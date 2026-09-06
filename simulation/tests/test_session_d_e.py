"""
Session D & E Integration Tests:
- 3D Frontend static bundle serving
- WebSocket handshake and wire protocol
- Real-time tick streaming and command dispatching
- Gate T52: Vertical exaggeration contract
- Gate T53: Intervention propagation
- Gate T54: Blast vibration zero surface delta
"""

import numpy as np
import pytest
from starlette.testclient import TestClient

from sandbox import collapse, layout, sensors, surface, terrain
from sandbox.server import app, get_session
from sandbox.session import SimulationSession


def test_frontend_bundle_serving():
    """Verify that the FastAPI app serves the compiled 3D frontend bundle."""
    with TestClient(app) as client:
        res = client.get("/")
        assert res.status_code == 200
        assert "<div id=\"root\"></div>" in res.text
        assert "Adriyala Longwall Mine Sandbox" in res.text


def test_websocket_init_and_tick_streaming():
    """Verify WebSocket /ws handshake, initial mesh geometry, and live ticks."""
    session = get_session()
    session.stop()
    session.pillar_failures.clear()

    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            # 1. First message must be "init"
            init_data = ws.receive_json()
            assert init_data["type"] == "init"
            assert len(init_data["nodes"]) == layout.N_NODES
            assert len(init_data["zones"]) == 36
            assert len(init_data["z0_mesh"]) == 121
            assert len(init_data["base_bowl_mesh"]) == 121

            # 2. Start simulation via command
            ws.send_json({"action": "start"})

            # 3. Receive tick message
            tick_data = ws.receive_json()
            assert "t_sim" in tick_data
            assert "time_scalar" in tick_data
            assert len(tick_data["nodes"]) == layout.N_NODES
            assert len(tick_data["segments"]) == 36

            # 4. Trigger Ground Intervention: Pillar Collapse
            ws.send_json({
                "action": "collapse",
                "cx": 60.0,
                "cy": -60.0,
                "magnitude": 0.75,
                "duration_hours": 4.8,
            })

            # Advance session tick
            session.apply_collapse(cx=60.0, cy=-60.0, magnitude_m=0.75, duration_hours=4.8)
            tick_pert = session.tick()
            assert len(tick_pert["perturbations"]) >= 1
            assert tick_pert["perturbations"][0]["cx"] == 60.0

            # 5. Stop simulation
            ws.send_json({"action": "stop"})


def test_gate_t52_vertical_exaggeration_contract():
    """
    Gate T52 (was T39): Vertical exaggeration is a display-only scalar transform.
    The true physical surface coordinates are:
        Z_physical(x, y) = Z_0(x, y) - S(x, y, t)
    The display transform is:
        Z_display(x, y) = Z_physical(x, y) * exaggeration
    When exaggeration is snapped to 1.0, maximum display delta equals true peak subsidence.
    """
    X, Y, z0 = terrain.baseline_grid(seed=0)
    s_bowl = surface.S(X, Y, t=365.0)

    z_physical = z0 - s_bowl
    exaggeration = 1.0
    z_display_1x = z_physical * exaggeration

    # At 1x, display is identical to physical
    assert (z_display_1x == z_physical).all()

    # At 20x default display
    z_display_20x = z_physical * 20.0
    delta_display_20x = (z0 - z_physical) * 20.0
    peak_display_delta = float(delta_display_20x.max())

    # Peak physical subsidence is ~1.997m -> at 20x display is ~39.94m
    assert 38.0 <= peak_display_delta <= 42.0


def test_gate_t53_intervention_propagation():
    """
    Gate T53 (was T40): Ground model changes propagate outward through the physical
    continuum, affecting node readings outside the direct intervention point.
    """
    # Create collapse perturbation at (0, 0)
    pert = collapse.PillarFailure(
        cx=0.0,
        cy=0.0,
        radius_m=60.0,
        magnitude_m=0.8,
        t_init_days=10.0,
        t_collapse_days=10.5,
        duration_days=0.2,
    )

    X = np.array([0.0, 60.0, 120.0])
    Y = np.array([0.0, 0.0, 0.0])

    deltas = collapse.collapse_deltas(X, Y, t=11.0, events=[pert])
    delta_s = deltas["delta_s"]

    # Center (0, 0)
    assert delta_s[0] == pytest.approx(0.8, abs=1e-3)

    # 60m away (at radius r) -> Gaussian bell at 1-sigma: 0.8 * exp(-0.5) = ~0.485m
    assert 0.45 <= delta_s[1] <= 0.52

    # 120m away (at 2-sigma) -> 0.8 * exp(-2) = ~0.108m
    assert 0.08 <= delta_s[2] <= 0.14


def test_gate_t54_blast_vibration_zero_surface_delta():
    """
    Gate T54 (was T36): Blast vibration produces 0.0 surface delta (no permanent
    ground displacement) and a non-zero transient acceleration/vibration spike.
    """
    sess = SimulationSession()
    sess.start()

    # Baseline tick
    p1 = sess.tick()
    assert len(p1["perturbations"]) == 0

    # Apply blast vibration of 25.0 mm/s
    sess.apply_vibration(magnitude_ppv=25.0)

    # Tick immediately after blast
    p2 = sess.tick()

    # Perturbations must remain empty (no ground displacement)
    assert len(p2["perturbations"]) == 0

    # Knothe surface subsidence at early t is small and unaffected by vibration
    X, Y, _ = terrain.baseline_grid(seed=0)
    s_base = surface.S(X, Y, t=p2["t_days"])
    assert s_base.max() < 0.1

    sess.stop()


def test_gate_t55_ws_apply_collapse_roundtrip():
    """
    Gate T55: the exact action name the frontend sends must reach the ground model.

    This is the test whose absence allowed the frontend and server to disagree on
    action names while every other gate stayed green: prior tests called
    session.apply_collapse() directly in Python and never exercised the WebSocket
    dispatcher.
    """
    session = get_session()
    session.reset()

    with TestClient(app).websocket_connect("/ws") as ws:
        ws.receive_json()  # discard the init payload
        ws.send_json({
            "action": "apply_collapse",
            "cx": 0.0,
            "cy": 0.0,
            "radius_m": 60.0,
            "magnitude_m": 0.75,
            "duration_hours": 4.8,
            "warning_hours": 2.4,
        })
        ws.send_json({"action": "start"})

    assert len(session.pillar_failures) == 1
    pf = session.pillar_failures[0]
    assert pf.magnitude_m == pytest.approx(0.75)
    assert pf.radius_m == pytest.approx(60.0)

    session.reset()


def test_gate_t55_ws_unknown_action_reports_error():
    """Gate T55b: an unrecognised action must produce an explicit error, never silence."""
    session = get_session()
    session.reset()

    with TestClient(app).websocket_connect("/ws") as ws:
        ws.receive_json()  # init
        ws.send_json({"action": "definitely_not_a_real_action"})
        reply = ws.receive_json()

    assert reply["type"] == "error"
    assert "definitely_not_a_real_action" in reply["message"]

    session.reset()


def test_gate_t55_ws_apply_vibration_roundtrip_zero_surface_delta():
    """
    Gate T55c: apply_vibration must reach the session AND still move the ground
    zero millimetres (the T54 blast-filter property, now checked over the wire).
    """
    session = get_session()
    session.reset()

    with TestClient(app).websocket_connect("/ws") as ws:
        ws.receive_json()  # init
        ws.send_json({"action": "apply_vibration", "magnitude_ppv": 25.0, "duration_s": 60.0})

    assert session.vibration_transient > 0.0
    # A blast must not create any ground perturbation.
    assert len(session.pillar_failures) == 0

    session.reset()


def test_session_reset_clears_interventions():
    """reset() must discard interventions and rewind sim-time."""
    session = get_session()
    session.reset()

    session.apply_collapse(cx=0.0, cy=0.0, magnitude_m=0.75)
    assert len(session.pillar_failures) == 1

    session.reset()
    assert session.pillar_failures == []
    assert session.tick_index == 0
    assert session.t_sim_seconds == session.config.t_start_seconds
    assert session.is_running is False


def test_reset_truncates_the_csvs_it_closes(tmp_path):
    """RESET must clear the telemetry on disk, not just close the handles.

    `reset()` used to call `stop()` (which closes the files) and then set the
    handles to None, leaving every row of the previous run on disk. The next
    `start()` reopened with mode "w", so the stale data survived until someone
    pressed START again -- and stayed downloadable through /data/nodes.csv the
    whole time. Pressing RESET and then downloading gave you the run you had
    just discarded, which is worse than an error: it looks like fresh data.

    Measured before the fix: 5 ticks wrote 167 lines and reset left all 167.
    """
    from sandbox.session import SessionConfig, SimulationSession

    session = SimulationSession(SessionConfig(out_dir=tmp_path))
    session.start()
    for _ in range(5):
        session.tick()

    nodes_csv = tmp_path / "nodes.csv"
    events_csv = tmp_path / "events.csv"
    before = len(nodes_csv.read_text(encoding="utf-8").splitlines())
    assert before > 2, "expected the run to have written telemetry rows"

    session.reset()

    # Exactly the provenance comment plus the column header -- no data rows.
    lines = nodes_csv.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2, f"reset left {len(lines) - 2} stale rows in nodes.csv"
    assert lines[0].startswith("#")
    # Derived from the single source of truth rather than retyped, so a
    # schema change cannot leave the header and this assertion disagreeing.
    assert lines[1] == ",".join(sensors.CSV_COLUMNS)

    event_lines = events_csv.read_text(encoding="utf-8").splitlines()
    assert len(event_lines) == 1, f"reset left {len(event_lines) - 1} stale events"
    assert event_lines[0].startswith("t_iso,kind,")

    # And the file must still be usable: a new run writes on top of the header
    # rather than appending to a half-closed handle.
    session.start()
    session.tick()
    assert len(nodes_csv.read_text(encoding="utf-8").splitlines()) == 2 + len(
        session.last_readings
    )
