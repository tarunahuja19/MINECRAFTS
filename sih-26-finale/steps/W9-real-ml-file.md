# W9 — Real ML file (only if the ML teammate sent one)

**In plain words:** Only if the ML teammate sent a forecast file: check it and plug it in.

**Antigravity files owner:** AG-3 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W9 · Real ML file (only if the ML teammate sent one)

Validate the ML teammate's file with lab.forecast.load_forecast. If it fails, write the exact failures into handoff/ML-FORECAST-FEEDBACK.md in plain words, and don't modify their file. If it passes, copy it to scenario-lab/fixtures/ and run W7's test on it. Report.

When done: write walkthroughs/step-w9-real-ml-file/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W9
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W9`.

## 3 · You check by hand

Save their file unchanged as `handoff/ml-forecast/<name>.json` before pasting the prompt. If it isn't here by Wed 18:00, skip this step (moves to Thursday).

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
