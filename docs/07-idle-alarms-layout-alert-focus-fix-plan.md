# Fix idle alarms, node layout, alert focus, and session teardown

## Context

Six problems in the mine-subsidence demo, all traced to concrete code:

1. **Nodes go red with no user action.** The simulation's physics treats 4000/5300 µε as tension/critical (`simulation/sandbox/constants.py:41`), but the Electron dashboard independently classifies at **600/400 µε** in *two* places — [node-markers.js:379-382](dashboard_electron/renderer/js/map/node-markers.js#L379-L382) and [live-provider.js:255-258](dashboard_electron/renderer/js/data/live-provider.js#L255-L258). Baseline Knothe settling (`C_KNOTHE = 0.04/day`) crosses 600 µε within a short window with zero operator input, so the map paints nodes red. Commit `55192e7` gated the *Python* alarm producers but left both browser ladders untouched. Worse, [node-markers.js:449-475](dashboard_electron/renderer/js/map/node-markers.js#L449-L475) then **manufactures alarm objects and POSTs them to `/api/alarms`**, so the phantom red nodes write real rows into Postgres.

   A second bug compounds it: `live-provider.js:255` compares raw `tilt_x_urad` (microradians) against a threshold meant for millidegrees — `node-markers.js:373` divides by 17.4533 first, live-provider does not. That test is ~57× too sensitive.

2. **The 1.2× carve radius rule is the intended source of truth** and already exists at [session.py:296-317](simulation/sandbox/session.py#L296-L317), but its `is_onset_window` gate is dead code: `cycle_sec = t_sim_seconds % 60.0` with a 60 s tick is always `0.0`, so the condition never excludes anything. And the rule only sets `crack_flags`/`strain_ue` — it never publishes an explicit per-node state, which is why the UI felt free to invent its own.

3. **Postgres is not reliably clean at startup.** `scripts/start_all.js:163-166` truncates, but `scripts/start_all.sh` does not, and the same TRUNCATE is copy-pasted in **five** places across three languages.

4. **Node layout is visually crowded.** [layout.py:274-295](simulation/sandbox/layout.py#L274-L295): the 1C fault transect passes straight through the 1A 3×3 grid (`(-45,-24)` and `(45,24)` sit inside the grid's footprint), and the 1B ribs are dead-straight columns at `x=±204`. Coordinates are hand-duplicated in three files.

5. **No concentric-circle alert or camera focus on the 2D map.** `lastgasp-marker.js:56` sets `className: 'lastgasp-pulse'` but **that CSS rule was never written** — the ring is static. `zoom-to-alarm.js:30-53` pans with `setView`/`fitBounds` and no `{animate:true}`, so it jump-cuts.

6. **Wrong button.** Two "RESET DATABASE" buttons exist (`index.html:37`, `index.html:489`); the user wants a single "CLOSE EVERYTHING" that stops the sim, wipes the DB, and quits.

**Outcome:** nothing turns red until you carve; carving reliably reddens exactly the nodes inside 1.2× the radius with an animated ring and camera focus; every launch starts clean; one button ends the session.

---

## Decisions taken

- **Server decides node state, UI obeys.** Both dashboard threshold ladders are deleted.
- **Concentric rings + camera focus: Electron 2D map only.** The sim 3D view keeps its existing static `TargetBeacon` ring.
- **CLOSE EVERYTHING = stop sim + wipe DB + quit Electron.** Background services (broker, backend, uvicorn, vite) stay up so a relaunch is fast.
- **Layout keeps its geological meaning**, spacing is fixed.

---

## Step 1 — Server becomes the single source of node state

**`simulation/sandbox/session.py`** (rewrite the block at lines 280-317):

- Delete the `cycle_sec` / `is_onset_window` gate entirely — it is a no-op and it made the effect flicker conceptually. A carve should redden its nodes and hold them.
- Compute one authoritative state per node each tick and store it on the reading:

```
no active collapse      -> every node: state = "ACTIVE", crack_flags = 0, crack_latched = 0
active collapse at C,R  -> dist <= 1.20*R -> "CRITICAL", crack_flags |= 1, strain_ue = max(curr, 6500)
                           dist <= 1.60*R -> "WARNING",  strain_ue = max(curr, 4200)
                           else           -> "ACTIVE",   crack_flags = 0, crack_latched = 0
```

Reuse the existing `math.hypot(n.x_m - pf.cx, n.y_m - pf.cy)` distance test and `_node_topic_id()` at `session.py:301-302`. When several collapses overlap, a node takes its **most severe** state.

- The 1.6× WARNING band is new — it gives the ground-falling gradient the user described (red core, amber fringe) instead of a hard binary edge.

**`simulation/sandbox/packet.py`** — carry the state outward. In `standard_aggregates` (around line 122), add `"node_state": <the state string>` so the 60 s packet the Electron dashboard consumes has it. The per-reading MQTT telemetry frame must carry the same field.

**`simulation/sandbox/mqtt_bridge.py`** — `publish_node_alarms()` (line 327) and `publish_zone_alarms()` (line 244) already early-return `[]` when `not active_collapses`; keep that. Change the severity decision at lines 376-387 to read the state the session assigned rather than re-deriving from thresholds, so there is exactly one ladder in the whole system.

---

## Step 2 — Dashboard stops inventing state and stops inventing alarms

**`dashboard_electron/renderer/js/data/live-provider.js`** (lines 252-260): delete the `600/400` block. Set `status` from `n.aggregates.node_state` (lowercased), defaulting to `'active'` when absent. This also kills the µrad-vs-mdeg unit bug at line 255.

**`dashboard_electron/renderer/js/map/node-markers.js`**:
- Lines 377-385: replace the threshold ladder with `updateState(nodeId, t.state || 'active')`. Keep the `flags & 1` lastgasp check — a genuine last-gasp packet is a real device event, not a threshold.
- **Lines 436-475: delete the entire client-side alarm synthesis block.** The renderer must never POST to `/api/alarms`. Keep the `activeAlarmsByNode` bookkeeping only if something else reads it; otherwise remove it too.
- Lines 129-156 (`findAlarmForNode`): remove the `bus.emit('alarm', ...)` side-effect hidden inside what reads as a getter — it is the second synthesis path.
- Keep the no-op guard at line 428 (it is what stopped the redraw storm).

**`dashboard_electron/renderer/js/map/real-terrain-3d.js`** (lines 590-595) and **`node-markers.js`** (lines 11-17): unify to one palette so the 2D and 3D panes stop disagreeing. Use the 2D values as canonical.

---

## Step 3 — Concentric alert rings + animated camera focus (Electron 2D only)

**`dashboard_electron/renderer/css/hmi.css`** — write the missing rule. Three staggered expanding rings:

```css
@keyframes alertRing {
  0%   { transform: scale(0.4); opacity: 0.95; }
  70%  { transform: scale(2.4); opacity: 0.25; }
  100% { transform: scale(3.2); opacity: 0; }
}
```
Apply to `.alert-ring` with `animation-delay` of `0s / 0.6s / 1.2s` on the three children so they read as a sonar ping. Also remove the duplicate `@keyframes blink` (defined twice, `hmi.css:620` and `:997`).

**`dashboard_electron/renderer/js/map/lastgasp-marker.js`** — generalise it into the critical-alert ring. It already builds a Leaflet `circleMarker` at `nd.lat, nd.lng` (line 49). Replace that with an `L.divIcon`-based marker holding three nested `<div class="alert-ring">` elements so CSS can animate them (a `circleMarker` is an SVG path and cannot carry the keyframe cleanly). Add the ring when a node enters `critical`/`lastgasp`, remove it when it leaves.

**`dashboard_electron/renderer/js/map/zoom-to-alarm.js`** — make the pan smooth. Lines 30-53: add `{ animate: true, duration: 1.2 }` to both `setView` and `fitBounds`. Keep the existing 12 s `AUTO_ZOOM_COOLDOWN_MS` and the `isMajorRegional` filter (lines 15-27) so the view does not thrash when a carve reddens six nodes at once.

---

## Step 4 — Spread the node layout

**`simulation/sandbox/layout.py`** `_build()` (lines 274-295). Keep all six tiers and their geological roles; fix the crowding:

- **1C fault transect** currently intersects the 1A grid at `(-45,-24)` / `(45,24)`. Shift the whole transect off the grid centre (keep the 28° bearing, offset it perpendicular by ~90 m) so it reads as a distinct lineament.
- **1B ribs**: stagger the two columns in x by ±12 m alternating, so they read as instrumented ribs rather than a printed column.
- **1A grid**: widen from ±75 m to ±95 m spacing and apply a small deterministic per-node offset (derived from node id, not `random`) so it stays reproducible but does not look machine-stamped.
- Keep 2A/2B/gateway as-is — they are already well separated.
- **Delete the ~150 lines of dead Poisson-disc code** (`_poisson_disc`, `_sample_*`, `_rng`, `_SEED`, `_scout_budget`, `_max_anchors_for_site`) and correct the module docstring, which still describes an algorithm `_build()` no longer calls.

**Propagate to the two hand-synced copies** (this is the step that is easy to forget):
- `simulation/frontend/src/components/NodeMarkers.tsx:51-83` — `FALLBACK_NODES`
- `dashboard_electron/fixtures/nodes.json`

Rather than retyping them, add **`scripts/dump_layout.js`** (or a small Python equivalent) that reads `layout.py` via the running sim's `GET /config` and rewrites both files. This removes the "sync enforced by a code comment" hazard permanently.

`simulation/sandbox/db.py:245-249` already deletes any node not in the canonical 31, so Postgres self-heals on next sync.

---

## Step 5 — Guaranteed-clean Postgres on every launch

Consolidate the five duplicated TRUNCATEs onto the one HTTP endpoint that already exists, `POST /api/system/reset` ([backend/server.js:130-165](backend/server.js#L130-L165)).

- **`scripts/start_all.sh`**: add the same auto-reset `start_all.js:163-166` performs, so the two launchers finally behave identically.
- **`scripts/start_all.js:159-171`**: keep the reset but make a DB failure **fatal** rather than a `warn`. A silent failure here is exactly how stale alarms survive into a demo.
- **`simulation/sandbox/db.py:507-530`**: `reset_database()` truncates locally *and* calls `/api/system/reset`, double-truncating. Drop the local SQL, keep the HTTP call.
- **`backend/db/migrate.js:52-55`**: `--reset` drops only `readings`/`nodes`, not `alarms`/`simulation_packets`. Make it consistent.

---

## Step 6 — Replace RESET DATABASE with CLOSE EVERYTHING

**`dashboard_electron/renderer/index.html`**: delete `#btn-db-reset` (line 37) and `#btn-db-reset-system` (line 489). Add `#btn-close-all` "CLOSE EVERYTHING" in the header slot line 37 vacated, same red styling.

**`dashboard_electron/renderer/js/app.js`** — replace the handler at lines 145-194:
1. `window.confirm` gate (keep it — this is destructive).
2. `POST http://localhost:8080/api/simulation/control {action:"stop"}` — or the sim's `/control` directly; `simulation/sandbox/server.py:415-420` handles `stop`.
3. `POST /api/system/reset` (existing, unchanged).
4. Emit `system-reset`, `alarms-loaded: []`, `simulation-status: STOPPED` as it does today.
5. `window.r4.closeApp()` — new IPC.

Replace the hardcoded `http://localhost:8080` at `app.js:162` with the same `window.location.hostname` pattern the sim UI already uses.

**`dashboard_electron/preload.js`**: add `closeApp: () => ipcRenderer.invoke('app:close')` alongside the existing bridges at lines 10-14.

**`dashboard_electron/main/`**: register `ipcMain.handle('app:close', () => app.quit())` next to the existing handlers in `history-api.js:15-16` (or the main entry, whichever owns app lifecycle).

**`simulation/frontend/src/components/MenuBar.tsx:129-132`** — the sim UI's "Reset" button becomes **CLOSE EVERYTHING** as well, so both windows offer the same single end-of-session action.

Rename the button label and repoint `onFullMasterReset` → `onCloseEverything`. Extend `handleFullMasterReset` ([App.tsx:416-443](simulation/frontend/src/App.tsx#L416-L443)) — it already clears every piece of React state (`isRunning`, `tSim`, `tDays`, perturbations, logs, selection, `nodeTelemetry`, `zoneTelemetry`, `tickCount`, `vibration`, `latestPacket`, `packetCount`), calls `globalGeomechanics.reset()`, sends WS `{action:"reset"}`, and POSTs `/api/system/reset`. Add to it:

1. Send WS `{action:"stop"}` **before** the reset, so the engine halts rather than restarting clean.
2. `await` the `/api/system/reset` POST instead of the current fire-and-forget `.catch(() => {})` at line 441 — otherwise the window can close before the truncate lands.
3. Then `window.close()`.

Caveat: `window.close()` is a no-op on a tab the user opened by hand (browsers only allow it for script-opened windows). `scripts/start_all.js:247-252` opens the sim UI via `open http://127.0.0.1:5173/`, so this will usually be a normal tab. Fall back to rendering a full-screen "SESSION CLOSED — safe to close this tab" overlay when `window.close()` does not take effect, so the UI is unambiguously dead either way. The Electron side has no such limit — `app.quit()` genuinely quits.

Both buttons keep a confirm gate.

---

## Step 7 — Additional bugs found, fixed along the way

| Bug | Location | Fix |
|---|---|---|
| Tilt compared in µrad against a mdeg threshold (~57× too sensitive) | `live-provider.js:255` | Resolved by Step 2 (block deleted) |
| `max_strain` uses `MAX_MAGNITUDE`, so a large *compressive* (negative) strain aggregates to a big positive and trips `>` | `packet.py:101,123` | Compare on signed tensile value, or document the intent |
| `@keyframes blink` defined twice | `hmi.css:620` and `:997` | Delete one |
| `TENSION`/`CRITICAL` declared but never assigned — unreachable states | `NodeMarkers.tsx:345-350` | Assign from server state now that Step 1 publishes it |
| Postgres password `labpass123` hardcoded in 6 files | `db.js:11`, `migrate.js:18,46`, `seed.js:40`, `db.py:52`, `reset_demo_state.sh:23` | Read from env with one shared default |
| `config/nodes.json` is a stale 4th layout copy in a different coordinate frame | `config/nodes.json` | Delete |
| Three divergent color palettes for the same five states | `node-markers.js:11`, `real-terrain-3d.js:590`, `NodeMarkers.tsx:27` | Unified in Step 2 |

---

## Verification

Run `npm start` and confirm, in order:

1. **Clean boot** — Alarms tab empty, node count `31/31 ACTIVE`, no red markers.
   `psql -d mine_subsidence -c "select count(*) from alarms"` → `0`.
2. **Idle hold (the headline fix)** — let the sim run **5 full minutes with zero interaction**. Every node must stay green; the alarm badge must stay at 0; `select count(*) from alarms` must still be `0`. This is the test that fails today.
3. **Carve** — click a point in the sim 3D view, trigger a collapse with radius R. Verify:
   - exactly the nodes within `1.2*R` turn red, and the `1.2*R`–`1.6*R` band turns amber;
   - cross-check against `TargetBeacon`'s drawn 1.2× ring — the red set must match the ring;
   - the Electron 2D map shows expanding concentric rings on the red nodes;
   - the 2D map smoothly pans to the alert (not a jump-cut);
   - `select count(*) from alarms` is now non-zero and every row's `affected_nodes` is a subset of the red set.
4. **Layout** — visually inspect both the 3D sim view and the 2D map: no two markers overlap, the 1C fault line is clearly separate from the 1A grid, and the node count is 31 in both. Confirm `layout.py`, `NodeMarkers.tsx` `FALLBACK_NODES`, and `fixtures/nodes.json` agree (the dump script should make this a no-op diff).
5. **Close Everything — Electron** — click it: confirm dialog appears, sim reports STOPPED, all three tables are empty, the Electron window quits.
6. **Close Everything — sim web UI** — relaunch, then click it there instead: confirm the engine stops, all three tables are empty, and the tab either closes or shows the "SESSION CLOSED" overlay. Verify the truncate completed *before* the close (check the tables after).
7. Re-run `npm start` after each and confirm step 1 passes again — a clean board every time.
8. Run the existing suites: `npm run verify` and `npm run stress:full`.
