# What you asked, what I understood, what I did (sessions 10–13, 15 Sep)

Written by Claude Code for Adarsh. No jargon. If a line here doesn't match what you meant, tell me which line.

---

## Session 10: "one command for everything, no database"

**You said:** give me one command that wipes the generated data and runs the whole system from scratch. No Postgres. Backend and frontend read files from my laptop. "Yes for all" to D1–D7.

**I understood:** you want to type one thing and get a fresh, repeatable result, without any database setup.

**I did:**
- Made `./run-simulation.sh`. It wipes old output, refits the physics, runs the tests, runs the 690-day simulation with a live day counter, builds the real-anchored dataset, copies a sample into `handoff/`, and checks the row count.
- Ran it: 121 seconds, and the output is byte-for-byte the same as the committed v2 data, so it is repeatable.
- Recorded D1–D7 as approved, plus a new decision DEC-16: no database in Part 1.

## Session 11: "is the visualization built?"

**You asked** whether the 3D view existed yet.
**I answered:** not yet, because T4 (Antigravity) comes first. I tightened the T4 prompt so it reads the v2 data.

## Session 12: "the 3D view looks very bad, rebuild it on real terrain, then place the nodes"

**You said:** the simulation runs on our mine data, but the design and terrain look very bad. Study the old `sih26/simulation` folder (terrain, design, 3D; ignore the ML), rebuild the view on our data, then use the placement algorithm to plan nodes over that terrain, reusing old code where it helps. You asked me to build this myself, not Antigravity.

**I understood:** two jobs.
1. **Job 1:** a 3D view that looks like real ground, sinking day by day from our own simulation.
2. **Job 2:** decide where the sensor nodes go on that ground, using the old placement idea, not a plain grid.

**I did, Job 1 (the 3D view):**
- **Ground:** real elevation data for Adriyala, not a flat sheet. It shows the real open-cast pit and dumps.
- **Colours:** one colour scale for height and a separate blue→red scale for how far the ground has sunk.
- **Mine:** where the face is, the panel outline, the survey line, an underground "X-ray" view, and a cross-section along the survey line (today versus day 0).
- **Controls:** a day slider, 6 camera buttons, and click-a-node for details.
- **Bug found in the old code:** it placed the mine at the centre of its elevation tile, about 2.2 km from the real spot. I fetched correctly placed data instead.

**I did, Job 2 (node plan):**
- **Nodes:** 237 scouts, 34 anchors and 1 gateway, costing ₹5.71 lakh.
- **Placement rules:** scouts are scattered, not on a grid, and kept at least 20 m apart. No scout goes on ground steeper than 20°. Where the ground stretches more, better nodes go.
- **Radio:** no anchor has more than 8 scouts. Links that a hill blocks are drawn red.
- **Tests:** 9 new tests. One caught a real mistake (the wrong tier at a node's exact spot), and I fixed it.

**I did not do:**
- I did not feed the new node plan into the sensor run. `nodes.csv` still has the old 25 nodes.
- I did not verify the mine's real coordinates. They are copied from the old project.
- I did not commit it in that session (committed in session 13 as `685bbd4`).

**How to see it:** `./run-simulation.sh view`, or the screenshots `s1_overview.png` … `s7_click.png` in this folder.

## Session 13: "clean the whole folder, commit, and one command that runs the simulation entirely"

**You said:**
- Remove every file or folder that isn't needed.
- Write down in simple words what you asked and what I did.
- Commit.
- Give me one command, "run simulation", that runs everything.

**I understood:**
- Delete leftovers and duplicates, but nothing the demo, tests, CI or vault needs.
- Write this file and commit.
- Make one clearly named command and prove it works by running it.

**I did:**
- **Checked first:** vault clean (0 broken, 0 orphans) and 138 tests passed.
- **Committed sessions 10–12** as `685bbd4`.
- **Renamed** `run-all.sh` to **`run-simulation.sh`** and updated `steps/`, `BUILD-PLAN.md`, `REAL-MINE-DATA-PLAN.md` and the vault decisions note to the new name. Older logs keep the old name because they are history.
- **Fixed a bug the full run exposed:** the script stopped silently at step 6 whenever `run_summary.json` really changed. Here it changed because session 12 added planner settings to the config, which changes the config hash. The sensor data itself was byte-identical. Now the script keeps the new file and carries on.
- **Ran it entirely:** `./run-simulation.sh --no-view` finished in 170 s with exit code 0.
  - Tests: 138 passed.
  - Data: 414,000 rows (expected 414,000), 0 duplicates, delivery 99.96%, peak sinking 1,204 mm.
  - Node plan: 237 scouts, 34 anchors, 1 gateway (₹5.71 lakh).
  - 3D scene: 5.7 MB.

**Not done: the deletions.** Claude Code's safety check blocked every delete command, even through git. The commands are in the chat for you to run. They remove:

| Remove | Why it's not needed |
|---|---|
| `work-with-tools/` | `steps/` replaced it (STATUS.md + one file per step with its prompt) |
| `work-with-system/` | `steps/` replaced it too (each step has a "check by hand" part; V1/V2 have the demo steps) |
| `handoff/v1-sample/` (10 MB) | its own README says it is superseded by `v2-sim-sample` |
| `__pycache__`, `.pytest_cache` | Python caches; they come back by themselves |

**Kept on purpose:**

| Keep | Why |
|---|---|
| `mine-sim/out/` (293 MB) | the 3D view and the Wednesday steps read it; git ignores it |
| `renderer/scene/` | the file the 3D page loads (ignored by git) |
| `files/` specs, checklists, RECOMMENDATIONS | frozen specs and decision sources; the vault points at them |
| `walkthroughs/` | the review evidence for every step |
| `mine-sim/src/minesim.egg-info` | Python needs it to find `minesim` |
| folders outside this repo | you said on 14 Sep to leave them alone |

## The one command

```bash
cd ~/Documents/sih26/sih-26-finale
./run-simulation.sh            # everything from scratch (~3 min), then opens the 3D view
./run-simulation.sh view       # just open the 3D view, no rebuild
./run-simulation.sh 30         # quick 30-day run
```
