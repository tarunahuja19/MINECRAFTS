# T3 — Same-seed check + run facts

**In plain words:** Proves the simulator gives exactly the same data every time with the same seed, and records how long the full run takes.

**Antigravity files owner:** AG-3 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP T3 · Same-seed check + run facts

The 690-day run already exists at mine-sim/out/v2-690d (made by ./run-simulation.sh). Do NOT rerun it and do NOT edit any code.
1. Report wall_time_s, epochs, delivery_rate, peak_subsidence_mm and provenance from mine-sim/out/v2-690d/run_summary.json.
2. Run the same seed twice for 7 days into a temp folder: cd mine-sim && python -m minesim.run --days 7 --out /tmp/t3a and --out /tmp/t3b. Then cmp /tmp/t3a/nodes.csv /tmp/t3b/nodes.csv and cmp both terrain_changes.jsonl files. Both must be identical.
3. Write walkthroughs/step-t3-same-seed/WALKTHROUGH.md and test_results.txt with the exact commands and outputs. Report, then STOP.
```

## 2 · Paste into Claude (check)

```text
Check step T3
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit T3`.

## 3 · You check by hand

Look at the walkthrough and write down: full-run wall time `____ s`, the two 7-day files identical `yes / no` (must be **yes**).

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
