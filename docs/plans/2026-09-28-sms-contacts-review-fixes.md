# SMS contacts manager: review of Antigravity's implementation

**Reviewed by:** Claude, 2026-09-28. Static read of the full diff against `docs/plans/2026-09-28-sms-contacts-manager.md`, plus `node --check` on every touched file (all pass).
**Not done:** no runtime testing. Nothing was run against Postgres, Twilio, or the live UI. The user plans to check physically.

**Verdict:** the implementation follows the plan closely: schema, migrate seed, CRUD + manual send, DB-backed recipient list with env fallback, shared `getTwilioClient()`, WS `sms_dispatch` wiring, in-memory rate limit, HTML escaping. The items below are bugs and gaps, ordered by how likely you are to notice them when you run it.

## Fix these (visible when you run it)

1. **The SMS panel styling is broken: CSS variables that don't exist.**
   `sms-contacts.js` uses `--panel-bg`, `--border-color`, `--accent-green`, `--font-mono`, and a `btn-sm` class. None of them are defined in `renderer/css/hmi.css` (real tokens: `--bg-inset`, `--border-rule`, `--status-active`, `--text-primary`; there is no `.btn-sm`). Result: inputs have no background/border, and the **+ ADD button has `color:#000` on an invalid background = black text on dark chrome, likely unreadable.**
   Fix: swap to the real tokens; `grep -- "--token:" css/hmi.css` each one.

2. **Every manual send appears twice in the dispatch log.**
   The backend broadcasts `sms_dispatch` over WS per recipient (→ `bus 'sms-dispatch'` → `pushEvent`), *and* `sms-contacts.js:231-242` re-emits `dispatch-event` from the HTTP response (→ `pushEvent` again).
   Fix: delete the `bus.emit('dispatch-event', ...)` loop in the send `.then` in `sms-contacts.js`. The WS event is the single source of truth.

3. **Wrong port lookup: the panel can talk to the wrong backend.**
   `sms-contacts.js:10` and `tier-config.js:8` read `window.__BACKEND_PORT__`, which is defined nowhere. `live-provider.js:15-22` actually resolves the port from `window.__TEST_BACKEND_PORT__` or `?backend_port=NNNN`, else 8080. Fine on 8080; wrong in any test harness/alt-port run (and the plan said "same as live-provider").
   Fix: expose `getPort`/`API_BASE` from `liveProvider` (or a tiny shared helper) and use it in both files.

4. **`blast-test.js` now renders as a blank contact.**
   It emits `{ t, tier: 1, outcome: 'SUPPRESSED' }`; the reshaped log reads `contact`/`source`, so the row shows `—` / `AUTO`. One-line fix in `blast-test.js:42`: add `contact: 'BLAST TEST', source: 'test'`.

5. **Tier-2 contact count goes stale.**
   `tierConfig.refresh` is exported but nothing calls it. After add/delete/toggle in `sms-contacts.js`, call `tierConfig.refresh()` (guard with `typeof tierConfig !== 'undefined'`).

## Fix these (robustness / abuse)

6. **Rate limit counts requests, not recipients.** `POST /send` accepts unbounded `phones` and `contact_ids`, so 10 requests/min can text an unlimited number of people. Cap recipients per request (e.g. 10) and return 400 above it. Plan flagged this endpoint as the abuse target.

7. **Bad input returns 500 instead of 400.**
   - `name`/`phone`/`message` non-string → `.trim()` throws → 500 (`sms-contacts.js` POST/PATCH/send).
   - Non-numeric `:id` → `parseInt` → `NaN` → Postgres error → 500 (PATCH/DELETE).
   - Non-numeric entries in `contact_ids` likewise.
   Fix: `typeof x === 'string'` checks and `Number.isInteger(id)` → 400.

8. **Auto-send log rows show the raw phone number, not the contact name.** `sms.js` `getAutoAlertPhones()` selects only `phone`, so `dispatchEvent.contact = to`. Select `name, phone`, keep a phone→name map.

## Nice to have

9. `render()` rebuilds the whole panel via `innerHTML`, so typing a manual message and then toggling any AUTO switch wipes the message and any half-typed new contact. Preserve input values across renders (or update only the table).
10. Toggle/delete ignore non-OK responses; the panel silently reverts on refetch. Surface an error line.
11. The manual-send box is hidden when there are zero contacts, so you can't text an unsaved number from the UI even though the API supports `phones`. Plan called for this to be *supported*, not necessarily in the UI, so this is optional.
12. `migrate.js --reset` now drops `sms_contacts`, so a reset wipes saved contacts (they re-seed only from `ALERT_SMS_TO`). Not wrong, but say so in the PR/handoff note. (`/api/system/reset`, the CLOSE EVERYTHING path, truncates only `readings, simulation_packets, alarms`. Contacts are safe there. Verified.)

## Gaps against the plan

- **No tests added.** Plan step 3 said to extend `backend/notifications/sms.manual-test.js` to seed a contact; it's unmodified. Plan step 7 (full-stack run) is what the user will do by hand.
- Plan's `/count` endpoint isn't in the plan text but is a reasonable addition; it swallows DB errors and returns `count: 0`, which will show "0 contacts configured" during a DB outage even if `ALERT_SMS_TO` is still sending. Minor; consider returning the env-fallback count or an explicit `null`.

## Housekeeping (not part of this feature)

`git status` also shows untracked `datasetformlguy/` and `sih-26-finale/renderer/.gitignore.dataless-stub-bak`. Don't `git add -A` this work; add the SMS files by name.
