# Merge: heatmap Chrome-render UI + SMS/web alerts

**Branch:** `integrate/heatmap-chrome-render-and-alerts` (based on `feat/heatmap-toolbar-ui`, merged `feat/sms-and-web-alerts` in)
**Done by:** Claude, 2026-09-28. This doc is the record of what happened and what's left, written for Antigravity to pick up.

## What was merged

- `feat/heatmap-toolbar-ui` (Tarun's branch, 292 files) — heatmap dropdown toolbar, HUD tooltips, FORGE crack-draw tool, 365-day dataset, and the Chrome-rendering work (tile proxy same-origin fix, etc.). Tip: `1f1afd3`.
- `feat/sms-and-web-alerts` (13 files) — Tier-2+ Twilio SMS on `POST /api/alarms`, and desktop/browser `Notification` API alerts wired to `bus.on('alarm')`. Tip: `7239ba0`.
- Both branches forked from the same commit (`2ef8b1b`), so this is a real 3-way merge, not a rebase.

## Conflict resolution

Only one file conflicted: `dashboard_electron/renderer/js/app.js`. Both branches edited the init block right after `alarmDetail.init()`:

- heatmap-toolbar-ui **deleted** `js/map/trough-overlay.js` entirely (superseded by `heatmap-overlay.js`) and removed its `troughOverlay.init(map)` call.
- sms-and-web-alerts **added** `browserNotify.init()` at that same anchor line.

Resolved by keeping `browserNotify.init()` and dropping `troughOverlay.init(map)` — the file it calls into no longer exists on this branch, so keeping the call would throw `ReferenceError: troughOverlay is not defined` at runtime.

`dashboard_electron/renderer/index.html` also had changes from both branches (script-tag additions) but auto-merged cleanly — the two branches touched disjoint blocks (`js/alerts/*.js` vs `js/map/*.js`).

Nothing else overlapped. Full list of files both branches touched: `app.js`, `index.html` — that's it. Everything else in the 436-file combined diff is one branch or the other, not both.

## Bug found and fixed during testing

`dashboard_electron/serve.js` maps `/` to `renderer/index.html`'s content but was leaving the browser's URL at `/`. Every relative asset path in the page (`css/hmi.css`, `lib/leaflet/leaflet.css`, ...) resolves against the *browser's* URL, not the served path, so a real Chrome tab hitting `http://127.0.0.1:8085/` rendered completely unstyled — 404s on every stylesheet, map stuck on "LOADING...". Electron never hit this because `main.js` loads the file directly (`loadFile(...renderer/index.html)`), so the bug was invisible there.

Fixed with a real `302` redirect to `/renderer/index.html` instead of an internal rewrite (commit `8be3888`). Verified with `curl` (404 → 200 on `lib/leaflet/leaflet.css`) and a Chrome screenshot showing the dashboard rendering identically to Electron.

**If you're picking this up:** if Tarun's Chrome-rendering intent was specifically "open `:8085/` in a browser and it just works," this fix is required — without it that URL was broken on this branch (and would have been broken on `feat/heatmap-toolbar-ui` alone too, this isn't merge fallout, it's a pre-existing bug this testing pass surfaced).

## Testing performed

1. `npm start` from repo root (full stack: MQTT broker, backend API, tile server, sim server, scenario lab, FORGE math server, Vite 3D sandbox, Electron) — came up clean, no errors in ~175 lines of boot log.
2. Grepped the full boot+runtime log for `error|trough|ReferenceError|TypeError` — zero hits.
3. Screenshotted the live Electron window: heatmap dropdown toolbar (`HEATMAP: OFF ▾`) renders correctly where the old 8-button row used to be; a live Tier-3 alarm fired both the in-app banner and a native macOS desktop notification.
4. Opened `http://127.0.0.1:8085/` in real Chrome — found the routing bug above.
5. Opened `http://127.0.0.1:8085/renderer/index.html` directly — renders pixel-identical to Electron, heatmap toolbar included, plus Chrome's own native notification-permission prompt fired correctly (confirms `browser-notify.js` works outside Electron too, not just inside its Chromium shell).
6. Applied the redirect fix, restarted `serve.js`, re-tested `http://127.0.0.1:8085/` — now redirects and renders correctly.
7. `node -c` syntax-checked every touched JS file (`alarms.js`, `sms.js`, `browser-notify.js`, `main.js`, `app.js`, `serve.js`) — all pass.
8. Killed the test stack cleanly afterward.

## What Antigravity should do next

1. **Review the merge commit** (`080c000`) and the fix commit (`8be3888`) on `integrate/heatmap-chrome-render-and-alerts` — `git log -p` or `git show` each.
2. **Decide the target branch.** This was built on top of `feat/heatmap-toolbar-ui` rather than `main` — check whether `feat/heatmap-toolbar-ui` (or `heatmaps-and-alert-system-import` / `merge/heatmaps-and-alert-system`, which look like earlier attempts at this same merge) was meant to land on `main` first. If so, land that first, then rebase/merge this branch's two new commits on top; if `main` is stale relative to both, this branch can likely go straight to `main` via a normal merge or squash.
3. **Re-run the manual SMS test** (`backend/notifications/sms.manual-test.js`) with real Twilio credentials in `backend/.env` — it was verified with no-throw fallback (unconfigured Twilio) during original ALERT-1 work, not re-verified with live credentials here.
4. **Re-run `dashboard_electron/test/verify_live_notifications.js`** (the existing CDP script that drives both Electron and desktop Chrome) against this branch specifically — it wasn't re-run as part of this merge, only manually reproduced.
5. **Decide if the `serve.js` redirect fix should also be backported** to `feat/heatmap-toolbar-ui` directly (it's a pre-existing bug on that branch alone, unrelated to the alerts merge) — cherry-pick `8be3888` if that branch has a life of its own.
6. Checked the other branches whose names sound related (`heatmaps-and-alert-system-import`, `merge/heatmaps-and-alert-system`) — both just point at commits already inside `feat/heatmap-toolbar-ui`'s own history (`2ef8b1b`, `1fe22f7`), not a separate prior attempt at merging in the SMS/alerts work. No one else had done this merge yet.
7. Two untracked, unrelated paths sat in the working tree the whole time and were left alone: `datasetformlguy/` and `sih-26-finale/renderer/.gitignore.dataless-stub-bak`. Not part of this merge — check with whoever's working tree this is before doing anything with them.
