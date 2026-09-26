Repo: /Users/adarshagarwala/Documents/sih26, branch feat/forge-v2-live-and-scripted.
Plan: docs/plans/2026-09-26-forge-v2-live-and-scripted.md, step B0. The original step prompt is docs/plans/prompts/B0-cleanup-and-button-audit.md.
Rules:
- FORGE must never send anything to :8000 /control or :8080 /api/simulation/* (reads such as GET /api/simulation/status are fine).
- Do not touch the 690-day run: the :8010 lab server, sih-26-finale/, mine-sim/out/v2-690d.
- No new dependencies. Do not push.
- simulation/frontend/src/embed.ts has an uncommitted `terrain-target` type. Leave it unstaged and do not commit it.

STEP B0-finish. B0 is half done and uncommitted in the working tree: the timeline bar, node list and 60s toasts have been removed. Keep those removals. Fix what is wrong, finish what is missing, then commit.

Files you may touch:
  dashboard_electron/renderer/index.html
  dashboard_electron/renderer/js/sim/sim-tab.js
  dashboard_electron/renderer/js/data/mode-switch.js
  dashboard_electron/renderer/css/sim-tab.css
  dashboard_electron/test/*   (only tests that reference removed IDs)
  docs/BUTTON_AUDIT.md        (new)
  walkthroughs/forge-v2/B0.md (new)

Fix 1: the live feed must start by itself, from real state.
  Before B0, the only thing that started the live feed was the PLAY button:
  sim-tab.js startPlay → bus 'simulation-play' → mode-switch.js:32 → liveProvider.start().
  The half-done B0 replaced that with an inline <script> in index.html. The script emits 'simulation-play' and a hard-coded
  'simulation-status' RUNNING at parse time. That is wrong for two reasons:
    (a) it runs before mode-switch's /api/health fetch resolves, so currentMode is still 'fixture' and it can start fixtureProvider instead of liveProvider;
    (b) it tells node-table, status-bar, node-markers, node-detail, sim-live and so on that the engine is RUNNING even when it is paused or stopped.
  Do:
  - Delete that inline <script> block from index.html completely.
  - In mode-switch.js setMode('live'), call liveProvider.start() (it must be idempotent: check live-provider.js start() and guard it if it is not).
    The real 'simulation-status' already comes from live-provider.js:184 using backend data. Nothing else should fake it.
  - Keep the 'simulation-play' / 'simulation-stop' listeners in mode-switch.js. They are reused by step A3 (header play/pause).
  - Move the "LIVE · Day N.N" badge polling into sim-tab.js, using that file's existing style (5 s interval, GET http://localhost:8080/api/simulation/status,
    t_sim_seconds / 86400 to 1 decimal place, "LIVE · —" on failure). Poll only while the SIM tab is visible if sim-tab.js already has a tab-visibility hook; otherwise poll always.

Fix 2: no fake status labels.
  - index.html replaced the "PHYSICS CLOCK: Day N" line with a hard-coded green "PHYSICS ENGINE: ACTIVE". Remove that line entirely.
    Do not add a replacement: the LIVE badge already shows the day.

Fix 3: stale comment.
  - The FORGE left column comment "Region comes ONLY from the MAP SIM-box selection" is wrong, because the SIM box was removed in step 2.
    Replace it with one line: FORGE always uses the full terrain and all nodes.
  - Check sim-tab.js for leftover JS that only served the removed node list (forge-node-list, forge-node-count). Remove it if no other caller exists.

Finish 4: docs/BUTTON_AUDIT.md (REPORT ONLY; delete nothing from it in this step).
  - Cover every <button> and clickable control in dashboard_electron/renderer/index.html (all tabs) and simulation/frontend/src (3D sim panels).
  - Columns: | id / label | tab / panel | what it does (one line) | tested? what you saw | verdict KEEP / REMOVE / FIX | reason |
  - Test each one by clicking it in a headless Electron run (reuse the harness pattern in dashboard_electron/test/). Write what actually happened.
  - REMOVE = does nothing, duplicates another control, or belongs to a removed flow. FIX = should work but doesn't.
  - End with a short list of REMOVE candidates and a separate list of FIX candidates.

Finish 5: walkthroughs/forge-v2/B0.md: what changed, files, how to verify, and the real test output from the checks below.

Checks (paste the real output of each in the walkthrough and in your final report):
  a) Every test file in dashboard_electron/test/ run headless (with ELECTRON_RUN_AS_NODE unset: `env -u ELECTRON_RUN_AS_NODE ...`). Report pass/fail per file.
  b) Boot proof: launch headless and capture the renderer console. It must show mode-switch going LIVE and then liveProvider starting, with no 'fixture' provider starting.
     Then wait 15 s and confirm the MAP tab node data updated (a telemetry timestamp changed).
  c) Console-error check with every tab opened once. Report any errors.
  d) grep proof (expected: no hits):
     grep -rn "sim-timeline-bar\|sim-btn-step\|sim-loop-checkbox\|SYNCHRONIZED\|tick stream active\|refreshSimDayData\|forge-node-list\|PHYSICS ENGINE:" dashboard_electron/renderer simulation/frontend/src
     grep -n "bus.emit('simulation-status'" dashboard_electron/renderer/index.html
  e) Screenshots: the SIM tab (LIVE badge, no bar) and the FORGE left column (no node list). Save them under walkthroughs/forge-v2/B0/.

Commit (stage everything except simulation/frontend/src/embed.ts and docs/plans/, since the plan changes are committed separately):
  chore(ui): remove FORGE node list, SIM timeline bar and packet popups; add button audit
