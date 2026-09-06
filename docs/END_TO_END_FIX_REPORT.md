# End-to-end pass — bugs found and fixed

**Date:** 2026-09-06
**Branches:** `fix/launcher-and-3d-terrain-handoff` (root repo), `step-7-sim-site-geo-alignment` (nested `simulation/`)
**Commits:** root `e9fe5a1`, simulation `f1a9d1e`

I ran the whole stack headless (`start_all.sh --no-ui --no-chrome`), drove the
simulation over its WebSocket, watched the MQTT and backend-WS alarm streams,
and read every renderer module on the live paths. Two problems you named plus
three related ones were real. All are fixed and verified.

---

## 1. "Why is the time wrong (1970-01-01)?"

**Cause.** A finalized 60-second packet only carries `start_sim_time` /
`end_sim_time`. Those are **offsets in simulated seconds from the start of the
run** (e.g. `20520` after ~5.7 sim-hours), not Unix timestamps. The dashboard
did `new Date(packet.end_sim_time * 1000)` → 20520 s after the epoch →
`1970-01-01T05:42:00`, and "(496845h 27m ago)". The MQTT telemetry path had the
opposite problem: it carried `t_utc` (an ISO string) but never set `t_epoch_s`
at all, so charts on that path showed `NaN:NaN`. Both are visible in your
screenshot's strain/tilt chart x-axes.

**Fix.**
- Simulation (`simulation/sandbox/session.py`): every finalized packet is now
  stamped with `emitted_wall_s` (real epoch seconds at the moment it is
  finalized) and `end_sim_iso` (the in-world clock, for display).
- Dashboard (`live-provider.js`): the packet path uses `packet.emitted_wall_s`;
  the MQTT path stamps real arrival time (`Date.now()`). Both live paths now
  agree, and "LAST SEEN" shows the actual instant + a correct "Xs ago".

**Note that is *not* a bug:** the simulation clock legitimately races ahead of
real time (10× by default, more when you speed it up), so `readings.ts` in
Postgres is minutes-to-hours ahead of "now". That is expected. It does mean the
**History → 90-day replay**, if you set the "TO" date to today, finds nothing —
the fresh rows are timestamped in the sim's future. Widen the range or leave the
dates empty. (Left as-is; changing the replay's default window is a separate
UX decision.)

---

## 2. "The same node gives alarms again and again, and the map never zooms"

Three separate defects fed this.

### 2a. Zone state machine had no severity latch  *(root cause)*

`simulation/sandbox/segments.py` re-evaluated each zone's state every tick from
noisy truth criteria with no hysteresis. Near a threshold a zone flipped
`CRITICAL → FAILED → CRITICAL → FAILED …`, roughly one bounce per simulated
minute, and **every flip raised a fresh alarm**. Confirmed in your database:
`ALM-Z-22-FAILED` at 03:39:27 followed by `ALM-Z-22-CRITICAL` at 03:40:27.

**Fix.** Subsidence (Knothe) is monotonic on the sim's timescale, so a zone's
severity can only ever increase. A zone now never de-escalates on its own; only
a simulation rewind (`ZoneManager.reset()`) clears it. Escalation
(`TENSION → CRITICAL → FAILED`) still works, and gate T50 (must pass through
CRITICAL before FAILED) still holds — its tests pass.

### 2b. The dashboard raised a *second* alarm for every event

`applySimulationPacket()` re-derived alarms from `packet.events` with
`alarm_id = 'SIM-ALM-' + zone + '-' + packet_id`. Because `packet_id` changes
every 60 s, a zone sitting in one state produced a new, un-dedupable alarm every
minute — on top of the proper alarm the simulation already publishes on the
MQTT `mine/<panel>/alarm` topic (deduped on `zone + state`, carrying a
centroid). Two alarm streams, different id schemes, both shown.

**Fix.** Removed the packet-path alarm derivation entirely. The MQTT alarm (and
its persisted backend copy) is the single source.

### 2c. The backend-WS alarm frame lost its id

The backend broadcasts `{ type:'alarm', alarm:{…} }`. The renderer emitted the
**wrapper**, so `alarm.alarm_id` was `undefined`, the history panel's dedup
never matched, and every frame counted as new. Now emits `msg.alarm`.

### 2d. The map never zoomed

`zoom-to-alarm.js` only reacted to `level >= 3` (FAILED). You carved a collapse
and nodes reached CRITICAL (level 2); the map stayed put. Now zooms on
`level >= 2`. (Every alarm the sim publishes carries a `centroid`, so the zoom
target is always available.)

### 2e. Settled nodes visibly "went red again"

`nodeMarkers.updateState()` redrew the marker icon and re-ran the alarm hooks on
**every** packet, even when the node's state was unchanged — the live provider
re-asserts all 31 node states every 60 s. Now a no-op when the state has not
changed.

---

## 3. Also fixed while sweeping the system

- **Every packet was processed twice.** `mode-switch.js` calls
  `liveProvider.start()` twice (once on init, once when it settles on LIVE
  mode). The second call re-registered the Electron IPC handlers, so every
  telemetry and alarm frame fired its event twice — the `.electron.log` shows
  "Applying simulation packet #… [twice]" for every id. `start()` is now
  idempotent.
- **Stale packet-pipeline tests.** `simulation/tests/test_packet_pipeline.py`
  asserted `packet_id == 1` / `== 2`; `packet_id` is seeded from epoch-ms now
  (so runs don't collide in Postgres). Updated to assert on the ids each run
  actually produces. Full sim suite: **76 passed, 0 failed**.

---

## Verification performed

| Check | Result |
|---|---|
| `scripts/verify_data_loop.js` (sim → Postgres → dashboard, both WS-notify and HTTP-fetch paths) | **PASS**, exit 0 |
| Fresh packet carries `emitted_wall_s` / `end_sim_iso` | `emitted_wall_s` = real wall time; renders as current time, not 1970 |
| Live end-to-end: drive sim to collapse, 90 s, watch MQTT + backend WS | **22 alarms, 22 distinct ids, zero repeats, zero de-escalations, every alarm has a centroid** |
| Severity-latch unit test (`ZoneManager`) | Latch holds FAILED through relaxing input; escalation TENSION→CRITICAL still fires |
| `simulation/tests/` full suite | 76 passed |
| `node --check` on all modified renderer files | clean |

---

## Not exercised

- The **Electron operator window itself** (needs a display + WebGL). The
  renderer modules were read and the data they consume was verified over the
  wire, but I did not click through the live UI.
- The **3D terrain sub-window** (`terrain-3d-window.js`, `real-terrain-3d.js`) —
  same reason. Its launch hook is visible and wired in your screenshot.

If you run the full stack with the Electron window, the two things to eyeball:
"LAST SEEN" on a node detail panel should read the current time, and carving a
collapse should raise **one** alarm per zone per state (not a stream) and pan
the map to it.

---

## Files changed

**Root repo (`e9fe5a1`)**
- `dashboard_electron/renderer/js/data/live-provider.js`
- `dashboard_electron/renderer/js/map/node-markers.js`
- `dashboard_electron/renderer/js/map/zoom-to-alarm.js`

**Nested `simulation/` repo (`f1a9d1e`)**
- `sandbox/session.py` — `emitted_wall_s` / `end_sim_iso` on packets
- `sandbox/segments.py` — zone severity latch
- `sandbox/packet.py` — epoch-ms `packet_id` seed (was already uncommitted)
- `tests/test_packet_pipeline.py` — assert on real packet ids
