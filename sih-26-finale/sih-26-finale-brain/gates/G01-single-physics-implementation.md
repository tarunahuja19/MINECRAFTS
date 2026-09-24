---
title: "Gate G01 — Single Implementation of S(x,y,t)"
slug: G01-single-physics-implementation
type: gate
module: physics
status: reviewed
tags: [gate, g01, physics, knothe, single-implementation, ast-check]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP1-core-physics.md
---

# Gate G01 — Single Implementation of S(x,y,t)

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP1-core-physics\|WP1]] |
| **Owner** | [[people/claude-code\|Claude Code]] |
| **Verification Target** | Invariant 4 compliance |
| **Test Script** | `tests/gates/test_g01.py` |

---

## 1. Assertion

Exactly one implementation of the Knothe subsidence formula $S(x,y,t)$ exists in the codebase, located strictly in `src/minesim/physics.py`. Tilt, curvature, strain, and displacement must be computed numerically from `subsidence()`. No duplicate closed-form mathematical equations may exist anywhere else in `src/`.

---

## 2. Test Implementation

The test executes an AST (Abstract Syntax Tree) walk over the entire `src/` hierarchy, parsing all functions and methods:
- Detects any function definition invoking `scipy.special.erf` or containing Knothe influence arithmetic.
- Asserts that the count of such functions is exactly **1**.
- Asserts that this function is defined within `src/minesim/physics.py`.

---

## 3. Negative Case

Adding a second dummy closed-form tilt function containing `erf` or a duplicate subsidence calculation in any other module causes the AST count to become 2, immediately failing Gate G01.
