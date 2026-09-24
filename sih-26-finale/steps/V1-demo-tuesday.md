# V1 — Tuesday demo (20:00)

**In plain words:** Claude checks that everything built today works together and writes the exact demo commands. You rehearse once, then demo.

No Antigravity prompt in this step.

## 1 · Morning (~11:00) · Ask teammates (you)

| Who | Ask | Good answer |
|---|---|---|
| ML | "Is your loader reading `handoff/v2-sim-sample/nodes.csv.gz` (414,000 rows)? Have you opened `handoff/v2-real-anchored/README.md`?" | Shows a dataframe / row count |
| Backend/frontend | "Are you reading `nodes.csv` rows? Show me one row." | A row with `node_id`, `epoch`, negative `subsidence_mm` |
| Hardware | "Did you send the sensor spec sheet and packet format?" | File or link → save as `files/hardware-spec-<date>.pdf`, tell Claude `Spec sheet is at <path>` |

**12:00 slip check:** if T4 isn't committed by 12:00, tell Claude `Give me a slip plan for tonight's demo.` You decide between its options.

## 2 · Paste into Claude (16:00, or once T1–T4 are committed)

```text
Integration v1: vault check and mine-sim pytest count; run_gates.py; ./run-simulation.sh --no-view and confirm rows/duplicates; start the WebSocket server and receive 100 ordered frames; ./run-simulation.sh view and check the page loads. Write handoff/DEMO-SCRIPT-V1.md with the exact commands for the 20:00 demo, each with what the team should see. Update steps/STATUS.md. Commit and push. Session log.
```

## 3 · You check by hand

**18:00 dry run (45 min):** `git pull`, close every terminal and browser tab, follow `handoff/DEMO-SCRIPT-V1.md` exactly, time yourself. Write down anything that failed. Paste into Claude: `Dry run: <what broke>` or `Dry run clean, <N> min`.

**19:45:** tell Antigravity `Freeze. No edits until I say so.`

**20:00 demo:** follow the script. At the end assign owners in team chat: dashboard, map, user roles, mobile app. Tell ML: "Forecast file due Wed 15:00, format `interface-ml-to-renderer.md` §2b."

**Before bed:** read Claude's session log.
