---
title: Claude Code
slug: claude-code
type: person
module: governance
status: reviewed
tags: [agent, claude-code, lane-b, physics, sizing, harness]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/10-build-order-v1.md
---

# Claude Code

| Field | Details |
|---|---|
| **Role** | Autonomous Coding Agent — Lane B |
| **Lane Ownership** | **Lane B:** [[work-packages/WP1-core-physics\|WP1]], [[work-packages/WP2-sizing-algorithm\|WP2]], [[work-packages/WP7-gate-harness\|WP7]] |
| **Files Owned** | `src/minesim/physics.py`, `src/minesim/sizing.py`, `tests/gates/*`, `scripts/run_gates.py` |
| **Primary Gates Owned** | [[gates/G01-single-physics-implementation\|G01]], [[gates/G02-no-node-count-parameter\|G02]], [[gates/G03-cost-breakdown-emitted\|G03]], [[gates/G12-cost-reporting-without-budget-cap\|G12]], [[gates/G14-no-pinn-in-alarm-path\|G14]], [[gates/G15-config-driven-mine-independence\|G15]] |

---

## 1. Responsibilities

- **Core Physics (`physics.py`):** Single vectorised implementation of Knothe equation $S(x,y,t)$ and numerical evaluation of tilt, curvature, strain, and displacement.
- **Network Sizing (`sizing.py`):** Physics-driven layout engine deploying 30 Scouts along the travelling profile cross, clustering nodes to Anchors, and evaluating RF Fresnel clearances.
- **Verification Harness (`tests/gates/`):** Building the automated gate test suite, shared mocks, negative test fixtures, and Gate G14 static safety audit.

---

## 2. Key Invariant Constraints

- Never introduce closed-form formulas for tilt or curvature (violates Gate G01).
- Never introduce a `node_count` parameter to `size_network()` (violates Gate G02).
- Never hardcode numeric literals from the assumption register into `src/` (violates Gate G15).
- Never introduce PINN or deep learning imports into Part 1 (violates Gate G14).

---

## 3. Related Links

- **Work Packages:** [[work-packages/WP1-core-physics]], [[work-packages/WP2-sizing-algorithm]], [[work-packages/WP7-gate-harness]]
- **Peer Lanes:** [[people/adarsh-agarwala]] (Lane A), [[people/antigravity]] (Lanes C & D)
