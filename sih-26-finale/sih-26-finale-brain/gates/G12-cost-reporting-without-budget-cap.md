---
title: "Gate G12 — Cost Reporting Without Budget Cap"
slug: G12-cost-reporting-without-budget-cap
type: gate
module: sizing
status: reviewed
tags: [gate, g12, sizing, cost-breakdown, budget-cap-deleted, amendment]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP2-sizing-algorithm.md
---

# Gate G12 — Cost Reporting Without Budget Cap

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP2-sizing-algorithm\|WP2]] |
| **Owner** | [[people/claude-code\|Claude Code]] |
| **Verification Target** | Baseline amendment: budget cap A22 removed |
| **Test Script** | `tests/gates/test_g12.py` |

---

## 1. Assertion

`size_network(cfg)` emits an itemized total cost with every generated layout, but **never** compares this cost against a budget ceiling. Sizing relaxation path K fires strictly on RF link or line-of-sight failures, and sizing never fails due to financial cost.

---

## 2. Technical Context

On 2026-09-13, Assumption A22 (Budget Cap) was formally deleted by team consensus. Sizing is dictated solely by the physics of ground strain sampling ($50\text{ m}$ spacing) and LoRa Fresnel clearance. Gate G12 was amended from a pass/fail cost ceiling test into an informational reporting requirement.

---

## 3. Test Implementation

Asserts that even when unit costs in `config/assumptions.yaml` are multiplied by $10\times$ (simulating exorbitant hardware prices), `size_network(cfg)` outputs the exact same 30-Scout node layout without relaxation or error.
