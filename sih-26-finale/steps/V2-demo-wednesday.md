# V2 — Wednesday checks and final run-through

**In plain words:** at 18:00 Claude checks the first batch (sudden sinking, crack, edge collapse, houses/roads/poles, forecast view). At 22:00 it checks everything and writes the demo script. At 23:00 you rehearse.

No Antigravity prompt in this step. Anything that fails gets a fix prompt written into that step's file.

## 1 · Morning (you)

`./run-simulation.sh view` still works and `git pull` is clean. At **15:00** message ML: "Send your forecast JSON now." When it arrives, save it unchanged as `handoff/ml-forecast/<name>.json` and do [W9](W9-real-ml-file.md). If it's not here by 18:00, it moves to Thursday. That's the plan, not a failure.

## 2 · Paste into Claude

**18:00 — first-batch gate:**
```text
First-batch gate: pytest counts in mine-sim/ and scenario-lab/; run_gates.py; start lab.server on mine-sim/out/v2-690d; run sudden_sinking, crack and edge_collapse through the API at the WP9 test points; confirm L1–L7; Window 1 → Freeze → Window 2 → each type → screenshots; forecast view with the test fixture. PASS/FAIL table per item. Failing items: fix prompt into that step file, update steps/STATUS.md; the second-batch item it displaces moves to Thursday.
```

**22:00 — final integration:**
```text
Final v2 integration: everything from the 18:00 gate plus blast, sinkhole, railway, pipe, and the real ML file if present. Write handoff/DEMO-SCRIPT-V2.md (commands + what to show: Window 1 → 2 → 3 → forecast). Update walkthroughs/README.md and steps/STATUS.md. List what moved to v3. Commit and push. Session log with vault check and both pytest counts.
```

## 3 · You check by hand (23:00, 30 min)

1. `git pull`, close all terminals and tabs.
2. Fingerprint: `shasum -a 256 mine-sim/out/v2-690d/nodes.csv mine-sim/out/v2-690d/terrain_changes.jsonl > /tmp/before.sha`
3. Follow `handoff/DEMO-SCRIPT-V2.md` exactly.
4. `shasum -a 256 mine-sim/out/v2-690d/nodes.csv mine-sim/out/v2-690d/terrain_changes.jsonl | diff - /tmp/before.sha && echo UNCHANGED` → must print `UNCHANGED`. If not, stop and tell Claude `Scenarios changed the main run files.`
5. Paste what failed + total time into Claude.
