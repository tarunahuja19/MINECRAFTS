# Step 03 — WP3 world state (BUILD-PLAN M3 Part A)

| | |
|---|---|
| **Built by** | Claude Code (at Adarsh's request, 14 Sep) |
| **Files** | `mine-sim/src/minesim/world.py`, `mine-sim/tests/unit/test_world.py`, `mine-sim/tests/gates/test_g06.py`, `mine-sim/tests/gates/test_g13.py` |
| **Contract** | §4 signatures unchanged. Additive read-only attributes: `cell_m`, `origin_x_m`, `origin_y_m`, `shape`, `z0_mm` (for `terrain_state.npz`), `t_s`, `t_days`, and `model_subsidence_mm(t_days)` (float physics on the grid, for checks and the Scenario Lab) |
| **Tests** | step files: see `test_results.txt`; whole suite at commit `75 passed` |

## How it works

- **Grid:** `np.int32` mm, shape `(nx, ny)` = **(598, 148)** at 5 m cells, `i` ↔ x, `j` ↔ y, cell centre `origin + (i + 0.5)·cell`. Footprint = panel + 2r on every side (origin −242.66 m, −367.66 m). Beyond 2r the Knothe influence is below 1e-6 of peak.
- **Step:** one vectorised `physics.subsidence` call on the broadcast `(nx,1) × (1,ny)` grid. `target = round(S_t)`, `dz = −(target − S_int)`, commit, emit only `dz ≠ 0`. **Never `round(S_t − S_{t−1})`.** Zero-motion steps emit a `Delta` with empty `cells`.
- **`z_at`:** bilinear over the four surrounding cell centres, clamped at the grid edge, float mm.
- No operator controls (a test scans method names for trigger/collapse/inject/blast/kill/deform).

## Results

| | |
|---|---|
| 690-day world-only run (16,560 steps) | **7.5 s** (target < 60 s) |
| Delta cells written over 690 days | 22,253,869 (max 1,638 in one step) |
| Peak grid subsidence, day 690 | **930 mm** (physics 927 at x = 1000; measured 1267 → −27%, R0-3, reported not tuned) |
| max \|grid S − round(physics S)\| after 690 days | **0** |

Size note for WP6: ~22 M delta cells is a few hundred MB of `terrain_changes.jsonl` for a 690-day run. BUILD-PLAN already says to share a 120-day run if the 690-day sample is over 50 MB.

## Gates

| Gate | Test | Negative |
|---|---|---|
| G06 | 2,400 steps (100 days): full replay and replay to step 1,200 are `np.array_equal` to the snapshots | `FloatAccumulatingWorld` (emits `round(S_t − S_{t−1})`) → replay ≠ snapshot, detected |
| G13 | `Node.z0_mm` and the world's `z0_mm` grid unchanged after 300 days while `z_at(1000, 0)` < −100 mm | assigning `Node.z0_mm` raises `FrozenInstanceError` |

Other tests: t=0 flat int32; axes/extent; every `dz < 0`, dense epochs, grid equals round(model) along a 30-day run (and an empty-delta step exists); ≤ 1 mm drift after 120 days; `z_at` exact at a cell centre and bounded between cells; `z_at` within 5 mm of physics; the 10 mm front tracks `face_position` within 2r and advances.
