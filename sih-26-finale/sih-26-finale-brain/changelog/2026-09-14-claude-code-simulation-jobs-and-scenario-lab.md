---
title: "Changelog: Simulation Segment Jobs 1–3, Scenario Lab, Plan Cleanup"
slug: 2026-09-14-claude-code-simulation-jobs-and-scenario-lab
type: changelog
module: governance
status: reviewed
tags: [changelog, audit-trail, scenario, wp9, renderer, forecast]
created: 2026-09-14
updated: 2026-09-14
author: claude-code
last_agent_edit: claude-code
source_file: hands-on/SIMULATION-IDEA.pdf
---

# Changelog: Simulation Segment Jobs 1–3, Scenario Lab, Plan Cleanup

## Agent: Claude Code
## Date: 2026-09-14
## Source: Adarsh's answers redefining the simulation segment (Jobs 1–3, three windows, v1 Tue / v2 Wed night), plus the request to remove confusing plan files

### Files created
- `work-packages/WP9-scenario-lab.md` — Job 2 + Job 3 spec: boundary, owners, conventions, dataclasses, 5 scenario formulas, consequences + damage limits (DGMS Circular 7/1997; building grades I–IV), JSON/HTTP, gates L1–L7, windows. → [[work-packages/WP9-scenario-lab]]
- Outside the vault: `hands-on/SIMULATION-IDEA.pdf` (+ `.src/`), `hands-on/MY-STEPS.md`, `work-with-tools/BUILD-PLAN.md`, `archive/README.md`, `project-updates/2026-09-14-session-04.md`.

### Files updated
- `projects/subsidence-simulator/decisions.md` — §6 marked superseded; §7 DEC-13 (ratified), DEC-14, DEC-15 (proposed), physics bug finding. → [[projects/subsidence-simulator/decisions]]
- `work-packages/WP8-consequence-renderer.md` — now Window 1 only; steps 4–6 moved to WP9. → [[work-packages/WP8-consequence-renderer]]
- `docs/interface-ml-to-renderer.md` — §2b per-node forecast file. → [[docs/interface-ml-to-renderer]]
- Outside the vault: `handoff/TEAM-BRIEF-V1.md` (simulator v2, ML output §2b, backend owns SMS/app/offline), `hands-on/README.md`, `work-with-tools/README.md`, `walkthroughs/step-00-wp0-wpc-data-pinning/CLAUDE-REVIEW.md` (pointer).

### Files moved (outside the vault, nothing deleted)
- `work-with-tools/day-1..3.md`, `work-with-tools/V1-PLAN.md`, `hands-on/day-1..3.md`, `hands-on/START-HERE-V1.md`, `hands-on/SIMPLE-1..3*.md` → `archive/2026-09-14-superseded-plans/`.

### Decisions Ratified
- DEC-13 (Adarsh). DEC-14, DEC-15 await D1–D7 in `hands-on/MY-STEPS.md`.

### Stress-test revision (same day)
- `work-packages/WP9-scenario-lab.md` — derivatives from the float model only; `Snapshot.s_model_mm`; crack rate/cap/threshold source; blast constants null; sinkhole note + upper bound; H7/H8; masked forecast objects; L4/L5 wording; id hash length in config. → [[work-packages/WP9-scenario-lab]]
- `projects/subsidence-simulator/decisions.md` — stress-test findings. → [[projects/subsidence-simulator/decisions]]
- Outside the vault: `work-with-tools/BUILD-PLAN.md`, `hands-on/MY-STEPS.md`, `hands-on/SIMULATION-IDEA.pdf` (+ source), `project-updates/2026-09-14-session-04.md`.

