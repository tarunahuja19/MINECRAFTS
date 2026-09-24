---
title: "WP8 — Consequence Renderer (Proposed)"
slug: WP8-consequence-renderer
type: work-package
module: integration
status: draft
tags: [work-package, wp8, renderer, visualization, provenance, forecast, proposed]
created: 2026-09-14
updated: 2026-09-15
author: claude-code
last_agent_edit: claude-code
source_file: files/RECOMMENDATIONS.md
---

# WP8 — Consequence Renderer (Proposed)

> [!WARNING]
> **DEC-5 ratified 2026-09-14 — in scope.** This widens Part 1 scope ([[docs/build-order]] §6 listed 3D rendering under Part 3). See [[projects/subsidence-simulator/decisions]] §5. The forecast input comes from the teammate-built ML model. The tickable checklist is `files/SIMULATOR-CHECKLIST.md` §3.
>
> **Update 2026-09-14 (DEC-13/14):** this package is now **Window 1** only (steps 1–3). Steps 4–6 (forecast, scenario, reference objects) moved to [[work-packages/WP9-scenario-lab]]: Window 2 creates subsidence **on a frozen copy** through the Scenario Lab, so safety requirement 6 ("no deform controls") still holds for Window 1 and the live stream. The build prompt is BUILD-PLAN T4.
>
> **Update 2026-09-15:** at Adarsh's request Claude Code rebuilt Window 1 on real SRTM terrain with a geological block, underground X-ray, cross-section at line S, and the v2 planned network (`minesim.placement`). The T4 fix prompt is on hold until Adarsh reviews it. See [[changelog/2026-09-15-claude-code-real-terrain-renderer-node-planner]].

| Field | Details |
|---|---|
| **Owner** | [[people/adarsh-agarwala\|Adarsh]] (supervisor); code by [[people/antigravity\|Antigravity]] workspace AG-4; review by [[people/claude-code\|Claude Code]] |
| **Depends on** | [[work-packages/WP3-world-state-engine\|WP3]] (terrain), [[work-packages/WP6-stream-and-output\|WP6]] (artefacts + stream), ML output per [[docs/interface-ml-to-renderer]] |
| **Blocks** | Nothing in the simulator. It is a pure consumer |
| **Days Scheduled** | Sprint Day 2 afternoon → Day 3, subject to the hard stop below |
| **Protects Invariants** | 3 (no NN in safety path), 4 (one S(x,y,t)), 6 (provenance), plus [[docs/interface-contracts]] §7.4 "no click-to-subside" |

---

## 1. Goal

A user-facing view that turns simulator output and ML forecasts into a picture of the ground at panel scale, **clearly labelled by what it is**. It has three jobs: J1 scale demonstration, J2 consequence rendering, J3 scenario testing.

```
simulator artefacts (npz + jsonl + nodes.csv / ws) ──┐
                                                     ├─► export_scene.py ─► renderer page
ML forecast file (draft interface) ──────────────────┘        (reads only; draws; never decides)
```

The renderer **consumes** predictions and terrain. It does not compute subsidence, has no path to any alarm, and cannot deform the ground.

---

## 2. Files Owned (proposed)

```
renderer/                      ← repo root, OUTSIDE mine-sim/ so G01/G14 src scans are unaffected
  export_scene.py              ← reads mine-sim/out/* (+ forecast file), writes renderer/scene/*.json
  index.html                   ← static Three.js page (pinned CDN version), reads scene JSON
  scene/                       ← generated, git-ignored
  reference_objects.yaml       ← road / building / pole-line geometry (config, not code)
  tests/test_export_scene.py   ← replay equality, label presence, no physics import
walkthroughs/step-09-wp8-renderer/
```

`export_scene.py` may import `minesim.config` for grid metadata. It must **not** import `minesim.physics`: the terrain comes from world-state artefacts only (see [[notes/world-state/live-node-z-and-delta-log]]).

---

## 3. Mandatory Safety Requirements

1. Persistent mode banner: `SIMULATED` · `LIVE (MEASURED)` · `FORECAST (PREDICTED)` · `SCENARIO (HYPOTHETICAL)`.
2. `SIMULATED` is its own mode. Simulator terrain is never labelled `LIVE (MEASURED)`. Node markers carry their `_prov` tag colour ([[notes/sensors/sensor-provenance-and-tagging]]).
3. Measured, simulated and predicted geometry use different rendering treatments, not just a legend.
4. Forecasts show the p10–p90 band as well as p50, and the issue time and horizon are always visible.
5. Vertical exaggeration factor is printed on screen whenever it isn't 1.
6. No footage-like collapse animation. No blast/kill/collapse/deform controls ([[docs/interface-contracts]] §7.4).
7. No import of `minesim.physics`, no threshold or alarm logic (mirrors [[gates/G14-no-pinn-in-alarm-path|G14]]).

---

## 4. Build Order and Acceptance

| Step | Deliverable | Acceptance check |
|---|---|---|
| 1 | Static surface | Exported grid at day T `array_equal` to replaying `terrain_changes.jsonl` onto `terrain_state.npz` |
| 2 | Time evolution | Day slider; face position marker; seek to day N equals direct replay to N |
| 3 | Node overlay | Nodes at live Z; tier + provenance colour; `delivered=false` visibly distinct |
| 4 | Forecast ingest | A **real** ML output file validated against [[docs/interface-ml-to-renderer]]; banner = FORECAST; band drawn. A mock forecast never appears in the demo |
| 5 | Scenario | Two simulator runs differing only in config; SCENARIO banner; config diff shown |
| 6 | Reference objects | Objects from `reference_objects.yaml` sampled on the surface; tilt in mm/m labelled |

**Hard stop (R1):** after steps 1–4 (or 1–3 if no real ML output exists by Day 3 13:00), work stops and Adarsh moves to hardware support. Steps 5–6 only after the hardware node and the simulator floor are green.

---

## 5. Do Not

- Reimplement or call `physics.subsidence` to "fill in" terrain.
- Label simulator output as measured.
- Render a forecast without its uncertainty band.
- Add operator interventions (R7, v2).
- Let renderer polish displace the simulator floor or hardware support.

---

## 6. Related

- Charter: [[projects/subsidence-simulator/overview]]
- Decisions: [[projects/subsidence-simulator/decisions]] (DEC-5, DEC-7)
- Stream source: [[work-packages/WP6-stream-and-output]]
- Forecast interface: [[docs/interface-ml-to-renderer]]
