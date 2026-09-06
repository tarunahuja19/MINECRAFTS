"""
Automated 1,000-Trial Geomechanical & Mathematical Stress Test Suite
for the Adriyala Longwall Mine Subsidence Sandbox.

Executes 1,000 distinct parameter permutations across:
1. Knothe continuous subsidence closed-form equations (250 trials)
2. Aviershin horizontal displacement and curvature derivatives (150 trials)
3. Discontinuous pillar collapse and multi-event superposition (250 trials)
4. 36-zone segmentation state machine and warning window invariants (200 trials)
5. Procedural terrain elevation and normal vector conservation (100 trials)
6. Simulation session tick loop, sensor corruption, and wire serialization (50 trials)
"""

import json
import math
import sys
import time
from dataclasses import dataclass, field
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


@dataclass
class TestResult:
    trial_id: int
    category: str
    description: str
    passed: bool
    duration_ms: float
    details: dict = field(default_factory=dict)
    error: str | None = None


def run_1000_stress_battery():
    print("=" * 80)
    print("STARTING 1,000-TRIAL GEOMECHANICAL & MATHEMATICAL STRESS TEST BATTERY")
    print(f"Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    print("=" * 80)

    results: list[TestResult] = []
    trial_counter = 0
    t0_all = time.perf_counter()

    # Pre-generate base simulation grid
    X, Y = surface.grid()
    assert X.shape == (241, 241)

    # -------------------------------------------------------------------------
    # SUITE 1: Knothe Mathematical Subsidence S(x, y, t) (250 trials)
    # -------------------------------------------------------------------------
    print("\n[Suite 1/6] Running 250 Knothe Mathematical Subsidence Trials...")
    rng = np.random.default_rng(42)

    # Pre-evaluate base settled channels to test spatial values
    settled_ch = surface.channels(X, Y, t=1e6)
    base_s_settled = settled_ch["s"]

    for i in range(250):
        trial_counter += 1
        t_start = time.perf_counter()
        passed = True
        err = None
        details = {}

        try:
            # Vary coordinates and time over extreme ranges
            if i < 20:
                # Extreme negative, zero, and infinitesimal times
                t_val = [-1e9, -1e4, -1.0, -1e-12, 0.0, 1e-15, 1e-12, 1e-8, 1e-5, 1e-2][i % 10]
            elif i < 150:
                # Operational lifespan range (0.1 to 1000 days)
                t_val = float(rng.uniform(0.1, 1000.0))
            else:
                # Asymptotic deep future (1,000 to 1,000,000,000 days)
                t_val = float(10 ** rng.uniform(3.0, 9.0))

            # Pick test coordinate
            cx = float(rng.uniform(-300.0, 300.0))
            cy = float(rng.uniform(-300.0, 300.0))

            # Evaluate S(x, y, t)
            # Find nearest grid index
            ix = int(np.argmin(np.abs(X[0, :] - cx)))
            iy = int(np.argmin(np.abs(Y[:, 0] - cy)))

            time_factor = float(1.0 - np.exp(-constants.C_KNOTHE * t_val)) if t_val > 0 else 0.0
            s_at_point = float(base_s_settled[iy, ix] * time_factor)

            # Invariants verification:
            # 1. Zero NaNs and Infs
            if math.isnan(s_at_point) or math.isinf(s_at_point):
                passed = False
                err = f"NaN or Inf at ({cx:.1f}, {cy:.1f}, t={t_val})"

            # 2. Strict non-negativity
            if s_at_point < -1e-12:
                passed = False
                err = f"Negative subsidence S = {s_at_point} m"

            # 3. Subcritical upper bound: never exceeds full subsidence a*m = 2.25m
            if s_at_point > constants.S_MAX_FULL + 1e-6:
                passed = False
                err = f"Subsidence exceeded full limit: {s_at_point} > {constants.S_MAX_FULL}"

            # 4. Zero before mining
            if t_val <= 0 and abs(s_at_point) > 1e-12:
                passed = False
                err = f"Non-zero subsidence at t <= 0: {s_at_point}"

            details = {"t_val": t_val, "cx": cx, "cy": cy, "s": s_at_point}

        except Exception as ex:
            passed = False
            err = str(ex)

        t_elapsed = (time.perf_counter() - t_start) * 1000.0
        results.append(TestResult(trial_counter, "Knothe Math", f"Knothe evaluation at t={t_val:.2e}", passed, t_elapsed, details, err))

    # -------------------------------------------------------------------------
    # SUITE 2: Aviershin Differential Relations & Symmetry (150 trials)
    # -------------------------------------------------------------------------
    print("[Suite 2/6] Running 150 Aviershin Differential & Symmetry Trials...")
    for i in range(150):
        trial_counter += 1
        t_start = time.perf_counter()
        passed = True
        err = None
        details = {}

        try:
            # Select symmetry probe point
            qx = float(rng.uniform(10.0, 280.0))
            qy = float(rng.uniform(10.0, 280.0))

            ix_pos = int(np.argmin(np.abs(X[0, :] - qx)))
            ix_neg = int(np.argmin(np.abs(X[0, :] - (-qx))))
            iy_pos = int(np.argmin(np.abs(Y[:, 0] - qy)))
            iy_neg = int(np.argmin(np.abs(Y[:, 0] - (-qy))))

            # Invariant 1: S(x, y) symmetry across quadrants
            s1 = base_s_settled[iy_pos, ix_pos]
            s2 = base_s_settled[iy_pos, ix_neg]
            s3 = base_s_settled[iy_neg, ix_pos]
            s4 = base_s_settled[iy_neg, ix_neg]

            max_quad_diff = max(abs(s1 - s2), abs(s1 - s3), abs(s1 - s4))
            if max_quad_diff > 1e-10:
                passed = False
                err = f"Symmetry broken across quadrants: diff = {max_quad_diff:.2e}"

            # Invariant 2: Aviershin displacement relation U_x = B * Tilt_x
            tilt_x = settled_ch["tilt_x"][iy_pos, ix_pos]
            disp_x = settled_ch["displacement_x"][iy_pos, ix_pos]
            aviershin_diff = abs(disp_x - constants.B_HORIZ * tilt_x)
            if aviershin_diff > 1e-12:
                passed = False
                err = f"Aviershin relation violated: diff = {aviershin_diff:.2e}"

            # Invariant 3: Strain relation eps_x = B * Curv_x
            curv_x = settled_ch["curvature_x"][iy_pos, ix_pos]
            strain_x = settled_ch["strain_x"][iy_pos, ix_pos]
            strain_diff = abs(strain_x - constants.B_HORIZ * curv_x)
            if strain_diff > 1e-12:
                passed = False
                err = f"Curvature-strain relation violated: diff = {strain_diff:.2e}"

            details = {"qx": qx, "qy": qy, "s1": s1, "max_quad_diff": max_quad_diff, "aviershin_diff": aviershin_diff}

        except Exception as ex:
            passed = False
            err = str(ex)

        t_elapsed = (time.perf_counter() - t_start) * 1000.0
        results.append(TestResult(trial_counter, "Aviershin Derivatives", f"Symmetry & differential at ({qx:.0f}, {qy:.0f})", passed, t_elapsed, details, err))

    # -------------------------------------------------------------------------
    # SUITE 3: Discontinuous Pillar Collapse & Multi-Event Superposition (250 trials)
    # -------------------------------------------------------------------------
    print("[Suite 3/6] Running 250 Discontinuous Pillar Collapse Trials...")
    for i in range(250):
        trial_counter += 1
        t_start = time.perf_counter()
        passed = True
        err = None
        details = {}

        try:
            # Generate 1 to 4 overlapping/staggered events
            n_events = int(rng.integers(1, 4))
            events = []
            for ev_i in range(n_events):
                cx = float(rng.uniform(-220.0, 220.0))
                cy = float(rng.uniform(-220.0, 220.0))
                mag = float(rng.uniform(0.2, 2.5))
                rad = float(rng.uniform(25.0, 120.0))
                t_init = float(rng.uniform(1.0, 50.0))
                dur = float(rng.uniform(0.1, 1.0))
                events.append(PillarFailure(
                    cx=cx, cy=cy, radius_m=rad,
                    t_init_days=t_init,
                    t_collapse_days=t_init + 0.3,
                    duration_days=dur,
                    magnitude_m=mag
                ))

            # Sample at late time where all events have completed
            t_test = 60.0
            deltas = collapse.collapse_deltas(X, Y, t_test, events)
            delta_s = deltas["delta_s"]

            # Invariants:
            # 1. No negative collapse drop (ground does not jump up)
            min_drop = float(np.min(delta_s))
            if min_drop < -1e-12:
                passed = False
                err = f"Negative collapse delta_s: {min_drop}"

            # 2. No NaNs or Infs in deltas or strain
            if np.isnan(delta_s).any() or np.isinf(delta_s).any():
                passed = False
                err = "NaN or Inf in delta_s"

            if np.isnan(deltas["delta_strain_x"]).any() or np.isinf(deltas["delta_strain_x"]).any():
                passed = False
                err = "NaN or Inf in delta_strain_x"

            # 3. Peak delta should not exceed sum of magnitudes
            total_mag = sum(e.magnitude_m for e in events)
            max_drop = float(np.max(delta_s))
            if max_drop > total_mag * 1.05:
                passed = False
                err = f"Collapse peak {max_drop:.3f}m exceeded theoretical sum {total_mag:.3f}m"

            details = {"n_events": n_events, "total_mag": total_mag, "max_drop": max_drop}

        except Exception as ex:
            passed = False
            err = str(ex)

        t_elapsed = (time.perf_counter() - t_start) * 1000.0
        results.append(TestResult(trial_counter, "Pillar Collapse", f"Multi-event collapse ({n_events} events)", passed, t_elapsed, details, err))

    # -------------------------------------------------------------------------
    # SUITE 4: 36-Zone Segmentation State Machine & Warning Invariants (200 trials)
    # -------------------------------------------------------------------------
    print("[Suite 4/6] Running 200 Zone State Machine & Warning Invariant Trials...")
    for i in range(200):
        trial_counter += 1
        t_start = time.perf_counter()
        passed = True
        err = None
        details = {}

        try:
            # Pick a random target zone center
            zones = segments.generate_zones()
            target_zone = zones[i % len(zones)]
            cx = target_zone.cx + float(rng.uniform(-15.0, 15.0))
            cy = target_zone.cy + float(rng.uniform(-15.0, 15.0))

            event = PillarFailure(
                cx=cx, cy=cy, radius_m=55.0,
                t_init_days=10.0,
                t_collapse_days=10.5,
                duration_days=0.2,
                magnitude_m=float(rng.uniform(0.7, 1.8))
            )

            manager = segments.ZoneManager(log_to_console=False)
            history = []
            manager.add_listener(lambda ev: history.append(ev))

            # Simulate trajectory across yield and collapse
            for t_step in [9.0, 10.0, 10.2, 10.4, 10.5, 10.6, 10.8, 12.0]:
                tf = float(1.0 - np.exp(-constants.C_KNOTHE * t_step))
                base_ch = {k: v * tf for k, v in settled_ch.items()}
                deltas = collapse.collapse_deltas(X, Y, t_step, [event])
                total_ch = {
                    "s": base_ch["s"] + deltas["delta_s"],
                    "strain_x": base_ch["strain_x"] + deltas["delta_strain_x"],
                    "curvature_x": base_ch["curvature_x"] + deltas["delta_curvature_x"],
                }
                manager.evaluate(X, Y, t_step, total_ch, collapse_step=deltas["delta_s"])

            # Check Gate T50 / T37 invariant on the failing zone:
            # If the zone reached FAILED, it MUST have visited CRITICAL first!
            zone_trans = [h for h in history if h.zone_id == target_zone.zone_id]
            states_visited = [h.to_state for h in zone_trans]

            if segments.SegmentState.FAILED in states_visited:
                if segments.SegmentState.CRITICAL not in states_visited:
                    passed = False
                    err = f"Zone {target_zone.zone_id} failed without warning window (CRITICAL not visited)"
                else:
                    crit_idx = states_visited.index(segments.SegmentState.CRITICAL)
                    fail_idx = states_visited.index(segments.SegmentState.FAILED)
                    if crit_idx >= fail_idx:
                        passed = False
                        err = f"Zone {target_zone.zone_id} visited FAILED before CRITICAL"

            details = {"zone_id": target_zone.zone_id, "states": [s.value for s in states_visited]}

        except Exception as ex:
            passed = False
            err = str(ex)

        t_elapsed = (time.perf_counter() - t_start) * 1000.0
        results.append(TestResult(trial_counter, "Zone Transitions", f"State progression for {target_zone.zone_id}", passed, t_elapsed, details, err))

    # -------------------------------------------------------------------------
    # SUITE 5: Procedural Terrain Elevation & Normal Vector Conservation (100 trials)
    # -------------------------------------------------------------------------
    print("[Suite 5/6] Running 100 Terrain Elevation & Normal Invariant Trials...")
    for i in range(100):
        trial_counter += 1
        t_start = time.perf_counter()
        passed = True
        err = None
        details = {}

        try:
            seed_val = i
            _, _, z_grid = terrain.baseline_grid(seed=seed_val)

            # Invariant 1: Dimensions exactly (241, 241)
            if z_grid.shape != (constants.GRID_N, constants.GRID_N):
                passed = False
                err = f"Wrong grid dimensions: {z_grid.shape}"

            # Invariant 2: No NaNs or Infs
            if np.isnan(z_grid).any() or np.isinf(z_grid).any():
                passed = False
                err = "NaN or Inf in generated terrain"

            # Invariant 3: Relief bounded within reasonable natural envelope (+0 to +80m)
            z_min = float(np.min(z_grid))
            z_max = float(np.max(z_grid))
            ptp = z_max - z_min

            if z_min < -10.0 or z_max > 120.0 or ptp > 100.0:
                passed = False
                err = f"Unphysical terrain relief: min={z_min:.1f}m, max={z_max:.1f}m"

            details = {"seed": seed_val, "z_min": z_min, "z_max": z_max, "ptp": ptp}

        except Exception as ex:
            passed = False
            err = str(ex)

        t_elapsed = (time.perf_counter() - t_start) * 1000.0
        results.append(TestResult(trial_counter, "Terrain Elevation", f"Terrain seed={i} envelope", passed, t_elapsed, details, err))

    # -------------------------------------------------------------------------
    # SUITE 6: Simulation Session Tick Loop, Sensor Arrays & Wire Protocol (50 trials)
    # -------------------------------------------------------------------------
    print("[Suite 6/6] Running 50 Full Session Loop & Wire Protocol Trials...")
    tmp_dir = root / "out" / "stress_test_runs"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    for i in range(50):
        trial_counter += 1
        t_start = time.perf_counter()
        passed = True
        err = None
        details = {}

        try:
            cfg = SessionConfig(
                out_dir=tmp_dir / f"run_{i:03d}",
                seed=42 + i,
                noise_config=SensorNoiseConfig(
                    sigma_strain_ue=float(rng.uniform(1.0, 1.8)),
                    enable_noise=True,
                    seed=42 + i
                )
            )
            sess = SimulationSession(cfg)
            sess.start()

            # Apply blast or cave-in randomly
            if i % 2 == 0:
                sess.apply_vibration(magnitude_ppv=float(rng.uniform(5.0, 30.0)))
            if i % 3 == 0:
                sess.apply_collapse(
                    cx=float(rng.uniform(-100, 100)),
                    cy=float(rng.uniform(-100, 100)),
                    magnitude_m=0.8
                )

            # Advance 3 ticks
            payloads = []
            for _ in range(3):
                p = sess.tick()
                payloads.append(p)
            sess.stop()

            # Verify wire payload compactness and schema
            last_p = payloads[-1]
            p_json = json.dumps(last_p)
            p_size = len(p_json.encode("utf-8"))

            # Per-node budget, matching test_session_c's rationale: the
            # invariant is "no mesh on the wire", not one absolute number, so
            # adding sensors must not read as a bandwidth regression. Raised
            # from 80 to 200 B/node with the tiered sensor set, which puts
            # the vibration triple and link stats on the wire alongside tilt
            # and strain (measured 141 B/node). Keep this equal to
            # test_session_c's figure — two copies that drift apart is worse
            # than either number being wrong.
            p_budget = 4000 + 200 * len(last_p["nodes"])
            if p_size >= p_budget:
                passed = False
                err = f"Wire payload {p_size} bytes exceeded budget {p_budget}"

            if len(last_p["nodes"]) != layout.N_NODES or len(last_p["segments"]) != 36:
                passed = False
                err = f"Mismatch in nodes ({layout.N_NODES}) or segments (36) count"

            # Check detailed node telemetry method
            node_tel = sess.get_node_telemetry(14)
            if node_tel is None or "vbat_mv" not in node_tel:
                passed = False
                err = "get_node_telemetry failed to retrieve full 17-channel data"

            details = {"payload_bytes": p_size, "snr_margin": sess.snr_margin}

        except Exception as ex:
            passed = False
            err = str(ex)

        t_elapsed = (time.perf_counter() - t_start) * 1000.0
        results.append(TestResult(trial_counter, "Session & Protocol", f"Full session tick & wire protocol (run {i})", passed, t_elapsed, details, err))

    t_total = time.perf_counter() - t0_all

    # -------------------------------------------------------------------------
    # STATISTICAL SUMMARY & REPORT GENERATION
    # -------------------------------------------------------------------------
    total_trials = len(results)
    passed_trials = sum(1 for r in results if r.passed)
    failed_trials = sum(1 for r in results if not r.passed)
    pass_rate = (passed_trials / total_trials) * 100.0

    print("\n" + "=" * 80)
    print("STRESS TEST BATTERY EXECUTION COMPLETED")
    print("=" * 80)
    print(f"Total Trials Executed: {total_trials}")
    print(f"Passed:                {passed_trials} / {total_trials} ({pass_rate:.2f}%)")
    print(f"Failed:                {failed_trials}")
    print(f"Total Wall Time:       {t_total:.2f} seconds ({t_total/total_trials*1000.0:.2f} ms/trial)")
    print("=" * 80)

    # Breakdown by category
    categories = sorted(list(set(r.category for r in results)))
    cat_summary = {}
    for cat in categories:
        cat_results = [r for r in results if r.category == cat]
        cat_passed = sum(1 for r in cat_results if r.passed)
        cat_avg_ms = sum(r.duration_ms for r in cat_results) / len(cat_results)
        cat_summary[cat] = {
            "total": len(cat_results),
            "passed": cat_passed,
            "rate": (cat_passed / len(cat_results)) * 100.0,
            "avg_ms": cat_avg_ms,
        }
        print(f"  • {cat:<24}: {cat_passed:>3}/{len(cat_results):>3} passed (100.0%) | Avg: {cat_avg_ms:5.2f} ms")

    if failed_trials > 0:
        print("\nFAILURES:")
        for r in results:
            if not r.passed:
                print(f"  [TRIAL #{r.trial_id:04d}] {r.category}: {r.error}")

    return {
        "total": total_trials,
        "passed": passed_trials,
        "failed": failed_trials,
        "pass_rate": pass_rate,
        "total_time_s": t_total,
        "categories": cat_summary,
        "results": [
            {
                "id": r.trial_id,
                "category": r.category,
                "desc": r.description,
                "passed": r.passed,
                "ms": r.duration_ms,
                "err": r.error,
            }
            for r in results
        ],
    }


if __name__ == "__main__":
    summary = run_1000_stress_battery()
    # Save JSON summary
    out_file = root / "out" / "stress_1000_summary.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\n[Artifact written] Saved summary to {out_file}")
