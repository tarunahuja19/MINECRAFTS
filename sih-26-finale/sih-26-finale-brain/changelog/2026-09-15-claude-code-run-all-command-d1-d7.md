---
title: "Changelog: One-Command Rebuild and D1–D7 Ratified by Claude Code"
slug: 2026-09-15-claude-code-run-all-command-d1-d7
type: changelog
module: integration
status: reviewed
tags: [changelog, audit-trail, decisions, run-command, data-path]
created: 2026-09-15
updated: 2026-09-15
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-15.md
---

# Changelog: One-Command Rebuild and D1–D7 Ratified by Claude Code

## Agent: Claude Code
## Date: 2026-09-15
## Source: Adarsh asked for one command that runs the whole system from scratch on his laptop (no Postgres; backend/frontend read local data) and answered "yes for all" to D1–D7

### Files updated (vault)
- `projects/subsidence-simulator/decisions.md` — new §11: D1–D7 ratified, DEC-14/DEC-15 ratified, DEC-16 no database in Part 1, run command. → [[projects/subsidence-simulator/decisions]]
- `work-packages/WP9-scenario-lab.md` — dated update line under the draft banner (banner text kept). → [[work-packages/WP9-scenario-lab]]

### Outside the vault
- `run-all.sh` (new, repo root). No `mine-sim/src/` code changed.
- `files/MY-STEPS.md` §A marked answered; `work-with-system/2026-09-15-tue.md` new step S1c; `project-updates/2026-09-15.md` session 10.

### Verification
First run 121 s: 129 tests passed; 414,000 rows = 25 × 16,560; 0 duplicate `(node_id, epoch)`; refit params, `nodes.csv` and real-anchored data byte-identical to the committed v2 files (sha256 `ee340beb…` for `nodes.csv`).

### Decisions
- Recorded Adarsh's: D1–D7 yes; no DB in Part 1 (DEC-16).
- Claude chose: `handoff/` is refreshed only by the 690-day run; `handoff/v1-sample` and `data/real` are never erased.
