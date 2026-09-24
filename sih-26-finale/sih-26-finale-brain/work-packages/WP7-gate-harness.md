---
title: "WP7 — Gate Harness and Integration"
slug: WP7-gate-harness
type: work-package
module: integration
status: reviewed
tags: [work-package, wp7, gates, test-harness, integration-day, d7, g14]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP7-gate-harness.md
---

# WP7 — Gate Harness and Integration

| Field | Details |
|---|---|
| **Owner** | [[people/claude-code\|Claude Code]] (Lane B) |
| **Depends on** | [[work-packages/WPC-contracts-and-skeleton\|WP-C]] |
| **Blocks** | Release & Handoff |
| **Days Scheduled** | D5–D7 (Integration on D7) |
| **Enforces Gate** | Owns [[gates/G14-no-pinn-in-alarm-path\|Gate G14]]; runs all sixteen gates ([[docs/gates-registry\|G00–G15]]) |

---

## 1. Goal

Provide the automated test infrastructure, runner (`scripts/run_gates.py`), shared mocks, and negative test cases for all sixteen gates, and orchestrate the Day 7 integration merge.

---

## 2. Files Owned

```
tests/gates/__init__.py
tests/gates/conftest.py
tests/gates/test_g14.py
tests/gates/helpers.py
scripts/run_gates.py
GATES.md
```

---

## 3. Harness Architecture & Rules

- **Independent Stand-Alone Execution:** `pytest tests/gates/test_g08.py` must execute in complete isolation without requiring prior packages to be built. Unfinished modules are stubbed in `conftest.py`.
- **Exact Comparisons Only:** No gate may use `np.allclose` or soft tolerances where mathematical or structural exactness is claimed (e.g. [[gates/G06-bit-identical-terrain-replay|G06]] uses `np.array_equal`).
- **Mandatory Negative Cases:** Every gate must possess an intentional failure test proving that violating the constraint triggers an immediate error.

---

## 4. Gate G14 Specification (WP7 Core Responsibility)

> [!IMPORTANT]
> **Safety Invariant Verification (Gate G14):** No neural network, deep learning library (`torch`, `tensorflow`, `jax`, `keras`), or PINN may exist in the Part 1 simulator.
>
> **Static Repository Check:**
> - AST search verifies zero forbidden ML framework imports across `src/`.
> - AST search confirms zero classes or methods containing `pinn`, `PINN`, `neural`, or `predict`.
> - Confirms zero alarm generation or safety classification logic exists in Part 1 (Part 1 emits telemetry; the classical detector in Part 2 raises alarms).

---

## 5. Day 7 Integration Protocol

1. **Merge All Lanes:** Merge Lanes A, B, C, D into `main`. Resolve conflicts in contracts before execution.
2. **Unit Battery:** `pytest tests/unit` $\to$ 100% pass.
3. **Run Gate Harness:** `python scripts/run_gates.py` $\to$ all 16 gates green.
4. **Full 690-Day Simulation:** Execute full Adriyala LW1 run:
   - Verify `nodes.csv`, `terrain_state.npz`, `terrain_changes.jsonl` are populated.
   - Replay check: reconstruct terrain at day 345 from delta log and compare with snapshot (`np.array_equal`).
   - Validate live WebSocket output stream.
   - Output `run_summary.json` including provenance breakdown.
