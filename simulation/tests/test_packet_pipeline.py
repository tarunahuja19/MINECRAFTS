import pytest
from starlette.testclient import TestClient

from sandbox.packet import NodeAccumulator, PacketAggregator, AggregationFunc
from sandbox.session import SimulationSession
from sandbox.server import app, get_session
from sandbox.ml_hook import process_simulation_packet, register_ml_handler, unregister_ml_handler


def test_packet_aggregator_60s_boundary():
    """Verify that readings are collected into 60-second packets and finalized at boundaries."""
    aggregator = PacketAggregator(window_duration_sim_s=60.0, session_id="TEST01", grid_id="G8")
    # packet_id is seeded from epoch-milliseconds (monotonic + unique across
    # runs), not a fixed 1, so assert on the id the aggregator actually started
    # from and its per-window increments.
    first_id = aggregator.current_packet_id

    # Tick at t = 0..59s with dt = 1.0 (inside packet 0, since 0+1=1 <= 60, ... 58+1=59 < 60)
    for t in range(0, 59):
        readings = [
            {
                "node_id": 1,
                "tier": "1A",
                "strain_ue": float(t * 10),
                "tilt_x_urad": -50.0 if t % 2 == 0 else 20.0,
                "tilt_y_urad": 10.0,
                "ext_delta_mm": float(t * 0.01),
                "temp_c": 25.0 + t * 0.05,
                "vbat_mv": 3700 - t,
                "alive": 1,
            },
            {
                "node_id": 2,
                "tier": "1B",
                "strain_ue": 100.0,
                "vbat_mv": 3600,
                "alive": 1,
            }
        ]
        completed = aggregator.add_tick(
            t_sim_seconds=float(t),
            tick_duration_s=1.0,
            readings=readings
        )
        assert completed is None, f"Packet should not finalize prematurely at t={t}"

    # Tick 59 (from 59.0 to 60.0): tick_end_sim = 59.0 + 1.0 = 60.0 >= 60.0 -> packet 0 finalizes!
    tick_59_readings = [
        {"node_id": 1, "tier": "1A", "strain_ue": 590.0, "vbat_mv": 3641, "alive": 1},
        {"node_id": 2, "tier": "1B", "strain_ue": 50.0, "vbat_mv": 3550, "alive": 1}
    ]
    completed_pkt = aggregator.add_tick(
        t_sim_seconds=59.0,
        tick_duration_s=1.0,
        readings=tick_59_readings
    )
    assert completed_pkt is not None, "Packet 1 must be finalized when window reaches 60s"
    assert completed_pkt["packet_id"] == first_id
    assert completed_pkt["start_sim_time"] == 0.0
    assert completed_pkt["end_sim_time"] == 60.0
    assert len(completed_pkt["nodes"]) == 2

    # Check node 1 aggregates in packet 1
    n1 = next(n for n in completed_pkt["nodes"] if n["node_id"] == 1)
    assert n1["reading_count"] == 60
    assert n1["aggregates"]["max_strain"] == 590.0  # max of 0..590
    assert n1["aggregates"]["max_tilt_x"] == -50.0  # max magnitude of |-50.0|
    assert n1["aggregates"]["min_battery"] == 3641  # min vbat
    assert n1["aggregates"]["last_alive"] == 1

    # Verify that the aggregator moved to packet 2 immediately
    assert aggregator.current_packet_id == first_id + 1
    assert aggregator.window_start_sim_s == 60.0
    assert aggregator.window_end_sim_s == 120.0

    # Ingest tick 60 into packet 2
    pkt_1_reading = [{"node_id": 1, "tier": "1A", "strain_ue": 999.0, "vbat_mv": 3600, "alive": 1}]
    completed_pkt_1 = aggregator.add_tick(
        t_sim_seconds=60.0,
        tick_duration_s=1.0,
        readings=pkt_1_reading
    )
    assert completed_pkt_1 is None
    assert aggregator.current_packet_id == first_id + 1
    assert aggregator._node_accumulators[1].reading_count == 1


def test_simulation_session_emits_packet():
    """Verify that SimulationSession generates packets and triggers callbacks."""
    sess = SimulationSession()
    packets_generated = []

    def on_packet(pkt: dict):
        packets_generated.append(pkt)

    sess.register_packet_callback(on_packet)

    # Tick simulation across 3 ticks (each tick is 60 sim-seconds)
    for _ in range(3):
        delta = sess.tick()
        if "packet_available" in delta:
            notif = delta["packet_available"]
            assert notif["packet_id"] >= 1
            assert notif["end_sim_time"] > notif["start_sim_time"]

    assert len(packets_generated) >= 1
    assert packets_generated[0]["packet_id"] >= 1
    assert len(packets_generated[0]["nodes"]) == len(sess.sensor_array.nodes)  # matches active nodes in array


def test_ml_hook_integration():
    """Verify process_simulation_packet invokes registered ML hooks."""
    handled_packets = []

    def dummy_ml_handler(pkt: dict):
        handled_packets.append(pkt["packet_id"])

    register_ml_handler(dummy_ml_handler)
    try:
        sample_pkt = {
            "packet_id": 42,
            "session_id": "ML_TEST",
            "grid_id": "G8",
            "start_sim_time": 0.0,
            "end_sim_time": 60.0,
            "nodes": [],
            "terrain": {"changed": False, "changes": []},
            "events": [],
        }
        process_simulation_packet(sample_pkt)
        assert 42 in handled_packets
    finally:
        unregister_ml_handler(dummy_ml_handler)


def test_fastapi_packet_endpoints():
    """Test FastAPI GET endpoints for packet retrieval."""
    client = TestClient(app)
    sess = get_session()

    # Ensure a packet exists in the session packet buffer. packet_id is
    # epoch-ms seeded, so capture the ids this run actually produced.
    sess.packet_aggregator.reset(t_start_sim_s=0.0)
    base_id = sess.packet_aggregator.current_packet_id
    for _ in range(2):
        sess.tick()

    # Two ticks -> two finalized packets: base_id and base_id + 1.
    resp_latest = client.get("/simulation/packets/latest")
    assert resp_latest.status_code == 200
    pkt = resp_latest.json()
    assert pkt["packet_id"] == base_id + 1
    assert pkt["session_id"] == sess.session_id

    # Test packet by id
    resp_by_id = client.get(f"/simulation/packets/{base_id}")
    assert resp_by_id.status_code == 200
    assert resp_by_id.json()["packet_id"] == base_id

    # Test non-existent packet
    resp_404 = client.get("/simulation/packets/99999")
    assert resp_404.status_code == 404

    # Test list packets
    resp_list = client.get("/simulation/packets?limit=10")
    assert resp_list.status_code == 200
    assert len(resp_list.json()) >= 1
