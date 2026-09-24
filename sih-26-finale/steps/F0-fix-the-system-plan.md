# F0 — "Fix the system" plan (branch `fix-the-system`)

**Written 15 Sep 2026 by Claude (planner + checker). Antigravity writes the code. Adarsh decides.**

## What Adarsh asked (plain words)

1. Remove the wires all over the 3D view.
2. Check the node placement algorithm: the whole network sits in one small patch.
3. Let me zoom in and out with **+ / −** to fixed zoom levels. Show the terrain at its real size, so nodes aren't crammed together.
4. Give the three scout types (1A, 1B, 1C) clearly different designs.
5. Check the terrain data.
6. More data: a run longer than a year, played slowly (a full year ≈ one real day at 1×), with speed buttons 10×, 20×, 40× and faster.

## What Claude found (checked on the real files, 15 Sep)

| # | Finding | Evidence |
|---|---|---|
| 1 | **Wires**: 34 long arcs from the anchors to the gateway (1.4–2.0 km each) and 237 scout→anchor lines are on by default. The 1C 30 m wire and 1B 10 m rod are also drawn as long bars. | Screenshot, day 345. `renderer/js/network.js` `scoutLines`, `anchorLines`. |
| 2 | **Network sits in one corner.** Sector = `survey_window`, so x −69 … 585 m of a 2,500 m panel (26 %). Every scout is in a 655 × 410 m patch. | `node_plan.json` sector; x histogram 10/22/46/44/46/37/32 per 100 m. |
| 3 | **Nodes stop being useful after ~day 150.** The face moves 4 m/day. On day 345 it is at 1,380 m, and it passes 2,500 m before day 690. No node stands where the ground is actively moving. | `A6_face_advance_m_per_day: 4.0`; face 1,380 m on screen at day 345. |
| 4 | **Spec/code mismatch.** `assumptions.yaml` says the sector "is moved as the face advances". `_sector_bounds()` is static around survey line S. | `placement.py:189-198`. |
| 5 | **Too dense in that patch.** One spacing for every tier: 20 m (median 22.5 m). 1B takes 164 of 237 scouts (69 %). 1C is squeezed into \|y\| < 38 m. 1A is placed last and gets only the leftovers. | `checks`, tier bounding boxes. |
| 6 | **Anchors crowd.** 34 anchors, min spacing **31.6 m**. The cap of 8 children plus 20 m packing forces one anchor per ~7 scouts on a tiny patch. Radio has a huge margin to spare: the worst link still has 42.9 dB against 10 dB needed. | `checks.anchor_spacing_min_m`, `min_link_margin_db`. |
| 7 | 6 of 34 anchor→gateway links and 17 of 237 scout links are terrain-blocked. | `checks`. |
| 8 | **Nodes drawn ×1.8 oversize.** Pad radius ≈ 5 m, masts 11–54 m tall, pick radius 9 m, all on 20 m spacing. They overlap at every zoom. Config antenna heights are scout 2 m, anchor 2 m, gateway 10 m. | `network.js` `this.scale = 1.8`; `assumptions.yaml` A15. |
| 9 | **Terrain data OK but small.** Real SRTM-derived DEM, 380 × 230 cells × 15 m = 5.7 × 3.45 km (x −1,592 … 4,108 m, y −1,717 … 1,733 m), 71–212 m AMSL. The renderer draws only 800 m around the world grid. Site lat/lon and bearing are still **OPEN — VERIFY**. | `data/real/adriyala_lw1_dem.npz`, `renderer/config.yaml`. |
| 10 | **Data is long enough, the view isn't.** The run is already 690 days hourly (16,560 epochs) but has only the **25 old v1 nodes**. The view samples every 10 days (70 frames) and plays in "days per second". The planned 272-node network has no sensor data. | `run_summary.json`, `renderer/config.yaml day_step_days: 10`. |

## Decisions for Adarsh (Claude's default in bold; say if you want otherwise)

| ID | Question | Default |
|---|---|---|
| DF1 | What does 1× mean? | **1× = 6 simulated minutes per real second.** A full year then takes ≈ 24 h of real time. Speeds: 1×, 10×, 20×, 40×, 100×, 250×, 500×, 1000×, 5000×, 10000× (690 days in ~17 s). Set in `renderer/config.yaml`. |
| DF2 | Run length | **Keep 690 days.** That is longer than a year and covers the whole panel being mined (2,500 m ÷ 4 m/day = 625 d) plus settling. |
| DF3 | Should the planned network (≈300 nodes) become the network the sensor run simulates? | **Yes.** `nodes.csv` grows from 25 to ≈300 nodes, about 5 M rows (~0.6 GB). `size_network(cfg)` keeps its one-argument signature (contract §G2). |
| DF4 | Bigger terrain? | **Yes.** Refetch the DEM with `dem_margin_m` 1,300 → 3,000 m, so about 8.5 × 6.5 km. Needs internet once. |

## Order (one Antigravity chat at a time; F3 can run in a second chat in parallel with F1)

| Step | File | Touches | Depends on |
|---|---|---|---|
| F1 | [F1-no-wires-node-designs.md](F1-no-wires-node-designs.md) | `renderer/js/network.js`, `app.js`, `index.html` | — |
| F2 | [F2-zoom-scale-terrain.md](F2-zoom-scale-terrain.md) | `renderer/*`, `mine-sim/config/assumptions.yaml` (dem margin), DEM refetch | F1 |
| F3 | [F3-placement-spread.md](F3-placement-spread.md) | `mine-sim/src/minesim/placement.py`, `assumptions.yaml placement:`, placement tests | — (parallel with F1) |
| F4 | [F4-plan-network-daily-frames.md](F4-plan-network-daily-frames.md) | `mine-sim/src/minesim/sizing.py`, `run.py` (if needed), `renderer/export_scene.py`, `run-simulation.sh` | F2, F3 |
| F5 | [F5-playback-clock-speeds.md](F5-playback-clock-speeds.md) | `renderer/js/app.js`, `index.html`, `config.yaml` | F4 |

After each step: paste section 2 (`Check step Fn`) into Claude. Claude reruns tests, looks at screenshots, and writes PASS or a fix prompt.

## Guard rails every F prompt repeats

- Contract (`files/11-interface-contracts-v1.md`) wins inside `mine-sim/`. If a step can't be done without breaking it, **STOP and say why**.
- Terrain (DEM) never feeds S(x,y,t) and never writes Z (Invariants 1, 4). The renderer never imports `minesim.physics`.
- Every display or design number goes in config with a `# source:` comment. Negative = down.
- Report exact pytest counts: mine-sim (138 now), renderer tests (8 now).
