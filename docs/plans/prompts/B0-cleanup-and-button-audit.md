Repo: /Users/adarshagarwala/Documents/sih26, branch feat/forge-v2-live-and-scripted.
Plan: docs/plans/2026-09-26-forge-v2-live-and-scripted.md. Read it first, especially "Changes after B1 (round 2)" and step B0.
Rules:
- Do ONLY step B0. Do not touch files outside its list without asking.
- FORGE must never send anything to :8000 /control or :8080 /api/simulation/*.
- Do not touch the 690-day run: the :8010 lab server, sih-26-finale/, mine-sim/out/v2-690d. It is kept for a later phase.
- No new dependencies.
- When done: run the check commands, paste the real output, and write walkthroughs/forge-v2/B0.md (what changed, files, how to verify, test output).
- One commit, message below. Do not push.
- simulation/frontend/src/embed.ts has an uncommitted `terrain-target` type. Leave it as it is and do not commit it in this step.

STEP B0: remove the FORGE node list, the SIM tab timeline bar and the 60s popups, and write a button audit (report only).

Files you may touch:
  dashboard_electron/renderer/index.html
  dashboard_electron/renderer/js/sim/sim-tab.js
  dashboard_electron/renderer/css/sim-tab.css
  simulation/frontend/src/App.tsx          (the two toasts only)
  dashboard_electron/test/*                (only tests that reference removed IDs)
  docs/BUTTON_AUDIT.md                     (new)

Do:
1. FORGE node list: remove the "NODES IN EXPERIMENT" checkbox list added in B1 (HTML, JS, CSS). FORGE always uses all nodes. Keep the event buttons, sliders, Target readout, FIRE and RESET FORGE.

2. SIM tab timeline bar: remove `<div class="sim-timeline-bar">` (index.html ~672-696): ▶ PLAY, 1x/10x, -1d/+1d/-1h/+1h, LOOP, "Day N (Live)".
   - Remove the JS that only this bar used: sim-tab.js onDayChange, the step buttons, the loop checkbox, startPlay/stopPlay/togglePlay/restartPlayTimer/playTimer, refreshSimDayData and its scrub state (lastScrubbedDay, scrubInFlight, scrubQueuedDay), and the `#sim-day-display` / `#sim-timeline-day-val` badges.
   - Before deleting each function, grep for other callers. If something else still calls one, keep it and list it in the walkthrough.
   - Note: startPlay/stopPlay emit `simulation-play` / `simulation-stop` / `simulation-status` on the bus and start/stop liveProvider. Find who listens to those. The live provider must keep streaming exactly as it does now without the button: open the MAP tab and confirm nodes still update.
   - Put ONE read-only badge in the SIM tab where the bar was: "LIVE · Day N.N". Take it from GET http://localhost:8080/api/simulation/status → t_sim_seconds / 86400, polled every 5 s. This is a read (allowed). Show "LIVE · —" if the call fails.

3. Popups: in simulation/frontend/src/App.tsx, delete the toast `📦 60s PACKET #… SYNCHRONIZED` (~line 312, with its `embedSlotRef.current !== "forge"` guard) and the toast `▶ SIMULATION RUNNING (60s tick stream active)` in handleStart (~line 508). Keep the packet handling itself; only the showToast calls go.

4. Broken test: dashboard_electron/test/verify_sandbox.js clicks the SIM map button (#btn-sim-select) removed in step 2. Update it to the current flow (FORGE opens ungated on the full terrain), or delete the steps that no longer exist. Say which you did.

5. docs/BUTTON_AUDIT.md: REPORT ONLY, delete nothing from it in this step.
   - Cover every <button> and clickable control in dashboard_electron/renderer/index.html (all tabs) and in simulation/frontend/src (3D sim panels).
   - Columns: | id / label | tab / panel | what it does (one line) | tested? works? | verdict KEEP / REMOVE / FIX | reason |
   - "Tested" means you actually clicked it in the running app (headless Electron is fine) and saw the effect. Say what you saw.
   - Mark REMOVE when it does nothing, duplicates another control, or belongs to a removed flow. Mark FIX when it should work but doesn't.
   - Leave the verdict column editable. Adarsh will approve it, and the deletions happen in B0b.

Check:
  a) cd dashboard_electron && the full test suite (all files in test/). Paste the real pass/fail counts.
  b) Headless Electron console-error check: open every tab (MAP, NODES, ALARMS, HISTORY, SIM, FORGE, …) and paste any console errors (expected: none new).
  c) Screenshots: the SIM tab with the new "LIVE · Day N" badge and no bar; the FORGE left column with no node list.
  d) grep proof that nothing is left behind:
     grep -rn "sim-timeline-bar\|sim-btn-step\|sim-loop-checkbox\|SYNCHRONIZED\|tick stream active\|refreshSimDayData" dashboard_electron/renderer simulation/frontend/src
     (expected: no hits)

Commit: chore(ui): remove FORGE node list, SIM timeline bar and packet popups; add button audit
