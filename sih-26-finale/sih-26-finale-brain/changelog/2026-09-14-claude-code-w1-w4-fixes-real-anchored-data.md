---
title: "Changelog: W1–W4 Fixes and Real-Anchored Dataset by Claude Code"
slug: 2026-09-14-claude-code-w1-w4-fixes-real-anchored-data
type: changelog
module: integration
status: reviewed
tags: [changelog, audit-trail, physics, fitting, sizing, provenance, dataset, ci]
created: 2026-09-14
updated: 2026-09-14
author: claude-code
last_agent_edit: claude-code
source_file: walkthroughs/step-06c-w1-w4-fixes/WALKTHROUGH.md
---

# Changelog: W1–W4 Fixes and Real-Anchored Dataset by Claude Code

## Agent: Claude Code
## Date: 2026-09-14
## Source: Adarsh asked to fix W2–W4, stop shipping 100% synthetic data (keep measured values, derive missing ones), add CI, and keep one project-update file per date

### Files updated (vault)
- `projects/subsidence-simulator/decisions.md` — new §10; §8 layout result, §9 W1–W4 headings and DEC-1 / DEC-12 marked superseded (text kept). → [[projects/subsidence-simulator/decisions]]
- `gates/G00-data-pinning.md` — appended refit section; peak finding marked resolved. → [[gates/G00-data-pinning]]

### Outside the vault
- `mine-sim/src/minesim/physics.py` — inflection-point offset. → [[work-packages/WP1-core-physics]]
- `mine-sim/src/minesim/fitting.py` — fit through `physics.subsidence` (R0-4); `data/fitted/adriyala_lw1_params.json` refit; `config/mines/*.yaml` new keys and values.
- `mine-sim/src/minesim/sizing.py` — cross on survey line, monument snap, natural-break tiers on rod-axis strain, 1A tilt detectability. → [[work-packages/WP2-sizing-algorithm]]
- `mine-sim/src/minesim/config.py`, `provenance.py`, `sensors.py` — survey origin offset, effective extent. → [[work-packages/WP4-sensor-models-provenance]]
- `scripts/stress_test.py` 55/0/0; new `scripts/build_anchored_dataset.py`.
- `handoff/v2-sim-sample/`, `handoff/v2-real-anchored/`; v1 README marked superseded.
- `.github/workflows/ci.yml`; `project-updates/` merged to one file per date; `CLAUDE.md` rule 3 updated.

### Decisions
- Recorded Adarsh's directions (data rule, fix W2–W4, file per date). Claude chose: offset model, 5% rule for a, natural breaks, SNR 3 (all marked OPEN where not sourced).
