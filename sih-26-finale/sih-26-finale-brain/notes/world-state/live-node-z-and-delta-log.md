---
title: Live Node Z Elevation & Delta Log Scrubbing
slug: live-node-z-and-delta-log
type: concept
module: world-state
status: reviewed
tags: [world-state, live-elevation, z0, delta-log, timeline-scrub, stream]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP3-world-state-engine.md
---

# Live Node Z Elevation & Delta Log Scrubbing

Design reference on how dynamic node vertical elevation is tracked without modifying static layout metadata, and how the append-only delta log powers timeline scrubbing in Part 3's 3D dashboard.

---

## 1. Static Reference vs Live Ground Truth (Gate G13)

When nodes are placed by `sizing.py` at $t=0$:
- `node.z0_mm` records the pre-mining surface elevation at that $(x, y)$ coordinate.
- **`node.z0_mm` is immutable.** It is never modified after network generation.

As extraction advances and the subsidence trough deepens (up to $1.27\text{ m}$ to $1.63\text{ m}$):
- The physical sensor node moves downward with the ground.
- The live elevation of the node is retrieved dynamically:
  $$Z_{live}(t) = \text{world.z\_at}(node.x\_m, node.y\_m)$$
- Relative subsidence reported to telemetry is:
  $$S_{node}(t) = Z_{live}(t) - node.z0\_mm$$

---

## 2. The Append-Only Delta Log (`terrain_changes.jsonl`)

Every call to `world.step()` generates a `Delta` record:
```json
{"epoch": 42, "t_s": 151200.0, "cells": [[120, 44, -3], [120, 45, -4]]}
```

### Storage Efficiency:
- Only cells where $\Delta z_{mm} \ne 0$ are included in the array.
- In early extraction stages, $>95\%$ of cells have $\Delta z_{mm} = 0$ and are omitted, saving $>90\%$ storage bandwidth over dense snapshots.
- A timestep with no ground movement emits `{"epoch": k, "t_s": ..., "cells": []}` to guarantee dense, sequential epoch indexing.

---

## 3. Timeline Scrub Mechanics (Part 3 Dashboard)

To scrub backwards or forwards in time without loading giant gigabyte datasets:
1. **Seek to Day $D$:** Start with pre-computed keyframe baseline `terrain_state.npz` at $t=0$.
2. **Stream Deltas:** Read `terrain_changes.jsonl` lines from epoch 0 up to target epoch $T = D \times 24$.
3. **Apply Additions:** Integer additions reconstruct the terrain surface at Day $D$ in under $50\text{ ms}$.

---

## 4. Cross-References

- **Implementation Package:** [[work-packages/WP3-world-state-engine]]
- **Integer Grid Architecture:** [[notes/world-state/integer-millimeter-terrain-grid]]
- **Gate G13:** [[gates/G13-live-z-owned-by-world-state]]
- **Streaming Package:** [[work-packages/WP6-stream-and-output]]
