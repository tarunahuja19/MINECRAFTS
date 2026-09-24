# F7 — Calm the view: status dots, one honest colour ramp, thinner ground

**In plain words:** Stop drawing 374 pieces of 3D hardware all the time. Nodes become small dots coloured by whether they are reporting or not; the 3D models come back when you zoom in or click one. The sinking colours stop being a rainbow — shallow sinking barely tints the ground, and red only means deep. The isolated-segment slab gets thinner.

**Plan:** Adarsh's three decisions, 17 Sep (session 20). Renderer only — no re-run, no re-export needed.

**Why:** a subsidence engineer reads a plan view with contours and a dot grid. What we draw today reads as "we modelled hardware", not "we measured ground". Three measured defects behind it:
- `node_models.visual_scale: 9.0` — hardware is only visible because we draw it nine times true size.
- `Ramps.DEPTH_STOPS` is an 8-stop rainbow (blue→violet→magenta→dark red) normalised as `t = depth / peakMm`. 150 mm out of a 1200 mm peak already lands on saturated blue `#1778ff`, so there is no "barely sunk" appearance anywhere on the scale. And because it divides by the *running* peak, the colour of a given millimetre value changes between frames.
- `display.segment_cut_depth_m: 100.0` on a 250 m segment is a slab 40 % as tall as it is wide.

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md, sih-26-finale-brain/RULES.md, WP8-consequence-renderer.md §3, steps/F0-fix-the-system-plan.md, steps/F6-district-shell-graphics.md and this step. Branch feat/viz-darker-ground-bigger-nodes, do not commit. Only edit the files listed. If the spec can't be implemented as written, STOP and tell me why. No magic numbers: every threshold goes in renderer/config.yaml with "# source: display choice (F7)". Terrain is context only: never feeds S(x,y,t), never writes Z. No minesim.physics in renderer/. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

STEP F7 · Status dots by default, single-hue depth ramp, thinner slab

Files you may edit: renderer/js/ramps.js, renderer/js/network.js, renderer/js/terrain.js, renderer/js/app.js, renderer/index.html, renderer/config.yaml, renderer/export_scene.py, renderer/tests/test_export_scene.py, walkthroughs/step-f7-calm-view/*.

A. Nodes become status dots
1. Default at EVERY zoom level: one flat screen-space dot per node, config zoom.icon_px (keep 18 for now but expose zoom.dot_px, default 7 — a dot is not an icon). Shape carries tier (1A circle, 1B square, 1C triangle, anchor diamond, gateway larger diamond with a ring). FILL CARRIES STATUS, not tier. Status comes from the readings frame already loaded (renderer/scene/frames/readings_*.bin) — read it, do not invent a new field:
   reporting = normal; late = missed its expected report; silent = no report this frame; low battery.
   Four fills in config.yaml display.status_colors with "# source: display choice (F7)". Silent must be the loudest of the four — a dead sensor is the thing an operator is scanning for.
2. DELETE the cluster count badges entirely (this.clusters in js/network.js and the badge draw + the pick path at js/network.js:248). Overlapping dots at low zoom are fine and wanted: density is information, and a hole in the lattice is exactly what a planner is looking for. Removing the badges also removes the last click-to-zoom path, which F6 A3 already wanted gone.
3. 3D models are drawn ONLY when either: view width <= zoom.models_below_view_m (lower it to 120.0), OR the node is the current selection (then draw its model whatever the zoom, so clicking a dot anywhere shows the hardware). Nothing else draws a model.
4. Set node_models.visual_scale to 1.0 — true size. Models are now a zoom/selection reward, so they no longer need to be inflated. If a selected node's model is then sub-pixel at the current zoom, draw the model AND keep its dot; do not re-inflate.
5. Picking keeps working at every level against the dot's pixel radius (zoom.pick_px).

B. One honest depth ramp
1. Replace Ramps.DEPTH_STOPS with a single-hue sequential ramp, monotone in CIE L*, running ground-green -> pale straw -> amber -> orange -> deep red. No blue. No violet. Solve it on an L* schedule the way HEIGHT_STOPS was solved (the file already documents that method) and write the L* of each stop in a comment. The ramp must stay distinguishable from HEIGHT_STOPS: HEIGHT is dark-green-to-mid-green and never leaves green; DEPTH starts near the ground colour and leaves green immediately for warm hues.
2. FIX THE SCALE ABSOLUTELY. In js/terrain.js:343, replace `t = Math.min(1, depth / this.peakMm)` with `t = Math.min(1, depth / RAMP_FULL_SCALE_MM)` where RAMP_FULL_SCALE_MM comes from config.yaml display.depth_ramp_full_scale_mm, default 1300.0, commented "# source: display choice (F7) — fixed so a given millimetre value is the same colour in every frame; 1300 sits just above the measured Adriyala peak of 1267 mm (10.18311/jmmf/2022/32099)". Any depth beyond full scale clamps to the last stop. Keep the existing `depth > 2` cut-in and the FADE_IN_MM blend.
3. Drop Ramps.SUBSIDENCE_SHADOW from 0.22 to 0.08.
4. Contours now carry the numbers. Default opts.contours stays on; make the contour lines more visible than they are now (they are currently overpowered by the fill) and label the legend bar in millimetres at 0 / 325 / 650 / 975 / 1300 against the fixed scale. The legend must state the full-scale value, because it is now fixed rather than per-frame.

C. Thinner ground
1. display.segment_cut_depth_m: 100.0 -> 30.0, updating its comment to say why (a 250 m segment cut 100 m deep reads as a tower, not a landscape).
2. Leave display.shell_thickness_m at 12.0 — measured at the 2000 m default view it is 0.6 % of the frame and is not the problem.

D. One inert config key
renderer/config.yaml vertical_exaggeration: 10.0 is read ONLY by export_scene.py:314 and stamped into scene.json; the live view runs on the "Sink exaggeration" slider, which defaults to 25 (index.html:251). So scene.json claims x10 while the screen shows x25. Make the slider's default value read from config vertical_exaggeration, so the one key drives both and scene.json stops lying. Do not change the on-screen "vertical xN" chip (js/app.js:446) — it is already correct and already visible.

Tests: renderer/tests/test_export_scene.py gains — DEPTH_STOPS contains no stop whose blue channel exceeds its red channel (i.e. the rainbow is gone); depth_ramp_full_scale_mm is present and > 0; segment_cut_depth_m <= 40; status_colors has all four keys; scene.json vertical_exaggeration equals the config value. Keep the existing assertion that cluster_px >= icon_px only if cluster_px still exists; if you delete clustering, delete that assertion too and say so.

Screenshots at day 345, all at the default zoom level unless stated: (1) whole panel, dots only, showing the lattice and at least one silent node; (2) same view with the new depth ramp, contours on — the shallow outer trough must read as barely-tinted ground; (3) a selected node at default zoom showing its model beside its dot; (4) an isolated 250 m segment at the new 30 m cut depth; (5) the legend bar with its millimetre labels.

Report: renderer pytest count, mine-sim pytest count (must be unchanged at 157 passed / 1 skipped — this step touches no mine-sim file), scene.json size, the five screenshots, and the L* value of each new DEPTH stop. Write the walkthrough. STOP.
```

## 2 · Paste into Claude (check)

```text
Check step F7
```

Claude checks: the depth ramp is monotone in L* and has no blue/violet stop; full scale is fixed, not per-frame; a 150 mm reading renders as a faint tint and a 1200 mm reading renders deep red; cluster badges are gone from both draw and pick paths; `visual_scale` is 1.0 and models really are gated on zoom-or-selection; status comes from the readings frame and is not invented; nothing under `mine-sim/` changed.

## 3 · You check by hand

| # | Do | You should see |
|---|---|---|
| 1 | Open the view at the default zoom | Small dots in a regular lattice — no 3D hardware, no number badges |
| 2 | Look at the trough edge | Ground barely tinted at the edge; colour deepens toward the centre; red only in the deepest part |
| 3 | Drag the day slider from 0 to 690 | A patch of ground that is a given colour keeps that colour once it stops sinking — colours no longer shift as the peak grows |
| 4 | Click one dot | Its 3D model appears at true size, at this zoom, next to the dot |
| 5 | Isolate a 250 m segment | A slab of landscape, not a tower |

## 4 · Fix prompt (only if Claude's check found problems)

_Empty until Claude's check._
