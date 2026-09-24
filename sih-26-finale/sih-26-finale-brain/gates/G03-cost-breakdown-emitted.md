---
title: "Gate G03 — Sizing Emits Itemized Cost Breakdown"
slug: G03-cost-breakdown-emitted
type: gate
module: sizing
status: reviewed
tags: [gate, g03, sizing, cost-breakdown, bom, reporting]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP2-sizing-algorithm.md
---

# Gate G03 — Sizing Emits Itemized Cost Breakdown

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP2-sizing-algorithm\|WP2]] |
| **Owner** | [[people/claude-code\|Claude Code]] |
| **Verification Target** | Financial transparency and Bill of Materials output |
| **Test Script** | `tests/gates/test_g03.py` |

---

## 1. Assertion

Every `Layout` emitted by `size_network(cfg)` must include an itemized `CostBreakdown` instance containing tier-by-tier hardware unit costs, node counts, subtotals, and total network deployment cost in INR.

---

## 2. Test Implementation

```python
def test_g03_cost_breakdown(config):
    layout = size_network(config)
    assert isinstance(layout.cost, CostBreakdown)
    assert layout.cost.total_inr > 0
    calculated_sum = sum(subtotal for _, _, subtotal in layout.cost.per_tier.values())
    assert layout.cost.total_inr == calculated_sum
```

---

## 3. Negative Case

A sizing implementation that omits `cost` or returns `total_inr = 0` fails this gate.
