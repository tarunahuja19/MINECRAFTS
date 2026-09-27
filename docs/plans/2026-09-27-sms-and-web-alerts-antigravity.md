# SMS + web (browser) alarm notifications — for Antigravity

Branch: `feat/sms-and-web-alerts` (cut from `heatmaps-and-alert-system-import`).
Claude wrote this plan and will review the diff; Antigravity implements it.

## Why these two steps are split the way they are

Today the alarm "dispatch" UI is 100% cosmetic:
- `dashboard_electron/renderer/js/alarm/dispatch-status.js:6` hardcodes a
  `TIER 2 — SMS TO SAFETY OFFICER` row whose FIRED/PENDING label is just a
  function of `alarm.level` — no SMS is ever sent.
- `dashboard_electron/renderer/js/alerts/sms-contacts.js` and
  `dashboard_electron/renderer/js/alerts/tier-config.js` render hardcoded
  contacts/tiers with no backend behind them.

Every alarm already flows through one real choke point on each side:
- **Backend**: `POST /api/alarms` (`backend/routes/alarms.js:76`) upserts the
  alarm and calls `broadcastFn` to push it over the WebSocket
  (`backend/routes/alarms.js:126-128`).
- **Frontend**: every alarm — from Electron IPC (`window.r4.onAlarm`,
  `dashboard_electron/renderer/js/data/live-provider.js:50-53`) or from the
  backend WebSocket (`live-provider.js:153-157`) — ends up as
  `bus.emit('alarm', alarmObj)`.

ALERT-1 hooks the backend choke point to send a real SMS (Twilio). ALERT-2
hooks the frontend choke point to show a real OS/browser notification. They
are independent: different languages, different files, no shared import.
Do them in either order, or in parallel.

**Your friend hosting the renderer on the web matters for ALERT-2 only.**
`dashboard_electron/main.js:85-86` already runs the renderer with
`contextIsolation: true, nodeIntegration: false` — i.e. it's a normal
sandboxed webpage today, not a Node context. That means the standard
`Notification` browser API works identically inside Electron and in a plain
browser tab. No Electron-specific code, no preload/IPC changes.

---

## STEP: ALERT-1 — real SMS on Tier-2+ alarms (backend)

1. `backend/package.json` — add `"twilio": "^5"` to `dependencies`. Run
   `npm install` inside `backend/`.

2. New file `backend/notifications/sms.js`:
   - Reads `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`,
     `ALERT_SMS_TO` (comma-separated E.164 numbers) from `process.env`.
   - Exports `sendAlarmSms(alarm)`:
     - If any of the four env vars is missing: log once
       (`[notifications:sms] Twilio not configured, skipping`) and return.
       No throw — a box with no Twilio account must still run the full
       stack untouched (same fallback shape as other optional-integration
       code in this repo).
     - If `alarm.level < 2`: no-op (matches the Tier-2 threshold
       `dispatch-status.js` already renders).
     - Dedup with an in-memory `Map<alarm_id, lastNotifiedLevel>`: only call
       Twilio when this `alarm_id` is new or its level increased since the
       last call. `POST /api/alarms` is upsert-on-conflict
       (`backend/routes/alarms.js:91` `ON CONFLICT ... DO UPDATE`), so the
       same alarm can hit this route many times as it evolves — without
       this check the same phone gets one text per tick.
     - Build the message from `alarm.zone_id`, `alarm.level`,
       `alarm.max_strain_ue`, `alarm.explanation`; call the Twilio REST
       client once per number in `ALERT_SMS_TO`.
     - Catch and log Twilio errors per-number so one bad number doesn't
       stop the others.

3. `backend/routes/alarms.js` — the only edit to an existing backend file,
   purely additive:
   - Near the top (by the other `require`s, ~line 7): add
     `const sms = require('../notifications/sms');`
   - Right after the existing broadcast call (~line 126-128,
     `if (typeof broadcastFn === 'function') { broadcastFn({...}); }`), add:
     ```js
     sms.sendAlarmSms(alarm);
     ```

4. `backend/.env.example` — append:
   ```
   # SMS alerts (Tier 2+) — leave blank to disable, no code changes needed
   TWILIO_ACCOUNT_SID=
   TWILIO_AUTH_TOKEN=
   TWILIO_FROM_NUMBER=
   ALERT_SMS_TO=
   ```
   Real values go in the untracked `backend/.env` only — `.gitignore`
   already excludes `.env` / `*.env` (keeps `.env.example`). Never commit
   real Twilio credentials or phone numbers.

5. New file `backend/notifications/sms.manual-test.js` — backend has no
   test runner configured, so follow the plain-script convention already
   used in `dashboard_electron/test/verify_*.js`: a standalone script that
   builds a fake level-3 alarm object and calls `sendAlarmSms` twice with
   the same `alarm_id`, to prove the dedup path sends at most once.

**Test**: `node backend/notifications/sms.manual-test.js`
- With no Twilio env vars set: expect exactly one "not configured,
  skipping" line, no thrown error.
- With real Twilio trial creds and your own verified number in
  `ALERT_SMS_TO`: expect exactly one SMS to arrive despite two calls for
  the same `alarm_id`.

**Live check (report the output)**:
```
cd backend && npm install && npm start
```
In another terminal:
```
curl -X POST http://localhost:8080/api/alarms \
  -H "Content-Type: application/json" \
  -d '{"alarm_id":"test-1","level":3,"zone_id":"Z1","explanation":"test"}'
```
Expect the server log to show either an SMS-sent confirmation or the
"not configured, skipping" line, and the existing dashboard alarm banner to
still fire exactly as it does today (no regression in the broadcast path).

---

## STEP: ALERT-2 — real browser/OS notification on Tier-2+ alarms (frontend)

1. New file `dashboard_electron/renderer/js/alerts/browser-notify.js`:
   - `init()`: if `window.Notification` doesn't exist, no-op. Otherwise call
     `Notification.requestPermission()` once, non-blocking.
   - `bus.on('alarm', function (alarm) { ... })`.
   - Same Tier-2 threshold as ALERT-1 (`alarm.level >= 2`) and the same
     `Map<alarm_id, lastNotifiedLevel>` dedup shape — keep it a separate,
     independent copy in this file (no shared import with the backend;
     frontend and backend don't share a require graph here), just the same
     reasoning so the two are easy to hold in your head together.
   - When `Notification.permission === 'granted'`, show:
     ```js
     new Notification('Alarm — Zone ' + alarm.zone_id, {
       body: alarm.explanation || ('Level ' + alarm.level),
       tag: alarm.alarm_id
     });
     ```
     The `tag` makes the OS replace, not stack, a re-fired notification for
     the same `alarm_id`.
   - On the notification's `click` handler: focus the window
     (`window.focus()`) and `bus.emit('alarm-selected', alarm)` — this is
     the existing event that already opens the alarm detail panel; it's
     what `alarm-banner.js:54`, `node-markers.js:300` and
     `alarm-history.js:328` all emit today, and `alarm-detail.js:14`,
     `zoom-to-alarm.js:9` and `trough-overlay.js:22` already listen for.
     Reuse it — don't re-derive tab-switching logic.

2. `dashboard_electron/renderer/index.html` — add exactly one line:
   ```html
   <script src="js/alerts/browser-notify.js"></script>
   ```
   Append it immediately **after** the existing `js/alerts/blast-test.js`
   line (~line 1873) — after the block, not inside it, so the diff is a
   clean single-line addition.

3. `dashboard_electron/renderer/js/app.js` — add exactly one line:
   ```js
   browserNotify.init();
   ```
   next to the other "Phase 3B — Alarm system modules" inits, right after
   `alarmDetail.init();` (~line 58). Append, don't reorder the existing
   inits around it.

Do **not** touch `tier-config.js` or `sms-contacts.js` — they're cosmetic
status/config panels for a different screen. Wiring them to real state is a
separate follow-up, not required for the notification path to work.

**Test**: no test harness exists for this plain-script frontend. Add
`dashboard_electron/test/verify_browser_notify.md` — a short checklist
(matching the existing `verify_*` naming in that folder): open the app,
grant the notification permission prompt, trigger a level ≥2 alarm (the
existing blast-test button, or the `curl` from ALERT-1), confirm exactly
one OS notification appears, confirm re-firing the same `alarm_id` does not
stack a second notification, confirm clicking it opens the alarm detail
panel.

**Live check (report the output)**:
```
npm start
```
(launches the Electron app, per this repo's usual convention). Trigger a
level-3 alarm and confirm: (a) a native OS notification appears, (b) the
existing in-app alarm banner still fires unchanged, (c) repeating the same
`alarm_id` does not stack a second notification, (d) clicking the
notification opens the alarm detail panel.

Then — since this is the path your friend's web hosting exercises — open
the same `dashboard_electron/renderer/index.html` in a plain desktop
browser tab pointed at the same backend, and repeat the same four checks
outside Electron.

---

## Merge note

- ALERT-1 touches one existing file (`backend/routes/alarms.js`, 2
  additive lines) plus 3 new files, all under a new `backend/notifications/`
  directory.
- ALERT-2 touches two existing files (`index.html`, `app.js` — one
  additive, appended line each) plus 2 new files under the existing
  `dashboard_electron/renderer/js/alerts/` and `dashboard_electron/test/`
  directories.
- Neither step touches `dashboard_electron/renderer/js/map/**`,
  any `heatmap*` file, or any 3D/terrain file — the areas
  `feat/heatmap-toolbar-ui` is actively changing — so both steps should
  apply or rebase cleanly regardless of which branch merges first.
- If `index.html` or `app.js` have moved on by the time this merges, the
  two new lines are self-contained appends near an existing, clearly
  labeled block (`js/alerts/...` scripts, "Phase 3B — Alarm system
  modules") — reapply them next to that block rather than resolving a line
  conflict blindly.
