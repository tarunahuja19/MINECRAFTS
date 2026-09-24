---
title: "Gate G13 — Live Z Owned Solely by World State"
slug: G13-live-z-owned-by-world-state
type: gate
module: world-state
status: reviewed
tags: [gate, g13, world-state, live-elevation, z0-static, invariant]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP3-world-state-engine.md
---

# Gate G13 — Live Z Owned Solely by World State

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP3-world-state-engine\|WP3]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Invariant 1 compliance |
| **Test Script** | `tests/gates/test_g13.py` |

---

## 1. Assertion

The world-state engine owns terrain truth, including the live vertical elevation ($Z$) of every deployed sensor node. `node.z0_mm` is written strictly at $t=0$ as a pre-mining reference baseline and is never mutated. No sensor, radio, or stream module may update or cache node elevations independently.

---

## 2. Test Implementation

- Asserts that `node.z0_mm` remains completely unchanged after 100 simulation timesteps.
- Verifies that `world.z_at(node.x_m, node.y_m)` changes dynamically as the longwall extraction face advances.
- AST search verifies that `node.z0_mm` is never assigned outside `sizing.py`.
