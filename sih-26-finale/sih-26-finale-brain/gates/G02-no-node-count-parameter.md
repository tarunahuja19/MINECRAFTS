---
title: "Gate G02 — Sizing Accepts No Node-Count Parameter"
slug: G02-no-node-count-parameter
type: gate
module: sizing
status: reviewed
tags: [gate, g02, sizing, signature-check, node-count, invariant]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP2-sizing-algorithm.md
---

# Gate G02 — Sizing Accepts No Node-Count Parameter

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP2-sizing-algorithm\|WP2]] |
| **Owner** | [[people/claude-code\|Claude Code]] |
| **Verification Target** | Invariant 5 compliance |
| **Test Script** | `tests/gates/test_g02.py` |

---

## 1. Assertion

The network sizing entrypoint `size_network(cfg: Config) -> Layout` accepts **strictly one parameter**: `cfg`. It accepts no `n_nodes`, `node_count`, `target_nodes`, or similar parameter, even with a default value. Node count is an output of physics and Fresnel clearance, never an input.

---

## 2. Test Implementation

Uses Python's `inspect.signature(sizing.size_network)`:
- Asserts `len(sig.parameters) == 1`.
- Asserts that the single parameter accepts `Config`.

---

## 3. Negative Case

Adding `def size_network(cfg: Config, target_nodes: int = 30)` fails the signature inspection, even though the parameter had a default value.
