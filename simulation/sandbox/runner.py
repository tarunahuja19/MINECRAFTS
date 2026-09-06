"""
Standalone simulation runner and data producer for the mine subsidence early warning system (§Phase 3, 4, 8).

Runs the physics tick loop, generates node readings, stores them in the authoritative
PostgreSQL database (`mine_subsidence`), generates 60-second packets, writes debug JSON,
and bridges to the existing backend (Folder A) to trigger real-time WebSocket notifications.
"""

import argparse
import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
import time
from typing import Any

# Ensure simulation_making root is in sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sandbox.constants import DEFAULT_SPEED_MULTIPLIER, TICK_SIM_SECONDS
from sandbox.db import db_manager
from sandbox.ml_hook import process_simulation_packet
from sandbox.session import SessionConfig, SimulationSession


async def run_simulation(
    num_ticks: int | None = None,
    speed: float = 10.0,
    save_json: bool = True,
    interventions: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Run the simulation loop and persist data to the existing PostgreSQL database."""
    print("=" * 65)
    print("  R4 MINE SUBSIDENCE SIMULATION ENGINE -> POSTGRESQL BRIDGE")
    print(f"  Speed Multiplier: {speed}x | Tick Duration: {TICK_SIM_SECONDS} sim-seconds")
    print("=" * 65)

    # 1. Connect to authoritative PostgreSQL database
    connected = await db_manager.connect()
    if connected:
        print("[RUNNER] Connected to existing PostgreSQL database.")
    else:
        print("[RUNNER] Running with local memory buffer fallback.")

    # 2. Configure and start session
    cfg = SessionConfig(
        default_speed=speed,
        save_packet_json=save_json,
        base_iso_time=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    )
    session = SimulationSession(cfg)
    session.set_speed(speed)
    session.start()

    # Apply any initial interventions if specified
    if interventions:
        for itv in interventions:
            if itv.get("kind") == "collapse":
                session.apply_collapse(
                    cx=itv.get("cx", 0.0),
                    cy=itv.get("cy", 0.0),
                    radius_m=itv.get("radius_m", 60.0),
                    magnitude_m=itv.get("magnitude_m", 0.75),
                    duration_hours=itv.get("duration_hours", 4.8),
                )
            elif itv.get("kind") == "vibration":
                session.apply_vibration(
                    magnitude_ppv=itv.get("magnitude", 15.0),
                    duration_s=itv.get("duration_s", 60.0),
                )

    completed_packets: list[dict[str, Any]] = []
    ticks_executed = 0

    try:
        while True:
            if num_ticks is not None and ticks_executed >= num_ticks:
                break

            # Execute single simulation tick (1 tick = 60 simulated seconds)
            payload = session.tick()
            ticks_executed += 1

            # Check if a 60-second packet was finalized
            if payload.get("packet_available") and session.last_finalized_packet:
                pkt = session.last_finalized_packet
                completed_packets.append(pkt)

                # Broadcast notification via Folder A backend HTTP endpoint
                notif_sent = await db_manager.post_packet_to_backend(pkt)
                status_str = "broadcast to Folder A backend" if notif_sent else "saved in PostgreSQL"
                print(f"[PACKET #{pkt['packet_id']}] 0–{pkt['end_sim_time']}s finalized -> {status_str}")

            # Sleep wall-clock time proportional to speed multiplier
            wall_sleep = max(0.01, TICK_SIM_SECONDS / max(1.0, session.speed_multiplier))
            await asyncio.sleep(wall_sleep)

    except KeyboardInterrupt:
        print("\n[RUNNER] Interrupted by user.")
    finally:
        session.stop()
        await db_manager.close()
        print(f"[RUNNER] Finished. Total ticks: {ticks_executed}, Total packets: {len(completed_packets)}")

    return completed_packets


def main():
    parser = argparse.ArgumentParser(description="Mine Subsidence Simulation Runner")
    parser.add_argument("--ticks", type=int, default=None, help="Number of ticks to run (default: infinite)")
    parser.add_argument("--speed", type=float, default=10.0, help="Simulation speed multiplier (default: 10.0)")
    parser.add_argument("--no-json", action="store_true", help="Disable debug JSON file writing")
    parser.add_argument("--collapse", action="store_true", help="Inject a test collapse intervention at startup")

    args = parser.parse_args()

    itvs = []
    if args.collapse:
        itvs.append({
            "kind": "collapse",
            "cx": 180.0,
            "cy": 0.0,
            "radius_m": 60.0,
            "magnitude_m": 1.2,
            "duration_hours": 2.0
        })

    asyncio.run(
        run_simulation(
            num_ticks=args.ticks,
            speed=args.speed,
            save_json=not args.no_json,
            interventions=itvs if itvs else None,
        )
    )


if __name__ == "__main__":
    main()
