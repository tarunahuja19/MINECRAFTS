# F1 — Remove the wires, give every node type its own design

**In plain words:** Clean up the 3D view. Radio links appear only for the node you click, and each of the five node types gets a shape you can recognise at a glance.

**Plan:** [F0](F0-fix-the-system-plan.md) findings 1 and 8.

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md, sih-26-finale-brain/RULES.md, sih-26-finale-brain/work-packages/WP8-consequence-renderer.md (§3 safety rules), steps/F0-fix-the-system-plan.md and this step. Work on git branch fix-the-system (already created; do not commit). Only edit the files listed. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: display sizes go in renderer/config.yaml with a "# source:" comment (real hardware sizes: "OPEN — design choice" if not from a spec sheet). Sign at every boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts; never say "tests pass" without the number.

STEP F1 · No wires + distinct node designs

Files you may edit (nothing else): renderer/js/network.js, renderer/js/app.js, renderer/js/terrain.js (overlay lines only), renderer/index.html, renderer/config.yaml, renderer/export_scene.py (only to pass new config keys into scene.json), renderer/tests/test_export_scene.py, walkthroughs/step-f1-no-wires/WALKTHROUGH.md, test_results.txt, screenshots.

A. Remove the wires
1. Delete the always-on scout→anchor lines (scoutLines) and the 34 anchor→gateway arcs (anchorLines, the ARC code). Nothing link-shaped is drawn by default.
2. On click, select a node and draw only that node's links: scout → parent anchor (solid), scout → backup anchor (dashed), anchor → gateway (straight, not arced). Selecting an anchor also shows its children's links. A blocked link (link_clear false) is drawn red and labelled "terrain blocks radio".
3. Rename the "Radio links" layer to "All radio links (debug)", unchecked by default.
4. Angle-of-draw rays and panel corner posts: visible only when Underground X-ray is on. Face curtain: replace the vertical line comb with one thin solid band. "Monitoring sector" dashed box: unchecked by default.

B. Node designs (true size, in metres, from config)
Add renderer/config.yaml section node_models with sizes. Heights: use mine-sim/config/assumptions.yaml radio.A15_antenna_height_m (scout 2, anchor 2, gateway 10). Read it in export_scene.py and pass it to scene.json. Don't copy the numbers.
- 1A tilt scout: slim stake + small round tilt-meter capsule + small tilted solar plate. Teal. Icon: triangle.
- 1B strain-rod scout: square pad + box enclosure + the 10 m rod (sensing.A8_strain_rod_baseline_m) lying flat on the ground with a pin at the far end. Amber. Icon: square.
- 1C wire-extensometer scout: two short posts sensing.A9_extensometer_baseline_m apart joined by one thin taut wire at post height, bigger enclosure on the first post. Red. Icon: diamond. This wire is part of the sensor. It is not a radio link, so draw it thin and only when the camera is closer than node_models.detail_distance_m.
- Anchor: mast + router box + whip antenna. Blue. Icon: hexagon.
- Gateway: lattice tower + dish. White. Icon: star.
The beacon still shows how far that spot has sunk (existing depth ramp, grey below threshold). The pad colour still shows the tier. Delete the ×1.8 default scale: models are true size (scale 1.0). Keep the Node size slider, range 1–10, default 1. Make the pick target radius a config value, no larger than half the minimum scout spacing from scene.plan.checks.scout_nn_min_m.

C. Legend
The Planned-network legend shows the icon shape and the colour per tier (inline SVG), not just a colour square. Inspector text: "Beacon = how far this spot has sunk · shape = tier · click a node to see its radio links".

Tests (renderer/tests): scene.json carries the antenna heights and baselines taken from assumptions.yaml (compare to the yaml values); index.html has no "Radio links" checkbox checked by default; grep proves no minesim.physics in renderer/. Keep all existing tests.

Screenshots (headless Chrome is fine): overview at day 345 (no wires visible), network cam close-up with one scout selected (parent + backup link visible), close-up of one 1A, one 1B, one 1C, one anchor, the gateway.

Report: renderer pytest count, mine-sim pytest count (must still be 138), the screenshot paths, the list of changed files. Write walkthroughs/step-f1-no-wires/WALKTHROUGH.md and test_results.txt. Then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step F1
```

Claude checks: only the listed files changed; no link lines at default; sizes come from assumptions.yaml rather than copied numbers; five silhouettes can be told apart in the screenshots; tests rerun by Claude.

## 3 · You check by hand

```bash
./run-simulation.sh view
```

| # | Do | You should see |
|---|---|---|
| 1 | Page loads (overview) | No lines fanning out to the gateway, no line mesh over the nodes |
| 2 | Click a scout | White ring, a solid line to its anchor, a dashed line to its backup anchor |
| 3 | Click an anchor | Lines to its children and one straight line to the gateway |
| 4 | Zoom close to nodes | Triangle-stake 1A, rod-on-ground 1B, two-post-wire 1C: three different shapes |
| 5 | Tick "All radio links (debug)" | The old lines come back; untick → gone |

## 4 · Fix prompt (only if Claude's check found problems)

Claude's check (15 Sep, session 15): renderer **10 passed**, mine-sim **138 passed** (rerun by Claude), vault clean. Wires gone at default, click links work, blocked label works, legend SVG + inspector text right. Seven problems below.

```text
Before you start, read steps/F1-no-wires-node-designs.md (this file) and your walkthroughs/step-f1-no-wires/WALKTHROUGH.md. Branch fix-the-system, do not commit. Same file list as F1. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

STEP F1 · FIXES

1. Gateway tower has only 2 legs. In network.js the four legs use only ox; z is ignored, so pairs overlap (see 07_closeup_gateway.png). Add an oz offset to place() and refresh(), put the four legs at (±, ±), tapered from base_width_m to top_width_m (tilt each leg), and add at least two levels of cross bracing so it reads as a lattice. The dish must face outward, not look like a black ball.
2. Node size slider stretches real lengths. refresh() multiplies ox by S, so at size 10 the 1B rod is 100 m and the 1C wire is 300 m; the wire end also uses n.x_m + extLen*S. Baselines (rod, extensometer spacing) and the pick radius must stay true size at every slider value. Only the part geometry (pads, boxes, masts, beacon) scales with S.
3. 1C wire LOD uses the distance to the sector centre, not to the wires. Use the distance from the camera to the nearest 1C node (or per-wire visibility). Test by hand: close-up of a 1C far from the sector centre still shows its wire.
4. Copied numbers. network.js has fallbacks `|| { scout: 2.0, anchor: 2.0, gateway: 10.0 }`, `|| 10.0`, `|| 30.0`, and `|| <config value>` on every node_models key; terrain.js has `|| 1.5`. The spec says don't copy the numbers. Remove the fallbacks: if scene.json lacks node_models, throw a clear error ("re-export scene.json: node_models missing"). Also move the remaining literal sizes to config.yaml node_models with "# source:": the 0.025 m antenna stake on 1B/1C, the 0.2 m disc under 1C post 2, the backup dash length/gap (4/3 m), the selection ring radii.
5. TIER_SVG in app.js repeats the hex colours. Build the SVG fill from TIER_COLOUR so one table owns the colours.
6. The test test_scene_carries_antenna_heights_and_baselines_from_assumptions reads the file already on disk (renderer/scene/scene.json), so it passes even if export_scene.py breaks. Make it call export_scene() on the existing small 80-day fixture into tmp_path and check that output. Keep the other assertions.
7. WALKTHROUGH.md does not match the code: capsule "0.12 m dia" (config radius 0.14 → 0.28 m), 1C post "0.45 m" (config 0.6), whip "0.5 m" (0.8), dish "1.2 m dia" (radius 0.8 → 1.6 m), pad hex colours (#2dd4bf vs #5eead4), and "Scout #101 … Anchor #12's straight link to Gateway" (the code draws the anchor→gateway line only when an anchor is selected). Write the walkthrough from the final code and config values, not from memory.

Rerun renderer and mine-sim pytest. Retake 07_closeup_gateway.png and 05_closeup_1c.png, and add 08_nodesize_10_1b.png (slider at 10, the rod is still 10 m). Update WALKTHROUGH.md (add a "Fixes" section) and test_results.txt. STOP.
```

Not a bug, for F2: at true size nodes can't be seen in the overview (01_overview_day345.png). F2's far-zoom icons fix this.
