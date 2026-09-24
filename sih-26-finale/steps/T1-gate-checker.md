# T1 — WP7-lite harness + G14

**In plain words:** One script that runs every safety test (gate) and prints a pass/fail table. Adds gate G14: no machine learning is allowed in the alarm path.

**Antigravity files owner:** AG-1 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP T1 · WP7-lite harness + G14

Files: mine-sim/tests/gates/test_g14.py, mine-sim/scripts/run_gates.py, mine-sim/GATES.md. G14: static scan of all mine-sim/src/: no torch/tensorflow/jax/keras/sklearn imports, no alarm/threshold/classify/should_alarm logic; negative cases with temp files. run_gates.py runs each existing gate file alone and prints gate / pass-fail / seconds, then writes GATES.md (gates not built are listed as "v3 — not built", never faked). Exit 1 on failure.

When done: write walkthroughs/step-t1-gate-checker/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step T1
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit T1`.

## 3 · You check by hand

```bash
cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 scripts/run_gates.py; cd ..
```
**You should see:** a table with one row per gate, all built gates `PASS`, gates not built listed as "v3 — not built", and `mine-sim/GATES.md` created.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
