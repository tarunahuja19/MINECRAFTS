# Plan: First-time tutorial cards (game-style onboarding)

**Branch:** `feat/tutorial-cards` (worktree at `../sih26-tutorial-cards`, cut from `integrate/heatmap-chrome-render-and-alerts` @ 7bf351b)
**Written by:** Claude, 2026-09-28. Planning only, no code. For Antigravity to implement.

## The ask

First-time visitors should get short, game-style tutorial cards that say what to do and how, basic stuff only. Think "Step 2 of 7 — this is the map, click a dot to see that sensor", not a manual. The INFO tab already is the manual; this is the 30-second version.

## Scope: keep it small

**In v1**
1. A welcome card on first launch: *Start tour* / *Skip*.
2. A guided tour of ~8 steps. Each step dims the screen, spotlights one real UI element, and shows a card next to it with a title, 1–2 plain sentences, `Back` / `Next` / `Skip`, and "Step n of N".
3. Remembers it was shown (localStorage), so it never nags again.
4. A small `?` button in the tab bar to replay the tour.
5. Works in both Electron and plain Chrome (`serve.js`).

**Not in v1** (do not build unless asked): per-tab mini-tours, animations beyond a fade, sound, localisation, analytics, a settings page, backend changes.

## Hard rules

- **Frontend only.** No backend/DB changes. Touch nothing under `backend/` and nothing in `renderer/js/alerts/` (SMS work is in flight on another branch and will conflict).
- **Match the existing code style:** plain ES5 IIFE modules exposed as a global (`var tutorial = (function () { ... })();`), `'use strict'`, no bundler, no new dependencies. See `js/panels/info-tab.js` for the shape.
- **Only use CSS variables that exist in `css/hmi.css`.** Use `--bg-panel`, `--bg-panel-header`, `--bg-inset`, `--border-bevel-light`, `--border-rule`, `--status-active`, `--text-primary`, `--text-secondary`, `--btn-bg`. Do **not** invent tokens: the SMS panel used `--panel-bg`, `--border-color`, `--accent-green`, none of which exist, so its inputs and buttons render unstyled. `grep -- "--your-token:" css/hmi.css` before using any variable.
- **Wrap all `localStorage` access in try/catch** and render fine without it (private windows can throw). If storage is unavailable, show the tour once per page load and don't crash.
- **The overlay must never appear during automated tests.** The existing CDP/verify scripts in `dashboard_electron/test/` would be blocked by a full-screen overlay. Skip the auto-start when `window.__TEST_BACKEND_PORT__` is set or the URL has `?tutorial=off`. Allow `?tutorial=1` to force it (for manual testing and for our own verify script).

## Design

### Files

| File | Change |
|---|---|
| `renderer/js/tutorial/tutorial.js` | **new**, the engine: overlay, spotlight, card, next/back/skip, persistence, replay |
| `renderer/js/tutorial/tutorial-steps.js` | **new**, the step content as a plain array, so copy edits never touch engine code |
| `renderer/css/tutorial.css` | **new**, all styling |
| `renderer/index.html` | add `<link>` for the css, two `<script>` tags before `js/app.js`, and the `?` button in `#tab-bar` (next to `#sim-status-hud`, ~line 194) |
| `renderer/js/app.js` | one call, `tutorial.init()`, near the other `init()` calls (e.g. after `infoTab.init()`, ~line 90), guarded like the others: `if (typeof tutorial !== 'undefined' && tutorial.init) ...` |

Script order matters: `tutorial-steps.js` before `tutorial.js`, both before `app.js`.

### Step data shape

```js
{
  id: 'tabs',
  target: '#tab-bar',          // CSS selector; omit for a centred card (welcome/done)
  tab: 'map',                  // optional: click this tab first so the target is visible
  title: 'Switch views here',
  body: 'MAP is home. SIMULATION and FORGE are for what-if testing. INFO explains everything.',
  placement: 'bottom'          // 'top' | 'bottom' | 'left' | 'right' | 'center'
}
```

### Engine behaviour

- **Spotlight:** one absolutely-positioned box over the target with a huge `box-shadow: 0 0 0 9999px rgba(0,0,0,.65)` (the standard cut-out trick), so the target stays visible and everything else dims. No canvas, no library.
- **Card placement:** prefer `placement`, but flip to the opposite side, or clamp inside the viewport, if it would overflow. Recompute on `resize`.
- **Missing target:** if the selector matches nothing or the element has zero size (hidden tab, panel not rendered), **skip that step silently**. Never throw and never show a card floating over nothing.
- **Tab switching:** if a step has `tab`, dispatch a click on `.tab-btn[data-tab="..."]` so the existing tab handler in `app.js` does the real switch. Do not reimplement tab switching. Wait one animation frame before measuring the target.
- **Keyboard:** `→`/`Enter` next, `←` back, `Esc` skip. Card gets focus so this works without clicking first.
- **Click-through blocked:** the dim layer swallows clicks so nobody accidentally hits CLOSE EVERYTHING mid-tour. The `?` button and card buttons remain the only interactive things.
- **z-index:** the highest existing value in `hmi.css` is 1200; use 2000+ for the overlay so it sits above the map HUD, modals and tooltips.
- **Persistence:** key `sih26.tutorial.v1` = `'done'` (set on finish **or** skip, because skipping is also "seen it"). Bumping to `v2` later re-shows it to everyone after a big UI change.
- **Auto-start timing:** start after the first render settles (e.g. `setTimeout(..., 800)` after `init`), so the map has laid out and the targets have real sizes.
- **API:** `tutorial.init()`, `tutorial.start()` (used by the `?` button), `tutorial.skip()`. Nothing else public.
- **Cleanup:** on finish/skip remove every element and listener it added. No leftover nodes in the DOM.

### Suggested steps (copy is a starting point; keep each body ≤ 2 sentences, no jargon)

Selectors below were read from `index.html`, but **verify each one exists and is visible before relying on it.** If a selector is wrong, pick the nearest stable id.

| # | Target | Title | Body |
|---|---|---|---|
| 1 | *(centre)* | Welcome | This dashboard watches for ground movement above the mine. Take a 30-second tour? |
| 2 | `#tab-bar` | Switch views here | MAP is home. SIMULATION and FORGE let you try what-if scenarios. NODES, ALARMS, HISTORY and SYSTEM show health and records. |
| 3 | `#sim-status-hud` | Is anything running? | Sensors only send data while the simulation is running. This badge shows the current state. |
| 4 | `#map-container` | The map | Each dot is a sensor. Green is healthy, amber is drifting, red is trouble. |
| 5 | the right-hand panel that contains `#panel-empty` ("SELECT A NODE") | Inspect a sensor | Click any dot on the map and its live readings and charts appear here. |
| 6 | `#map-alarm-history-container` (or its panel) | Alarms show up here | When a sensor crosses a danger threshold, a banner appears and the alarm is listed. Click one to zoom to it. |
| 7 | `.tab-btn[data-tab="system"]` | Alerts & health | Check that sensors are online and that text-message alerts are set up. |
| 8 | `.tab-btn[data-tab="info"]` | Stuck? Read INFO | Plain-English explanations of every sensor, zone, and alarm level. |
| 9 | the `?` button | You're set | Press `?` any time to replay this tour. |

Step 5 should not assume a node is selected. It points at the empty panel and tells them what to click.

### The `?` button

Small, in the tab bar next to the simulation badge, `title="Replay the tutorial"`, styled like the other tab-bar controls. It calls `tutorial.start()` regardless of the stored flag.

## Suggested build sequence

1. CSS + engine with **two hard-coded steps** (one centred, one targeted). Confirm the spotlight and card render right at 1280×720 and 1920×1080.
2. Add persistence, keyboard, skip-missing-target, cleanup.
3. Add the real steps file and the `?` button.
4. Wire `init()` into `app.js`. Confirm `?tutorial=off` and `__TEST_BACKEND_PORT__` suppress it.
5. Run the existing verify scripts that load the dashboard (`verify_no_beacon_on_load.js`, `verify_live_notifications.js`) to confirm the overlay doesn't interfere.

## How to check it works (acceptance)

- Fresh profile (clear site data, or run `localStorage.removeItem('sih26.tutorial.v1')`): welcome card appears once, tour runs through, finishing sets the flag, **reload → no tutorial**.
- Skip on step 1 also sets the flag.
- `?` replays it even after the flag is set.
- `?tutorial=off` → nothing appears, even with cleared storage.
- Resize the window mid-tour → spotlight and card follow the target.
- Temporarily rename one target selector → that step is skipped and the tour continues; no console errors.
- Works in Electron **and** in Chrome at `http://localhost:<port>/` (the `serve.js` redirect to `/renderer/index.html`).
- Finishing/skipping leaves no `tutorial-*` elements in the DOM.
- `git diff --stat` shows **only** the five files above (three new, two edited). Nothing under `backend/` or `js/alerts/`.

## Open decisions (defaults chosen, tell me to change)

- **Per-tab first-visit hints** (a one-card intro the first time someone opens SIMULATION, FORGE, etc.): deferred. Good v2 once the main tour is proven.
- **Re-show after updates:** handled by bumping the storage key version; no server involved.
- **Node/Electron main-process persistence:** not needed; renderer `localStorage` is enough and behaves identically in Chrome.
