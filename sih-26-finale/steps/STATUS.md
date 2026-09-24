# STATUS — where are we?

**👉 You are here: session 27 (17 Sep).** The Scenario Lab is two parts of six in. **P1** gave it zones (and stopped a boolean zone mask from drawing a rectangle of fake cracks — 95.95 vs 5.28 mm/m at the rim) plus one crack model shared with the simulator. **P2** gave it consequences: cracks as **lines** with a bearing, houses/roads/poles graded on the NCB scale, the "keeps moving N more days" event capped by the ground's remaining capacity, a caving-driven shaking layer as contour lines, and **S7** — the crack history now survives a rebuild. Gate L8 grew the null check (ds = 0 → the simulator's own answer, 0.14 % of cells differ on grade) and a mutation-checked bearing check. **Next: P3, the lab server.** Live tick-list: [CHECKLIST.md](CHECKLIST.md). Hand check: [`walkthroughs/step-p2-consequences/WALKTHROUGH.md`](../walkthroughs/step-p2-consequences/WALKTHROUGH.md). scenario-lab **125 passed** · mine-sim **198 passed / 1 skipped** · renderer **19** · vault PERFECT.

_Earlier pointer (session 24):_ Two asks done: the node inspector now reads the simulator's per-node telemetry (tilt, strain, displacement, battery, RSSI, parent actually used, emergency slot) instead of padding the panel with the planner's static pre-run peaks — each tier shows a different live set because each carries a different sensor package; and **the last cap on node counts is gone** — `LAST_ANCHOR_ID = 99` deleted, anchors = `ceil(scouts/(cap-1))` with nothing truncating it. Adriyala bit-identical, Illinois unclamps 99 → 106. mine-sim 198 passed / 1 skipped, stress test 60/0/0, renderer 19, vault PERFECT.

_Earlier pointer (session 22): Adarsh's eight-item list done._ View cleanup (F12), the `max_children_per_anchor` 8 → 5 contract amendment with a full re-run, the session-19 anchor-spacing defect closed, and the Scenario Lab base built (T5 + W1) behind the "Freeze + create subsidence" button. Hand checks: [`walkthroughs/step-f12-view-cleanup/WALKTHROUGH.md`](../walkthroughs/step-f12-view-cleanup/WALKTHROUGH.md) and [`walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md`](../walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md) §6. **F7 is still not built** — the depth ramp is still the running-peak rainbow.

_Earlier pointer (session 21): F9 + F10 built; hand checks in `walkthroughs/step-f9-shell/WALKTHROUGH.md` §5 and `walkthroughs/step-f10-cracks/WALKTHROUGH.md` §4._

**🛑 F8 has no blocking constraint left (session 24) — your call needed.** Session 23 unblocked F8 on a 495-scout ceiling. Session 24 removed the ceiling itself: the 1–99 anchor ID range is gone, so the anchor count is pure arithmetic and 1676 scouts would plan at 419 anchors, refused by nothing. F8 exists *only* to squeeze a district under 495, so its reason to exist has to be re-decided: drop it and turn `n_panels: 8` on at the sourced spacing (check cost and the 60 s TDMA uplink window), or keep re-spacing for cost/airtime reasons with a new target from you. Both options are in the banner at the top of [F8](F8-district-respace-tiers.md). **Gate G15 still passes**, assertion 4 rewritten to contiguity + no ID collision.

**Two decisions waiting on you:** F10 stopped short of putting the fissure and vibration channels into `out/nodes.csv`, because contract §7.1 freezes that column order ("Part 2 parses positionally"). They go to `out/cracks/` instead. Amend the contract to append them, or leave them in their own file? See `walkthroughs/step-f10-cracks/WALKTHROUGH.md` §5.

Open the view with `./run-simulation.sh view` and do the hand checks in each F file (section 3). Still open from 16 Sep: push `fix-the-system` / merge to `main`, and the open points in `project-updates/2026-09-16.md`.

_Earlier pointer (16 Sep, session 16): F1–F5 done by Claude on `fix-the-system`._

_Earlier pointer (15 Sep evening): F1 fixes._
_Earlier pointer (before 15 Sep 17:00): T4 fixes._

Claude updates this table after every check and commit. Tick meanings:
**Written** = Antigravity finished · **Checked** = Claude reviewed · **Fixed** = fix prompt done and rechecked (— = no fixes needed) · **Committed** = saved to GitHub.

## Fix the system — branch `fix-the-system` (15 Sep evening)

| # | Step | In plain words | Written | Checked | Fixed | Committed | Your next action |
|---|---|---|---|---|---|---|---|
| F0 | [F0](F0-fix-the-system-plan.md) | Plan: findings + decisions DF1–DF4 | ✅ Claude | — | — | ✅ `5349579` | DF1–DF4 defaults were used |
| F1 | [F1](F1-no-wires-node-designs.md) | Remove wires, 5 distinct node designs | ✅ AG + Claude fixes | ✅ | ✅ | ✅ `47b67ca` | hand check §3 |
| F2 | [F2](F2-zoom-scale-terrain.md) | True scale, + / − zoom levels, bigger terrain | ✅ Claude | ✅ | — | ✅ `ad61277` | hand check §3 |
| F3 | [F3](F3-placement-spread.md) | Placement covers whole panel, spacing by tier | ✅ Claude | ✅ | — | ✅ `477191a` | look at `walkthroughs/step-f3-placement/top_view_v3.png` |
| F4 | [F4](F4-plan-network-daily-frames.md) | 375 nodes × 690 days hourly; daily frames | ✅ Claude | ✅ | — | ✅ `855387f`, `62701a5` | hand check §3 |
| F5 | [F5](F5-playback-clock-speeds.md) | Clock; 1× … 10000× speed buttons | ✅ Claude | ✅ | — | ✅ `2e4c1ce` | hand check §3 |
| F6 | [F6](F6-district-shell-graphics.md) | Thin-shell ground, 360° camera, district (Phase B stopped) | ✅ Claude | ✅ | — | ⬜ | superseded by F8 for the district part |
| F7 | [F7](F7-calm-view-nodes-colour.md) | Status dots, single-hue fixed-scale depth ramp, thinner slab | ⬜ | ⬜ | ⬜ | ⬜ | 👉 paste §1 into Antigravity |
| F8 | [F8](F8-district-respace-tiers.md) | 8-panel district — ~~inside the frozen 1–99 anchor budget~~ | ⬜ | ⬜ | ⬜ | ⬜ | 🛑 **premise gone (session 24)** — the ceiling it was written against no longer exists; decide what F8 is for, or drop it |
| F9 | [F9](F9-docked-shell-layer-control.md) | Docked shell (no floating panels), per-tier node layers + density | ✅ Claude | ✅ headless | — | ⬜ | hand check [§5](../walkthroughs/step-f9-shell/WALKTHROUGH.md) |
| F10 | [F10](F10-cracks-vibration-damage.md) | Surface cracks, NCB damage, ground vibration; strain tensor closed | ✅ Claude | ✅ | — | ⬜ | hand check [§4](../walkthroughs/step-f10-cracks/WALKTHROUGH.md) + the contract decision |
| F11 | — | DEM trimmed 62.2 → 12.9 km² (`dem_margin_m` 3000 → 900); placement provably unchanged | ✅ Claude | ✅ | — | ⬜ | nothing — the view is identical |
| F12 | — | View cleanup: lighter green (L* 27.3→62.6), Survey line S off the surface, terrain 4.81→3.42 km² with a per-side margin, shorter left rail, duplicate tier list removed | ✅ Claude | ✅ headless | — | ⬜ | look at the screenshots in [the walkthrough](../walkthroughs/step-f12-view-cleanup/WALKTHROUGH.md) and say if the green is right |
| — | [T5](T5-scenario-lab-base.md) | Scenario Lab base: freeze a finished run at a day, on a copy | ✅ Claude | ✅ | — | ⬜ | `pip install -e scenario-lab` then §6 of [the walkthrough](../walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md) |
| — | [W1](W1-sudden-sinking-edge-collapse.md) | "What if": sudden sinking, edge collapse | ✅ Claude | ✅ | — | ⬜ | needs W3 + W4 before the header button can be enabled |

"Committed" = on local branch `fix-the-system` (not pushed).

## Tuesday 15 Sep — v1 (demo 20:00)

| # | Step | In plain words | Written | Checked | Fixed | Committed | Your next action |
|---|---|---|---|---|---|---|---|
| 1 | [T4](T4-3d-view.md) | 3D view of the ground sinking | ✅ | ✅ 5 fixes | ⬜ | ⬜ | 👉 paste fix prompt (section 4) → then `Check step T4` |
| 2 | [T1](T1-gate-checker.md) | One script runs all safety tests | ⬜ | ⬜ | ⬜ | ⬜ | after T4 is committed |
| 3 | [T2](T2-live-stream-server.md) | Live replay feed for backend/frontend | ⬜ | ⬜ | ⬜ | ⬜ | after T1 |
| 4 | [T3](T3-same-seed-check.md) | Same seed → same data, timing | ⬜ | ⬜ | ⬜ | ⬜ | after T2 |
| 5 | [V1](V1-demo-tuesday.md) | Demo script, dry run, demo | ⬜ | ⬜ | ⬜ | ⬜ | 16:00, or when T1–T4 are committed |

## Tuesday evening — v2 groundwork (not in tonight's demo)

| # | Step | In plain words | Written | Checked | Fixed | Committed | Your next action |
|---|---|---|---|---|---|---|---|
| 6 | [T5](T5-scenario-lab-base.md) | Freeze the ground at a day (on a copy) | ⬜ | ⬜ | ⬜ | ⬜ | after V1 |
| 7 | [T6](T6-cracks-and-damage.md) | Cracks + damage grades for houses/roads/poles | ⬜ | ⬜ | ⬜ | ⬜ | ⚠️ Claude rechecks numbers first |
| 8 | [T7](T7-forecast-input.md) | Read + check the ML forecast file | ⬜ | ⬜ | ⬜ | ⬜ | after T6 |

## Wednesday 16 Sep — v2 (first batch by 18:00, rest by 23:00)

| # | Step | In plain words | Written | Checked | Fixed | Committed | Your next action |
|---|---|---|---|---|---|---|---|
| 9 | [W1](W1-sudden-sinking-edge-collapse.md) | "What if": sudden sinking, edge collapse | ⬜ | ⬜ | ⬜ | ⬜ | ⚠️ Claude rechecks numbers first |
| 10 | [W2](W2-crack-scenario.md) | "What if": cracks | ⬜ | ⬜ | ⬜ | ⬜ | |
| 11 | [W3](W3-lab-server.md) | Scenario Lab server + safety gates | ⬜ | ⬜ | ⬜ | ⬜ | |
| 12 | [W4](W4-scenario-page.md) | Window 2 page (+ Window 3 placeholder) | ⬜ | ⬜ | ⬜ | ⬜ | |
| 13 | [W8](W8-forecast-page.md) | Forecast page | ⬜ | ⬜ | ⬜ | ⬜ | needs W7 |
| 14 | [W7](W7-forecast-damage.md) | Forecast → damage results | ⬜ | ⬜ | ⬜ | ⬜ | |
| 15 | [W5](W5-blast.md) | "What if": blast (second batch) | ⬜ | ⬜ | ⬜ | ⬜ | |
| 16 | [W6](W6-sinkhole-railway-pipe.md) | "What if": sinkhole + railway + pipe (second batch) | ⬜ | ⬜ | ⬜ | ⬜ | |
| 17 | [W9](W9-real-ml-file.md) | Real ML file (only if it arrived) | ⬜ | ⬜ | ⬜ | ⬜ | |
| 18 | [V2](V2-demo-wednesday.md) | Final check, demo script, run-through | ⬜ | ⬜ | ⬜ | ⬜ | 22:00 |

Order note: W7 must be committed before W8, so do row 14 before row 13.

## Your own to-dos (not Antigravity)

| To-do | Done |
|---|---|
| D1–D7 decisions | ✅ 15 Sep (all yes) |
| `pip install websockets httpx` | ✅ already installed |
| Send teammate messages ([messages](../files/MY-STEPS.md) §E) | ⬜ |
| GitHub invites for teammates | ⬜ |
| Say `commit` so Claude saves sessions 10–12 (run-simulation.sh, steps/ folder) | ⬜ |
| Read survey line S position from the JMMF figure (not urgent) | ⬜ |
