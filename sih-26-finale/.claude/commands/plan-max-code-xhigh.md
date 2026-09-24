---
description: Plan a task with maximum effort, then code it lean to save tokens
argument-hint: <task description>
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# /plan-max-code-xhigh

Two phases for one task (`$ARGUMENTS`). Phase 1 thinks hard and touches
nothing. Phase 2 codes fast and wastes nothing. Invoking this command counts
as Adarsh's explicit ask to implement (CLAUDE.md planner-only default is
lifted for this task only).

## Rule 0 — Contracts and invariants outrank this file

`files/11-interface-contracts-v1.md` is authoritative. The eight invariants in
`AGENTS.md` are not reversible. If a contract cannot be implemented as written,
stop and escalate to Adarsh — never quietly change a shape and carry on.

## Phase 1 — PLAN-MAX (maximum effort, read-only)

Spend the full reasoning budget here. **No edits, no commits, no runs that
write output.** Read-only commands (`ls`, `sed`, `grep`, pytest dry reads) are
fine.

1. Re-read the truth: `AGENTS.md`, `files/11-interface-contracts-v1.md`
   (bindings for this task), the owning work package in `files/WP*.md`, and
   the matching step file in `steps/` plus its STATUS line.
2. Trace every call site and existing test for the area being changed — they
   define the real contract (error types, return shapes, defaults).
3. Produce the plan and **stop for approval**:
   - Goal in one line.
   - Files to touch (stay in your package; need something outside it? write it
     down and escalate instead of editing it).
   - Contract check: fits the frozen shapes, or why it cannot (then stop).
   - Gates/tests that will prove it (`tests/gates/test_gNN.py` names).
   - Risks and what is deliberately left out (simplest version that works).

Do not enter Phase 2 without Adarsh's go-ahead on the plan.

## Phase 2 — CODE-XHIGH (lean implementation, token-saving mode)

Code with a tight budget: no re-planning, no over-engineering, no drive-by
fixes outside the approved file list. Batch edits; one verification pass.

1. Implement the approved plan only. Working rules: no magic numbers (values
   live in `config/assumptions.yaml` or `config/mines/*.yaml`), every emitted
   value tagged `real` / `pinned` / `synthetic`, integer-millimetre terrain
   accumulation, fail loudly on unpinned parameters.
2. Run the proving gates: `cd mine-sim && <PY> -m pytest -q` for the touched
   area (full file, never deselected). Report the exact count, e.g.
   `198 passed, 1 skipped` — never "tests pass" without the number.
3. Report: files changed, test count, gates covered, anything left open. Do not
   commit, touch the vault, or update `steps/STATUS.md` unless asked.
