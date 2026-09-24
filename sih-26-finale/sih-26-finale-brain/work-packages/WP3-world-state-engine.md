---
title: "WP3 — World-State Engine"
slug: WP3-world-state-engine
type: work-package
module: world-state
status: reviewed
tags: [work-package, wp3, world-state, integer-mm, bit-identical, replay, delta-log]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP3-world-state-engine.md
---

# WP3 — World-State Engine

| Field | Details |
|---|---|
| **Owner** | [[people/antigravity\|Antigravity]] (Lane C) |
| **Depends on** | [[work-packages/WPC-contracts-and-skeleton\|WP-C]] stubs; logic from [[work-packages/WP1-core-physics\|WP1]], [[work-packages/WP2-sizing-algorithm\|WP2]] |
| **Blocks** | [[work-packages/WP4-sensor-models-provenance\|WP4]] |
| **Days Scheduled** | D1–D3 |
| **Enforces Gates** | [[gates/G06-bit-identical-terrain-replay\|Gate G06]], [[gates/G13-live-z-owned-by-world-state\|Gate G13]] |

---

## 1. Goal

Maintain authoritative ground truth elevation for every cell on the terrain grid and every deployed sensor node. Advance surface deformation by integer-millimetre deltas and emit an append-only delta log (`terrain_changes.jsonl`) that replays **bit-identically**.

---

## 2. Files Owned

```
src/minesim/world.py
tests/unit/test_world.py
tests/gates/test_g06.py
tests/gates/test_g13.py
```

---

## 3. The Integer-Millimetre Invariant (Gate G06)

> [!CAUTION]
> **Floating-Point Accumulation Drifts:** Across a 690-day simulation with hourly steps, each grid cell undergoes over 16,500 accumulation cycles. Floating-point accumulation drifts and will fail [[gates/G06-bit-identical-terrain-replay|Gate G06]].
>
> **The Rule:** The internal surface grid is stored strictly as `np.int32` millimetres. Deltas (`dz_mm`) are integers. Accumulation is exact integer addition:
> $$Z_{grid}[t + \Delta t] = Z_{grid}[t] + \Delta z_{mm}$$
> Conversion to floating-point occurs **only** during bilinear interpolation in `z_at(x, y)` and is never fed back into the grid.

---

## 4. Replay Mechanics (`terrain_changes.jsonl`)

- **Format:** Single-line JSON objects per epoch:
  ```json
  {"epoch": 1, "t_s": 3600.0, "cells": [[120, 44, -3], [120, 45, -4]]}
  ```
- **Dense Epoch Numbering:** If no ground moves during a timestep, the engine emits `{"epoch": k, "t_s": ..., "cells": []}`. Dropping lines or creating epoch gaps is prohibited.
- **Verification Assertion:** Starting from `terrain_state.npz` at $t=0$ and adding all logged deltas up to epoch $T$ must match `snapshot()` at epoch $T$ under `np.array_equal` (zero numerical tolerance).

---

## 5. Live Node Elevation vs Static Reference (Gate G13)

- **`node.z0_mm`:** Set at $t=0$ as a static pre-mining reference baseline. Never updated.
- **`world.z_at(x, y)`:** Computes live elevation at any arbitrary node coordinate via 2D bilinear interpolation from the four adjacent integer grid cells. Sensor models sample subsidence strictly as:
  $$\Delta Z_{node}(t) = \text{world.z\_at}(x_{node}, y_{node}) - z_0$$

---

## 6. Prohibition on Operator Intervention

Deformation is governed entirely by empirical Knothe equations and face advance parameters. **There is no manual "click-to-subside" or blast trigger.** Any operator intervention methods are rejected as v2 additions to preserve scientific integrity.
