# Plan: SMS contacts manager (dashboard-managed numbers, manual + automatic send)

**Branch:** build on top of `integrate/heatmap-chrome-render-and-alerts` (or wherever that lands — see the prior handoff doc's open item #2 about target branch).
**Written by:** Claude, 2026-09-28, planning only — no code changes in this doc. For Antigravity to implement.

## The ask

Right now Tier-2+ alarms text exactly one phone number, because `ALERT_SMS_TO` is a single env var requiring a server restart to change. The user wants a dashboard feature to:

1. Save a list of phone numbers from the UI (no `.env` editing, no restart).
2. For each number, support both **automatic** sends (system texts it on every Tier-2+ alarm, same as today) and **manual** sends (operator picks a number/numbers and fires an SMS on demand, e.g. to check the line works or push an ad-hoc message).

## Current state (verified by reading the code, not assumed)

- **Backend SMS already supports multiple numbers**, just not dynamically: [backend/notifications/sms.js](backend/notifications/sms.js) reads `ALERT_SMS_TO` as a comma-separated list and loops over it. The gap isn't multi-number support, it's that the list lives in a static env var instead of the database.
- **There is already an "Alerts" panel in the dashboard that looks like this feature — but it's 100% fixture UI wired to nothing real:**
  - [dashboard_electron/renderer/js/alerts/sms-contacts.js](dashboard_electron/renderer/js/alerts/sms-contacts.js) — hardcoded array of 2 fake contacts (`MINE FOREMAN`, `SAFETY OFFICER` with `XXXXX` redacted numbers), read-only table, no add/remove, no backend calls.
  - [dashboard_electron/renderer/js/alerts/tier-config.js](dashboard_electron/renderer/js/alerts/tier-config.js) — hardcoded fake hardware strings (`SIM800L — 2 contacts configured`). Cosmetic only.
  - [dashboard_electron/renderer/js/alerts/dispatch-log.js](dashboard_electron/renderer/js/alerts/dispatch-log.js) — listens for a `bus.emit('dispatch-event', ...)` that nothing real ever emits; only `blast-test.js`'s fake button and a canned `fixtureEvents` array populate it.
  - [dashboard_electron/renderer/js/alerts/blast-test.js](dashboard_electron/renderer/js/alerts/blast-test.js) — "TEST — BLAST INJECTION" button that does a `setTimeout` and always reports `SUPPRESSED (test mode)`. Doesn't call any API.
  - These four mount into `#tier-config-container`, `#sms-contacts-container`, `#dispatch-log-container`, `#blast-test-container` in [dashboard_electron/renderer/index.html:1099-1114](dashboard_electron/renderer/index.html#L1099-L1114).
- **No auth anywhere in the backend** (`grep` for auth/jwt/apiKey across `backend/` turned up nothing). Every route including `/api/alarms` is open to anyone who can reach the port. This matters for the new manual-send endpoint — see Security note below.
- Postgres is already live and migrated via [backend/db/migrate.js](backend/db/migrate.js) + [backend/db/schema.sql](backend/db/schema.sql), so a new table is the natural place for the contact list, not a JSON file.

## Proposed design

### 1. Database — new table

Add to `backend/db/schema.sql` (append, following the existing `CREATE TABLE IF NOT EXISTS` + comment style already used for `nodes`/`alarms`):

```sql
CREATE TABLE IF NOT EXISTS sms_contacts (
    contact_id   SERIAL PRIMARY KEY,
    name         VARCHAR(128) NOT NULL,
    phone        VARCHAR(32) NOT NULL UNIQUE,   -- E.164, e.g. +919812345678
    auto_alert   BOOLEAN NOT NULL DEFAULT true, -- gets Tier-2+ alarms automatically
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

One-time seed on migrate: if the table is empty and `ALERT_SMS_TO` is set in `.env`, insert those numbers as the initial rows (`auto_alert = true`, name = `LEGACY-<n>`), so nobody's existing working number silently stops getting alerts the day this ships. Do this in `migrate.js`, not `schema.sql` (schema files shouldn't read `process.env`).

### 2. Backend API — `backend/routes/sms-contacts.js` (new file, mounted at `/api/sms-contacts`)

Follow the existing route-file shape (`nodes.js`, `alarms.js`: plain Express router, `query()` from `db/db`, no framework beyond that).

- `GET /api/sms-contacts` — list all contacts.
- `POST /api/sms-contacts` — `{ name, phone }` → insert, `auto_alert` defaults true. Validate `phone` looks like E.164 (`/^\+[1-9]\d{6,14}$/`) before hitting the DB or Twilio — reject with 400 otherwise, since a malformed number is a wasted/failed Twilio call at send time.
- `PATCH /api/sms-contacts/:id` — `{ name?, phone?, auto_alert? }` → partial update. This is how the UI toggles a contact between "gets automatic alerts" and "manual only."
- `DELETE /api/sms-contacts/:id` — remove.
- `POST /api/sms-contacts/send` — **the manual-send feature.** Body: `{ contact_ids: [...], message: "..." }` (or `phones: [...]` for numbers not saved as contacts — support either so an operator can text an unsaved number without adding it first). Looks up phones for any `contact_ids`, merges with any raw `phones`, sends via the same Twilio client pattern as `sms.js`, and broadcasts a `dispatch-event`-shaped WS message per send so the (currently fake) dispatch log becomes real. Reuse Twilio client construction logic from `sms.js` rather than duplicating it — see refactor note below.

### 3. Backend — `backend/notifications/sms.js` changes

`sendAlarmSms` currently sources recipients from `process.env.ALERT_SMS_TO`. Change it to query `SELECT phone FROM sms_contacts WHERE auto_alert = true`. Keep `ALERT_SMS_TO` as an additional fallback source only if the table is unreachable/empty (defense in depth for the "DB down but alarms still firing" case) — union the two lists, dedupe.

Pull the Twilio-client-construction + "check config present" block out into a small shared helper (e.g. `getTwilioClient()` in `sms.js`, exported) so `sms-contacts.js`'s manual-send route calls the same function instead of re-implementing credential checks. Today that logic is inlined in `sendAlarmSms` (lines 21-37, 69-76 of `sms.js`) — it needs to be callable from two places now.

Also broadcast a WS event on every automatic send/failure (`{ type: 'sms_dispatch', contact, outcome, alarm_id }`) via the same `broadcastFn` pattern `alarms.js` already uses, so the dispatch log reflects real Tier-2+ sends too, not just manual ones.

### 4. Frontend — replace the fixture panels with real ones

- **`sms-contacts.js`**: fetch `GET /api/sms-contacts` on init and on a manual refresh; render name/phone/auto-alert-toggle/delete-button per row; an "add contact" form (name + phone input) that `POST`s and re-renders. Toggling the switch does `PATCH .../:id { auto_alert }`.
- **New manual-send UI** (extend `sms-contacts.js` or a new `send-sms.js` in the same folder — Antigravity's call): checkboxes next to each contact + a message textarea + "Send" button → `POST /api/sms-contacts/send`. Show per-number success/failure inline from the response.
- **`dispatch-log.js`**: subscribe to the real WS `sms_dispatch` message type (check how `app.js` currently routes incoming WS frames into `bus.emit(...)` — likely near where `type: 'alarm'` is handled, per `routes/alarms.js`'s `broadcastFn` usage) in addition to keeping the local `bus.emit('dispatch-event', ...)` path for the manual-send response.
- **`tier-config.js`**: low priority — update the Tier-2 row's `detail` string to show the real contact count (`SELECT count(*) FROM sms_contacts WHERE auto_alert = true`) instead of the hardcoded "2 contacts configured." Cosmetic; do last if time-boxed.
- **`blast-test.js`**: out of scope for this feature — it's a simulated blast-injection test, unrelated to SMS contacts, leave as-is unless the user asks for it separately.

## Security note (flagging, not blocking)

`/api/sms-contacts/send` triggers real Twilio spend and, since nothing in this backend is authenticated, is reachable by anyone who can hit the port. That's already true of `/api/alarms` today so this isn't a new class of exposure, but a send-arbitrary-SMS-to-arbitrary-number endpoint is a more attractive abuse target than the existing alarm-triggered one. Minimum recommendation: rate-limit this specific route (e.g. N sends/minute) even before any broader auth story exists. Flagging for Antigravity/the user to decide how much to invest here given this is apparently a local/LAN dashboard.

## Files to touch

- `backend/db/schema.sql` — add `sms_contacts` table.
- `backend/db/migrate.js` — seed from `ALERT_SMS_TO` if table empty.
- `backend/routes/sms-contacts.js` — new.
- `backend/server.js` — mount the new router (`app.use('/api/sms-contacts', smsContactsRouter)`, alongside the other `app.use('/api/...')` lines).
- `backend/notifications/sms.js` — swap env-list for DB query, extract shared Twilio client helper, add dispatch broadcast.
- `dashboard_electron/renderer/js/alerts/sms-contacts.js` — real CRUD + manual send UI.
- `dashboard_electron/renderer/js/alerts/dispatch-log.js` — wire to real WS event.
- `dashboard_electron/renderer/js/alerts/tier-config.js` — real contact count (optional/last).
- `dashboard_electron/renderer/index.html` — no structural change expected (containers already exist), only if the manual-send UI needs a new container div.

## Suggested sequence

1. Schema + migrate seed. Run `node backend/db/migrate.js`, confirm `sms_contacts` appears and is seeded from any existing `ALERT_SMS_TO`.
2. Backend CRUD route + mount, `curl` each verb manually.
3. Refactor `sms.js` to read from DB; re-run `backend/notifications/sms.manual-test.js` (extend it to seed a test contact first) to confirm automatic sends still work unconfigured (no-throw) and, if live Twilio creds are available, actually deliver.
4. Manual-send route + broadcast.
5. Frontend CRUD panel, wired to steps 2-4.
6. Dispatch log real-data wiring.
7. Full-stack test: `npm start`, add a contact from the UI, toggle auto-alert off/on, send a manual test SMS, then trigger a real Tier-2+ alarm and confirm only `auto_alert=true` contacts receive it. Re-run `dashboard_electron/test/verify_live_notifications.js` if it's still relevant to this surface.

## Open decisions for Antigravity / the user

- Phone format enforcement: hard-require E.164 (`+<countrycode><number>`) or accept loose input and normalize server-side? Recommend hard-require with a UI hint, since Twilio rejects malformed numbers anyway and silent normalization can send to the wrong number.
- Should deleting a contact also purge their rows from any past dispatch-log history, or just stop future sends? Recommend just stop future sends — history is an audit trail.
- Rate limiting approach for the manual-send route (in-memory counter vs. a proper limiter package) — not currently a dependency in `backend/package.json`, so simplest is an in-memory sliding window given this is a single-process backend.
