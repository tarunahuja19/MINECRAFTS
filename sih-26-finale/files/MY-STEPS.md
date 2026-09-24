# MY STEPS — Adarsh, Mon 14 → Wed 16 Sep

Files that matter:
1. `files/SIMULATION-IDEA.pdf`: what we're building
2. **this file**: your decisions (§A) and teammate messages (§E)
3. `work-with-system/<date>.md`: what you do by hand today
4. `work-with-tools/<date>.md`: which prompt goes into which window today
5. `files/BUILD-PLAN.md`: the prompt texts (step ids M1, T4, W2…)

---

## A. Say yes or change (5 minutes, now)

Reply to Claude with e.g. `D1–D7 yes`. Each one has a default.

> **Answered 2026-09-15: D1–D7 yes (all defaults).** Recorded in vault decisions §11.

| # | Decision | Default if you say yes |
|---|---|---|
| D1 | **Scenarios never touch the main run.** Window 2 works on a frozen copy; the data file and stream the team uses never change. That keeps the frozen contract ("no click-to-subside" in the live stream) true | Yes |
| D2 | **Fix three physics bugs first on Monday:** horizontal movement points the wrong way; strain returns tilt; the coal face keeps moving past the panel end (2760 m on a 2500 m panel at day 690). Without the fix the ML/backend data is wrong | AG-3 does it first (M2 Part 0) |
| D3 | **5 scenario types.** First batch: sudden sinking, crack, edge collapse (tilt). Second batch: blast, sinkhole. **Blast stays switched off ("site constants not set") unless a published Indian K and b are found**; no guessed values | As listed |
| D4 | **Objects:** houses, roads, poles first; railway, pipe second. Placed as an example village, not the real Adriyala surface. Grades only where a published limit exists | As listed |
| D5 | **ML file format** = per node, +24 h / +72 h, p10/p50/p90, cumulative mm, negative down (`sih-26-finale-brain/docs/interface-ml-to-renderer.md` §2b) | Send it to the ML teammate today |
| D6 | **Window 3** (sensor data after the event) = v3. Wednesday only gets a placeholder page | v3 |
| D7 | **If the second batch isn't done by Wed 23:00**, it moves to Thursday | Thursday |

Also taken as yes unless you object: Illinois data renamed "synthetic test file" · one radio cycle per simulated hour · missing sensor/radio numbers are guesses marked `# OPEN` · data shared through the GitHub repo.

---

## B–D. Day-by-day steps → moved

Your steps by date now live in **`work-with-system/`** (what you do by hand) and **`work-with-tools/`** (what goes into each Antigravity window and Claude, in order). One file per date in each. They replace the Monday/Tuesday/Wednesday tables that used to be here.

---

## E. Messages to send today (copy-paste)

**To the ML teammate:**
> Brief: `files/TEAM-BRIEF-V1.md` → ML section. Tonight you get sample rows labelled FAKE in `handoff/v1-sample/` so you can write your loader (the header is in the brief, so start now); the real simulator sample replaces them once the run works (late tonight or Tue morning). Goal for Tue 20:00: predict each node's `subsidence_mm` at +24 h and +72 h as p10/p50/p90, compare against a "no change" baseline, error in mm. **Output file format (please use exactly this):** `sih-26-finale-brain/docs/interface-ml-to-renderer.md` §2b: one JSON per issue time, cumulative mm, negative = down. I need one real file by **Wed 15:00** for the forecast view. Your output is advice only; it never triggers alerts.

**To the backend pair:**
> Brief: `files/TEAM-BRIEF-V1.md` → Backend section. Goal for Tue 20:00: ingest simulator rows (from `nodes.csv` tonight, WebSocket tomorrow), store them with their `_prov` tags, dedupe on (node_id, epoch) never seq, one threshold alarm with a logged reason, ONE alert actually sent. **SMS, app alerts and offline mode are yours** (v2). Column names are frozen. Negative subsidence = ground went down. Scenario results from the simulator's Window 2 are NOT sent to you; don't ingest them.

**To the hardware pair:**
> For Tuesday: one node on the table sending a reading. By Tue midday please send (1) a spec sheet per sensor (range, resolution, noise, drift, sample rate), because the simulator uses guesses now, and (2) your radio packet format. Please start the tilt day/night drift test.

**To everyone:**
> v1 (Tue 20:00) = simulator + ML + backend + 3D view. v2 (Wed night) = the simulator's "freeze and create subsidence" window and the forecast view. Dashboard, map, roles and mobile owners get assigned at Tuesday's demo.
