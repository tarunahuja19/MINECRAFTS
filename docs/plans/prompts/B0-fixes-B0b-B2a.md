Repo: /Users/adarshagarwala/Documents/sih26, branch feat/forge-v2-live-and-scripted.
Plan: docs/plans/2026-09-26-forge-v2-live-and-scripted.md. Read it first, especially "Changes after B1", B0b and B2a.
Rules:
- Do ONLY the three steps below, in order: B0-fix, then B0b, then B2a. Do not touch files outside each step's list without asking.
- Each step ends with its checks. If any check fails and you can't fix it inside that step's file list, STOP there and report. Do not start the next step.
- FORGE must never send anything to :8000 /control or :8080 /api/simulation/*. The only allowed reads are GET /api/simulation/status (the LIVE badge) and, from B2a on, GET :8000/interventions.
- Do not touch the 690-day run: the :8010 lab server, sih-26-finale/, mine-sim/out/v2-690d.
- Do not stop, reset or restart the running live engine on :8000. It is mid-run at 10x. Tests that need a fresh engine must start their own on a different port.
- No new dependencies. Do not push.
- simulation/frontend/src/embed.ts has an uncommitted `terrain-target` change, and docs/plans/ has uncommitted plan edits. Leave both unstaged in every commit.
- Run Electron tests with `env -u ELECTRON_RUN_AS_NODE ...`.
- One commit per step, using the message given. Every walkthrough must contain the REAL pasted output of its checks.
Speed rules (the stack is already running, so don't redo work):
- The stack (:1883, :8080, :8000, :5173, :8010) is already up. Don't run start_all, npm install, pip install, or a frontend build.
- The only dashboard tests are the .js files in dashboard_electron/test/ (acceptance_s3, verify_forge_close, verify_forge_isolation,
  verify_sandbox). stub-publisher.py and vertical-slice.sh are helpers, not tests. Skip them.
- Give every test run a hard cap: `perl -e 'alarm 180; exec @ARGV' node <test>`. If one times out, report it as TIMEOUT and move on.
  Don't retry a failing test more than once.
- The repo is in iCloud-synced ~/Documents. If a file read or git command hangs for more than 30 s, run
  `find . -flags +dataless -not -path '*/node_modules/*' | head` and report which files are offloaded. Don't wait on it.
- Don't re-read the whole plan or the whole of sim-tab.js (2000+ lines) for each step. Grep for what you need.

======================================================================
STEP 1 · B0-fix: follow-up to commit 566562a
======================================================================
Files you may touch:
  dashboard_electron/renderer/js/sim/sim-tab.js
  dashboard_electron/test/verify_forge_isolation.js
  dashboard_electron/test/verify_sim_gate.js   (delete)
  walkthroughs/forge-v2/B0.md                   (append a "B0-fix" section)

Fix 1 (must fix): verify_forge_isolation.js:44 fails.
  It bans any ":8080" in sim-tab.js, and the LIVE badge's GET /api/simulation/status trips it. That read is allowed.
  Narrow the check so that:
    - it still fails on any :8000 address, any "/control", and any :8080 path other than /api/simulation/status
    - it fails if sim-tab.js uses anything other than GET toward :8080 (e.g. a `method: 'POST'` / PUT / DELETE in a fetch that targets 8080)
  Keep the check strict and simple, e.g. find every "/api/" path string in sim-tab.js and assert the set is exactly {"/api/simulation/status"}.
  Do not move the badge out of sim-tab.js.
  Prove the guard still works: temporarily add `fetch('http://localhost:8080/api/simulation/control', {method:'POST'})` to sim-tab.js,
  run the test, see it FAIL, then remove the line and see it PASS. Paste both outputs.

Fix 2: the badge should poll only while the SIM tab is visible.
  Right now sim-tab.js:167-168 starts a 5 s setInterval at init that never stops.
  Change it so that polling starts in onTabShown('sim') and stops when any other tab is shown (onTabShown is called for every tab switch.
  Check that, and if it isn't, have the interval callback skip when the SIM tab panel is hidden). There must never be more than one interval.

Fix 3: a missing day must not show "Day 0.0".
  In updateSimLiveBadge, if t_sim_seconds is missing or not a finite number, show "LIVE · —". Only a real number shows "LIVE · Day N.N".

Fix 4: stale comment at sim-tab.js:173 ("the region comes ONLY from the MAP SIM-box").
  Replace it with one line: FORGE always uses the full terrain and all nodes.

Fix 5: dead code.
  Remove `var isPlaying` (sim-tab.js:44), the `isPlaying: function ...` export (~sim-tab.js:2112) and the stale comment around sim-tab.js:118
  that mentions it. First grep the whole renderer and tests for `simTab.isPlaying` / `.isPlaying(`. If any caller exists, report it and don't remove.

Fix 6: delete dashboard_electron/test/verify_sim_gate.js.
  It asserts the old PLAY-gate design (fresh load = STOPPED, PLAY button revives nodes), which B0 removed on purpose.
  Step A3 (header PLAY/PAUSE) will write its replacement. Remove any reference to it from package.json scripts / test runners, if one exists.

Checks:
  a) node dashboard_electron/test/verify_forge_isolation.js → PASS, plus the FAIL/PASS guard proof from Fix 1.
  b) Every other test in dashboard_electron/test/ run headless. Pass/fail per file. Expected known failures:
       verify_sandbox (STEP 5 CAVE-IN; B2c rewrites CAVE-IN) and acceptance_s3 (gate banner).
     For each of those two, also run it at commit 4b2eeb2 (use `git worktree add /tmp/b0-base 4b2eeb2`, then remove the worktree)
     and paste which step it fails at there. Anything else failing = STOP.
  c) Headless Electron: open SIM, wait 12 s, and confirm the badge reads "LIVE · Day N.N" with N > 0. Then switch to MAP, wait 12 s,
     and confirm (count fetches, or log inside updateSimLiveBadge) that no status requests were made while MAP was shown.
  d) grep -n "isPlaying\|SIM-box" dashboard_electron/renderer/js/sim/sim-tab.js   → no hits

Commit: fix(ui): narrow FORGE isolation test to allow the status read; badge polls only on SIM tab

======================================================================
STEP 2 · B0b: remove approved buttons from docs/BUTTON_AUDIT.md
======================================================================
Adarsh has approved the audit's REMOVE list, which is exactly ONE item: `btn-sim-freeze` (the hidden FREEZE button in the FORGE left column).
The FIX items (snap-layout cards, TelemetryDrawer internals, CAVE-IN) are NOT part of this step. Don't touch them.

Files you may touch:
  dashboard_electron/renderer/index.html
  dashboard_electron/renderer/js/sim/sim-tab.js
  dashboard_electron/renderer/css/sim-tab.css
  dashboard_electron/test/*   (only lines that reference btn-sim-freeze)
  docs/BUTTON_AUDIT.md
  walkthroughs/forge-v2/B0b.md (new)

Do:
  - Remove the btn-sim-freeze element, its click handler, any function or state only it used, and any CSS only it used.
    Before deleting each function, grep for other callers. If one exists, keep the function and say so.
  - In BUTTON_AUDIT.md, mark that row "REMOVED in B0b (commit <sha>)". Leave every other row as is.

Checks:
  a) grep -rn "btn-sim-freeze\|sim-freeze" dashboard_electron/renderer dashboard_electron/test simulation/frontend/src   → no hits
  b) Rerun the 4 dashboard tests (with the 180 s cap). The results must match Step 1 exactly (same passes, same known failures).
     Don't rerun the 4b2eeb2 baseline. Step 1 already did that.
  c) Headless console-error check with every tab opened once. Zero new errors.

Commit: chore(ui): remove unused buttons per audit

======================================================================
STEP 3 · B2a: FORGE math server on :8020
======================================================================
Files you may touch:
  simulation/forge/__init__.py          (new)
  simulation/forge/server.py            (new)
  simulation/sandbox/session.py         (refactor only, see below)
  simulation/sandbox/server.py          (add one read-only GET /interventions)
  scripts/start_all.js                  (start :8020)
  simulation/tests/test_forge.py        (new)
  walkthroughs/forge-v2/B2a.md          (new)

Background (checked in the code):
  - Live ground = surface.channels(X, Y, t_days) (simulation/sandbox/surface.py:296)
    + collapse.collapse_deltas(X, Y, t_days, pillar_failures) (collapse.py:134). See session.py tick() ~line 290-310.
  - Session.apply_collapse (session.py:576) builds a PillarFailure (collapse.py:32) like this:
      t_init = current day; t_collapse = t_init + warning_hours/24 (default 8 h); duration_days = duration_hours/24; magnitude_m.
  - Node states: Session._assign_node_states (session.py:234) uses 1.2R → CRITICAL and 1.5R → WARNING over the ACTIVE collapses only,
    where active = t_init_days <= t <= t_collapse_days + duration_days + 0.05 (session.py ~346).

Do:
  1. session.py refactor, with NO behaviour change:
     - Lift _assign_node_states into a module-level pure function, e.g.
       `assign_node_states(nodes, active_collapses) -> dict[str, str]` (nodes = objects with node_id, x_m, y_m).
     - Lift the active-collapse filter into `active_collapses(failures, t_days)`.
     - Session calls both. The existing Session method may stay as a one-line wrapper.
     - All existing simulation/tests must still pass, including test_reproducibility.py (A1).
  2. simulation/sandbox/server.py: add `GET /interventions` → {"t_sim_seconds": ..., "pillar_failures": [ {cx, cy, radius_m, t_init_days,
     t_collapse_days, duration_days, magnitude_m}, ... ]}. Read-only: it must not tick, lock for long, or change any state.
  3. simulation/forge/server.py: a stateless FastAPI app on :8020. No MQTT, no DB, no writes to :8000, no module-level mutable state.
     It builds its own X, Y grid and sensor-node layout the same way Session does (reuse the same helpers; don't copy constants).
     Build the grid and node layout ONCE at startup and treat them as read-only (that's allowed; "stateless" means no event/day state
     kept between requests). Don't construct a Session per request, because that's slow and opens files. Each /forge/frame should take
     well under 1 s; report the median time over the 100-call proof.
     - POST /forge/frame  {day, events:[{type:"cave_in", x, y, radius_m, depth_m, day, duration_h}]}
         Each event becomes PillarFailure(cx=x, cy=y, radius_m, t_init_days=day, t_collapse_days=day + 8/24,
         duration_days=duration_h/24, magnitude_m=depth_m), the same mapping as apply_collapse.
         Returns a frame with the same field names the live packet uses for terrain and nodes (read packet.py and the tick() payload;
         match them, don't invent new ones), plus `node_states` from assign_node_states(nodes, active_collapses(failures, day)).
         Sensor noise is OFF: FORGE shows truth values.
         Reject unknown event types with 422. Only "cave_in" exists in this step.
     - POST /forge/range  {events} → {end_day}. end_day = max(120, the latest event's t_collapse_days + duration_days + 5), rounded up to a whole day.
     - GET  /forge/seed   → reads GET :8000/interventions and returns {day, events} in FORGE's event format
         (convert back: depth_m = magnitude_m, day = t_init_days, duration_h = duration_days*24, mark each with "source":"live").
         If :8000 is down, return 503 with a clear message. Don't fake a day.
     - GET  /health
     - CORS: allow the dashboard origin (file:// / localhost), the same way the other servers do.
  4. scripts/start_all.js: start `uvicorn forge.server:app --port 8020` (same cwd/pythonCmd pattern as the :8000 sandbox server),
     wait for /health, add 8020 to STACK_PORTS and to the printed URL list and the "ports are free" message.
     Do not restart the currently running stack to test this. Test start_all's :8020 block by reading it, and start :8020 yourself by hand.

Checks: simulation/tests/test_forge.py (use FastAPI TestClient; mock :8000 for /forge/seed; never call the real :8000 from pytest):
  - frame at day 0: subsidence is zero everywhere
  - frame at day 30 with no events matches surface.channels(X, Y, 30) exactly (np.array_equal or atol=0)
  - cave-in 10 m depth / 100 m radius at day 20: at day 19 the centre delta is 0; at day 25 (settled) the centre delta is ≈ -10 m (±5%)
  - node_states match Session's own result for the same failures and day (build a Session, append the same PillarFailure, compare)
  - nodes inside 1.2R are CRITICAL during the active window and ACTIVE after it ends (this is the engine's rule, so keep it)
  - /forge/range: no events → 120; an event on day 118 → end_day > 118
  - unknown event type → 422
  - /forge/seed with :8000 mocked → correct {day, events}; with :8000 down → 503
Also run:
  - Run pytest from simulation/ (`cd simulation && python -m pytest tests -q -x`) in two passes:
      1. fast: `--ignore=tests/test_stress_1000_trials.py --ignore=tests/test_stress_sessions_ab.py`, which must include
         test_forge.py and test_reproducibility.py (both must pass)
      2. stress: those two files alone, run once, with `--durations=5`. If together they run over 10 min, stop them and report TIMEOUT.
    Paste both summaries.
  - Iterate on test_forge.py alone (`-q tests/test_forge.py`) while developing. Don't rerun the full suite after every edit.
  - Live isolation proof against the REAL running stack: record GET :8000/interventions and GET :8080/api/simulation/status,
    make 100 POST :8020/forge/frame calls with a cave-in event, and record both again. pillar_failures must be identical,
    and t_sim_seconds must only have advanced by normal ticking (no reset, no jump). Paste all of it.
  - node dashboard_electron/test/verify_forge_isolation.js → PASS

Commit: feat(forge): private FORGE math server on :8020 using the live engine's equations

======================================================================
Final report (after Step 3, or at the step where you stopped):
  - commit sha per step
  - per-step check output (short), with links to the walkthroughs
  - anything you left alone and why
