---
title: "Changelog: Repo Cleanup — Plan Docs into files/, Old Folders Removed"
slug: 2026-09-14-claude-code-repo-cleanup
type: changelog
module: governance
status: reviewed
tags: [changelog, audit-trail, cleanup]
created: 2026-09-14
updated: 2026-09-14
author: claude-code
last_agent_edit: claude-code
source_file: CLAUDE.md, files/
---

# Changelog: Repo Cleanup — Plan Docs into files/, Old Folders Removed

## Agent: Claude Code
## Date: 2026-09-14
## Source: Adarsh asked to remove old/unneeded folders and put the plan and problem-statement docs in `files/`

### Files updated (vault)
- `docs/agents-invariants.md`, `notes/safety-and-governance/no-pinn-safety-path-invariant.md` — `source_file` → root `AGENTS.md` (duplicate `files/AGENTS.md` removed). → [[docs/agents-invariants]], [[notes/safety-and-governance/no-pinn-safety-path-invariant]]
- `docs/master-process-explainer.md`, `docs/wp0-data-pinning-guide.md`, `docs/architectural-decisions-and-analogies.md` — `source_file` notes that `explainers/` was removed; these notes are now the only copy. → [[docs/master-process-explainer]], [[docs/wp0-data-pinning-guide]], [[docs/architectural-decisions-and-analogies]]
- `work-packages/WP9-scenario-lab.md`, `projects/subsidence-simulator/decisions.md` — plan paths → `files/`. → [[work-packages/WP9-scenario-lab]], [[projects/subsidence-simulator/decisions]]

### Outside the vault
- Moved into `files/`: `BUILD-PLAN.md`, `MY-STEPS.md`, `SIMULATION-IDEA.pdf` (+ `.src/simulation-idea.html`), `TEAM-BRIEF-V1.md`.
- Deleted: `archive/` (11 superseded plans), `explainers/`, `hands-on/`, `work-with-tools/`, `handoff/` (now empty; BUILD-PLAN recreates `handoff/v1-sample/` for data drops), `files.zip`, `files/AGENTS.md`, `mine-sim/AGENTS.md`, `.DS_Store`. Backup: `~/Documents/sih26-cleanup-backup-2026-09-14.zip`.
- `CLAUDE.md` folder table + Rule 2 python path; `files/README-start-here.md` current-plan pointer; `files/SIMULATOR-CHECKLIST.md`, `walkthroughs/step-00-…/CLAUDE-REVIEW.md` pointers; `.gitignore`.
- Not touched: older changelogs and `project-updates/` session logs (historical record, may name old paths). Folders outside the repo (`~/Documents/sih26` code, `sih-second-brain`, `sih26-archive`, `sih26-backups`) left alone per Adarsh.

### Decisions
- None. No spec, contract or scope change.
