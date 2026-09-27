# DATA-365: prompts for Antigravity (one fresh chat per step)

Plan: `docs/plans/2026-09-27-data-365.md`. Read it before anything else.

**Status at hand-over (27 Sep):**

- Done and pushed on `feat/forge-v2-live-and-scripted`:
  - **Z1** (6d12db2): packet JSON dump off.
  - **T1** (bbc898c): `config/alarm-thresholds.json` plus the Python and JS loaders.
  - **G1** (2b0506c): `simulation/sandbox/district.py`, the real-fit 3-panel ground.
- Remaining, in this order: **G2, A1, E1, U1, M1, M2, M3, D1, D2, D3, A2, A3, A4, U2, R1.**
- A1, E1 and U1 do not depend on G2 and may run in any order. Everything else is sequential.
- Partial, unverified work from the interrupted Claude run is in `docs/plans/prompts/data-365-wip/`:
  - G2: `session.py` patch and `ground.py`
  - A1: `engine.js` and the `thresholds.js` patch

  Treat these as reference only. Read them, reuse what is right, and verify everything yourself.

**Decisions already made by Adarsh (do not reopen):**

- Ground = the real Adriyala fit with 3 panels.
- One data-driven alarm engine in the backend.
- A left info column on the SIM tab.
- FORGE = the dataset's ground plus event deltas.

**Planner decision after G1:**

- Sensors read change since install (day 0).
- On tilt alone, all 30 sensing nodes reach ADVISORY and 27 reach WARNING. Nodes 14, 21 and 27 stay ADVISORY because of early-panel pre-settlement and opposing slopes between the bowls. This is accepted.
- D1 reports the final per-node coverage across all conditions.
- The daily tilt rate from the Knothe bowl peaks at 0.138 mm/m/day, so the `tilt_rate` alarm fires only on events.

---

## RULES (paste at the top of every chat)

```
Repo: /Users/adarshagarwala/Documents/sih26. Branch: feat/forge-v2-live-and-scripted. Do not create or switch branches, never touch main.
Plan: docs/plans/2026-09-27-data-365.md. Read "Context" and your step. Prompts file: docs/plans/prompts/data-365-antigravity.md.
Do ONLY the step named below. Touch only the files it lists; if you need another file, stop and ask.
No new dependencies. No fabricated values: every new constant has a source or ASSUMED/VERIFY in a comment,
and nothing may force or invent a sensor value (the old session.py 6500/4200 strain override is the anti-example).
One threshold source: config/alarm-thresholds.json via simulation/sandbox/thresholds.py (Python) or backend/alarm/thresholds.js (Node).
Never hard-code a threshold number elsewhere.
Checks:
  Python:   cd simulation && .venv/bin/python -m pytest -q -p no:cacheprovider --ignore=tests/test_stress_1000_trials.py   (260 pass before G2)
  Frontend: cd simulation/frontend && npx tsc --noEmit -p tsconfig.app.json   (a plain `npx tsc --noEmit` checks nothing)
  Backend:  node --test backend/alarm/*.test.js   (Node v26: a bare directory argument fails; use the glob)
  Electron tests: env -u ELECTRON_RUN_AS_NODE node dashboard_electron/test/verify_<name>.js
Do not stop, reset or restart a running live engine on :8000, and do not wipe the live DB; tests start their own engine/backend on spare ports.
Port 8021 belongs to launchd; don't use it.
Write walkthroughs/data-365/<STEP>.md (What changed / Files / Verify) with the REAL pasted output of every check.
Then one commit with the message given below, ending with the line
"Co-Authored-By: Antigravity", and git push. If a check fails and you cannot fix it inside the step's files, STOP and report; do not start another step.
```

---

## G2 · district ground into the engine, FORGE and 3D

```
STEP G2. Read walkthroughs/data-365/G1.md first. Reference (unverified) partial work: docs/plans/prompts/data-365-wip/G2-*.

sandbox/district.py gives channels(X,Y,t) (same keys/units as surface.channels), face_positions(t) (3), bowl_terms_px() (3x121 m),
bowl_terms_py(t) (3x121). The sum over k of px_k[ix]*py_k[iy] equals S on the x2-downsampled grid (same grid as surface.grid()).

Today everything uses `surface`:
- session.py (import at :26, grid at :196, channels at :383, tick bowl_py/face_y_m at :608-609)
- sandbox/server.py (base_bowl_mesh from surface._BASE_S at :343/:592, bowl_px at :354/:603)
- forge/server.py (:37 grid, :144 channels, :251-252 bowl_py/face_y_m)
- frontend:
  - App.tsx: applyBowl :145-150, init bowl_px :465, tick :481, forge-frame :993
  - utils/geomechanicsEngine.ts: :468-483, and the sum at :631
  - types.ts: :74-75, :178
  - embed.ts: :79
  - MineViewport.tsx: groundTick :255
  - TerrainMesh.tsx: bowlPy prop

Do:
1. SessionConfig.ground = "district" (default), with a small resolver (optional new sandbox/ground.py) used by session.py and forge/server.py.
   surface.py stays unchanged. Tests that assert old ASSUMED-ground numbers pass ground="surface". List every one you pin.
2. Since install: session keeps install_ch = ground.channels(X,Y,0) (recomputed on reset) and passes total - install_ch for every
   channel key to sensor_array.sample_tick. zone_manager keeps the absolute field. FORGE node values are also relative to day 0; its event-delta logic is untouched.
3. Payloads:
   - tick and FORGE frame: add bowl_terms_py (round 1e-4) and face_positions; face_y_m = the centre panel (index 1);
     bowl_py = null on the district ground.
   - init/config: add bowl_terms_px (round 1e-5); base_bowl_mesh from the active ground at day 365; bowl_px only for "surface".
4. Frontend:
   - optional bowl_terms_px / bowl_terms_py / face_positions in types and embed
   - geomechanicsEngine setBowlTermsPx/Py; sum the terms when present, otherwise the old path
   - App.tsx wires init, tick and forge-frame; the re-render signature must change when the terms change
5. dashboard_electron/renderer/js/sim/sim-tab.js: only if it strips unknown keys when forwarding forge frames, pass the new keys through.

New simulation/tests/test_ground_wiring.py:
- default ground is district
- a tick has bowl_terms_py 3x121 and face_positions of length 3
- total - install == 0 at t = 0
- /forge/frame (TestClient, {"day": d, "events": []}) has bowl_terms_py 3x121 and every node_state ACTIVE
- the server.py init/config builder gives bowl_terms_px of length 3

Also time one session.tick() (target < 100 ms) and put the number in the walkthrough.
Files: session.py, sandbox/server.py, forge/server.py, sandbox/ground.py (new), simulation/tests/*, the frontend files above, sim-tab.js (pass-through only).
Commit: "feat(sim): engine, FORGE and 3D run on the real-fit district ground, sensors zeroed at install"
```

## A1 · pure alarm lifecycle engine (backend, independent)

```
STEP A1. Reference (unverified): docs/plans/prompts/data-365-wip/A1-*.

Build backend/alarm/engine.js: a PURE state machine (no DB, network or timers; time is passed in), ISA-18.2 style.

createEngine({thresholds = load()}) returns:
- ingest(sample)
  - sample = {node_id, t_ms, tier, values:{tilt_change, strain_tensile, strain_compressive, tilt_rate, crack_width,
    ppv, ppv_freq_hz, pore_pressure_rise, battery_v}}; null values are skipped
  - returns change events {type: raised|escalated|deescalated|rtn|cleared|acked|shelved|unshelved|stale, record}
- tick(t_ms): comms_stale after stale_after_cadences x cadence (cadence = median gap of the node's recent samples, default 1 h), and shelve expiry
- ack(key,{operator,t_ms}), shelve(key,{operator,t_ms,until_ms,reason}), unshelve(key,...)
- records(), nodeState(node_id) (the highest active, unshelved priority, or "NORMAL"), snapshot()/restore() as plain JSON

One record per key `${node_id}:${condition}`. Fields: key, node_id, condition, priority, state (UNACK_ACTIVE|ACK_ACTIVE|UNACK_RTN|NORMAL),
value, limit, t_raised, t_escalated, t_ack, ack_by, t_rtn, shelved_until, history[] (escalation APPENDS, never overwrites).

Rules:
- on_delay_samples consecutive samples before a raise or escalation
- to drop a level, the value must be past limit*(1-deadband_frac) for on_delay_samples (mirrored for "below")
- CRITICAL is latched until ACK
- RTN: unacked goes to UNACK_RTN; acked goes to NORMAL; ACK of UNACK_RTN clears it
- shelved records raise nothing
- battery_low uses the "below" direction
- levels come from thresholds.classify; limits come from the table (add a limitFor(condition, level, {freqHz}) export to thresholds.js; no duplicated numbers)

Header note: the 24 h median filter is applied upstream (A2).

Tests in backend/alarm/engine.test.js:
- persistence: 2 samples raise nothing, 3 raise
- chatter never raises
- escalation keeps one record with 2 history entries
- latch
- RTN then ACK
- deadband
- shelve and its expiry
- stale, and its RTN
- nodeState
- snapshot round-trip
- battery

Files: backend/alarm/engine.js, engine.test.js, thresholds.js (the export only).
Commit: "feat(alarm): pure ISA-18.2 alarm lifecycle engine"
```

## E1 · a real mine's year (independent)

```
STEP E1. New simulation/sandbox/environment.py: seeded, deterministic (np.random.default_rng only), hourly, 365 days, day 0 = 2026-01-01 UTC.

build_year(seed, node_ids, node_xy, node_tiers, days=365) returns a dataclass with:
- air_temp_c: Ramagundam monthly normals (IMD, VERIFY), plus a seasonal diurnal cycle peaking at 08:30 UTC, plus AR(1) noise
- rain_mm: monsoon June-September from monthly normals (annual ~1000 mm, VERIFY), stochastic wet/dry days; do not clip to hit a total
- pore_pressure_kpa, tier 2B only (NaN for others): 294 kPa hydrostatic base (ASSUMED) plus a linear reservoir with tau 10 d, 9.81 kPa/m, 0.5 kPa noise
- moisture_pct, tier 1C only: 10% base, tau 5 d, capped at 45%
- blasts: one a working day at 07:30 UTC, none on Sundays or 10 holidays (ASSUMED), 20-60 kg,
  placed at y = district.face_positions(t)[1] + U(20,80), x = U(-100,100)
- ppv helper: PPV = K*(D/sqrt(Q))^-beta, K 1140, beta 1.6 (USBM, VERIFY); D in 3D with the charge at 375 m depth;
  dominant frequency 10-40 Hz, falling with distance
- device (per node, per hour):
  - battery_v: 3.6 V draining to 3.30 over 120-200 d, replaced below 3.32 V
  - online: 1-3% packet loss per node, one node offline for 5 days in August, one 6 h gateway outage
  - stuck: one 1B strain gauge stuck for 3 days
- events: a sorted list of {t_hour, type, node_id, detail}

Tests in simulation/tests/test_environment.py:
- same seed gives identical output; a different seed gives different output
- rain total 600-1100 mm, with >= 70% in June-September
- May mean >= Jan mean + 8 C
- pore pressure: August mean >= April mean + 10 kPa
- blasts 300 +/- 20, none on Sundays, all at hour 7
- PPV finite and falling with distance
- exactly one 5-day offline node in August
- gateway outage lasts 6 h
- battery >= 3.3 V
- packet loss 1-3%

Report the build_year runtime (target < 3 s) and a key-numbers table in the walkthrough.
Files: environment.py, test_environment.py.
Commit: "feat(sim): seeded mine-year environment: weather, monsoon pore pressure, blast log, device faults"
```

## U1 · crack ⓘ (independent)

```
STEP U1. Cracks are shown with no classes or explanation in these places:
- FORGE CRACK button and the THROW/WIDTH/OPEN OVER sliders (dashboard_electron/renderer/index.html ~742, 761-775)
- the FORGE map crack drawing (renderer/js/sim/forge-map.js ~163-203): drawn crack = yellow band + red core;
  strain crack = red when new, orange when older
- the node detail "CRACKMETER FISSURE" row (renderer/js/panels/node-sensors.js ~656)

Classes come from config/alarm-thresholds.json conditions.crack_width.categories (Burland/BRE Digest 251, categories 0-5).
Check whether the renderer (served by dashboard_electron/serve.js on :8085) can fetch the repo file. If not, add a read-only GET route in serve.js for it.

Build:
- renderer/js/panels/info-pop.js: a reusable ⓘ button and popover, matching the renderer's module style.
  It must be keyboard accessible (button, aria-expanded), with Esc and an outside click closing it.
- .info-pop styles in renderer/css/hmi.css, using the existing palette variables
- "crack" content:
  - a crack opens where the major principal tensile strain exceeds ~3 mm/m; width ~ (strain - 3 mm/m) x 8 m spacing, ASSUMED/VERIFY
  - the 0-5 table rendered from the JSON, with the alarm level each maps to (cat >= 2 ADVISORY, >= 3 WARNING, >= 4 CRITICAL)
  - the map colour legend
  - what the FORGE sliders mean
  - the source line
- Place the ⓘ next to:
  - the FORGE CRACK controls
  - the FORGE map (plus a small legend)
  - the CRACKMETER row, also showing the Burland category name next to the mm value
- dashboard_electron/test/verify_crack_info.js, in the style of the existing verify_* tests: opens each ⓘ and checks that the 6 categories render

Files: info-pop.js (new), hmi.css, index.html, forge-map.js, node-sensors.js, serve.js (JSON route only), the test.
Commit: "feat(ui): crack ⓘ with Burland categories, map legend and slider meanings"
```

## M1 · event shapes

```
STEP M1 (after G2).
- collapse.py:196-199 applies the panel's B (69 m) to local pits: the default cave-in gives -338 mm/m of strain. Use B_event = 0.4 x the event radius.
- Make the event Gaussian sigma = R/2, so R is the visible edge.
  Today one 100 m / 10 m FORGE cave-in flags 21 of 31 nodes (6 CRITICAL, 15 WARNING); the target is 12 or fewer non-ACTIVE nodes.

New simulation/tests/test_event_shapes.py:
- default cave-in |strain| <= 30 mm/m
- the /forge/frame cave-in count as above

Update the forge-v3 tests whose expected numbers change, and list them.
Files: sandbox/collapse.py, sandbox/events.py (only if the radius mapping lives there), simulation/tests/*,
dashboard_electron/test/verify_forge_*.js (expected numbers only).
Commit: "fix(sim): event strain uses the event's own B, radius is the visible edge"
```

## M2 · sensors honest

```
STEP M2 (after E1 and G2). In sandbox/sensors.py:
- OU wander: the stationary std must equal the budget (it is ~9.5 ue today against 1.332), and the step must be per second so it does not depend on tick length.
- PPV separate from RMS: use environment.ppv for blasts; stop adding PPV to RMS (:487-490).
- Principal strain from strain_x and strain_y (:418, :497 ignore y).
- fissure_mm = (e1 - 3000 ue) x 8 m, latched and never healing (see sih-26-finale/mine-sim/src/minesim/cracks.py opening_mm).
- Pore pressure and moisture from environment arrays, not from S (:512, :530).
- Thermal tilt drift 5 urad/C (VERIFY) from environment.air_temp_c.

New tests/test_sensor_honesty.py:
- noise std within 10% of budget at both 60 s and 3600 s ticks
- PPV at 100 m / 30 kg
- the fissure latch persists
- no pore-pressure reading on non-2B tiers

Files: sensors.py, session.py (passing the environment in), tests.
Commit: "fix(sim): honest sensor noise, attenuated PPV, principal strain, latched fissure, rain-driven pore pressure"
```

## M3 · remove fabrication

```
STEP M3 (after M2).
- Delete the forced strain_ue 6500/4200 and the crack_latched reset (session.py ~443-461).
- Null the hard-coded trough_fit_r2 0.94/0.88, confidence 0.92 and days_to_level_3 3.5 in mqtt_bridge.py (~331-337, ~425-430),
  and make the dashboard show "—" for null (the alarm banner shows "R²=").
- Fix the SNR boot gate (session.py:270-289, gates.py): it uses c = 0.01414, multiplies a per-day rate by a tick count and mixes ue with mm/m, so it always passes.
  Make the units consistent against the active ground, or delete it with its tests, and say which.

Check: grep shows 6500/4200/0.94/0.88/0.92/3.5 gone from value paths; pytest passes.
Files: session.py, mqtt_bridge.py, gates.py, the related tests, alarm-banner.js/alarm-detail.js (null display only).
Commit: "fix(sim): no invented strain, R² or confidence on the wire"
```

## D1 · build the 365-day dataset

```
STEP D1 (after M3).
New simulation/scripts/build_dataset_365.py writes to simulation/datasets/adriyala_district_365/.
- Run SimulationSession offline: ground=district, tick 3600 s, 365 d, with environment.build_year(seed) and no FORGE events.
  Reuse the runner.run_script_offline pattern.
- nodes_hourly.csv.gz: every channel, empty where a tier has none, with per-row provenance (LW1 pinned; LW0/LW2 synthetic contributions noted in meta.json).
- bowl_terms.npz: daily bowl_terms_py 366x3x121, plus px 3x121.
- events.csv: daily face positions, blasts, device faults, crack first-opening with Burland category.
- meta.json:
  - parameters and sources (DOI 10.18311/jmmf/2022/32099)
  - seed and SHA-256 of each file
  - survey RMS vs sih-26-finale/mine-sim/data/real/adriyala_lw1_profiles.csv at days 210/300
  - per node: first ADVISORY/WARNING/CRITICAL day and condition, from sandbox/thresholds.py.
    Apply the 24 h median to tilt and strain first, and use tilt change since install.
- README.md.

Checks:
- two builds give identical SHA-256
- every sensing node reaches at least ADVISORY
- at least 27/30 reach WARNING; list the per-node table in the walkthrough
- CRITICAL nodes between 3 and 15; if outside, STOP and report the numbers, do not tune constants
- total size <= 30 MB. If larger, gitignore it and add the build to scripts/start_all.js when missing; report which.

Files: the script, simulation/datasets/**, simulation/tests/test_dataset_365.py (loads the files and checks the schema and the coverage table), .gitignore if needed.
Commit: "feat(data): 365-day real-anchored district dataset with provenance and alarm coverage"
```

## D2 · SIM replays the dataset

```
STEP D2 (after D1).
- SessionConfig.dataset (default: simulation/datasets/adriyala_district_365).
- In dataset mode, tick() reads that hour's rows instead of sampling sensors and sends that day's bowl_terms_py.
  It publishes through the same MQTT/DB/backend path. /config reports source: "dataset".
- PLAY/RESET/speed are unchanged; the year ends at day 365 (script_done).
- scripts/run_scripted_demo.js keeps working.

Checks:
- new test: the replayed tick at hour h equals file row h, for all 31 nodes
- `npm run demo:scripted -- --speed 400` on a test DB, then `select count(distinct node_id) from readings` = 31

Files: session.py, server.py, runner.py if needed, scripts/run_scripted_demo.js only if needed, tests.
Commit: "feat(sim): SIM plays the 365-day dataset through the live pipeline"
```

## D3 · FORGE starts from the same data

```
STEP D3 (after D2).
- /forge/frame loads the dataset (cached): the node rows for that hour and the day's bowl terms. It then adds the event deltas (collapse/events maths unchanged).
- Node state = the most severe of:
  - thresholds.classify on (dataset + delta) for tilt_change, strain_tensile, strain_compressive, crack_width
  - the existing 1.2R/1.5R rings
- Damage still never heals.

Checks:
- no events: FORGE node values equal the dataset rows
- a crack beside a node already at WARNING reaches CRITICAL earlier than the same crack on a quiet node
- every dashboard_electron/test/verify_forge_*.js passes

Files: forge/server.py, forge/states.py, tests, the verify_forge tests' expected numbers only.
Commit: "feat(forge): FORGE starts from the dataset ground and alarms through the shared thresholds"
```

## A2 · wire the alarm engine

```
STEP A2 (after A1 and D2).
- backend/db/schema.sql: new alarm_records table (key PK, node_id, condition, priority, state, value, limit_value, t_raised,
  t_escalated, t_ack, ack_by, t_rtn, shelved_until, history jsonb), plus migrate.js.
- routes/simulation.js: the packet POST applies a 24 h rolling median per node to tilt and strain, runs engine.ingest per node, upserts the records,
  and broadcasts {type:"alarm-update", record} and {type:"node-alarm-state", node_id, state}. A timer calls engine.tick every 60 s.
  Restore the engine from alarm_records at boot.
- routes/alarms.js: POST /api/alarms/:key/ack {operator} and /shelve {operator, until, reason}, both persisted; GET /api/alarms/records.
- simulation/sandbox/mqtt_bridge.py: publish_alarms flag, default False. Stop publishing zone and node alarms and stop POSTing them to :8080.

Check: after a fast scripted year on a test DB:
- `select node_id, max(priority) ... group by 1` gives 30 rows (at least ADVISORY each)
- `select key, count(*) from alarm_records group by key having count(*)>1` is empty

Files: schema.sql, migrate.js, routes/simulation.js, routes/alarms.js, server.js (engine instance and timer), mqtt_bridge.py, db.py if it posts alarms, tests.
Commit: "feat(alarm): backend alarm engine is the only alarm source"
```

## A3 · dashboard reads the one alarm source

```
STEP A3 (after A2).
- live-provider.js: take alarms only from the backend WebSocket; remove the MQTT alarm path
  (main/mqtt-client.js subscription to mine/+/alarm -> live-provider.js:48-51).
- node-markers.js: marker colour from node-alarm-state, with a distinct ADVISORY colour; remove the colour-from-alarm-level path (:445-452).
- alarm-history.js / past-alarms.js: key on alarm key and delete the merge heuristics (alarm-history.js:76-157, past-alarms.js:34-59).
  Show the escalation history.
- alarm-banner.js: show the highest-priority unacknowledged record. ACK posts to /api/alarms/:key/ack and clears only that record
  (today one ACK hides every banner, :14-16). Remove the hard-coded updateBadge(1).
- node-sensors.js: bars and labels from config/alarm-thresholds.json (use U1's route if one was added); delete the 500/1500 ue and 400/1200 mdeg copies.

Check: new dashboard_electron/test/verify_alarms_single_source.js, which checks:
- one row per alarm
- ACK survives a reload
- marker colour equals the node-detail level

Files: the listed renderer files, main/mqtt-client.js, the test.
Commit: "feat(ui): one alarm source, persisted ACK, ADVISORY colour, thresholds from the shared table"
```

## A4 · annunciation

```
STEP A4 (after A3).
- Audio: a WebAudio tone per priority (CRITICAL fast, WARNING slow, ADVISORY single chime), repeating until ACK or SILENCE.
- SILENCE works:
  - add ipcMain.handle('command:send') in dashboard_electron/main.js (none exists; main.js:192-238)
  - fix the preload.js:11 arity (two arguments are passed, one is taken)
  - silence mutes for 5 minutes and never acks
- status-bar.js: alarm rate (alarms per 10 min; EEMUA benchmark <= 10) and standing-alarm count.
- dispatch-log.js: remove the fake pre-filled rows (:9-14).
- Unify the heartbeat timers (30 s in node-markers.js:7, 60 s in live-provider.js:14) from the comms_stale settings.

Check: extend verify_alarms_single_source.js (the SILENCE IPC round-trip), then a manual Electron run.
Files: main.js, preload.js, alarm-banner.js/operator-actions.js, status-bar.js, dispatch-log.js, node-markers.js, live-provider.js, the test.
Commit: "feat(ui): audible alarms, working SILENCE, alarm-rate KPI, no fake dispatch rows"
```

## U2 · SIM left column

```
STEP U2 (after A3).
In the SIM tab (index.html:610-708) add #sim-info (280 px) left of #sim-viewport, with CSS in sim-tab.css. Reuse FORGE's .forge-health-dots, alarm-row and legend styles (sim-tab.css:1216-1340).

Contents:
- dataset card: date, day, the three face positions, and provenance "LW1 real fit · LW0/LW2 synthetic"
- node health dots from node-alarm-state
- live alarm list (the top 20 active)
- the terrain legend, moved out of the iframe: hide TerrainLegend when embed slot = "sim"

Also:
- fit the camera to the ground bounds on load (MineViewport.tsx focusOnBounds :276-292; the start position is [430,400,500] at :360)
- fix the .sim-hud-stats overlap with the iframe's "3D SUBSIDENCE VIEWPORT" header

Check:
- a headless screenshot of the SIM tab with no empty left region
- verify_sim_controls.js passes
- tsc passes

Files: index.html, sim-tab.css, sim-tab.js (or a new js/sim/sim-info.js), App.tsx/MineViewport.tsx/TerrainLegend.tsx (sim slot only).
Commit: "feat(ui): SIM left column with dataset, health and alarms; camera fits the ground"
```

## R1 · docs

```
STEP R1 (last).
- docs/ALARM-PHILOSOPHY.md:
  - the ISA-18.2 lifecycle as implemented
  - the table rendered from config/alarm-thresholds.json
  - the priority-to-response mapping
  - the VERIFY list: the 5.3 mm/m "DGMS" strain, the DGMS 7/1997 PPV bands, the tilt limits, the pore-pressure rise
- docs/DATASET-365.md:
  - the data flow (district -> sensors -> dataset -> SIM/FORGE -> backend alarms)
  - provenance and file schemas
  - how to swap in real field or InSAR data later
- Link both from docs/00-README-index.md.
- Tick the steps done in docs/plans/2026-09-27-data-365.md.

Commit: "docs: alarm philosophy and 365-day dataset"
```
