"""
Comprehensive End-to-End Integration Verification (§Phase 12).

Tests the full loop:
Simulation (Folder B)
    -> Node readings inserted into PostgreSQL (`mine_subsidence`)
    -> 60s aggregation packet created and saved to PostgreSQL
    -> Packet posted to Folder A Backend (`http://localhost:8080`)
    -> Backend broadcasts `packet_available` over WebSocket (`ws://localhost:8080/ws`)
    -> Client receives notification and requests `GET /simulation/packets/:id`
    -> Packet 2 generated without stopping simulation
"""

import asyncio
import json
from pathlib import Path
import sys
import time
import urllib.request

# Ensure simulation_making is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import websockets

from sandbox.constants import TICK_SIM_SECONDS
from sandbox.db import db_manager
from sandbox.session import SessionConfig, SimulationSession


async def test_full_pipeline():
    print("\n" + "=" * 70)
    print("  PHASE 12 END-TO-END INTEGRATION TEST")
    print("=" * 70)

    # 1. Verify backend health
    print("\n[Step 1] Checking Folder A Backend health...")
    try:
        with urllib.request.urlopen("http://localhost:8080/api/health", timeout=3.0) as res:
            health_data = json.loads(res.read().decode())
            print(f"  -> Backend is healthy: database='{health_data.get('database')}', nodes={health_data.get('counts', {}).get('nodes')}, readings={health_data.get('counts', {}).get('readings')}")
    except Exception as e:
        print(f"  -> [FAILED] Could not connect to backend on port 8080: {e}")
        return False

    # 2. Connect WebSocket client (simulating frontend listener)
    print("\n[Step 2] Connecting WebSocket client to ws://localhost:8080/ws (simulating frontend)...")
    ws_uri = "ws://localhost:8080/ws"
    received_notifications = []

    async def ws_listener(ws):
        try:
            async for raw in ws:
                data = json.loads(raw)
                print(f"  [Frontend WS Client] Received frame: type={data.get('type')}, packet_id={data.get('packet_id')}")
                if data.get("type") == "packet_available":
                    received_notifications.append(data)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"  [Frontend WS Client] Closed: {e}")

    ws = await websockets.connect(ws_uri)
    listener_task = asyncio.create_task(ws_listener(ws))

    # 3. Connect simulation db_manager to PostgreSQL
    print("\n[Step 3] Connecting simulation system to PostgreSQL database...")
    db_ok = await db_manager.connect()
    assert db_ok, "Failed to connect to PostgreSQL"
    print(f"  -> Connected to PostgreSQL: {db_manager.is_connected}")

    # 4. Measure initial readings and packet counts
    initial_packets = await db_manager.list_packets(limit=10)
    initial_packet_count = len(initial_packets)

    # 5. Initialize simulation session and tick
    print("\n[Step 4 & 5] Starting simulation session and generating node readings...")
    session_config = SessionConfig(
        scenario_name="adriyala_sandbox",
        default_speed=50.0,
        save_packet_json=True
    )
    session = SimulationSession(session_config)
    session.set_speed(50.0)
    session.start()

    # --- PACKET 1 (0 to 60 sim-seconds) ---
    print("\n[Step 6, 7 & 8] Advancing simulation 60s -> Packet 1 window...")
    payload1 = session.tick()
    assert payload1 is not None, "Tick 1 failed"
    pkt1 = session.last_finalized_packet
    assert pkt1 is not None, "Packet 1 was not finalized on tick 1"
    print(f"  -> Packet 1 generated: id={pkt1['packet_id']}, sim_time={pkt1['start_sim_time']}s-{pkt1['end_sim_time']}s, nodes={len(pkt1['nodes'])}")

    # Persist and forward to backend
    await db_manager.save_packet(pkt1)
    await db_manager.post_packet_to_backend(pkt1)

    # Allow time for WS broadcast and frontend fetch
    await asyncio.sleep(0.5)

    # --- Verify Packet 1 in PostgreSQL and Backend ---
    print("\n[Step 9 & 10] Verifying Packet 1 available via Backend REST API...")
    url1 = f"http://localhost:8080/simulation/packets/{pkt1['packet_id']}"
    with urllib.request.urlopen(url1, timeout=3.0) as res:
        fetched_pkt1 = json.loads(res.read().decode())
        assert fetched_pkt1["packet_id"] == pkt1["packet_id"]
        assert len(fetched_pkt1["nodes"]) == len(pkt1["nodes"])
        print(f"  -> Successfully fetched Packet 1 from backend: {fetched_pkt1['packet_id']}")

    # --- PACKET 2 (60 to 120 sim-seconds) ---
    print("\n[Step 11 & 12] Advancing simulation without stopping -> Packet 2 window (60s to 120s)...")
    payload2 = session.tick()
    assert payload2 is not None, "Tick 2 failed"
    pkt2 = session.last_finalized_packet
    assert pkt2 is not None, "Packet 2 was not finalized on tick 2"
    assert pkt2["packet_id"] != pkt1["packet_id"], "Packet 2 must have distinct packet_id"
    print(f"  -> Packet 2 generated: id={pkt2['packet_id']}, sim_time={pkt2['start_sim_time']}s-{pkt2['end_sim_time']}s, nodes={len(pkt2['nodes'])}")

    # Persist and forward to backend
    await db_manager.save_packet(pkt2)
    await db_manager.post_packet_to_backend(pkt2)

    await asyncio.sleep(0.5)

    # --- Verify Packet 2 in Backend ---
    url2 = f"http://localhost:8080/simulation/packets/{pkt2['packet_id']}"
    with urllib.request.urlopen(url2, timeout=3.0) as res:
        fetched_pkt2 = json.loads(res.read().decode())
        assert fetched_pkt2["packet_id"] == pkt2["packet_id"]
        print(f"  -> Successfully fetched Packet 2 from backend: {fetched_pkt2['packet_id']}")

    # --- PACKET 3 (120 to 180 sim-seconds) ---
    print("\n[Step 13 & 14] Continuing continuous run -> Packet 3 window...")
    payload3 = session.tick()
    pkt3 = session.last_finalized_packet
    await db_manager.save_packet(pkt3)
    await db_manager.post_packet_to_backend(pkt3)
    await asyncio.sleep(0.5)

    # 6. Verify WebSocket notifications received by client
    print("\n[Step 15] Verifying WebSocket notifications received by frontend...")
    print(f"  -> Total 'packet_available' notifications received: {len(received_notifications)}")
    notif_ids = [n.get("packet_id") for n in received_notifications]
    print(f"  -> Notification packet IDs: {notif_ids}")
    assert pkt1["packet_id"] in notif_ids, f"Packet {pkt1['packet_id']} notification was not received over WebSocket"
    assert pkt2["packet_id"] in notif_ids, f"Packet {pkt2['packet_id']} notification was not received over WebSocket"

    # Clean up
    listener_task.cancel()
    await ws.close()
    session.stop()
    await db_manager.close()

    print("\n" + "=" * 70)
    print("  ALL INTEGRATION VERIFICATION CHECKS PASSED SUCCESSFULLY!")
    print("  Simulation -> PostgreSQL -> Packet -> WebSocket -> Frontend OK")
    print("=" * 70 + "\n")
    return True


if __name__ == "__main__":
    success = asyncio.run(test_full_pipeline())
    sys.exit(0 if success else 1)
