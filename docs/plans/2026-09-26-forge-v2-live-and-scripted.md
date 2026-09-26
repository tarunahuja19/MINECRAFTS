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

### B2 · Centre: terrain on the current sim day, click-to-target, real deformation
**Files:** `simulation/frontend/src/App.tsx`, `embed.ts` (finish the `terrain-target` event), `components/TerrainMesh.tsx`, `components/TargetBeacon.tsx`, `utils/geomechanicsEngine.ts`, `dashboard_electron/renderer/js/sim/sim-embed.js`, `sim-tab.js`
**Do:**
- When FORGE opens, it reads the live sim day and current subsidence state (read-only) and shows the terrain in that state. A "Day N (live snapshot)" badge is shown. A REFRESH SNAPSHOT button re-reads it.
- Clicking the terrain places the beacon and sends `terrain-target {x,y,elev,slopeDeg,zoneName}` to the parent, which fills the left "Target" readout.
- FIRE calls `triggerScenario('forge', type, x, y, magnitude, radius)` with the **slider values** (no hidden fallbacks). CAVE-IN must visibly carve: depth colours, contour rings and rim. Effects add on top of the live-day ground. Existing soil and geology parameters in `geomechanicsEngine.ts` shape the bowl.
- Remove the `data.possible` early-return in `fireForgeTrigger`. If `:8010` says "not possible", still show the ground and label the result "outside lab model".
**Check:** screenshots before and after a 10 m / 100 m cave-in at two spots; the depth readout at the centre is about the slider depth.
**Commit:** `feat(forge): live-day snapshot terrain with click-to-target carve-in`

### B3 · Right column: mini-dashboard (node placement like the MAP tab)
**Files:** `index.html` (FORGE right, ~913+), `sim-tab.js`, `css/sim-tab.css`, reuse `js/map/*` helpers where possible
**Do:**
- Replace the right column with a small 2D map of the site: panel outline, all nodes at their real positions, colour-coded by state. Reuse the MAP tab's drawing code and node colours; do not write a second map.
- The map shows the current FORGE target and the radius circle of the last event.
- Under the map: counts (OK / WARNING / CRITICAL) and a short event log for FORGE only.
**Check:** screenshot; node count on the mini-map equals node count on the MAP tab.
**Commit:** `feat(forge): mini map dashboard in right column`

### B4 · FORGE consequences on nodes (FORGE-only)
**Files:** `sim-tab.js`, `simulation/frontend/src/App.tsx` / `embed.ts` (if node readings come from the iframe)
**Do:**
- After each event, compute each ticked node's would-be reading from the deformed FORGE ground: subsidence, tilt, strain at the node's position. Use the same 1.2R CRITICAL / 1.5R WARNING bands as `session.py:48-49`, so FORGE and live use one rule.
- Colour nodes in the mini-map and the left list from this. Do not emit `node-status-change` on the global bus, and do not touch the main alarm banner or the ALARMS tab.
- RESET FORGE restores all nodes to their live snapshot state.
**Check:** cave-in over a known node → it turns CRITICAL in FORGE; the MAP and ALARMS tabs are unchanged (screenshot both); the A2 test still passes.
**Commit:** `feat(forge): per-node consequences from FORGE ground, isolated from live alarms`

---

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

A1 → A2 → B1 → B2 → B3 → B4 → C1 → C2 → C3 → C4.
After each step: Adarsh tells Claude "check <step-id>". Claude reviews the diff, runs the check commands, and says pass or what to fix. Nothing moves on until the step passes.
