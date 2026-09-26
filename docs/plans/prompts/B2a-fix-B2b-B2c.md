Repo: /Users/adarshagarwala/Documents/sih26, branch feat/forge-v2-live-and-scripted.
Plan: docs/plans/2026-09-26-forge-v2-live-and-scripted.md. Read "Changes after B1", B2b and B2c. Don't re-read the rest.
Done so far: B0-fix 450351e, B0b 254c0f7, B2a f6bc4cb.

Rules:
- Do ONLY the three steps below, in order: B2a-fix, then B2b, then B2c. Do not touch files outside each step's list without asking.
- Each step ends with its checks. If any check fails and you can't fix it inside that step's file list, STOP there and report.
  Do not start the next step.
- FORGE must never send anything to :8000 /control or :8080 /api/simulation/*. Allowed reads: GET :8080/api/simulation/status
  (LIVE badge), GET :8000/interventions (only from :8020's /forge/seed), and the FORGE iframe's existing WS "init" frame from :8000.
  FORGE may call :8020 /forge/frame, /forge/range, /forge/seed and /health. Nothing else.
- Do not touch the 690-day run: the :8010 lab server, sih-26-finale/, mine-sim/out/v2-690d.
- Do not stop, reset or restart the running live engine on :8000. It is mid-run at 10x. Tests that need a fresh engine must start
  their own on a different port.
- No new dependencies. Do not push.
- docs/plans/ has uncommitted plan edits. Leave them unstaged in every commit.
- simulation/frontend/src/embed.ts has an uncommitted `terrain-target` type. Leave it unstaged in Step 1. From Step 2 on you will edit
  embed.ts, so commit that hunk together with your change and say so in the walkthrough.
- Run Electron tests with `env -u ELECTRON_RUN_AS_NODE ...`.
- One commit per step, using the message given. Every walkthrough must contain the REAL pasted output of its checks.

Speed rules (the stack is already running, so don't redo work):
- The stack (:1883, :8080, :8000, :5173, :8010) is already up. Don't run start_all, npm install or pip install.
  :8020 is NOT running. Start it yourself when a check needs it:
  `cd simulation && .venv/bin/python -m uvicorn forge.server:app --port 8020` (background), and stop it after the step.
- Vite on :5173 hot-reloads App.tsx/embed.ts. Don't run a frontend build. Do run `cd simulation/frontend && npx tsc --noEmit`
  once per step after editing .ts/.tsx files.
- The dashboard tests are the .js files in dashboard_electron/test/. stub-publisher.py and vertical-slice.sh are helpers. Skip them.
- Give every test run a hard cap: `perl -e 'alarm 180; exec @ARGV' node <test>`. If one times out, report it as TIMEOUT and move on.
  Don't retry a failing test more than once.
- The repo is in iCloud-synced ~/Documents. If a file read or git command hangs for more than 30 s, run
  `find . -flags +dataless -not -path '*/node_modules/*' | head` and report which files are offloaded. Don't wait on it.
- Don't re-read the whole plan, sim-tab.js (2000+ lines) or App.tsx (1100+ lines). Grep for what you need.
- While developing, run only that step's own test. Run the full set once, at the end of the step.

Known dashboard test failures (expected until noted):
  verify_sandbox: STEP 5 CAVE-IN fails ("did not post a trigger to the FORGE slot"). B2c fixes it.
  acceptance_s3: "#sim-gate-banner is not visible". A3 fixes it. Leave it.
Anything else failing = STOP.

======================================================================
STEP 1 · B2a-fix: follow-up to commit f6bc4cb
======================================================================
Review findings (Claude, measured):
  - Every /forge/frame response is 21.8 MB and takes ~625 ms, because it returns `channels` and `deltas` as full 241×241 lists
    (18 grids). The 3D view doesn't read them; it uses t_days, time_scalar, perturbations and nodes. Without them the frame is
    ~16 KB. B2b's PLAY needs frames in tens of ms.
  - Events silently default missing fields (radius 60, depth 0.75, duration 4.8, day = request day), and a missing x/y gives a 500.
  - /forge/seed drops warning_hours, so a live cave-in fired with a non-default warning time doesn't round-trip exactly.
  - The live isolation proof compared 404 to 404: the running :8000 predates /interventions, so it proves nothing about cave-ins.
    That's not a code bug, but the walkthrough must say so plainly.
  - docs/BUTTON_AUDIT.md still says "commit <sha>" in two places.

Files you may touch:
  simulation/forge/server.py
  simulation/tests/test_forge.py
  docs/BUTTON_AUDIT.md
  walkthroughs/forge-v2/B2a.md   (append a "B2a-fix" section)

Do:
  1. Grids opt-in: add `include_grids: bool = False` to the /forge/frame request. `channels` and `deltas` are only computed into the
     response when it is true. Tests that compare grids pass include_grids=true. Everything else stays the same shape.
  2. Strict events: a pydantic model `CaveInEvent` with type: Literal["cave_in"], and required x, y, radius_m (>0), depth_m (>0),
     day (>=0), duration_h (>0), plus optional warning_hours (default 8.0, the engine's own default in apply_collapse) and optional
     source (str). Use it in both /forge/frame and /forge/range. Missing or bad fields and unknown types must give 422 (pydantic does
     this for you; delete the hand-written type checks and the silent defaults).
  3. /forge/seed: also emit warning_hours = (t_collapse_days - t_init_days) * 24, rounded to 4 dp. Keep "source":"live".
  4. BUTTON_AUDIT.md: replace both "<sha>" with 254c0f7.
  5. Walkthrough: add a line under the old Check 5 saying the "IDENTICAL" result was 404 vs 404 because the running :8000 predates
     /interventions, so cave-in isolation is proven by the TestClient test, not the live stack. Don't edit the old output.

Checks:
  a) `cd simulation && .venv/bin/python -m pytest -q tests/test_forge.py` → all pass. New tests:
     - default frame has no "channels"/"deltas" keys; include_grids=true has both
     - missing radius_m → 422; missing x → 422; type "crack" → 422 (for /forge/frame and /forge/range)
     - seed round-trip: mocked :8000 returns a failure with a 2 h warning; feed seed's events into /forge/frame and assert the
       rebuilt PillarFailure fields equal the original (t_collapse_days included)
  b) Latency and size, in-process with TestClient, 100 calls with one cave-in, include_grids=false: paste median ms and bytes.
     Target: median < 60 ms, size < 50 KB. If it misses, profile and report what's slow before going further.
  c) Fast pytest pass (same as B2a: `--ignore` the two stress files). Paste the summary.
  d) node dashboard_electron/test/verify_forge_isolation.js → PASS

Commit: fix(forge): lean frames, strict event schema, exact seed round-trip

======================================================================
STEP 2 · B2b: FORGE timeline driven by :8020 frames
======================================================================
Files you may touch:
  dashboard_electron/renderer/index.html        (FORGE centre toolbar only)
  dashboard_electron/renderer/js/sim/sim-tab.js
  dashboard_electron/renderer/js/sim/sim-embed.js
  dashboard_electron/renderer/css/sim-tab.css
  simulation/frontend/src/App.tsx
  simulation/frontend/src/embed.ts
  dashboard_electron/test/verify_forge_isolation.js   (extend, see below)
  dashboard_electron/test/verify_forge_timeline.js    (new)
  walkthroughs/forge-v2/B2b.md                        (new)

Background (checked in the code):
  - The iframe applies live ticks in App.tsx ~line 384 (`if (data.t_sim !== undefined)`): setTDays, setTimeScalar,
    setPerturbations, setNodeTelemetry. The bowl is drawn from base_bowl_mesh × time_scalar, cave-ins from perturbations,
    node colours from nodeTelemetry[].node_state. :8020 frames already use the same field names and formulas.
  - The "init" WS frame (z0_mesh, base_bowl_mesh, nodes, geo origin) must still be used by the FORGE slot. It's a read.
  - Parent → iframe commands are handled in App.tsx's embed `switch (d.cmd)` (~line 763). Types live in embed.ts
    (EmbedParentCommand). The parent sends them with sim-embed.js postToSlot.
  - The FORGE slot is detected with isEngineReadOnly(embedParams) (embed.ts:158).
  - The running :8000 predates /interventions, so /forge/seed returns 503 right now. That's the normal case to handle, not an error.

Do:
  1. App.tsx / embed.ts:
     - New command `forge-frame {frame}`. In the FORGE slot it sets tDays, timeScalar, perturbations and nodeTelemetry from the
       frame through the SAME setters the live tick uses. Don't write a second render path.
     - In the FORGE slot, ignore live tick payloads and don't fetch packets (`packet_available`). Keep handling "init".
       The SIM slot is unchanged.
     - After applying a forge-frame, post a child event `forge-frame-applied {t_days, perturbations: n, max_amp}` so tests can
       see what was rendered.
  2. FORGE centre toolbar (index.html + css): PLAY/PAUSE, a speed select 1 / 5 / 20 days per second, a day slider 0 → end_day,
     a badge "FORGE · Day N.N / END", and "↺ LIVE DAY".
  3. sim-tab.js, FORGE state = { day, events, endDay, playing, speed }. Nothing else, and nothing leaves the FORGE tab.
     - On first FORGE open, and on ↺ LIVE DAY: GET :8020/forge/seed → day + events. If it fails (503 or :8020 down), fall back to the
       live day from the same /api/simulation/status read the LIVE badge uses, with no events, and show a small note in the badge area:
       "live cave-ins not copied (<reason>)". Never invent a day. If both fail, show "FORGE offline: start :8020" and disable PLAY.
       Then POST /forge/range {events} → endDay, start paused, and request the frame for that day.
     - Frame requests: at most one in flight. If more requests come in while one is running, keep only the newest and send it next.
       Slider input requests the frame for the slider's day.
     - PLAY: on each frame reply, advance day by speed × wall seconds since the last step, capped at endDay, and request the next
       frame. At endDay: stop, show PLAY again. PAUSE stops requesting. PLAY at endDay restarts from 0.
     - Leaving the FORGE tab pauses. There must never be more than one play loop.
     - All :8020 calls go through one small function with a 2 s timeout. The base URL is one constant, FORGE_API_BASE.
  4. verify_forge_isolation.js: add checks that sim-tab.js and sim-embed.js reference :8020 only with the paths
     /forge/frame, /forge/range, /forge/seed, /health, and that the App.tsx FORGE slot doesn't apply live ticks
     (grep for the guard). Keep every existing check.

Checks:
  a) verify_forge_timeline.js (new, headless Electron, starts its own :8020 on port 8021 via an env var or query param that
     sim-tab.js reads, or uses the running one if you start it by hand; say which):
     - open FORGE; the badge shows a day and END = 120 (or more if seeded events push it)
     - set the slider to day 10 and day 60: each `forge-frame-applied` t_days matches, and its max_amp/perturbations match a direct
       POST /forge/frame for the same day
     - PLAY at 20 d/s from day 100: the day increases and it stops at END by itself; PAUSE mid-way holds the day for 3 s
     - count requests during the test: zero to :8000/control and to :8080/api/simulation/* except GET .../status
     - switch to MAP: no /forge/frame requests for 5 s
  b) verify_forge_isolation.js → PASS (with the new checks)
  c) the full dashboard test set, pass/fail per file (known failures above only)
  d) `npx tsc --noEmit` in simulation/frontend → clean
  e) screenshots of FORGE at day 5, day 40 and END into walkthroughs/forge-v2/img/ and linked from B2b.md

Commit: feat(forge): independent FORGE timeline driven by the :8020 math

======================================================================
STEP 3 · B2c: click-to-target and CAVE-IN as a FORGE timeline event
======================================================================
Files you may touch:
  simulation/frontend/src/App.tsx
  simulation/frontend/src/embed.ts
  dashboard_electron/renderer/js/sim/sim-embed.js
  dashboard_electron/renderer/js/sim/sim-tab.js
  dashboard_electron/renderer/index.html   (FORGE left column: target readout and event list only)
  dashboard_electron/renderer/css/sim-tab.css
  dashboard_electron/test/verify_sandbox.js      (rewrite STEP 5 CAVE-IN to the new flow)
  dashboard_electron/test/verify_forge_cavein.js (new)
  walkthroughs/forge-v2/B2c.md                   (new)

Background (checked in the code):
  - App.tsx "trigger" command (~line 809) runs triggerEventRef → handleTriggerEvent, which calls
    globalGeomechanics.triggerCollapse (~line 633/678). In FORGE that would draw the bowl a second time on top of :8020's.
  - sim-tab.js fireForgeTrigger (~line 2050) returns early when the :8010 lab says `!data.possible`.
  - embed.ts already has the uncommitted `terrain-target` child-event type. Finish and use it.

Do:
  1. Clicking the terrain in the FORGE slot places the beacon (same as now) and posts
     `terrain-target {x, y, elev, slopeDeg, zoneName}`. sim-tab.js fills the left "Target" readout. Before any click the target is
     (0, 0) and the readout says "(default)".
  2. FIRE with CAVE-IN selected: push {type:"cave_in", x, y, radius_m, depth_m, day: current FORGE day, duration_h} onto FORGE's
     events, using the slider values as they are (no fallbacks; duration_h from the existing control or the engine default 4.8 if
     there's no control, and say which). Then POST /forge/range for the new endDay, and start PLAY so you watch it happen.
  3. Effects: in the FORGE slot, a new command `forge-effect {type:"cave_in", cx, cy, rad}` plays ONLY the dust burst, camera shake
     and toast from handleTriggerEvent. It must not call globalGeomechanics.triggerCollapse or change perturbations. The ground comes
     only from :8020 frames. The SIM slot and standalone app keep today's behaviour.
  4. fireForgeTrigger: remove the `!data.possible` early-return. The :8010 numbers are extra info only. When the lab says not possible,
     label them "outside lab model". CRACK, TILT and VIBRATION keep their current behaviour in this step (B2d–B2f replace them).
  5. Node colours in FORGE come only from the frame's node_states (already true after B2b). Nothing goes on the global bus, the ALARMS
     tab, the MAP tab or the main banner.
  6. Event list under the controls: one line per event, e.g. "Day 20.0 · CAVE-IN 10 m / 100 m at (100, 50)", with "(live)" for seeded
     ones. RESET FORGE clears FORGE's own events, keeps the seeded live ones, recomputes endDay, and reloads the current day's frame.
  7. verify_sandbox.js STEP 5: rewrite it to fire CAVE-IN in FORGE and assert a /forge/frame request with that event follows and
     the slot posts forge-frame-applied with perturbations ≥ 1. Don't change its other steps.

Checks:
  a) verify_forge_cavein.js (new, headless Electron, :8020 running):
     - post a terrain-target at (100, 50) (or click) → readout shows it; before that it shows (0, 0) (default)
     - set depth 10 m, radius 100 m, slider to day 20, FIRE → event list has the line, PLAY starts, and it stops at END
     - at END: forge-frame-applied max_amp ≈ 10 m (±10%). Slide to day 19: perturbations = 0
     - at day 20.5 (inside the active window): nodes within 1.2 × 100 m of (100, 50) are CRITICAL in the FORGE frame
     - the MAP tab's node colours and the ALARMS count are the same before and after
     - globalGeomechanics.triggerCollapse was not called in the FORGE slot (spy on it or count its log line)
     - request count: zero to :8000/control and :8080/api/simulation/* (except GET status)
  b) verify_sandbox.js → PASS, including STEP 5
  c) verify_forge_isolation.js and verify_forge_timeline.js → PASS
  d) the full dashboard test set, pass/fail per file (only acceptance_s3 may fail)
  e) `npx tsc --noEmit` → clean
  f) screenshots before / during / after a cave-in, at two different spots, linked from B2c.md

Commit: feat(forge): click-to-target cave-in as a timeline event

======================================================================
Final report (after Step 3, or at the step where you stopped):
  - commit sha per step
  - per-step check output (short), with links to the walkthroughs
  - the Step 1 latency/size numbers
  - anything you left alone and why
Then stop. B2d (CRACK), B2e (TILT) and B2f (VIBRATION) get their own prompt after Adarsh has looked at B2c.
