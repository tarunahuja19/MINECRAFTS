---
title: "Gate G14 — No PINN or Neural Network in Alarm Path"
slug: G14-no-pinn-in-alarm-path
type: gate
module: integration
status: reviewed
tags: [gate, g14, safety, no-pinn, classical-detector, ast-audit, invariant]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP7-gate-harness.md
---

# Gate G14 — No PINN or Neural Network in Alarm Path

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP7-gate-harness\|WP7]] |
| **Owner** | [[people/claude-code\|Claude Code]] |
| **Verification Target** | Invariants 2 & 3 compliance (Safety Critical) |
| **Test Script** | `tests/gates/test_g14.py` |

---

## 1. Assertion

No deep learning framework (`torch`, `tensorflow`, `jax`, `keras`, `sklearn`) is imported anywhere in `src/minesim/`. No class, method, or file named `pinn`, `PINN`, or `neural` exists in the repository. Furthermore, Part 1 contains zero alarm thresholds, safety triggers, or classification logic (alarms belong strictly to the classical Knothe-fit detector in Part 2).

---

## 2. Technical Rationale

Early architectural drafts (files 00–07) described a Physics-Informed Neural Network (PINN). In this final build, PINNs are completely discarded from the safety-critical path:
- Neural network outputs cannot provide bounded, deterministic worst-case guarantees required in mine strata control.
- Ground collapse warning must rely solely on classical, provable closed-form Knothe curve fitting.
- Part 1's role is purely physical simulation and telemetry generation.

---

## 3. Test Implementation

- AST audit of all Python files in `src/` checking for forbidden import statements.
- Regex search confirming absence of `pinn`, `PINN`, `neural`, `predict`, `should_alarm`, or `trigger_alarm`.
