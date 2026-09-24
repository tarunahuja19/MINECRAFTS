# Step F3 — Placement v3: full footprint, spacing by tier, spread anchors, link-aware siting

| Field | Details |
|---|---|
| **Built by** | Claude Code (16 Sep) |
| **Branch** | `fix/f3-placement` (from `fix/f2-zoom-scale`) → merged into `fix-the-system` |
| **Files** | `mine-sim/src/minesim/placement.py`, `mine-sim/config/assumptions.yaml` (`placement:` only), `mine-sim/tests/unit/test_placement.py` |
| **Tests** | mine-sim **147 passed** (138 + 9 new; the F2 failure is fixed) · renderer **13 passed** |
| **Planner runtime** | 6.1 s (`python -m minesim.placement`) |
| **Plots** | `top_view_v3.png`, `top_view_v2_before.png`, `view_day345_zoom2.png` (renderer, 4 km view) |

## Before / after (P1–P5)

| # | Before (v2, survey window, old DEM) | After (v3, full footprint, F2 DEM) |
|---|---|---|
| P1 sector | x −69 … 585 m (26 % of the panel); 237 scouts in 655 × 410 m | Sector `full` x −292 … 2,792 m; scouts x **−13 … 2,552 m** = **96.8 %** of the moving footprint (−77 … 2,573 m) |
| P2 code vs yaml | yaml said the sector moves; code static | `sector: full` default; `survey_window` kept and documented as **static** (test `test_survey_window_option_is_static`) |
| P3 spacing | 20 m for every tier; 1B 164/237 (69 %) | 1C **25** / 1B **50** / 1A **100** m. Counts 1C **182**, 1B **133**, 1A **12**. NN within tier (min · median): 1C 25.1 · 27.1, 1B 50.0 · 52.9, 1A 114 · 236 m. Coverage **0.9999**; gap pass added **13** |
| P4 anchors | 34 anchors, min spacing 31.6 m | **47** anchors (= ceil(327 / 7)); 7 centre pairs < 80 m, **6 merged and re-split**; final min spacing **42.4 m** (reported, not forced) |
| P5 blocked links | anchor 6/34, scout 17/237 | v2 siting rule on the v3 layout: anchor **25/47**, scout **61/327**. After link-aware siting + gateway iteration: anchor **22/47**, scout **63/327** |

Total **375 nodes** (1 gateway, 47 anchors, 327 scouts), cost **₹906,500** (was 272 nodes, ₹571,400). Worst link margin 43.8 dB (need 10). Steepest node 19.8° (limit 20°).

## What changed in the planner

1. **Sector** defaults to `full`: −2r … L+2r, |y| ≤ W/2 + 2r.
2. **Variable-radius Poisson disc.** `spacing_by_tier_m` replaces `scout_spacing_m` as the fill radius. `scout_spacing_m` is renamed `min_node_spacing_m` (20 m, hard minimum; the only readers were `placement.py` and two tests). Two scouts a, b placed in the main pass stay max(spacing[a], spacing[b]) apart. `tilt_spacing_m` (60 m) is removed; the 1A spacing of 100 m supersedes it.
3. **Each dart decides its tier from its own peak response** (one vectorised `_peak_fields` call for every candidate), and **only darts that actually move ≥ 10 mm are placed**. This fixes the F2 failure: jittered darts at the footprint edge could sit below the threshold. The old "relabel after placing" step is gone.
4. **Gap pass:** an installable moving cell farther than its own band spacing from every scout gets a scout at the cell centre (≥ `min_node_spacing_m` from everyone). It added 13.
5. **Anchors:** capacitated k-means unchanged (cap 8, contract §child_index untouched). Merge/re-split check at `min_anchor_spacing_m: 80`. Siting prefers a terrain-clear Fresnel path to the gateway, then the lowest tilt. **Bug fixed:** when every raster cell within 20 m of a centre was too steep, the old code put the anchor at the raw centre (anchor #11 at 34°). The search ring now widens in 20 m steps. Order: anchors (tilt) → gateway → anchors (clear first) → gateway → anchors.
6. **Checks added** to `node_plan.json` (no existing key removed): `nn_by_tier_m`, `coverage_fraction`, `moving_footprint_x_m`, `scouts_x_m`, `scout_x_span_fraction`, `gap_pass_added`, `anchor_pairs_closer_than_min_before_merge`, `anchor_pairs_merged`, `min_anchor_spacing_m`, `links_blocked_before_iteration`, `links_blocked`.
7. The gateway line-of-sight test is vectorised over all anchors (`_fresnel_clear_many`); the gateway ring on the 9 km DEM has ~5,000 candidates.

Node count is still an output (no target counts anywhere). Anchor IDs 1–47 are inside 1–99. Node fields are unchanged, so the renderer reads the plan as before.

## Honest notes for Adarsh

- **Blocked links are worse in absolute terms (22/47 anchors).** The network now spans 2.6 km of real terrain, not a 655 m corner. The gateway ring (500–1,000 m off the moving ground) has no spot that sees every anchor with 60 % Fresnel clearance at 2 m anchor antennas. Link-aware siting only moves an anchor within 20 m of its cluster, so it helps a little (25 → 22). Free-space margin is still ≥ 43.8 dB. Options (not built): taller anchor masts (A15 is 2 m), a relay anchor, or a second gateway. The sensor run's radio model does not use terrain, so this has no effect on nodes.csv.
- **1C sits along the panel centreline, not the side edges.** Peak horizontal strain (worst of x/y over the rod baseline) is highest in the x-direction behind the advancing face, along y ≈ 0. 1B takes the side bands, and 1A only the thin outer fringe where tilt is still detectable (12 nodes). That is what the fitted Knothe model says; I did not tune it.
- **Anchor spacing 42.4 m < 80 m.** With the cap at 8 and 1C at 25 m along a ~80 m strip, clusters are only ~60 m long, so centres can't all be 80 m apart. The check reports it.

## Tests

Existing tests updated only for the renamed keys (not loosened): `test_scouts_are_spaced_and_not_on_a_grid` (`scout_spacing_m` → `min_node_spacing_m`; the 1A check now uses 100 m instead of 60 m, which is stricter), `test_node_count_is_an_output_of_spacing` (scales `spacing_by_tier_m` × 1.5 instead of `scout_spacing_m`).

New: `test_sector_is_the_full_moving_footprint`, `test_scouts_span_the_moving_footprint_along_x` (≥ 90 %), `test_nn_spacing_per_tier_at_least_its_band_spacing` (excludes `survey_line`), `test_anchor_ids_in_range_parents_backups_and_cap`, `test_coverage_of_installable_moving_ground` (≥ 0.95), `test_every_scout_moves_by_its_own_response`, `test_v3_checks_present`, `test_deterministic_json_bytes`, `test_survey_window_option_is_static`. Kept: no grid (NN CV 0.42 > 0.1), determinism, flat-ground mine.
