---
title: "Gate G05 — Synthetic Grounded in Observed Data"
slug: G05-synthetic-grounded-in-observed-data
type: gate
module: sensors
status: reviewed
tags: [gate, g05, synthetic, empirical-grounding, noise-validation, invariant]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP4-sensor-models-provenance.md
---

# Gate G05 — Synthetic Grounded in Observed Data

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP4-sensor-models-provenance\|WP4]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Invariant 7 compliance |
| **Test Script** | `tests/gates/test_g05.py` |

---

## 1. Assertion

No `synthetic` value emitted by the simulator is generated from arbitrary random distributions ungrounded in real data behavior. Synthetic surface values must derive strictly from spatial/temporal interpolation between pinned Knothe parameters, and sensor noise/drift must adhere to bounded physical datasheet parameters specified in `config/assumptions.yaml`.

---

## 2. Test Implementation

- Evaluates that synthetic noise distributions possess empirical mean $\mu \approx 0$ and $\sigma$ matching the configured hardware specifications.
- Asserts that zero-movement epochs generate only noise around the baseline without inventing arbitrary subsidence trends.

---

## 3. Negative Case

Generating synthetic subsidence from an arbitrary random walk or an ungrounded sinusoidal perturbation fails Gate G05.
