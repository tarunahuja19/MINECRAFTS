# FORGE v2 — Live Math Data, Independent FORGE, Scripted Dataset

> **Branch:** `feat/forge-v2-live-and-scripted` (cut from `feat/forge-step4-carve-in-fix`, so steps 1–3 of the old plan are included).
> **Roles:** Antigravity writes the code. Claude plans and checks each step. Adarsh decides.
> **Supersedes:** steps 4 and 5 of `2026-09-26-forge-terrain-carve-in-refactor.md`. They are folded into Phase B below.

---

## The idea in plain words

1. **Live dashboard = math only.** The node data comes from the Knothe engine (`:8000`), flows through MQTT, the backend (`:8080`) and on to the dashboard. Nothing that happens in FORGE may reach this path.
2. **FORGE = a private playground.** It takes a copy of the ground as it is *right now* (current sim day), and lets you hit it with cave-ins, cracks, tilt and vibration at any spot, with any radius. You watch the ground change, and see which nodes *would* react. The live dashboard never sees any of it.
   - **Left:** node list (all nodes selected for now) and the event controls, as sliders.
   - **Centre:** the 3D terrain on the current sim day. Click to pick a target, then fire an event and watch the ground deform.
   - **Right:** a small copy of the MAP tab showing node placement and colours, reacting to FORGE events only.
3. **Scripted dataset = a repeatable demo.** A fixed "script" (seed, start time, and a list of events such as "cave-in on day 40 at x,y, radius 80 m") runs through the *same* engine. The same script gives the same numbers every time. Played through the real pipeline, the dashboard shows the alarms arrive on cue.

## What the code does today (checked 26 Sep)

| Fact | Where |
|---|---|
| Engine ticks 60 sim-s per step and publishes over MQTT → backend → dashboard WS | `simulation/sandbox/server.py:99`, `session.py:269`, `mqtt_bridge.py` |
| Why data looks "random": a clock anchored to wall time, plus a noise RNG that draws for every reading | `session.py` (`base_iso_time=""`), `sensors.py:287,340` |
| Collapse and vibration can be injected into the **live** engine | `session.py:567 apply_collapse`, `:603 apply_vibration`, `POST :8000/control` |
| FORGE already sends its 3D effects **locally** into its iframe (no engine command) | `sim-tab.js:2091 fireForgeTrigger` → `simEmbed.triggerScenario('forge', …)` |
| FORGE consequence numbers come from Scenario Lab `:8010` | `sim-tab.js` (`LAB_API_BASE`) |
| Current FORGE layout is already 3 columns: `#forge-left`, `#forge-middle`, `#forge-right` | `dashboard_electron/renderer/index.html:727-930` |
| Frontend physics (bowl and rim profiles, `globalGeomechanics`) | `simulation/frontend/src/utils/geomechanicsEngine.ts` |
| Half-done step-4 work (uncommitted): `terrain-target` event type | `simulation/frontend/src/embed.ts` |

## Rules every prompt carries (paste once at the top of each Antigravity chat)

```
Repo: /Users/adarshagarwala/Documents/sih26, branch feat/forge-v2-live-and-scripted.
Plan: docs/plans/2026-09-26-forge-v2-live-and-scripted.md — read it first.
Rules:
- Do ONLY the step I give you. Do not touch files outside its list without asking.
- FORGE must never send anything to :8000 /control or :8080 /api/simulation/*. FORGE is read-only toward the live system.
- No new dependencies unless the step says so.
- When done: run the step's check commands, paste the real output, and write
  walkthroughs/forge-v2/<step-id>.md (what changed, files, how to verify, test output).
- One commit per step, message given in the step. Do not push.
```

---

## Phase A — Live data from the math, dashboard independent of FORGE

### A1 · Make the live engine deterministic (seeded) and document the data path
**Files:** `simulation/sandbox/session.py`, `simulation/sandbox/sensors.py`, `simulation/sandbox/constants.py`, `simulation/tests/` (new test), `docs/DATA_LOOP.md`
**Do:**
- Keep the Knothe math as the only source of node values. Noise stays, but all of it must come from `SessionConfig.seed` (no unseeded RNG, no `Math.random`/`np.random` globals anywhere in `simulation/sandbox`).
- Add `SessionConfig.base_iso_time` support that makes a run fully reproducible when set. Leave the default (wall clock) for live mode.
- Add a test: two sessions with the same seed and base time, run N ticks each, give identical `nodes.csv` bytes (compare hashes).
- In `docs/DATA_LOOP.md`, add a short "Live path" section: engine → MQTT topic → backend route/table → WS message → dashboard module.
**Check:** `cd simulation && .venv/bin/python -m pytest -q` (report the count).
**Commit:** `feat(sim): seed all sensor noise and add reproducibility test`

### A2 · Isolation guard: FORGE cannot write to the live system
**Files:** `dashboard_electron/renderer/js/sim/sim-tab.js`, `sim-embed.js`, `simulation/frontend/src/App.tsx`, `dashboard_electron/test/` (new test)
**Do:**
- Find every `fetch`/`postMessage`/WS send reachable from FORGE. Anything that hits `:8000/control` or `:8080/api/simulation` must go. Reads (status, telemetry) are fine.
- In `App.tsx` embed mode, the FORGE slot must never call engine commands, and `handleTriggerEvent` must run locally without needing `isRunning`. This is old step 4, first bullet.
- Add a test that loads the renderer, fires one of each FORGE event, and asserts zero requests to those URLs. It also asserts the live alarm count is unchanged.
**Check:** the new test plus the existing `dashboard_electron` test suite. Report the counts.
**Commit:** `fix(forge): make FORGE read-only toward the live engine and backend`

---

## Phase B — FORGE layout: left controls, centre terrain, right mini-dashboard

### B1 · Left column: node list and event sliders
**Files:** `dashboard_electron/renderer/index.html` (FORGE left, ~730-825), `js/sim/sim-tab.js`, `css/sim-tab.css`
**Do:**
- At the top, a "NODES IN EXPERIMENT" list of all live nodes with checkboxes, all ticked by default. The list comes from the same node source as the MAP tab. For now, unticking only greys the node out. Nothing else depends on it yet.
- Below it, event buttons: CAVE-IN, CRACK, TILT, VIBRATION. Only the chosen event's sliders show, each with a live number badge:
  - CAVE-IN: depth 0.5–25 m, radius 10–300 m
  - CRACK: days ahead 1–90, radius 10–500 m
  - TILT: rate 0.5–30 mm/m, direction 0–360°, radius 10–500 m
  - VIBRATION: PPV 1–100 mm/s, radius 10–500 m
- Keep "Target: x, y" readout (filled by B2) and a FIRE button. Add a RESET FORGE button that clears all FORGE effects.
- Remove the old `<input type="number">` fields these replace.
**Check:** headless screenshot of FORGE, plus a console-error check. Moving each slider changes its badge.
**Commit:** `feat(forge): node list and slider-based event controls in left column`

### Changes after B1 (Adarsh, 26 Sep, round 2). These replace the old B2–B4.

**Decisions**
1. **All nodes are always in FORGE.** The "NODES IN EXPERIMENT" checkbox list from B1 goes.
2. **The SIM tab timeline bar goes** (PLAY, 1x/10x, -1d/+1d/-1h/+1h, LOOP, "Day N (Live)"). It moved a viewing pointer over the 690-day lab run, not the live engine, so "(Live)" was wrong. Pausing moves to the new header PLAY/PAUSE (A3). Moving through time moves to FORGE.
3. **The "60s PACKET SYNCHRONIZED" and "60s tick stream active" popups go**, everywhere.
4. **Any button that adds nothing or doesn't work goes.** First the audit lists every button with a verdict. Adarsh approves the list, and only then is anything deleted.
5. **The 690-day run stays** (`:8010`, `mine-sim/out/v2-690d`). It is kept for a later phase and must not be touched.
6. **FORGE runs on the same math as the live engine, on its own copy.**
   - The engine's ground is closed-form in time:
     - bowl: `surface.channels(X,Y,t)`, where S = S_base·(1−e^(−0.04·t))
     - cave-ins: `collapse.collapse_deltas(X,Y,t,failures)`
   - So FORGE's whole state is just **(day, list of FORGE events)**, and any day can be computed directly.
   - **Timeline:** Day 0 → Day END, where END = 120 d (99% settled: ln(100)/0.04 ≈ 115 d). END is pushed later if a FORGE event is still settling then.
   - **Opens at** the live engine's current day, paused, with the live engine's own cave-ins copied in (read-only).
   - **Slider:** jump to any day.
   - **PLAY:** runs from that day to END.
   - **Fire an event on day D:** it is added to FORGE's list with start = D, and from then on the math includes it. Playing on shows the ground settling around it. Sliding back before D shows the ground as it was before the event. RESET FORGE clears FORGE's events.
   - **Where it runs:** a separate process on **:8020** that imports the same `simulation/sandbox` math. It has no MQTT, no DB, and never writes to :8000. The live engine and dashboard cannot see it.
   - **Node colours** in FORGE use the engine's own rule (1.2R CRITICAL / 1.5R WARNING, `session.py:_assign_node_states`), computed by :8020.

**New order:** B0 → B2a → B2b → B2c → B2d → B2e → B2f → A3 → B3 → C…
(B4 is folded into B2a/B2c: :8020 returns node states with every frame.)

### B0 · Cleanup: node list, SIM timeline bar, 60s popups, and a button audit
**Files:** `dashboard_electron/renderer/index.html`, `js/sim/sim-tab.js`, `css/sim-tab.css`, `simulation/frontend/src/App.tsx`, the tests that reference removed IDs, new `docs/BUTTON_AUDIT.md`
**Do:**
- Remove the FORGE "NODES IN EXPERIMENT" list and its JS. FORGE always uses all nodes.
- Remove the SIM tab timeline bar (`sim-timeline-bar`, `index.html:672-696`) and its handlers (`sim-tab.js` onDayChange / step / loop / startPlay / stopPlay / refreshSimDayData, and anything only they used). Replace it with one read-only badge showing the live engine day: "LIVE · Day N" from `/api/simulation/status` t_sim_seconds.
- Remove the toasts `📦 60s PACKET #… SYNCHRONIZED` (`App.tsx:312`) and `▶ SIMULATION RUNNING (60s tick stream active)` (`App.tsx:508`).
- Fix `dashboard_electron/test/verify_sandbox.js` so it no longer clicks the removed SIM map button.
- Write `docs/BUTTON_AUDIT.md`: a table of every button in the dashboard (all tabs) and the 3D sim, with columns: id/label, tab, what it does, works? (tested), verdict KEEP / REMOVE / FIX. **Delete nothing from the audit in this step.**
**Check:** the dashboard test suite and a console-error check on every tab. Report the counts.
**Commit:** `chore(ui): remove FORGE node list, SIM timeline bar and packet popups; add button audit`

### B0b · Remove what Adarsh approves from BUTTON_AUDIT.md
Only runs once Adarsh has marked the audit. It deletes the approved buttons and their dead code, and nothing else.
**Commit:** `chore(ui): remove unused buttons per audit`

### B2a · FORGE math server on :8020
**Files:** new `simulation/forge/__init__.py`, `simulation/forge/server.py`, `simulation/sandbox/session.py` (refactor only: lift `_assign_node_states` into a pure function both use; no behaviour change), `simulation/sandbox/server.py` (read-only `GET /interventions`), `scripts/start_all.js` (start :8020), `simulation/tests/test_forge.py`
**Do:**
- `GET :8000/interventions` (read-only) returns the live engine's current `pillar_failures` and `t_sim_seconds`.
- `:8020` is stateless FastAPI:
  - `POST /forge/frame {day, events:[{type:"cave_in", x, y, radius_m, depth_m, day, duration_h}]}` returns a frame shaped like the live packet (same fields the 3D view already reads for terrain and nodes) plus `node_states`.
  - `POST /forge/range {events}` returns `{end_day}`.
  - `GET /forge/seed` reads `:8000/interventions` and returns `{day, events}` so FORGE can open on the live state.
- Math: `surface.channels` + `collapse.collapse_deltas` with FORGE's events turned into the same `PillarFailure` objects `apply_collapse` makes. No new physics. Sensor noise is off (FORGE shows truth).
**Check:** pytest:
- frame at day 0 has zero subsidence
- frame at day 30 matches `surface.channels` exactly
- a 10 m / 100 m cave-in at day 20: at day 19 its centre delta is 0; once settled it is ≈ −10 m (±5%)
- node states match `_assign_node_states` for the same failures
- live engine `t_sim_seconds` and failures are unchanged before and after 100 FORGE calls
- the A1 reproducibility test still passes
**Commit:** `feat(forge): private FORGE math server on :8020 using the live engine's equations`

### B2b · FORGE timeline: slider, PLAY/PAUSE, speed, frames into the 3D view
**Files:** `index.html` (FORGE centre toolbar), `js/sim/sim-tab.js`, `js/sim/sim-embed.js`, `simulation/frontend/src/App.tsx`, `embed.ts`, `css/sim-tab.css`, a test
**Do:**
- FORGE centre toolbar:
  - PLAY/PAUSE
  - speed 1 / 5 / 20 days per second
  - a day slider from 0 to `end_day`
  - badge "FORGE · Day N / END"
  - "↺ LIVE DAY" button (re-seeds from `/forge/seed`)
- On open, FORGE seeds from `/forge/seed`, starts paused, and loads that frame.
- Sliding requests `/forge/frame` for that day (throttled, latest wins). PLAY steps the day and requests frames until END, then stops.
- New embed command `forge-frame {frame}`. The FORGE slot of App.tsx renders it through the same path that renders live packets. In the FORGE slot, App.tsx stops fetching `:8000` packets.
- Nothing reaches `:8000/control` or `:8080/api/simulation/*`. Only reads from `:8000/interventions` are allowed.
**Check:**
- a test: slide to day 10 and day 60, and the rendered centre depth matches `/forge/frame`
- PLAY advances and stops at END; PAUSE holds
- the A2 isolation test passes
- screenshots at day 5 / 40 / END
**Commit:** `feat(forge): independent FORGE timeline driven by the :8020 math`

### B2c · Click-to-target and CAVE-IN into the FORGE timeline
**Files:** `simulation/frontend/src/App.tsx`, `embed.ts` (finish `terrain-target`), `js/sim/sim-embed.js`, `sim-tab.js`, `css/sim-tab.css`, a test
**Do:**
- Clicking the FORGE terrain places the beacon and posts `terrain-target {x,y,elev,slopeDeg,zoneName}`. The left "Target" readout fills in. The default target is (0,0) and says "(default)".
- FIRE CAVE-IN adds `{type:"cave_in", x, y, radius_m, depth_m, day: current FORGE day, duration_h}` to FORGE's event list, using the slider values with no fallbacks. It updates `end_day` and starts PLAY so you watch it happen.
- The look matches the standalone sim's CAVE-IN (`RightInspectorPanel.tsx` → `handleTriggerEvent`): dust burst, camera shake, toast. The ground itself comes only from :8020 frames. Do not also call `globalGeomechanics.triggerCollapse`, or the bowl would be drawn twice.
- Remove the `data.possible` early-return in `fireForgeTrigger`. :8010 consequence numbers are extra information. If the lab says not possible, label them "outside lab model".
- Node colours in FORGE come from the frame's `node_states`. Nothing goes on the global bus, the ALARMS tab or the main banner.
- The event list shows under the controls ("Day 20 · CAVE-IN 10 m / 100 m at (100, 50)"). RESET FORGE clears it.
**Check:**
- a test: fire 10 m / 100 m at (100, 50) on day 20, play to END, and the centre depth is ≈ 10 m (±10%); sliding to day 19 shows no bowl; nodes inside 1.2R are CRITICAL in FORGE and the MAP/ALARMS tabs are unchanged
- the A2 isolation test passes
- screenshots before, during and after, at two spots
**Commit:** `feat(forge): click-to-target cave-in as a timeline event`

### B2d · CRACK  ·  B2e · TILT  ·  B2f · VIBRATION
One event per step, same pattern as B2c: the event goes into FORGE's event list, :8020 computes its effect with engine math where the engine has it, and Adarsh checks it before the next one. Before each step, Claude writes the prompt after checking what the engine already models for that event (tilt = offset cave-in as in `handleTriggerEvent`; vibration = `vibration_transient`; crack = to be checked).

### Changes after B2c (Adarsh, 26 Sep, round 3). New in-between step before B2d.

**What Adarsh saw, and what the code says (checked 26 Sep)**
1. **No PLAY/PAUSE in the SIMULATION tab.** Correct. B0 removed the timeline bar and A3 was never built. The engine itself boots idle (`server.py` lifespan), but the SIM tab's embedded 3D view starts it the moment its socket connects (`App.tsx:928-940`, "the viewport arms itself"). So the engine runs as soon as the SIM tab loads, and nothing on screen can stop it.
2. **Old data in Postgres.** `npm start` (`start_all.js:210-221`) already truncates `readings, simulation_packets, alarms`. Launching only Electron (`npm run electron`) wipes nothing, and the engine keeps its old day, so old rows and the old day survive.
3. **The radius slider "doesn't work".** Its badge updates, but nothing on the terrain shows the radius until you press FIRE. The red circle in the screenshot is node N29's selection ring, not the event radius. Moving the slider after firing does not change events already fired (by design: each event is fixed at fire time).
4. **FORGE right column.** DISTRICT HEALTH takes a quarter of the column and is coloured from the *live* node states (`renderForgeHealth`, `sim-tab.js:1273`), so it stays all green after a FORGE cave-in. SANDBOX CLUSTER NODES still says "Draw a SIM box on MAP". The alarms and consequence panels show the :8010 lab, which is on the wrong day and mostly answers "OUTSIDE LAB MODEL".

**Decisions**
- A3 moves up, and its button moves from the header into the SIMULATION tab: one PLAY/PAUSE toggle and one RESET. The header keeps its status badge only.
- The engine stays STOPPED until PLAY is pressed. Nothing auto-starts it.
- Every real app launch starts clean: engine reset to day 0, and the DB tables wiped. Tests must never trigger this, because they share the live stack.
- B3 moves up too and is redesigned per Adarsh: a small health strip, a node-detail card, and a mini 2D map with FORGE alarms. Everything is coloured by FORGE's own `node_states`.
- The radius shows on the terrain and the mini map *while you drag the slider*, before firing.
- The :8010 lab panels leave the FORGE right column. FORGE's numbers come from :8020 only. (The 690-day lab itself stays untouched.)

**New order:** B2c → **A3 → B3** → B2d → B2e → B2f → C1 → C2 → C3 → C4.

### A3 · SIMULATION tab PLAY/PAUSE + RESET, engine idle until PLAY, clean start on every launch
**Files:** `dashboard_electron/renderer/index.html` (SIM tab toolbar, near `sim-live-day-badge` ~674), `js/sim/sim-tab.js`, `js/sim/sim-live.js`, `js/data/live-provider.js`, `css/sim-tab.css`, `simulation/frontend/src/App.tsx` (embed auto-start only), `dashboard_electron/main.js`, `package.json` + `dashboard_electron/package.json` (launch scripts only), `dashboard_electron/test/verify_forge_isolation.js` (allow-list only), a new test `dashboard_electron/test/verify_sim_controls.js`
**Do:**
- **No auto-start.** Delete the embed arm-on-connect effect (`App.tsx:928-940`) for the SIM slot. The reconnect "re-arm" (`App.tsx:238-245`) must not fire in embed. The standalone sim's own MenuBar Start/Pause stays as it is.
- **Two buttons in the SIM tab toolbar**, next to the LIVE badge:
  - `sim-play-btn`: shows ▶ PLAY when STOPPED or PAUSED, ❚❚ PAUSE when RUNNING. From STOPPED it sends `start`; from PAUSED `resume`; from RUNNING `pause`.
  - `sim-reset-btn` (RESET): asks `confirm("Reset the simulation to day 0 and delete all recorded data?")`, then sends `reset`. The engine ends STOPPED at day 0, and the DB tables are empty.
  - Use the one existing path: `POST :8080/api/simulation/control` (as `app.js:194` does). Do not add a second way to control the engine.
- **The button's label comes from engine status** (`is_running` / `is_paused` from `/api/simulation/status` and the WS `simulation_status`), not from its own click, so it is right even if something else paused the engine. Disable both buttons while a command is in flight.
- **Paused / stopped look:** while the engine is STOPPED or PAUSED, add `body.sim-paused` and grey the live tabs (MAP, SIMULATION, NODES, ALARMS) with `filter: grayscale(1)` and a small "PAUSED · Day N" / "STOPPED · press PLAY" chip. Clicks still work. FORGE, HISTORY, SYSTEM and INFO are never greyed.
- **Clean start on every real launch.** In `main.js`, once at `app.whenReady`, and only when `process.env.SIH_BOOT_RESET === '1'`:
  - `POST :8000/control {action:"reset"}`. This resets the engine and calls the backend's `/api/system/reset`, which truncates the tables.
  - If :8000 is down, call `POST :8080/api/system/reset` directly.
  - If both are down, log and carry on.
  - The window loads after this finishes (5 s timeout).
  - Set `SIH_BOOT_RESET=1` in the launch scripts only: root `electron`, and `dashboard_electron` `start` / `dev`. Test runners spawn the Electron binary directly, so they never reset. Add a comment saying why.
- **FORGE isolation test:** `sim-tab.js` may now call `/api/simulation/control`, but only from the two SIM toolbar handlers. Move these handlers into a new small file `js/sim/sim-controls.js`, so the rule "sim-tab.js (FORGE) never names /control" stays as it is. Add `sim-controls.js` to `index.html`.
**Check:**
- `verify_sim_controls.js` starts its **own** engine on :8023 and a backend pointed at it. It never touches the live :8000.
  - Fresh load, wait 10 s: the engine reports STOPPED, the day doesn't move, the button reads PLAY, and the body has `sim-paused`.
  - PLAY: RUNNING, and the day advances. PAUSE: PAUSED, and the day holds for 10 s. PLAY: `resume`, and the day advances again.
  - RESET with confirm stubbed to true: STOPPED, day 0, and `readings`/`alarms` counts are 0.
- Open the SIM tab 3 times: the engine never starts on its own.
- Boot reset: launch with `SIH_BOOT_RESET=1` against the test stack and see 0 rows; launch without it and see the rows untouched.
- `verify_forge_isolation.js` passes. The whole dashboard test set runs, with pass/fail per file.
**Note:** the live :8000 engine keeps running on its old code until Adarsh restarts the stack. Do not restart it in this step.
**Commit:** `feat(sim): PLAY/PAUSE and RESET in the SIM tab, engine idle until PLAY, clean DB on launch`

### B3 · FORGE right column: health strip, node detail, mini map with FORGE alarms (+ live radius preview)
**Files:** `dashboard_electron/renderer/index.html` (`#forge-right` ~923-960, remove the old panels), `js/sim/sim-tab.js`, `css/sim-tab.css`, reuse `js/map/*` drawing and `nodeStateColor`, `simulation/frontend/src/App.tsx` + `embed.ts` (preview ring only), `js/sim/sim-embed.js`, a test
**Do:**
- **Everything in this column is coloured by FORGE's frame `node_states`** (the :8020 result for the current FORGE day), never by live states. Sliding the FORGE day re-colours it.
- **1 · Health strip (small, top, about 60 px):** counts `OK n · WARNING n · CRITICAL n`, then one row of small dots (one per node, 8 px, wraps). Clicking a dot selects that node. It replaces the big DISTRICT HEALTH grid.
- **2 · Node detail (middle):** the selected node, chosen by clicking a dot, the 3D node or the mini map. It shows:
  - id, role/tier, x, y and lat/lng
  - its FORGE state
  - subsidence and tilt at this node on the current FORGE day (from the frame)
  - distance to the nearest FORGE event, and which one
  - the day it first went WARNING / CRITICAL in FORGE, if it did
  With nothing selected it shows "Click a node". Remove SANDBOX CLUSTER NODES and its "Draw a SIM box" text.
- **3 · Mini 2D map (bottom):** the site outline and all nodes at their real positions, coloured by FORGE state. It also shows:
  - each fired event as a circle of its radius, labelled with its day
  - the current target as a crosshair
  - a dashed **preview circle** for the current radius slider
  Reuse the MAP tab's projection and marker colours; do not write a second map.
- **FORGE alarms** go under the map: one line per node state change on the FORGE timeline ("Day 20.1 · N12 → CRITICAL (CAVE-IN #1, 38 m)"), newest first. They come from comparing `node_states` between frames. Nothing reaches the global bus, the ALARMS tab or the banner.
- **Live radius preview in 3D:** a new embed command `forge-preview {x, y, radius_m}` draws a dashed ring on the FORGE terrain at the target. It updates on every `input` event of the active event's radius slider and on every terrain click, and clears on FIRE and RESET FORGE. It is drawing only, with no math.
- **Remove from FORGE:** the SANDBOX SCENARIO ALARMS panel, SCENARIO CONSEQUENCE ANALYSIS, and the `:8010` call in `fireForgeTrigger`, plus their dead code. Leave `:8010` itself and the 690-day files alone.
**Check:**
- A test that fires a 10 m / 100 m cave-in at (100, 50) on day 20 and plays to END:
  - the health counts equal the frame's `node_states` counts
  - the mini map has as many nodes as the MAP tab
  - the nodes within 1.2R show CRITICAL on the dots, on the mini map and in the node detail
  - at least one FORGE alarm line appears
  - the MAP and ALARMS tabs don't change
- Dragging the radius slider from 30 to 200 changes the preview ring radius in the 3D view and on the mini map *before* FIRE.
- Zero requests to `:8010` from FORGE.
- `verify_forge_isolation.js` and the whole dashboard test set pass.
- Screenshots: before firing (with the preview ring), during settling, after END, and with a node selected.
**Commit:** `feat(forge): right column health strip, node detail and mini map from FORGE node states`

### Status 27 Sep (review of Antigravity's A3/B3 run)
- **A3: done** (f4092dc). Walkthrough has real PASS output; boot reset is in `main.js`.
- **B3: about 10% done.** Only the receiving side of `forge-preview` exists (`App.tsx`, `embed.ts`), and the beacon's R ring is now dashed orange. It did not type-check (null into non-null state; `computeLineDistances` called on a geometry). Both fixed by Claude, committed as `wip(forge)`.
- **Still to do in B3:**
  1. `sim-tab.js`: send `forge-preview` on every radius-slider `input` and every terrain click (nothing sends it yet).
  2. Clearing the preview on FIRE / RESET FORGE. The receiver ignores bad input today, so clearing needs an explicit `{x:null}` → hide-ring path.
  3. `renderForgeHealth` (`sim-tab.js` ~1278) still reads `fixtureProvider` states. Switch it to the frame's `node_states`.
  4. Health strip, node detail card, mini map (reuse `js/map/*`), FORGE alarm lines.
  5. Remove the :8010 calls from FORGE (`LAB_API_BASE` at `sim-tab.js` 23, 346, 475, 482, 1812, 1882) and the two lab panels.
  6. The B3 test and walkthrough.
- **Environment blocker:** iCloud has offloaded repo files ("dataless"). `backend/.env` is one of them, so `npm start` hangs after the preflight checks, before the DB reset. Mark the folder "Keep Downloaded" in Finder, or open `backend/.env` once so it downloads.

### A3 (old, replaced by the round-3 A3 above) · Live PLAY/PAUSE in the dashboard header, greyed dashboard while paused
**Files:** `dashboard_electron/renderer/index.html` (header), `js/app.js`, `js/data/live-provider.js`, `css/*`, a new test in `dashboard_electron/test/`
**Do:**
- Add one PLAY/PAUSE button to the header. It sends `pause` / `resume` to the live engine, using the same path the SIM tab's START uses. This is the only place outside the SIM tab that may control the engine.
- Take the paused state from the engine status (`is_paused` in `live-provider.js:173`), not from the button. That way the veil also appears when the engine is paused some other way.
- While paused, grey out the live tabs (`filter: grayscale(1)` plus a "PAUSED — Day N" veil). Clicks should still work. Leave FORGE untouched.
**Check:** test: pause → engine status reports paused → body has the paused class → FORGE panel does not. Resume → the class is removed and the sim day advances again.
**Commit:** `feat(dashboard): live play/pause in header with paused veil`

### B3 (old, replaced by the round-3 B3 above) · Right column: mini-dashboard (node placement like the MAP tab)
**Files:** `index.html` (FORGE right, ~913+), `sim-tab.js`, `css/sim-tab.css`, reuse `js/map/*` helpers where possible
**Do:**
- Replace the right column with a small 2D map of the site: panel outline, all nodes at their real positions, colour-coded by state. Reuse the MAP tab's drawing code and node colours; do not write a second map.
- The map shows the current FORGE target and the radius circle of the last event.
- Under the map: counts (OK / WARNING / CRITICAL) and a short event log for FORGE only.
**Check:** screenshot; node count on the mini-map equals node count on the MAP tab.
**Commit:** `feat(forge): mini map dashboard in right column`


## Phase C — Fixed scripted dataset (repeatable demo)

### C1 · Scenario script format and loader
**Files:** new `simulation/scenarios/default_demo.json`, new `simulation/sandbox/script.py`, tests
**Do:**
- JSON shape:
  ```json
  { "name": "default_demo", "seed": 20260926, "base_iso_time": "2026-01-01T00:00:00Z",
    "duration_days": 60,
    "events": [
      {"day": 20, "type": "crack",    "x": 0,   "y": 40, "radius_m": 60},
      {"day": 35, "type": "tilt",     "x": 120, "y": 0,  "radius_m": 80, "rate_mm_per_m": 6},
      {"day": 45, "type": "cave_in",  "x": 0,   "y": 0,  "radius_m": 80, "depth_m": 1.2, "duration_h": 5}
    ] }
  ```
- The loader validates it (types, ranges, positions inside the domain) and gives clear errors.
- Event positions must be chosen so at least 3 nodes get WARNING and at least 1 gets CRITICAL. The test checks this against the node layout.
**Check:** pytest count.
**Commit:** `feat(sim): scenario script format and validated loader`

### C2 · Run a script through the engine, bit-for-bit repeatable
**Files:** `simulation/sandbox/session.py`, `runner.py`, `server.py` (new `POST /script/run {name}`), tests
**Do:**
- The session fires each event at its day using the existing `apply_collapse` / `apply_vibration` / tilt / crack paths. No new physics.
- Offline mode writes `out/scripted/<name>/nodes.csv` and `events.csv`.
- Test: run twice, get identical hashes. The alarm days in `events.csv` match the script days (± one packet).
**Check:** pytest count; paste the hash lines.
**Commit:** `feat(sim): deterministic scripted runs with offline output`

### C3 · Play the scripted dataset through the real pipeline
**Files:** `scripts/run_scripted_demo.js` (new), `package.json` (`demo:scripted`), `scripts/reset_demo_state.sh` (reuse)
**Do:**
- `npm run demo:scripted [-- --speed N]` resets the DB (fixed timestamps would otherwise hit `ON CONFLICT DO NOTHING`), starts the script on `:8000` in live mode, and lets it flow through MQTT → backend → dashboard.
- The dashboard needs no special mode: alarms, node colours, HISTORY and replay should all just work.
- Print a timeline to the terminal: "day 20 crack → nodes 7,8 WARNING" and so on.
**Check:** `npm run verify`, then run the demo and screenshot the dashboard at the cave-in day.
**Commit:** `feat(demo): npm run demo:scripted plays the fixed scenario through the live pipeline`

### C4 · End-to-end check and demo notes
**Files:** `docs/DEMO-SCRIPTED.md` (new), `scripts/qa.js` (add checks)
**Do:** a one-page runbook: how to start the stack, run the scripted demo, open FORGE mid-run and play with it, and what the judges should see on each day. Add a QA check that FORGE is still isolated while the scripted demo runs.
**Commit:** `docs(demo): scripted demo runbook and QA checks`

---

## Order and checkpoints

A1 → A2 → B1 → B0 → (B0b) → B2a → B2b → B2c → **A3 → B3** → B2d → B2e → B2f → C1 → C2 → C3 → C4.
(Done: A1 → B2c. Next: A3.)
After each step: Adarsh tells Claude "check <step-id>". Claude reviews the diff, runs the check commands, and says pass or what to fix. Nothing moves on until the step passes.
