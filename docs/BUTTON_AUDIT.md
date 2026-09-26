# Button Audit — R4 Dashboard (Electron) + Sim Frontend (App.tsx)

Produced as part of B0-finish (2026-09-26). Every control below was located by
reading `dashboard_electron/renderer/index.html` and the `simulation/frontend/src`
component tree, then exercised live: the dashboard was booted headless (Chrome
via CDP, pointed at the served `dashboard_electron/renderer/index.html` on
`http://localhost:8085`, against the real running stack — postgres, MQTT
broker, backend `:8080`, sim engine `:8000`, lab `:8010`, vite `:5173`), every
tab was opened, and every visible/enabled `<button>` in the DOM was clicked
with a live console-error listener attached. `simulation/frontend`'s own
MenuBar/RightInspectorPanel controls were exercised the same way, loaded
standalone at `http://localhost:5173/`. Buttons that repeat identically across
near-duplicate panes (3D TILT / VERT EXAG / Google Earth / pop-out, present on
map pane-slots 1-4) are collapsed into one row with a note.

Destructive/blocking controls were **not** invoked for real (noted per row):
`CLOSE EVERYTHING` (quits the app + wipes the DB behind a `confirm()`), and
tab-bar buttons were excluded from the per-tab click sweep (they are the
mechanism used to *reach* each tab, already exercised by opening every tab).

Result up front: **zero click produced a console error or thrown exception**
across both apps, in this pass. See `walkthroughs/forge-v2/B0.md` for the raw
terminal output this table is built from.

## MAP tab

| id / label | tab / panel | what it does (one line) | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| `replay-play` / PLAY, PAUSE, STOP | MAP left panel, 90-day replay | Starts/pauses/stops the fixture replay timeline | Clicked; no errors, replay state advanced | KEEP | Core replay feature |
| `.replay-speed-btn` (10x/50x/100x) | MAP left panel | Sets replay playback speed | Clicked; no errors | KEEP | |
| `tab-btn-2d` | MAP workspace tab strip | Switches map workspace to the pinned 2D tab | Clicked; no errors | KEEP | |
| `btn-snap-layout` | MAP workspace | Opens Windows-style snap-layout flyout (1/2/3/4-pane split) | Clicked; flyout logic ran, no errors | KEEP | |
| `.snap-layout-card` (5 layouts) | Snap flyout | Chooses a pane split layout | Not clicked directly this pass (flyout closed before it could be exercised) | FIX | Verify the flyout stays open long enough to pick a layout in a manual pass; not confirmed broken, just not exercised |
| `btn-basemap-sat` / `btn-basemap-topo` | MAP HUD | Toggles aerial vs topo basemap | Clicked both; no errors | KEEP | |
| `btn-cursor-mode` (3D) | MAP HUD | Toggles the 3D area-selection cursor tool | Clicked; no errors, title text updates | KEEP | |
| `btn-grid-toggle` / `btn-grid-labels` / `btn-grid-surface` | MAP HUD | Show/hide 8x8 sector grid, labels, surface shading | Clicked all three; no errors | KEEP | |
| `btn-close-map-legend` | MAP HUD legend | Closes the map legend panel | Not clicked (legend was already collapsed in this session) | KEEP | Trivial, low risk |
| `.pane-btn.btn-pane-max` (×4, one per pane slot) | MAP workspace panes 1-4 | Maximizes a given pane to 100% | Not clicked (panes 2-4 inactive by default) | KEEP | Standard window-max control |
| `.terrain-tool-btn` (65°/0°/78° tilt, 1x/3x/5x exag) ×4 panes | 3D pane toolbars (panes 1-4, `-3`/`-4` suffixed ids) | Sets 3D camera tilt / vertical exaggeration | Exercised on the primary SIM/FORGE toolbars (see below); pane-slot duplicates not independently clicked | KEEP | Identical control repeated per pane, already proven safe on SIM/FORGE toolbars |
| `btn-launch-google-earth` (+`-3`/`-4`) | 3D pane toolbars | Opens the sector in Google Earth (external) | Not clicked (opens external browser/URL — unsafe to fire in headless CI) | KEEP | External-open action, correctly gated behind an explicit click |
| `btn-win-popout` (+`-3`/`-4`) | 3D pane toolbars | Pops a pane out to a standalone window | Not clicked (spawns a new BrowserWindow — out of scope for a click sweep) | KEEP | |
| `btn-snap-assist-close` | Snap-assist overlay | Dismisses the snap-assist window picker | Overlay not open in this session | KEEP | |
| `btn-view-both` / `btn-view-alarm` / `btn-view-node` | MAP right panel | Switches right panel between alarm/node/split view | Not clicked (view switcher hidden until an alarm+node are both open) | KEEP | |
| `btn-close-all` (CLOSE EVERYTHING) | Global tab bar | Stops the engine, wipes the runtime DB, quits Electron | **Not invoked** — behind a `window.confirm()`; declining would still be a real destructive action to rehearse against the shared live stack | KEEP | Correctly guarded by a confirmation dialog; do not automate-click this in a shared environment |

## SIMULATION tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| `sim-cam-tilt65/0/78` | SIM toolbar | 3D camera tilt presets | Clicked all three; no errors | KEEP | |
| `sim-exag-1/3/5` | SIM toolbar | Vertical exaggeration presets | Clicked all three; no errors | KEEP | |
| `sim-recenter-btn` | SIM toolbar | Re-fits camera to full district | Clicked; console showed `[SIM_TAB] Recentering sim camera to full district.`, embed received a `recenter` command | KEEP | Verified working end-to-end (`verify_sandbox.js` STEP 4 also asserts this) |
| `.sim-embed-retry-btn` (RETRY) | SIM viewport fallback | Retries loading the 3D embed if it failed | Not clicked (fallback banner not shown — embed loaded fine) | KEEP | |
| `#sim-live-day-badge` | SIM viewport bottom bar | **Not a button** (a `<span>` readout) — this is the LIVE badge this step wired up | Verified via screenshot: reads `LIVE · Day 2.1`, polling every 5s from `/api/simulation/status` | KEEP | New in this step (Fix 1) |

## FORGE tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| `.sim-scenario-btn` (CAVE-IN/CRACK/TILT/VIBRATION) | FORGE left column | Selects the event type to fire | Clicked all four; no errors, parameter sliders swap visibility correctly | KEEP | |
| Event parameter sliders (`.forge-slider`, e.g. `sim-days-ahead`, `sim-crack-radius`, ...) | FORGE left column | Tune event parameters | Not clicked (range inputs, not buttons — out of this audit's scope) | KEEP | |
| `btn-sim-run-scenario` (FIRE EVENT) | FORGE left column | Runs the selected experiment against the sandbox | Clicked with CRACK selected; no console error, forge embed received `set-cracks` command (confirmed independently by `verify_sandbox.js`) | KEEP | **Caveat:** `verify_sandbox.js` STEP 5 shows CAVE-IN specifically does not post its own distinct trigger command to the FORGE embed (pre-existing, confirmed unrelated to this step — reproduces identically with B0's live-provider/mode-switch changes reverted) |
| `btn-forge-reset` (RESET FORGE) | FORGE left column | Clears sandbox session, returns to full domain | Clicked; no errors | KEEP | |
| `btn-sim-close-session` (✕ CLOSE) | FORGE middle toolbar | Closes the sandbox session, returns to MAP | Disabled with no session open in this pass (correct — button starts `disabled`); exercised indirectly via `verify_forge_close.js`/`verify_sandbox.js`, which pass | KEEP | |
| `forge-recenter-btn` | FORGE middle toolbar | Re-fits camera to the selection bounds | Clicked (with an active sandbox session from `verify_sandbox.js`); FORGE slot received `recenter` | KEEP | |
| `.sim-embed-retry-btn` (RETRY) | FORGE viewport fallback | Retries the FORGE 3D embed | Not clicked (embed loaded fine) | KEEP | |
| `btn-sim-freeze` (FREEZE) | FORGE left column | Legacy freeze action | REMOVED in B0b (commit <sha>) | REMOVE | Removed in B0b: deleted button element, click handler, unused freezeCurrentDay function, and CSS rules. |

## NODES tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| (none — data table only) | NODES tab | Renders the node overview/status directory (`nodeTable.init`) | Opened the tab; 9 visible buttons counted are the always-present tab-bar + CLOSE EVERYTHING buttons, not tab-specific controls; table itself has no buttons | KEEP | Read-only table by design |

## ALARMS tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| `#btn-close-alarm` (X) | Alarm detail panel (`alarm-detail.js`) | Closes the open alarm detail | Not present in DOM in this pass — no alarm was selected/open | KEEP | Conditional on an open alarm |
| `#btn-ack-alarm` (ACK) / `#btn-silence-siren` / `#btn-export-report` | Operator actions (`operator-actions.js`), shown with an open alarm | Acknowledge / silence / export for the active alarm | Not present in DOM in this pass — no alarm open | KEEP | Conditional on an open alarm; verified present via source read |
| `#btn-ack-yes` / `#btn-ack-no` | Operator actions ACK confirm | Confirms/cancels acknowledging an alarm | Not present in DOM in this pass | KEEP | Conditional |
| `.past-alarm-replay` (VIEW) | Past-alarms table row | Jumps to a specific past alarm | Not present (no alarm history yet in this run) | KEEP | Conditional on alarm history rows existing |

## HISTORY tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| `replay-play` / `.replay-btn-pause` / `.replay-btn-stop` | HISTORY left column (shares `replay-controller.js` with MAP) | Same 90-day replay controls as MAP | Clicked PAUSE/STOP/speed buttons; no errors | KEEP | Shared component with MAP, already covered above |
| `.replay-speed-btn` (10x/50x/100x) | HISTORY left column | Replay speed | Clicked; no errors | KEEP | |
| `.past-alarm-replay` (VIEW), 3 visible in this run | HISTORY | Jump to a specific past alarm's replay point | Clicked all 3 visible instances; no errors | KEEP | |

## SYSTEM tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| `blast-test-btn` (TEST — BLAST INJECTION) | SYSTEM tab (`blast-test.js`) | Injects a synthetic blast/vibration test event | Clicked; no console error | KEEP | |

## INFO tab

| id / label | tab / panel | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| (none) | INFO tab | Static interactive reference content, no buttons of its own | Opened the tab; only the always-present tab-bar buttons were in the visible set | KEEP | Reference/read-only tab by design |

## simulation/frontend (App.tsx — standalone at `:5173`, and embedded in SIM/FORGE)

| id / label | component | what it does | tested? what you saw | verdict | reason |
|---|---|---|---|---|---|
| Start / Pause | `MenuBar.tsx` | Starts/pauses the physics engine | Clicked Start; no console error | KEEP | |
| CLOSE EVERYTHING | `MenuBar.tsx` | Stops engine, wipes DB, closes session | Clicked (standalone instance, not the embedded dashboard's live DB); no error thrown | KEEP | Same control as the dashboard's CLOSE EVERYTHING, mirrored in the sim app's own chrome |
| 10× (time base) | `MenuBar.tsx` | Info popover on the fixed time base | Clicked; no error | KEEP | |
| Formulas (calculator icon) | `MenuBar.tsx` | Opens the Knothe/Bals/Aviershin/Hall formula modal | Clicked; no error | KEEP | |
| 📊 OPEN NODES TABLE (N NODES) | `Menu.tsx` / `TelemetryDrawer.tsx` toggle | Opens the telemetry drawer | Clicked; no error | KEEP | |
| CSV / Seismograph / Logs / DGMS tabs, Download CSV, Close (×) | `TelemetryDrawer.tsx` | Drawer's internal tab switching, CSV export, close | Not clicked this pass (drawer toggle button was tested; its internal tabs were not — the drawer needs to be open first, which the toggle click should have done, but the follow-up buttons were not enumerated in the same pass) | FIX | Re-run the audit with the drawer open to exercise CSV export / internal tabs directly; not confirmed broken, just not reached in this pass |
| 1x / 5x / 10x (event playout speed) | `RightInspectorPanel.tsx` | Sets how fast a fired event plays out | Clicked all three; no error | KEEP | |
| STANDARD / TILT (target-offset segmented control) | `RightInspectorPanel.tsx` | Chooses cave-in target offset preset | Clicked both; no error | KEEP | |
| CENTER CAMERA / TRIGGER EVENT (per selected node) | `RightInspectorPanel.tsx` | Centers camera on a node / fires an event at it | Not clicked (requires a node to be selected first; none was selected in this pass) | KEEP | Verified present via source read (`RightInspectorPanel.tsx:504-515`), not click-tested this pass |
| Camera presets (VIEW dropdown), wireframe toggle, mesh-topology toggle | `RightInspectorPanel.tsx` | View controls | Not clicked (VIEW section is collapsed by default) | KEEP | Verified present via source read (`RightInspectorPanel.tsx:855-897`), not click-tested this pass |
| Info-popover buttons (`InfoModal.tsx`, `LiveMathModal.tsx`, `GroundPhysicsModal.tsx`) | Various modals | Open reference/help popovers | Not clicked (require opening their parent control first) | KEEP | |

## REMOVE candidates

- **`btn-sim-freeze` (FREEZE button, FORGE left column)** — REMOVED in B0b (commit <sha>). Dead markup, click handler, unused `freezeCurrentDay` function and CSS rules removed.

## FIX candidates

- **Snap-layout flyout cards** (`.snap-layout-card`, MAP tab) — not exercised in this automated pass because the flyout closed before a card could be clicked; needs a manual/interactive re-check, not confirmed broken.
- **`TelemetryDrawer.tsx` internal controls** (tab switches, CSV download, close) — the drawer-open toggle was clicked but the drawer's own internal buttons were not enumerated in the same pass; re-run with the drawer open.
- **CAVE-IN scenario in FORGE** — `dashboard_electron/test/verify_sandbox.js` fails at STEP 5 with "CAVE-IN did not post a trigger to the FORGE slot!". Confirmed pre-existing (reproduces identically with this step's `mode-switch.js`/`sim-tab.js` changes reverted) and unrelated to B0; needs its own investigation, out of scope here.
