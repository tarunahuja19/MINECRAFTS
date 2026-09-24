# F4 — More data: simulate the planned network for 690 days, export daily frames

**In plain words:** Today the 690-day run records only the 25 old nodes, and the 3D view jumps 10 days at a time. After F4, every planned node (≈300) gets hourly readings for all 690 days. The view gets one terrain frame per simulated day, loaded in chunks so the page stays light.

**Plan:** [F0](F0-fix-the-system-plan.md) finding 10 · decisions DF2, DF3. Needs F2 and F3 done.

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative in mine-sim/ — especially size_network(cfg) takes exactly ONE argument, G2; nodes.csv column order §7.1; ID ranges; child_index 0..7), sih-26-finale-brain/RULES.md, WP2, WP6, WP8 §3, steps/F0-fix-the-system-plan.md and this step. Branch fix-the-system, do not commit. Only edit the files listed. If the contract blocks this, STOP and tell me exactly which clause. Node count stays an output. Negative = down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

STEP F4 · Planned network in the sensor run + daily binary frames

Part A — mine-sim (sensor run uses the v3 plan)
Files: mine-sim/src/minesim/sizing.py, mine-sim/src/minesim/run.py (only if needed), mine-sim/config/assumptions.yaml (layout: section only), mine-sim/tests/unit/test_layout_from_plan.py (new) and fixtures in mine-sim/tests/conftest.py, run-simulation.sh.
1. assumptions.yaml layout.source: plan   # source: F0 decision DF3 (15 Sep); v1 = old sizing algorithm
2. size_network(cfg) keeps its exact signature. When cfg says source == plan, it returns the same Layout dataclass built from minesim.placement.plan_network (import inside the function to avoid a circular import): same tiers, IDs, parents, backups, child_index, positions. When source == v1 it runs the old code unchanged. If the Config dataclass needs a new field, add it with the yaml key; check the contract section on Config first and STOP if it is frozen.
3. Every existing gate test must still pass. Tests that were written for v1 node counts (25 scouts) must run with source == v1 explicitly (a fixture that sets it). List each such test by name in the report and don't change what they assert.
4. New tests: with source == plan, the Layout node set equals node_plan.json (ids, tiers, parents, child_index); G2 signature test still passes; an 80-day run with the plan layout has rows == scouts × epochs and 0 duplicate (node_id, epoch).
5. run-simulation.sh: plan BEFORE simulate (today it plans only before export). Verification step: expected rows = scouts from the plan × epochs. Keep the live day counter. Keep the handoff sample small: first 1000 rows plus a gzip of at most 50 MB. If the full gz is larger, write only the survey-line nodes to the handoff gz and say so in handoff README.
6. DAYS stays 690 (DF2). Report the new run: wall time, nodes.csv size, rows, delivery ratio, peak mm.

Part B — renderer daily frames
Files: renderer/export_scene.py, renderer/config.yaml, renderer/js/terrain.js, renderer/js/network.js, renderer/js/app.js (loading only; F5 does the clock), renderer/tests/test_export_scene.py, renderer/.gitignore.
1. config.yaml day_step_days: 1 (# source: F0 DF1 smooth playback). frame_chunk_days: 30.
2. export_scene.py still reads terrain_changes.jsonl in ONE pass. Writes renderer/scene/scene.json (static data: terrain, geometry, plan, frame index, NO per-day grids) and renderer/scene/frames/grid_DDDD.bin: little-endian int16 mm of the downsampled grid per day, frame_chunk_days days per file, row order documented in scene.json. Assert |value| <= 32767 before casting, else fall back to int32 and record dtype in scene.json. Plan node live dz per day: frames/nodes_DDDD.bin float32 [days × nodes]. Report total frames size and the largest one-day change of any cell (mm) and of any node.
3. terrain.js/network.js load chunks lazily (fetch arrayBuffer) as the day moves; keep at most 3 chunks in memory; between two days interpolate linearly by fractional day. The sensor-run nodes layer (v1) is replaced by the plan nodes' own nodes.csv readings for the current day: provenance colour per node (real / pinned / synthetic / undelivered), same legend as before.
4. Tests: on an 80-day run, every daily frame decoded from the bin files array_equals replay_terrain(run, epoch)[::k, ::k] at days 0, 1, 40, 79, 80; node frames match nodes.csv subsidence for 5 random nodes and days; scene.json size < 10 MB; no minesim.physics in renderer/.

Report: mine-sim pytest count (138 + new), renderer pytest count, full 690-day run numbers (time, rows, sizes), export time and sizes, a screenshot at day 1, 200, 690. Write walkthroughs/step-f4-data/WALKTHROUGH.md. STOP.
```

## 2 · Paste into Claude (check)

```text
Check step F4
```

Claude checks: `size_network` signature and G2; v1 tests still assert v1 behaviour; rows = scouts × epochs; single-pass jsonl; decoded frames equal the replay; disk sizes; handoff stays small.

## 3 · You check by hand

```bash
./run-simulation.sh          # full rebuild, now longer (report the time)
```

| # | Do | You should see |
|---|---|---|
| 1 | Watch the run | `day N / 690` counter, then `rows … (expected …) \| duplicate 0` with ≈300 nodes × 16,560 |
| 2 | View opens, drag the day slider slowly | The trough grows smoothly day by day, no 10-day jumps |
| 3 | Look at nodes near the face | Their beacons turn from grey to blue and purple as the face passes |

## 4 · Fix prompt (only if Claude's check found problems)

_Empty until Claude's check._
