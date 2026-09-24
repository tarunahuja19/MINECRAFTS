---
title: "Changelog: Inspector Reads the Simulator's Per-Node Maths, Not the Planner's Static Peaks"
slug: 2026-09-17-claude-code-node-telemetry-inspector
type: changelog
module: renderer
status: reviewed
tags: [changelog, audit-trail, renderer, inspector, provenance, sensors, telemetry]
created: 2026-09-17
updated: 2026-09-17
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-17.md
---

# Changelog: Inspector Reads the Simulator's Per-Node Maths, Not the Planner's Static Peaks

## Agent: Claude Code
## Date: 2026-09-17 (session 24)
## Source: Adarsh, 17 Sep — "each node shows a fixed amount of data, make sure that comes from maths; right now the nodes only read a few, like coordinates and all"

Branch: `fix/g15-mine-independence-cap5`.

### What was wrong

`nodes.csv` carries twenty-one columns per node per epoch. `renderer/export_scene.py` read **five**
of them (`epoch`, `node_id`, `subsidence_mm`, `subsidence_prov`, `delivered`) and discarded the rest
at export. Everything the simulator computed for a node — tilt on both axes, horizontal strain,
displacement, battery, RSSI, which parent the packet actually took, whether the emergency sub-slot
fired — never reached the browser.

So the inspector filled the gap with the **planner's** numbers: `peak_subsidence_mm`,
`peak_strain_ue`, `peak_tilt_urad`, all static, all decided before the run started and none of them
changing as the panel advances. Next to those sat the node's coordinates, ground elevation and slope,
which are also static. That is the "fixed amount of data" Adarsh saw: the panel looked live, but only
one row of it moved.

### What changed

**`renderer/export_scene.py`** — `read_daily_readings()` now returns five planes instead of two, and
writes three new per-chunk binaries beside the existing ones:

| File | dtype | Contents |
|---|---|---|
| `telem_DDDD.bin` | float32 `[day, node, channel]` | `tilt_x_urad`, `tilt_y_urad`, `strain_ustrain`, `disp_mm`, `battery_mv`, `rssi_dbm` — NaN where that node wrote nothing |
| `link_DDDD.bin` | uint16 `[day, node]` | `parent_used` — the parent the packet actually took (65535 = none) |
| `flags_DDDD.bin` | uint8 `[day, node]` | bit 0 `delivered`, bit 1 `via_emergency` |

Values are copied as written. Nothing is recomputed, interpolated or filled in — a NaN means that
sensor reported nothing, and the UI prints an em dash rather than a plausible zero.

**`renderer/js/terrain.js`** — `FrameStore` loads the three new files per chunk and exposes
`telem()`, `link()`, `flags()`. All three are **optional**: a `scene.json` exported before this change
still plays, the inspector just shows em dashes. That was deliberate, so a stale scene degrades
instead of breaking.

**`renderer/js/network.js`** — new `MineNetwork.telemetry(k)`, the sibling of the existing
`reading(k)`.

**`renderer/js/app.js`** + **`index.html`** — the inspector is now grouped under four headings, so it
is visible at a glance which numbers move and which never do:

1. **Measured by this node — day N** — the telemetry above. Relays (Anchor, Gateway) write no sensor
   row, and say so in one line instead of showing nine em dashes.
2. **Ground under the node — world grid** — live ΔZ and tilt sampled from the world grid.
3. **Planned before the run — static** — the planner's peaks, coordinates, DEM ground, slope.
4. **Radio plan** — parent, backup, child index, link budget.

`parent_used` is compared against the planned `parent_id` and marked *(failed over)* when they differ.

### What it exposed

Each tier carries a different sensor package, so each tier now shows a different set of live values —
which is the opposite of the fixed block Adarsh was looking at. Verified headlessly at day 400:

| Node | Tier | Live channels it actually reports |
|---|---|---|
| #100 | 1A · tilt | tilt 0.965 mm/m (136 · 955 µrad), battery 3,913 mV, RSSI −60.0 dBm — strain/disp blank |
| #102 | 1B · strain rod + pot | strain −2,649 µε, displacement −15.64 mm, RSSI −42.3 dBm — tilt blank |
| #104 | 1C · wire extensometer | strain −9,382 µε, RSSI −44.1 dBm — tilt and disp blank |
| #1 | Anchor | relay only, writes no sensor readings |

### Cost

`scene/frames` grows 37 MB → 45 MB for a 691-day, 410-node run (+8 MB, +22%). The new planes are
0.6 % the size of the terrain grid they sit next to.

### Verification

- `pytest renderer/tests -q` → **19 passed**.
- Re-exported `mine-sim/out/v2-690d`: 24 chunk sets, 691 daily frames, 6.96 s, all seven file kinds present.
- Headless Chromium screenshot (see [[changelog/2026-09-17-claude-code-anchor-id-cap-removed]] for the
  session's other half): scene loads, clock runs to day 400, all four tiers inspected, no console
  errors other than the pre-existing `favicon.ico` 404.
