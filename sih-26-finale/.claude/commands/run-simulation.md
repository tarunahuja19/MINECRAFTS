---
description: Run the whole simulation on this laptop (sim → data → 3D view), then report what came out
argument-hint: [view | <days> | --no-view]
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# /run-simulation

Run the pipeline end to end and report the real numbers. Arguments: `$ARGUMENTS`

## Rule 0 — `run-simulation.sh` is the only source of truth

`run-simulation.sh` at the repo root *is* the pipeline. Never re-implement its steps
here, never call `minesim.run` / `placement` / `build_anchored_dataset.py` directly to
"do the same thing", and never paste its step list into this file. This command only
*drives* it and reads back what it printed. That is what keeps this command current when
the script changes.

## Step 1 — Re-read the truth (every single run, before doing anything)

```bash
sed -n '1,20p' run-simulation.sh          # usage + step list, straight from the script
ls mine-sim/scripts/                       # what exists
git -C . log --oneline -1 -- run-simulation.sh
```

Take the accepted arguments and the step list from what you just read, not from memory.
If the header disagrees with anything written below, the header wins — and fix this file
(Step 5).

## Step 2 — Drift check (report, don't fix)

A rebuild erases `mine-sim/out/*`. Anything the pipeline does not regenerate is gone.
So, before running, list every producer script and check the pipeline actually calls it:

```bash
grep -oE '(scripts/[a-z_]+\.py|minesim\.[a-z_]+)' run-simulation.sh | sort -u
ls mine-sim/scripts/*.py renderer/*.py
```

Report any producer that exists but is never invoked, and name what output it owns.

**Known gap as of 17 Sep 2026:** `mine-sim/scripts/export_cracks.py` (F10) writes
`mine-sim/out/cracks/` and is **not** in `run-simulation.sh`. A full rebuild deletes
`out/cracks/` and does not rebuild it. Until Adarsh says to wire it in, after a full
rebuild run it by hand and say you did:

```bash
cd mine-sim && "$PY" scripts/export_cracks.py --day 690
```

Do not edit `run-simulation.sh` to close a gap unless Adarsh asks. Claude is planner and
checker here (CLAUDE.md); flag it, let him call it.

## Step 3 — Run it

`PY=/opt/miniconda3/envs/pinn-sandbox/bin/python3.11` unless the script header says otherwise.

Map `$ARGUMENTS` onto the script:

| User said | Run |
|---|---|
| *(nothing)* | full rebuild, 690 days, then the view |
| a number, e.g. `30` | quick run of that many days, then the view |
| `view` | no rebuild — prepare + open the view of the existing run |
| `--no-view` | add to any of the above; rebuild only |

Two things block, so **both go in the background** (`run_in_background: true`):

- **Rebuild.** The 690-day run took ~935 s wall time last time, so the whole rebuild is
  ~15–20 min. Run `./run-simulation.sh <args> --no-view` in the background and poll its
  output. While it runs, report the step banners (`== 4/8 ... ==`) as they appear so
  Adarsh can see where it is — do not sit silent for fifteen minutes.
- **The viewer.** The script ends in `exec python -m http.server`, which never returns.
  Start `./run-simulation.sh view` in the background, wait for the
  `3D view: http://localhost:8000` line, then hand over the URL. It opens the browser
  itself. If the port is busy the script says so — pass `PORT=8001` rather than killing
  whatever is on 8000 without asking.

If the script exits non-zero, show its actual output. Do not retry the whole rebuild on a
failure you have not read.

## Step 4 — Report (numbers, not adjectives)

From the script's own output, give:

- **Tests** — the exact pytest count from step 3/8, e.g. `194 passed, 1 skipped, 2 xfailed` (that was the count on 17 Sep 2026, session 23 — a drop is a
  regression, say so). CLAUDE.md Rule 2:
  never say "tests pass" without the number. On `view` (no rebuild) the script skips
  tests — say so rather than implying they ran.
- **Fit** — the Adriyala RMS residual and R² from step 2/8.
- **Verify** — the whole step 8/8 line: rows vs expected, duplicate `(node_id, epoch)`,
  delivery rate, peak subsidence, provenance. If rows ≠ expected or duplicates > 0, that
  is a failure — say so plainly, do not round it off.
- **Handoff** — whether `nodes.csv.gz` is `all_nodes` or `survey_line_only`, and its size.
- **Drift** — whatever Step 2 found, including whether you ran `export_cracks.py`.
- **Where the data is** — the paths the script printed.
- **The view** — the URL, or why there isn't one.

Then stop. Do not commit, do not touch the vault, do not update `steps/STATUS.md` unless
Adarsh asks — this command runs the simulation, nothing else.

## Step 5 — Keep this file current

If Step 1 or Step 2 showed this file is out of date — the script gained or lost a step,
an argument changed, a gap got wired in or a new one opened — edit
`.claude/commands/run-simulation.md` in the same turn and say in one line what you
changed. Stale instructions here are the one failure mode this command is built to avoid.
