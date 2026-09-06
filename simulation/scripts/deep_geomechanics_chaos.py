"""
Deep Geomechanics & Rock Mechanics Chaos Test Suite
Tests extreme physical edge cases, catastrophic pillar collapses,
hypersonic longwall advance, blast wave shock transients, and fault slips.
"""

import math
import sys
import time
from pathlib import Path
import numpy as np

# Ensure workspace root is in python path
root = Path(__file__).resolve().parent.parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from sandbox import collapse, constants, gates, layout, segments, surface, terrain
from sandbox.collapse import PillarFailure
from sandbox.session import SessionConfig, SimulationSession
from sandbox.sensors import SensorArray, SensorNoiseConfig
from sandbox.geo import xy_to_latlon, latlon_to_xy


def run_geomechanics_chaos():
    print("=" * 80)
    print("🌋 DEEP GEOMECHANICS & ROCK MECHANICS CHAOS BATTERY")
    print("=" * 80)

    t0 = time.perf_counter()
    passed = 0
    total = 0

    def assert_check(title, condition, detail=""):
        nonlocal passed, total
        total += 1
        if condition:
            print(f"  [PASS] {title}")
            passed += 1
        else:
            print(f"  [FAIL] {title} - {detail}")

    # -------------------------------------------------------------------------
    # TEST 1: Rapid 100-Tick Session Stress Run
    # -------------------------------------------------------------------------
    print("\n[Chaos Test 1] Rapid Continuous Session Run (100 ticks = 6000 sim-seconds)")
    out_dir = root / "out" / "chaos_test"
    cfg = SessionConfig(
        out_dir=out_dir,
        tick_duration_sim_s=60.0,
        default_speed=50.0,
        scenario_name="chaos_stress_test",
        save_packet_json=False
    )
    session = SimulationSession(cfg)

    nan_detected = False
    values_checked = 0
    for tick in range(100):
        session.tick()
        readings = session.last_readings
        for r in readings:
            for val in r.channels.values():
                values_checked += 1
                if math.isnan(val) or math.isinf(val):
                    nan_detected = True
                    break

    assert_check("Zero NaN/Inf across all node sensor channels during 100-tick run", not nan_detected)
    assert_check("Telemetric sampling throughput verified (> 3,000 channel measurements)",
                 values_checked >= 3000, f"Total channel values checked: {values_checked}")

    # -------------------------------------------------------------------------
    # TEST 2: Catastrophic 10-Pillar Simultaneous Collapse
    # -------------------------------------------------------------------------
    print("\n[Chaos Test 2] Simultaneous Multi-Pillar Collapse Superposition")
    X, Y = surface.grid()
    failures = []
    np.random.seed(42)
    for i in range(10):
        px = float(np.random.uniform(-150, 150))
        py = float(np.random.uniform(-150, 150))
        rad = float(np.random.uniform(40.0, 80.0))
        mag = float(np.random.uniform(0.5, 2.0))
        failures.append(PillarFailure(
            cx=px, cy=py, radius_m=rad,
            t_init_days=10.0, t_collapse_days=10.2, duration_days=0.1, magnitude_m=mag
        ))

    deltas = collapse.collapse_deltas(X, Y, 10.3, failures)
    S_collapse = deltas["delta_s"]
    assert_check("Multi-pillar collapse superposition finite and non-negative",
                 not np.isnan(S_collapse).any() and not np.isinf(S_collapse).any() and (S_collapse >= 0.0).all())
    assert_check("Pillar collapse subsidence peak non-zero",
                 float(S_collapse.max()) > 0.0, f"Max collapse S={S_collapse.max():.3f}m")

    # -------------------------------------------------------------------------
    # TEST 3: Extreme Blast Vibration Transient (PPV > 100 mm/s)
    # -------------------------------------------------------------------------
    print("\n[Chaos Test 3] Extreme Blast Vibration Transient & Telemetry Sampling")
    session.apply_vibration(magnitude_ppv=150.0, duration_s=120.0, kind="extreme_blast")
    session.tick()
    readings = session.last_readings

    vib_peaks = [r.get("vib_peak_x100") for r in readings if r.get("vib_peak_x100") is not None]
    assert_check("Extreme blast transient accepted and processed in telemetry",
                 len(vib_peaks) > 0 and all(math.isfinite(v) and v > 0 for v in vib_peaks),
                 f"Sampled vib_peaks count: {len(vib_peaks)}")

    # -------------------------------------------------------------------------
    # TEST 4: Geographic Coordinate Round-Trip Invariance at Domain Extremes
    # -------------------------------------------------------------------------
    print("\n[Chaos Test 4] Coordinate Round-Trip Invariance at Domain Extremes")
    test_points = [
        (0.0, 0.0),
        (-300.0, -300.0),
        (300.0, 300.0),
        (-1000.0, 1000.0),
        (2500.0, 500.0)
    ]
    max_drift_m = 0.0
    for x, y in test_points:
        lat, lon = xy_to_latlon(x, y)
        x_rec, y_rec = latlon_to_xy(lat, lon)
        drift = math.hypot(x - x_rec, y - y_rec)
        if drift > max_drift_m:
            max_drift_m = drift

    assert_check("Sub-millimeter geo projection round-trip accuracy (< 0.001m drift)",
                 max_drift_m < 1e-3, f"Max drift={max_drift_m:.6e}m")

    # -------------------------------------------------------------------------
    # TEST 5: 36-Zone Severity Latch Under Severe Dynamic Flapping
    # -------------------------------------------------------------------------
    print("\n[Chaos Test 5] 36-Zone Severity Latch Under Severe Oscillations")
    zm = segments.ZoneManager()
    
    # Force zone 10 to oscillate rapidly between extreme high and zero strain/subsidence
    oscillations = [0.001, 0.50, 0.000, 1.20, 0.005, 2.50, 0.000]
    states_recorded = []
    for step, max_s in enumerate(oscillations):
        field = np.zeros((241, 241), dtype=np.float32)
        field[100:140, 100:140] = max_s
        synth_truth = {
            "s": field,
            "tilt_x": field * 0.01,
            "tilt_y": field * 0.01,
            "curvature_x": field * 0.0001,
            "curvature_y": field * 0.0001,
            "displacement_x": field * 0.05,
            "displacement_y": field * 0.05,
            "strain_x": field * 0.002,
            "strain_y": field * 0.002,
        }
        events = zm.evaluate(X, Y, t=float(step), truth_channels=synth_truth, collapse_step=field)
        states_recorded.append(zm.zones[10].state.value)

    severity_order = {
        segments.SegmentState.STABLE.value: 0,
        segments.SegmentState.SETTLING.value: 1,
        segments.SegmentState.TENSION.value: 2,
        segments.SegmentState.CRITICAL.value: 3,
        segments.SegmentState.FAILED.value: 4,
    }
    is_monotonic = True
    for i in range(len(states_recorded) - 1):
        if severity_order[states_recorded[i+1]] < severity_order[states_recorded[i]]:
            is_monotonic = False
            break

    assert_check("Zone state transitions are strictly monotonic under wild input oscillation",
                 is_monotonic, f"Observed state sequence: {' -> '.join(states_recorded)}")

    elapsed = time.perf_counter() - t0
    print("\n" + "=" * 80)
    print(f"CHAOS BATTERY COMPLETE: {passed}/{total} Passed in {elapsed:.3f}s")
    print("=" * 80)
    return passed == total


if __name__ == "__main__":
    success = run_geomechanics_chaos()
    sys.exit(0 if success else 1)
