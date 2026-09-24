# Step 01b — Physics sign, strain and panel-end fix (BUILD-PLAN M2 Part 0)

| | |
|---|---|
| **Built by** | Claude Code (Adarsh asked Claude to build Monday's steps directly, 14 Sep) |
| **Files** | `mine-sim/src/minesim/physics.py`, `mine-sim/tests/unit/test_physics.py` |
| **Signatures changed** | None |
| **Tests** | `22 passed` after fixes 1–3 (was 15); `19 passed` for physics + G01 after fix 4. Full output: `test_results.txt` |

## What was wrong and what changed

1. **`displacement()` pointed away from the trough.** `tilt = dS/dx` with S positive down already points toward deeper ground, so the old leading minus sign flipped it. Now `ux = +B · tilt_x · 1e-3`, `B = r/√(2π)` unchanged.
2. **`strain()` differenced vertical subsidence**, so it returned tilt. It now differences horizontal displacement along the axis: `(u(x + b/2) − u(x − b/2)) / b`, in µε. Positive = tension.
3. **The face ran past the panel end.** `subsidence()` now uses `x_face = min(face_position(t), panel.length_m)` for the extracted length.
   - **Extra fix (not in the plan text):** the settling clock used the same `x_face`. With only the clamp, ground near the panel end would stop settling when the face stops, e.g. x = 2400 m would freeze at ~28% forever. The clock now uses the time since the face passed x, `(face_position(t) − x) / v`, which keeps running. Identical to the old value before the face reaches the panel end. Test: `test_ground_near_panel_end_settles_fully`.

4. **Cliff at the moving face (found while building M1, not in the plan).** The old `subsidence()` used the time since the face passed behind the face, but the *overall* run time ahead of it. On day 300 that made S jump from **0.31 mm just behind the face to 455 mm just ahead**, and unmined ground sank more than mined ground. Tilt at the face was ~2,270,000 µrad. Every artefact (nodes.csv, 3D view, ML data) would have carried that cliff.
   **Fix:** the Knothe time model applied properly. Each point relaxes toward the static profile at rate c (`dS/dt = c (S_static − S)`), where the static profile follows the moving face and stops at the panel end. The convolution integral is solved in closed form inside `subsidence()` (erf/erfc, no second function, G01 still passes). Checks: continuous at the face (53.46 vs 53.33 mm on day 300); every point monotone in time (min ΔS −1e-13 over a 3000 m × 800-day sweep); long-term limit unchanged (930.02 mm at x = 1000); peak on day 690 **927.06 mm** (was 927.09). Tests: `test_continuous_at_the_face`, `test_more_subsidence_behind_the_face`, `test_monotone_in_time`, `test_peak_near_long_term_value`.
   This model is the same ODE that `fitting.py`'s `1 − exp(−c·t)` term assumes for a sudden change, so the pinned `c` now means the same thing in both places (partly addresses R0-4's time-model mismatch).

`face_position()` keeps its contract signature and still returns the unclamped clock. Callers that draw the face on screen use `min(face_position(t), panel.length_m)`.

## Before / after (Adriyala, x = 1000 m, day 690, baseline 10 m)

| y (m) | S before | S after | uy before | uy after | tilt_y | strain_y before | strain_y after |
|---|---|---|---|---|---|---|---|
| 0 | 927.09 | 927.06 | 0.00 | 0.00 | 0.00 | 0.00 | **−1429.45** (compression) |
| 60 | 852.27 | 852.24 | +151.36 | **−151.36** | −3126.95 | −3131.41 | **−4217.31** |
| 150 | 283.47 | 283.46 | +326.88 | **−326.87** | −6752.87 | −6744.35 | **+3470.82** (tension) |
| 200 | 56.77 | 56.77 | +112.46 | **−112.45** | −2323.22 | −2329.08 | **+3595.85** |

| S at y = 0, day 690 | before | after |
|---|---|---|
| x = 2400 m | 643.70 | 630.21 |
| x = 2500 m (panel end) | 532.86 | 289.23 |
| x = 2600 m | 378.91 | 10.77 |
| x = 2500 + 3r = 2864 m | 14.73 | **0.00** |

After all four fixes the peak at (1000, 0, 690) is **927 mm** (measured 1267 mm; the −27% gap is R0-3 / DEC-1, not touched here). r = 121.33 m.

## New tests

`test_displacement_points_toward_trough`, `test_strain_tension_outside_rib`, `test_strain_compression_over_centre`, `test_strain_is_not_tilt`, `test_face_stops_at_panel_end`, `test_ground_near_panel_end_settles_fully`, plus the four fix-4 tests above.

**Changed test:** `test_baseline_sensitivity_strain` compared 10 m vs 30 m at the rib (y = 125). True horizontal strain crosses zero at the rib, so it now compares at the y of peak |strain|. The old location only "worked" because strain was secretly tilt.

## Invariants

- 4 (one S): G01 still passes. Strain and displacement are built from `tilt`, which calls `subsidence`. No new erf.
- Contract §2 signatures: unchanged.
- Sign rule at boundaries: `physics` keeps S positive down internally. WP4 converts to negative-down at the csv boundary and negates tilt (BUILD-PLAN M3 Part B).
