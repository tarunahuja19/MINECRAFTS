---
title: "Changelog: run-all.sh Renamed to run-simulation.sh by Claude Code"
slug: 2026-09-15-claude-code-run-simulation-command-rename
type: changelog
module: integration
status: reviewed
tags: [changelog, audit-trail, run-command]
created: 2026-09-15
updated: 2026-09-15
author: claude-code
last_agent_edit: claude-code
source_file: project-updates/2026-09-15.md
---

# Changelog: run-all.sh Renamed to run-simulation.sh by Claude Code

## Agent: Claude Code
## Date: 2026-09-15
## Source: Adarsh asked for one command named "run simulation" that runs everything

### Files updated (vault)
- `projects/subsidence-simulator/decisions.md` — run command name `./run-all.sh` → `./run-simulation.sh`. → [[projects/subsidence-simulator/decisions]]

### Outside the vault
- `run-all.sh` → `run-simulation.sh`; `keep_if_same` now returns 0 when a file really changed (it stopped the run silently at step 6 under `set -e`).
- `steps/*`, `files/BUILD-PLAN.md`, `files/REAL-MINE-DATA-PLAN.md` — command name.
- Full run verified: exit 0, 170 s, 138 passed, 414,000 rows, 0 duplicates, peak 1,204 mm.
- Older changelogs and session logs keep the old name (history). See [[changelog/2026-09-15-claude-code-run-all-command-d1-d7]].

### Decisions
- None. No spec, contract or scope change.
