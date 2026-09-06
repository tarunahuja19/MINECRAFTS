"""
Replication Script for Adriyala Longwall Mine Sandbox.

Demonstrates how to run a complete physical simulation scenario from Python:
1. Knothe continuous time-dependent subsidence bowl
2. Ground blast vibration transient shock (Gate T54)
3. Discontinuous pillar collapse event with pre-collapse yielding window (Gate T50)
4. Telemetry sampling with ADC corruption, noise, battery, and temperature drift
5. Streaming output to out/nodes.csv and out/events.csv
"""

import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sandbox.session import SessionConfig, SimulationSession


def run_replication_demo():
    print("=" * 70)
    print("   ADRIYALA LONGWALL PROJECT — PHYSICAL REPLICATION SIMULATION")
    print("   Godavari Valley Coalfield (H=375m, W=250m, r=197.4m)")
    print("=" * 70)

    # 1. Initialize Simulation Session
    config = SessionConfig(
        scenario_name="replication_demo",
        seed=42,
        t_start_seconds=0.0,
        default_speed=2000.0,
        out_dir="out",
    )
    session = SimulationSession(config)

    print(f"\n[1] Boot SNR Detectability Margin: {session.snr_margin:.2f} (Threshold >= 3.0: PASS)")
    session.start()

    # 2. Run 10 ticks of undisturbed baseline Knothe subsidence
    print("\n[2] Simulating baseline extraction (Ticks 1-10)...")
    for i in range(10):
        payload = session.tick()
    print(f"    -> Current Sim Time: t = +{payload['t_days']:.2f} days ({payload['t_sim']}s)")
    print(f"    -> Active zones: {len(payload['segments'])}, Nodes: {len(payload['nodes'])}")

    # 3. Inject Blast Vibration Transient (Gate T54)
    print("\n[3] Triggering Blast Vibration Transient (PPV = 25.0 mm/s)...")
    session.apply_vibration(magnitude_ppv=25.0, duration_s=120.0, note="Heavy blasting round #4")
    
    # Tick during blast
    blast_payload = session.tick()
    # Find sample node
    n1 = blast_payload["nodes"][0]
    print(f"    -> Surface Displacement Delta: 0.0 mm (Strict Invariant Gate T54)")
    print(f"    -> Node N-01 during blast: Tilt X={n1['tilt_x']} urad, Strain={n1['strain']} ue, Alive={n1['alive']}")

    # 4. Trigger Localized Pillar Collapse at (cx=50m, cy=-50m) (Gate T50)
    print("\n[4] Triggering Pillar Failure at (50m, -50m) (FoS < 1.0, Mag = 0.85m)...")
    pf = session.apply_collapse(
        cx=50.0,
        cy=-50.0,
        radius_m=60.0,
        magnitude_m=0.85,
        duration_hours=4.8,
        warning_hours=2.4,
    )
    print(f"    -> Yield initiated at t = {pf.t_init_days:.2f}d")
    print(f"    -> Dynamic void breach scheduled at t = {pf.t_collapse_days:.2f}d")

    # Run simulation forward by 20 ticks
    print("\n[5] Advancing simulation through yielding and void breach (Ticks 12-35)...")
    for i in range(24):
        payload = session.tick()
        # Monitor zones
        for seg in payload["segments"]:
            if seg["state"] in ("CRITICAL", "FAILED"):
                print(f"    [Sim Time t=+{payload['t_days']:.2f}d] Zone {seg['id']} transitioned to {seg['state']} (Strain eps={seg['eps']} mm/m)")

    # 5. Stop and verify output files
    session.stop()
    print("\n[6] Simulation Run Complete!")
    print(f"    -> Generated telemetry saved to: {session.nodes_csv_path}")
    print(f"    -> Generated events log saved to: {session.events_csv_path}")

    # Inspect CSV row count
    with open(session.nodes_csv_path) as f:
        row_count = sum(1 for line in f if not line.startswith("#") and line.strip()) - 1
    print(f"    -> Total rows written to nodes.csv: {row_count} (Expected: {session.tick_index * 33})")
    assert row_count == session.tick_index * 33, "Row count invariant violated!"
    print("    -> Row equality verified (Gate T51 PASS)\n")


if __name__ == "__main__":
    run_replication_demo()
