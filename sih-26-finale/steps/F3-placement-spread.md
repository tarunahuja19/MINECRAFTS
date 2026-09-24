# F3 — Fix the placement algorithm: cover the whole panel, spacing by tier, anchors spread out

**In plain words:** Today every node is packed into one 655 × 410 m corner, and the mining face leaves that corner by about day 150. The fixed planner covers the whole ground that moves during the run. It puts sensors dense where the ground cracks, sparse on the quiet bowl floor, and anchors where they are actually needed.

**Plan:** [F0](F0-fix-the-system-plan.md) findings 2–7. Can run in a second Antigravity chat in parallel with F1 (no shared files).

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative in mine-sim/), sih-26-finale-brain/RULES.md, WP2-sizing-algorithm.md, steps/F0-fix-the-system-plan.md, mine-sim/src/minesim/placement.py (whole file) and this step. Branch fix-the-system, do not commit. Only edit the files listed. If the contract blocks something, STOP and tell me why. Node count stays an OUTPUT (Invariant 5): no target counts anywhere. Every new number in assumptions.yaml gets "# source:" or "# OPEN — design choice". DEM never feeds S(x,y,t). Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11; run tests from mine-sim/. Report exact pytest counts.

STEP F3 · Placement v3: full footprint, spacing by strain band, spread anchors

Files you may edit: mine-sim/src/minesim/placement.py, mine-sim/config/assumptions.yaml (placement: section only), mine-sim/tests/unit/test_placement.py (add tests; don't loosen existing ones without saying which and why), walkthroughs/step-f3-placement/*.

Problems to fix (Claude measured them on out/plan/node_plan.json):
P1 sector survey_window = x -69..585 m of a 2500 m panel. All 237 scouts sit there, and the face (4 m/day) leaves by ~day 150.
P2 the yaml says the sector "is moved as the face advances"; _sector_bounds() is static. Code and spec disagree.
P3 one spacing (20 m) for every tier: 1B = 164/237, 1C squeezed into |y|<38 m, 1A gets leftovers.
P4 34 anchors with min spacing 31.6 m. They crowd because of P3.
P5 6/34 anchor→gateway and 17/237 scout links terrain-blocked.

Changes:
1. Sector: default placement.sector: full (whole moving footprint over the full run, -2r .. L+2r, |y| <= W/2+2r). Keep survey_window as an option and fix its comment to say it is static (no moving sector in v3). Monuments on survey line S are still placed first.
2. Spacing by tier (variable-radius Poisson disc). New keys, replacing scout_spacing_m as the fill radius:
   placement.spacing_by_tier_m: {1C: 25.0, 1B: 50.0, 1A: 100.0}   # OPEN — design choice; 1C/1B from the geotechnical spacing note (scouts 15-25 m where ground fails, looser where strain is lower), 1A on the bowl floor
   Two scouts a and b must be at least max(spacing[a], spacing[b]) apart. Keep scout_spacing_m only as the hard minimum between any two nodes (rename min_node_spacing_m, same value 20.0, update every reader).
   Fill order stays 1C → 1B → 1A with strain-weighted random order. Add a second pass that fills gaps: any installable moving cell farther than spacing_by_tier of its own band from every scout gets a scout. Report how many the gap pass added.
3. Anchors: keep the capacitated k-means and the contract cap layout.max_children_per_anchor (8, contract §child_index 0..7; do NOT change it). Add a check, not a target: placement.min_anchor_spacing_m: 80.0 (# OPEN — design choice). If two cluster centres end up closer than that, merge the clusters and re-split once. Report the result either way. Anchor IDs must stay in 1..99; if they would not, STOP and report the counts (don't narrow the sector).
4. Links: when siting an anchor, among installable candidates within min_node_spacing_m of the cluster centre, prefer the one with a terrain-clear Fresnel path to the gateway, then lowest peak tilt (today: tilt only). The gateway is sited after the anchors, so iterate once: site anchors → site gateway → re-site anchors against that gateway → re-site gateway. Report blocked counts before and after.
5. Checks in node_plan.json: add per-tier nn spacing (min, median), coverage_fraction (installable moving cells within spacing_by_tier of a scout / all installable moving cells, target >= 0.95 reported, not forced), x-extent of scouts vs panel length, anchor_spacing_min_m, links blocked. Keep all existing keys.
6. Remember the renderer reads plan.sector, plan.checks, plan.counts, and node fields. Don't rename node fields.

Tests to add: scouts span >= 90 % of the moving footprint along x; per-tier NN min >= spacing_by_tier (allow the monument pass to break it only on line S; test excludes zone == "survey_line"); anchor IDs within range; every scout has a parent and a distinct backup; max_children <= cap; coverage_fraction >= 0.95; still no grid (NN CV > 0.1); determinism: two runs with the same seed give identical node_plan.json.

Run: cd mine-sim && python -m minesim.placement, then report counts per tier, total cost, all checks, and a top-view PNG of the plan (matplotlib: panel outline, moving footprint contour, nodes by tier shape, anchors, gateway). Save it in the walkthrough folder.

Report: mine-sim pytest count (was 138 plus your new tests), planner runtime, the before/after table for P1–P5. Write the walkthrough. STOP.
```

## 2 · Paste into Claude (check)

```text
Check step F3
```

Claude checks: no target counts (Invariant 5); contract cap 8 untouched; monuments still first; determinism; coverage; the before/after numbers match a rerun; node count stays below the ID range; cost sensible.

## 3 · You check by hand

Open the top-view PNG in `walkthroughs/step-f3-placement/`.

| # | Look for | You should see |
|---|---|---|
| 1 | Along the panel | Nodes from the start rib to past the 2,500 m end, not one corner |
| 2 | Across the panel | Red 1C dense along the tension/compression edges, amber 1B looser, teal 1A far apart on the bowl floor |
| 3 | Anchors | Blue anchors spread out, none on top of each other |

## 4 · Fix prompt (only if Claude's check found problems)

_Empty until Claude's check._
