---
title: "Gate G10 — Emergency Sub-Slot Derives From Child Index"
slug: G10-emergency-slot-from-child-index
type: gate
module: radio
status: reviewed
tags: [gate, g10, radio, tdma, emergency-window, child-index, failover]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP5-radio-tdma.md
---

# Gate G10 — Emergency Sub-Slot Derives From Child Index

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP5-radio-tdma\|WP5]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Deterministic failover slotting logic |
| **Test Script** | `tests/gates/test_g10.py` |

---

## 1. Assertion

The emergency retransmission sub-slot index for any orphaned Scout node must derive strictly from its assigned `node.child_index` ($0..7$ within its primary cluster), and **never** from mathematical operations on its `node_id` (such as `node_id % 16`).

---

## 2. Technical Rationale

When an Anchor fails, all of its assigned children (up to 8 Scouts) simultaneously detect missing ACKs at $t = 12.0\text{ s}$ and fail over to their backup Anchor during the emergency window ($t = 15.5\text{ s}$). Because `child_index` is unique within each Anchor cluster by construction, all orphaned siblings transmit in separate, collision-free sub-slots.

---

## 3. Negative Case

AST inspection checks that `radio.py` contains no modulo operations (`%`) on `node_id` when calculating transmission time offsets.
