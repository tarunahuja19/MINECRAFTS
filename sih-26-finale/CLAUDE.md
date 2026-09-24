# CLAUDE.md — Session Protocol for Claude Code

Claude Code's role in this repo: **planner and checker.** Antigravity writes the code. Adarsh supervises and makes the calls. Claude does not implement work-package code unless Adarsh explicitly asks.

## Rule 1 — Always read the Obsidian vault first

At the start of **every** session, before answering anything about the project:

1. `sih-26-finale-brain/RULES.md` — vault governance (binding).
2. `sih-26-finale-brain/docs/start-here.md` and `docs/build-order.md`.
3. The newest file in `sih-26-finale-brain/changelog/`.
4. The newest file in `project-updates/` (one file per date) — its top summary, then the last session.
5. `AGENTS.md` (repo root) — the eight invariants. `files/11-interface-contracts-v1.md` wins over everything.

## Rule 2 — Always run the integrity checks

Run both at the start of a session **and** again before ending one:

```bash
python3 sync_vault.py --check                       # vault: frontmatter, broken wikilinks, orphans
cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q   # code: unit tests + gates
```

CI (`.github/workflows/ci.yml`) runs both on every push to `main`, plus `mine-sim/scripts/stress_test.py` and the real-anchored dataset build. Check it with `gh run list --limit 3`.

- Vault must report `0 broken / 0 orphans / 0 frontmatter issues`. If not, fix or report it before other work.
- Report the pytest count (e.g. `15 passed`). Never say "tests pass" without the number.

## Rule 3 — Leave a trail every session

- Any vault edit → follow `RULES.md` (frontmatter, wikilinks only, changelog entry in `changelog/`).
- End of session → append a `## Session NN` section to `project-updates/YYYY-MM-DD.md` (create the file for a new date). Keep the two summaries at the top of that file current: **Summary of earlier days** and **Summary of this day** (one line per session). Update that date's line in `project-updates/README.md`.
- If the plan changed → update `files/BUILD-PLAN.md` (prompt texts), and that day's `work-with-tools/<date>.md` (prompt order) and `work-with-system/<date>.md` (Adarsh's hands-on steps).

## Where things live

| Folder | Purpose |
|---|---|
| `files/` | Specs **and** the live plan. Frozen/read-only: `10-build-order`, `11-interface-contracts`, `WP*.md`. Live: `BUILD-PLAN.md` (only plan, all prompts), `MY-STEPS.md` (Adarsh's decisions D1–D7 + teammate messages), `SIMULATION-IDEA.pdf` (plain-words idea; source `.src/`), `TEAM-BRIEF-V1.md`, checklists. |
| `sih-26-finale-brain/` | Obsidian vault — source of truth. |
| `mine-sim/` | The simulator code. |
| `walkthroughs/step-XX-*/` | Per-step review packages (WALKTHROUGH.md + test_results.txt). |
| `work-with-tools/` | Per date: which prompt goes into which Antigravity window / Claude, in order. `00-CONNECT-ANTIGRAVITY-TO-VAULT.md` goes first in every AG chat. |
| `work-with-system/` | Per date: what Adarsh does by hand — installs, commands, clicks, expected output, teammate check-ins, decisions. |
| `project-updates/` | One file per date: summaries on top, then each session's log (what changed, what's open). |
