# steps/ — everything you do, one step at a time

**Open [STATUS.md](STATUS.md) first.** The 👉 row is where you are.

## The one command

```bash
cd ~/Documents/sih26/sih-26-finale
./run-simulation.sh              # rebuild everything from scratch (~2 min), then open the 3D view
./run-simulation.sh view         # no rebuild, just open the 3D view
./run-simulation.sh 30           # quick 30-day run + its 3D view
./run-simulation.sh --no-view    # rebuild only
```
You should see `129 passed`, a live `day N / 690` counter, `rows 414000 (expected 414000) | duplicate (node_id, epoch) 0`, then the browser opens at http://localhost:8000 with the **SIMULATED** banner. Stop the view with Ctrl+C.

No database, no API keys. ML and backend read the files in `mine-sim/out/v2-690d/` on this laptop, or `handoff/` on GitHub.

## The loop (same for every step)

| # | Where | What you do |
|---|---|---|
| 1 | Antigravity | New chat? Paste [00-connect-antigravity.md](00-connect-antigravity.md) and wait for `CONNECTED`. |
| 2 | Antigravity | Paste **section 1** of the step file. Wait for its report (it must give pytest numbers). |
| 3 | Claude | Paste **section 2**: `Check step <id>`. |
| 4 | Claude replies | **PASS** → say `commit <id>`. **Fixes** → Claude writes a fix prompt into section 4 of the step file. |
| 5 | Antigravity | Paste section 4 (fix prompt) → back to row 3. |
| 6 | You | Do **section 3** (check by hand) once it's committed. Then go to the next 👉 row in STATUS. |

Rules: one step at a time. Never accept "tests pass" without a number. If what you see doesn't match "You should see", paste it into Claude. Don't guess.

## What `Check step <id>` makes Claude do

Read the step file and the walkthrough, rerun the tests itself (step tests + `mine-sim` 129), compare the code with the prompt and the specs (contract inside `mine-sim/`, WP9 for `renderer/` and `scenario-lab/`), check that only the listed files changed, look for invented values and wrong signs (negative = down), look at screenshots. Then write PASS or a fix prompt into the step file and update STATUS.md.

## Other folders

| Folder | What |
|---|---|
| `mine-sim/` | the simulator |
| `renderer/` | 3D view pages |
| `handoff/` | data shared with ML/backend through GitHub |
| `walkthroughs/` | Antigravity's report for each step (screenshots, test output) |
| `project-updates/` | Claude's session log, one file per date |
| `files/` | specs (frozen) + BUILD-PLAN (milestones, file owners) + MY-STEPS (decisions, teammate messages) |
| `sih-26-finale-brain/` | the Obsidian vault (source of truth) |
