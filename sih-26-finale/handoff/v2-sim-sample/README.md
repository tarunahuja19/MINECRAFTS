# v2 sample — simulator output, 690 days, planned network (F4, 16 Sep 2026)

**Simulator output. Mostly synthetic; subsidence on the 17 survey-line nodes is `real` (6 survey days) or `pinned`.**

| | |
|---|---|
| Generated | 2026-09-16 by Claude Code (step F4), `./run-simulation.sh --no-view` (1,096 s total; simulation 871 s) |
| Seed | `20260913`; same seed gives byte-identical files |
| Network | **planned network v3** (`layout.source: plan`): 327 Scouts (1A 12, 1B 133, 1C 182), 47 Anchors, 1 Gateway — ₹906,500 |
| Rows (full run) | **5,415,120** = 327 scouts × 16,560 hourly epochs; 0 duplicate `(node_id, epoch)` |
| Delivered | 5,413,014 (99.96 %); 108,218 via emergency retry |
| Peak subsidence | 1,204 mm (unchanged: the ground model did not change) |
| Provenance | real 102 values, pinned 281,418 (1.51 %), synthetic 98.49 % |

## ⚠ `nodes.csv.gz` here holds the survey-line nodes only

The full `nodes.csv` is 624 MB, and its gzip is over the 50 MB handoff limit. This `nodes.csv.gz` therefore holds only
the **17 survey-line nodes** (zone `survey_line` in `mine-sim/out/plan/node_plan.json`): **281,520 rows**, same
columns. `NODES_GZ_CONTENTS.txt` says `survey_line_only`. The full file is on Adarsh's laptop at
`mine-sim/out/v2-690d/nodes.csv`. `nodes_first_1000_rows.csv` is the first 1,000 rows of the full file.

---

## Earlier: 25-node travelling cross (session 08, 14 Sep) — superseded by the section above


**Simulator output. Mostly synthetic; subsidence on 9 survey-line nodes is `real` (6 survey days) or `pinned` (every other hour).**

| | |
|---|---|
| Generated | 2026-09-14 by Claude Code (session 08) |
| Command | `cd mine-sim && python -m minesim.run --days 690 --out out/v2-690d` (70 s) |
| Seed | `20260913`; same seed gives byte-identical files |
| Mine | Adriyala LW1 (DOI 10.18311/jmmf/2022/32099): 250 m × 2500 m panel, 375 m deep, face 4 m/day |
| Fit behind it | Knothe + inflection offset, RMS 52 mm, R² 0.985 against 283 field points (was 178 mm / 0.82) |
| Rows | **414,000** = 25 sensor nodes × 16,560 hourly epochs |
| Delivered | 413,838 (99.96%); 162 rows `delivered=false`; 8,350 via emergency retry |
| Network | 25 Scouts (1A 15, 1B 9, 1C 1), 4 Anchors, 1 Gateway — ₹65,800 |

## What changed from v1 (why numbers moved)

| | v1 | v2 | Why |
|---|---|---|---|
| Peak subsidence | 930 mm | **1,204 mm** (field 1,267) | Trough edges sit 59 m inside the ribs (inflection offset); fit error cut 3× |
| Where the cross sits | x = 1250 m (mid-panel) | **x = 258 m, on survey line S** | So nodes stand on survey monuments |
| Provenance | 100% synthetic | **9.09% pinned, 0.003% real**, 90.9% synthetic | Subsidence at the 9 monument nodes (IDs 100–108) |
| Scouts | 33 | 25 | Narrower effective trough (extent 424 m) and 655 m travelling window |
| Tiers | percentile cut (split identical nodes) | natural breaks of rod-axis strain; 1A only where tilt is detectable | W2, W3 |

## Files

| File | What |
|---|---|
| `nodes.csv.gz` | 14 Sep: full data (54 MB unzipped). **16 Sep: survey-line nodes only, see top** |
| `nodes_first_1000_rows.csv` | First 1,000 rows |
| `run_summary.json` | Counts, cost, delivery, provenance, fit quality |
| `terrain_state.npz` | Terrain at t = 0 (int32 mm grid 617 × 167, 5 m cells) |

Columns are unchanged from v1 (contract §7.1). **Negative subsidence = ground went down. Dedupe on `(node_id, epoch)`.**

## What you will see

- The face reaches the survey line (x = 258 m) on day 65; monument nodes sink from about day 60 and are ~95% settled by day 210.
- Along-panel nodes run from x = −92 m (behind the start rib) to x = 608 m; the far ones sink as the face passes them (x = 608 m starts moving around day 150).
- `subsidence_prov = real` appears on 6 survey days (210, 300, 540, 570, 600, 690) at nodes 100–108: that value is the digitised field measurement, not the simulator. Expect it to differ from the neighbouring hours by the fit error (worst 54 mm). `pinned` = simulated value at a monument position.
- Tilt on 1A nodes carries a ±3,000 µrad day/night drift; **average over 24 h** and it cancels (it is a pure daily cycle), leaving ~20 µrad noise. Every 1A node sits where the real tilt is at least 3× that.
- Horizontal strain reaches −13,000 µε (compression) over the trough centre: the measured trough is narrow and deep, so curvature is high.
