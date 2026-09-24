---
title: Integer-Millimetre Terrain Grid & Exact Replay
slug: integer-millimeter-terrain-grid
type: concept
module: world-state
status: reviewed
tags: [world-state, integer-mm, bit-identical, replay, rounding-drift, numpy]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP3-world-state-engine.md
---

# Integer-Millimetre Terrain Grid & Exact Replay

Technical analysis of why the world-state engine in `src/minesim/world.py` stores terrain elevation strictly as integer millimetres, and how this guarantees bit-identical replay over 690-day simulations.

---

## 1. The Floating-Point Drift Vulnerability

Consider a 690-day longwall simulation executed at 1-hour timesteps:
$$\text{Total Timesteps} = 690 \times 24 = 16,560 \text{ iterations}$$

In standard floating-point arithmetic (IEEE 754 `float32` or `float64`):
- Each timestep adds an infinitesimal subsidence delta:
  $$Z_{cell} \leftarrow Z_{cell} + \Delta z$$
- Due to non-associativity in floating-point addition ($(a + b) + c \ne a + (b + c)$) and machine epsilon rounding, accumulated errors compound linearly.
- Over 16,560 steps, two identical simulations run in different thread orders or chunk sizes drift by $2\text{ mm}$ to $15\text{ mm}$.
- A drift of $5\text{ mm}$ is $50\%$ of the entire $10\text{ mm}$ alarm detection threshold, completely corrupting [[gates/G06-bit-identical-terrain-replay|Gate G06]].

---

## 2. The Integer Invariant Solution

To eliminate floating-point drift permanently:
1. The 2D grid array is initialized as `np.int32` millimetres:
   ```python
   self.grid = np.zeros((rows, cols), dtype=np.int32)
   ```
2. Deltas at timestep $t$ are calculated from continuous physics and rounded to integer millimetres immediately:
   $$\Delta z_{mm} = \text{round}(S(x, y, t + \Delta t) - S(x, y, t))$$
3. Surface updating is pure integer addition:
   $$Z_{cell}[t + 1] = Z_{cell}[t] + \Delta z_{mm} \quad (\Delta z_{mm} \in \mathbb{Z})$$
4. Integer addition is associative, commutative, and exact. It has zero machine epsilon drift.

---

## 3. Bilinear Interpolation Boundary (`z_at`)

When sensor models sample elevation at continuous coordinates $(x, y)$:
- The engine identifies the four surrounding grid corners: $(i, j), (i+1, j), (i, j+1), (i+1, j+1)$.
- Performs standard 2D bilinear interpolation using fractional distance weights.
- Returns a floating-point elevation in millimetres.
- **Critical Invariant:** This interpolated float is consumed by sensors and never written back to the grid.

---

## 4. Cross-References

- **Implementation Package:** [[work-packages/WP3-world-state-engine]]
- **Live Node Elevations:** [[notes/world-state/live-node-z-and-delta-log]]
- **Verification Gate:** [[gates/G06-bit-identical-terrain-replay]]
