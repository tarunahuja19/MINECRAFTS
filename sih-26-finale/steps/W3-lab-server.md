# W3 — Lab server + store + gates L1–L3, L7

**In plain words:** The Scenario Lab server that the pages talk to, plus safety gates proving scenarios never change the real run.

**Antigravity files owner:** AG-3 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP W3 · Lab server + store + gates L1–L3, L7

WP9 §7, §8. Files: scenario-lab/lab/scenario.py (run_scenario(run_dir, request) -> dict: snapshot → event → consequence.evaluate → full WP9 §7 JSON, window crop, negative-down ints), lab/store.py, lab/server.py (all endpoints in §7 except /api/forecast/consequence; serves renderer/ at /), scenario-lab/tests/test_server.py, tests/gates/test_l1.py, test_l2.py, test_l3.py, test_l7.py. /api/events builds the form spec from config/events/*.yaml, never from code. Unknown type or out-of-range param → HTTP 422 with a plain message. If W1/W2 aren't merged, register a fake event in tests only. Tests: every endpoint via TestClient; L1 hashes the run dir before and after running every registered type; L2 byte-identical repeat; L3 import scan + write-location check; L7 label present. Walkthrough step-15-lab-server. One-line start command.

When done: write walkthroughs/step-w3-lab-server/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step W3
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit W3`.

## 3 · You check by hand

Before trying scenarios, fingerprint the real run:
```bash
shasum -a 256 mine-sim/out/v2-690d/nodes.csv mine-sim/out/v2-690d/terrain_changes.jsonl > /tmp/before.sha
```
After trying scenarios: `shasum -a 256 mine-sim/out/v2-690d/nodes.csv mine-sim/out/v2-690d/terrain_changes.jsonl | diff - /tmp/before.sha && echo UNCHANGED` → must print `UNCHANGED`.

## 4 · Fix prompt (only if Claude's check found problems)

None yet.
