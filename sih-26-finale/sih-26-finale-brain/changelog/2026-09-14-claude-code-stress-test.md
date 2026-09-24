---
title: "Changelog: Stress Test of the v1 Simulator by Claude Code"
slug: 2026-09-14-claude-code-stress-test
type: changelog
module: integration
status: reviewed
tags: [changelog, audit-trail, physics, stress-test, provenance, sizing]
created: 2026-09-14
updated: 2026-09-14
author: claude-code
last_agent_edit: claude-code
source_file: walkthroughs/step-06b-stress-test/WALKTHROUGH.md
---

# Changelog: Stress Test of the v1 Simulator by Claude Code

## Agent: Claude Code
## Date: 2026-09-14
## Source: Adarsh asked for a stress test of the Monday build (physics and everything else), fixes, and a hands-on checklist

### Files updated (vault)
- `projects/subsidence-simulator/decisions.md` — new §9 (stress test results, NaN fix, W1–W4); §8 provenance claim marked superseded by §9 W1, original text kept. → [[projects/subsidence-simulator/decisions]]

### Outside the vault
- `mine-sim/src/minesim/physics.py` — overflow-safe `erfcx` form of the time-lag term; Adriyala output byte-identical. → [[work-packages/WP1-core-physics]]
- `mine-sim/tests/unit/test_physics.py` — +2 tests (closed form vs quadrature; finite for large c/v). Suite 123 passed.
- `mine-sim/scripts/stress_test.py` — new, 49 pass / 4 warn / 0 fail.
- `handoff/v1-sample/README.md` — provenance sentence corrected (W1).
- `walkthroughs/step-06b-stress-test/` — walkthrough, hands-on steps, checklist, raw results.

### Decisions
- None made by Claude. Open for Adarsh: W1 (survey line vs node cross), W2 (tier ties).
