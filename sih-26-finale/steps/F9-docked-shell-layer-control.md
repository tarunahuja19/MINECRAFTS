# F9 — Dock the panels into a real shell, and let the operator switch node layers off

> **BUILT by Claude, 17 Sep (session 21)** — not pasted into Antigravity. Results and headless verification in [`walkthroughs/step-f9-shell/WALKTHROUGH.md`](../walkthroughs/step-f9-shell/WALKTHROUGH.md). Two bugs were found during verification and fixed: `setSize(..., false)` left a stale canvas CSS box, and the relocated scale bar swallowed clicks until it was made `pointer-events: none`.


**In plain words:** the three control panels float on top of the map like sticky notes. Make them part of the window instead — a top bar, a left rail, a right rail, a bottom dock, and the 3D view in the hole in the middle. Then give the operator a layer box that switches node tiers off, so 375 pieces of hardware stop covering the ground.

**Plan:** Adarsh, 17 Sep (session 21). Renderer only — no re-run, no re-export.

**Why:** measured on `renderer/index.html`, every panel is `position: fixed` over a canvas that fills the whole window:
- `#left` — `fixed; top:70px; left:14px; width:292px` (line 35)
- `#right` — `fixed; top:70px; right:14px; width:318px` (line 36)
- `#bottom` — `fixed; left:50%; transform:translateX(-50%); bottom:14px; width:min(1040px, 100vw-28px)` (line 55)
- `#zoomCtl` — `fixed; top:70px; right:346px` (line 83) — a hardcoded `346px` that exists only to dodge `#right`'s 318px + 14px + 14px. That number is the tell: it is a layout computed by hand because there is no layout.

So ~610 px of the window is permanently covered by glass, the map underneath is still being drawn and lit under there, and `#scaleBox` sits at `bottom: 190px` (line 85) — another hand-measured number, chosen to clear `#bottom`. Docking the panels removes all three magic offsets.

**Note on the hide-nodes ask:** a hide-everything toggle already exists — `#tPlan` "Planned sensor nodes" (`index.html:191`). What is missing is switching off *part* of the network. The count is 375: 1 gateway, 47 anchors, 12 × 1A, 133 × 1B, 182 × 1C (`scene/scene.json` → `plan.counts`). Tier 1C alone is 48 % of every marker on screen, so a per-tier switch is the whole fix.

**Ordering:** F7 rewrites how a node is *drawn* (dot vs model). F9 only changes *where the panels sit* and *which tiers are drawn at all*. They do not overlap, but F7 touches `js/network.js` too — do F7 first, then F9, or tell Antigravity to do them in one window in that order.

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md, sih-26-finale-brain/RULES.md, WP8-consequence-renderer.md §3, steps/F0-fix-the-system-plan.md and this step. Branch feat/viz-darker-ground-bigger-nodes, do not commit. Only edit the files listed. If the spec can't be implemented as written, STOP and tell me why. No magic numbers: every size goes in renderer/config.yaml or a CSS custom property with "# source: display choice (F9)". Terrain is context only: never feeds S(x,y,t), never writes Z. No minesim.physics in renderer/. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

STEP F9 · Docked application shell + per-tier node layer control

Files you may edit: renderer/index.html, renderer/js/app.js, renderer/js/network.js, renderer/config.yaml, renderer/tests/test_export_scene.py, walkthroughs/step-f9-shell/*.
Do NOT edit anything under mine-sim/. This step changes no numbers that come out of the simulator.

A. The shell
1. Give <body> a CSS grid and stop using position:fixed for the panels:
     grid-template-columns: var(--railL) 1fr var(--railR);
     grid-template-rows: var(--barH) 1fr auto;
     height: 100vh; overflow: hidden;
   with --railL: 300px, --railR: 320px, --barH: 56px declared on :root.
   header spans row 1 across all three columns. #left is row 2 col 1. #viewport is row 2 col 2. #right is row 2 col 3. #bottom spans row 3 across all three columns.
2. Remove position/top/left/right/bottom/width/transform from #left, #right and #bottom. They keep their padding, their glass background, their border and their own `overflow:auto`. Each rail gets a 1px border on the side that faces the map, and NO rounded corners on that side — a docked rail is flush with the view, a floating card is not. Drop the max-height calc() on both rails; the grid row now bounds them.
3. #viewport becomes `position: relative` (it is the positioning parent for the overlays in B). It is no longer `position: fixed; inset: 0`.
4. Delete the hardcoded 346px on #zoomCtl and the 190px on #scaleBox. Both move INSIDE #viewport as `position:absolute` children — zoom control top-right of the map, scale bar + compass bottom-left of the map, both offset by a single --mapPad (12px). A scale bar and a north arrow belong on the map, not in a rail; that is the one exception to docking, and it is deliberate.
5. Responsive: keep a breakpoint, but make it collapse the grid, not hide content. Below 1100px set --railR: 0px and move #right's contents into a collapsible drawer over the map; below 860px do the same for --railL. Never leave the user with no inspector and no way to get it back — the current rule at index.html:96 is `#right { display: none }` with no way back, and that must go.

B. The canvas must stop measuring the window
This is the part that silently breaks if it is skipped. Every one of these reads window.innerWidth/innerHeight and must read the #viewport element's own content box instead:
  - js/app.js:23   renderer.setSize(...)
  - js/app.js:59   new THREE.PerspectiveCamera(42, aspect, ...)
  - js/app.js:586  and :593  mouse.set(...) for picking — these must subtract the viewport's left/top as well as divide by its width/height, or every click lands 300 px to the right of the node you aimed at
  - js/app.js:690-691 and :712-713  label and badge screen projection
  - js/app.js:737  metres-per-pixel for the scale bar
  - js/app.js:757-760 the resize handler
  - js/app.js:868  net.updateLod(...)
Write ONE helper, e.g. `function viewRect() { return viewportEl.getBoundingClientRect(); }`, and route all of the above through it. Cache it and refresh the cache on resize; do not call getBoundingClientRect once per node per frame.
Replace the `window.addEventListener("resize", ...)` with a ResizeObserver on #viewport, so the canvas also re-fits when a rail collapses or a drawer opens — a window resize event does not fire for that.
`.labels` and `.badges` are currently `position:fixed; inset:0` (index.html:75, 89). Move both inside #viewport and make them `position:absolute; inset:0`. If they stay fixed to the window while their coordinates come from the viewport rect, every label sits one rail-width off.
`#tip` follows the pointer from clientX/clientY, so it may stay fixed to the window. Leave it.

C. Layer control
1. New section in #left titled "Layers", placed directly above the existing "Show" section. One row per tier with a checkbox, the tier's marker glyph, its name and its live count read from scene.json plan.counts — do not hardcode the numbers:
     Gateway 1 · Anchor 47 · 1A Tilt 12 · 1B Tension 133 · 1C Ground 182
   Unchecking a tier removes those nodes from the scene AND from the pick set AND from their labels — a hidden node must not be clickable and must not leave a floating ID behind.
2. Keep the existing #tPlan master toggle. It now means "all tiers off/on" and must drive the five tier boxes so the two controls never disagree.
3. Add a "Density" select next to the layer rows with options 100% / 50% / 25% (default 100%). At 50% and 25% draw a deterministic subset — sort each tier's nodes by node_id and keep every 2nd or 4th — so the same nodes are shown on every run and between reloads. Label it clearly: "view only — the network is unchanged". Put the option list in config.yaml as display.density_steps with "# source: display choice (F9)".
   This is a VIEW filter. It must not touch scene.json, must not change plan.counts, must not change the "Planned nodes moving" statistic in the bottom dock, and must not change the hardware cost. If hiding a node changed any reported number we would be lying about the network; state in the note under the control that the counts are of the planned network, not of what is drawn.
4. Persist the layer + density choice in localStorage wrapped in try/catch, so a reload keeps the operator's view. If storage throws or is empty, default to all tiers on at 100%.

Tests: renderer/tests/test_export_scene.py gains — display.density_steps exists and its first entry is 1.0; scene.json plan.counts has all five keys and they sum to the length of plan.nodes. Add a DOM-free assertion only; do not add a browser test runner in this step.

Screenshots at day 345: (1) the docked shell at 1920x1080 — no glass over the map except the scale bar and zoom control, rails flush; (2) the same at 1280x800 showing the right drawer collapsed and the button that reopens it; (3) layers with 1C off (193 markers instead of 375) over the depth ramp, showing ground that was previously hidden; (4) density 25%; (5) a click test — click a node near the left rail edge and show the inspector filled for the node actually under the cursor.
```

## 2 · Paste into Claude (check)

```text
Check step F9.
```

Claude verifies: the grid shell exists and no panel is `position: fixed` any more; `346` and `190` are gone from index.html; every one of the ten `window.innerWidth/innerHeight` sites listed in B routes through the viewport rect; `.labels` and `.badges` are absolute inside `#viewport`; a ResizeObserver replaced the window resize handler; picking is correct at the map's left edge (the failure this defends against is a constant horizontal offset equal to the left rail width); the five tier counts are read from `plan.counts` and not hardcoded; the density filter changes nothing in `scene.json` and nothing in the bottom-dock statistics; `#right` can always be reopened below 1100px; exact pytest count reported.

## 3 · You check by hand

1. `./run-simulation.sh view`. Drag the window narrower and wider — the 3D view must resize with the hole in the grid, never slide under a rail.
2. Click a node sitting right next to the left rail. The inspector must fill for **that** node. This is the one thing most likely to be silently wrong.
3. Turn off 1C. 182 markers should go; the count in "Planned nodes moving" in the bottom dock must **not** change.
4. Shrink the window below 1100px. The inspector must still be reachable.
5. Reload. Your layer choice should still be set.

## 4 · Fix prompt (only if Claude's check found problems)

```text
Fix step F9: <paste Claude's findings>. Same file list and same rules as the F9 prompt. Do not widen the file list. Re-run the renderer tests and report the exact count.
```
