# WHATS-LEFT.md — flags to run it, and everything still open

**Who this is for:** Adarsh. One place to see how to start the system and what is not finished.
**Written:** 17 Sep 2026 (session 23), updated same day (session 23, G15 fix). **Rule:** one small thing at a time from here on.

Companion files — this one does not replace them:
- [steps/STATUS.md](steps/STATUS.md) — the written/checked/fixed/committed table per step. Claude keeps that current.
- [files/BUILD-PLAN.md](files/BUILD-PLAN.md) — the prompt texts.
- [project-updates/](project-updates/) — what happened, per session.

---

## Part 1 — Flags: how to run the system

### 1.1 The one command

```bash
./run-simulation.sh              # full rebuild from scratch (690 days), then open the 3D view
./run-simulation.sh 30           # quick 30-day run into mine-sim/out/v2-30d, then open its 3D view
./run-simulation.sh view         # no rebuild: prepare + open the 3D view of mine-sim/out/v2-690d
./run-simulation.sh --no-view    # rebuild only — can be added to any of the above
```

Anything that is not a number, `view`, or `--no-view` is refused with
`unknown argument: … (use a number of days, view, or --no-view)` and exit 2.

### 1.2 Environment flags

| Flag | Default | What it does |
|---|---|---|
| `PY` | `/opt/miniconda3/envs/pinn-sandbox/bin/python3.11` | Which Python runs everything. The script exits 1 if it is not executable. |
| `PORT` | `8000` | Port for the 3D view web server. If 8000 is busy, use `PORT=8001 ./run-simulation.sh view` — do not kill whatever is on 8000. |

### 1.3 The eight rebuild steps (what the flags actually drive)

1. Erase generated data — `mine-sim/out/*`, `data/fitted`, handoff v2 data files. **Never erased:** `data/real` (field data), `data/fixtures`, `config`.
2. Refit Knothe parameters from field data.
3. Unit tests and gates.
4. Plan the sensor network over the real terrain → `mine-sim/out/plan/node_plan.json`.
5. Simulate N days → `mine-sim/out/v2-<N>d` (live progress read off `nodes.csv` as it is written).
6. Real-anchored survey-line dataset.
7. Package `handoff/v2-sim-sample`.
8. Verify.

A partial run (`./run-simulation.sh 30`) only erases its own output dir; other runs are kept.

### 1.4 Config switches that change what gets built

These are not command-line flags — they are the knobs in config. Changing one changes the run.

| Where | Key | Now | Effect |
|---|---|---|---|
| `mine-sim/config/assumptions.yaml` | `mine` | `adriyala_lw1` | Picks `config/mines/<name>.yaml`. The other one is `illinois_lw`. Invariant 8: swapping mines must need no code change. |
| " | `layout.max_children_per_anchor` | `5` | Contract value. Amended 8 → 5 on 17 Sep. One Anchor's radio capacity, and the divisor in `anchors = ceil(scouts / (cap-1))` — drives the anchor count (82) and cost (₹1,029,000). **Not a ceiling on node counts: there is no per-mine ceiling any more** (session 24, the 1–99 anchor ID range was removed). |
| " | `layout.source` | see file | `plan` = simulate the planned network from step 4; otherwise the v1 grid layout. |
| " | `sim.duration_days` | `690` | Default run length. The CLI day count overrides it. |
| " | `sim.rng_seed` | `20260913` | Same seed → bit-identical run (G06). |
| " | `terrain.dem_margin_m` | `900.0` | DEM footprint. Was 3000 (62.2 km²); 900 gives 12.9 km². Below ~400 it clips the gateway ring. |
| `renderer/config.yaml` | `context_margin_m` | `100.0` | Padding per side around the mine in the view. |
| " | `cover_planned_nodes` | `false` | True widens the ground so no planned node stands off it — costs 3.42 → 5.56 km² of mostly empty terrain. |
| " | `vertical_exaggeration` | `10.0` | Makes millimetre subsidence visible. |
| " | `playback.default_speed` | `1000` | Playback speed on open. Speeds 1×–10000×. |

### 1.5 Known pipeline gap — a producer the rebuild does not rebuild

- [x] **CLOSED 17 Sep (session 27, step S7).** `mine-sim/scripts/export_cracks.py` is now **step 9/9** of `run-simulation.sh`, so a rebuild recreates `mine-sim/out/cracks/` instead of leaving it deleted. It exports **four days across the run in one shared walk** of the latched crack state (2.5 s for all four), because the Scenario Lab can freeze any day and without a baseline for that day it refuses to count new cracks. The script's hardcoded `cell = 10.0` became `cracks.export_cell_m` in `config/assumptions.yaml` — the lab resamples from that grid, so it has to be able to read it. To run it by hand for another day:
  ```bash
  cd mine-sim && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 scripts/export_cracks.py --day 300
  ```
- `mine-sim/scripts/stress_test.py` is also not called by the script — that one is on purpose, CI runs it.

---

## Part 2 — What is left, as checkboxes

### 2.1 Blocked — nothing moves until you decide

> Two of these three cleared on 17 Sep (session 23). Only the contract §7.1 crack-column question is still open.

- [x] ~~**F8 blocked by the anchor budget.**~~ **Resolved twice. Session 23** kept the 1–99 range frozen and set a 495-scout ceiling. **Session 24 (17 Sep) removed the ID range entirely** on your instruction — the anchor count is `ceil(scouts / (cap-1))` with nothing truncating it, so **there is no ceiling at all** and F8 has no blocking constraint left. Adriyala is bit-identical (82 anchors, ₹1,029,000); Illinois unclamps 99 → 106.
  - [ ] **YOUR CALL: what is F8 for now?** Drop it and turn `n_panels: 8` on at the sourced spacing (419 anchors, ~1676 scouts — check cost and the 60 s TDMA uplink window), or keep re-spacing for cost/airtime reasons with a new target number from you. Banner at the top of [steps/F8-district-respace-tiers.md](steps/F8-district-respace-tiers.md) has both options.
- [x] ~~**G15 is `xfail(strict=True)`.**~~ **Passing again, 17 Sep (session 23).** Both `illinois_lw` xfail markers are gone: `illinois_lw` plans at 421 scouts → 99 anchors (33 still holding a spare slot), and Adriyala is bit-identical (327 scouts → 82 anchors, ₹1,029,000). **Invariant 8 is evidenced again and can be quoted to a judge.** Two new tests pin the hard cap, the ID range, and the headroom-trade rule so none of it can regress quietly.
- [ ] **Contract §7.1 decision — where do crack and vibration columns live?** F10 stopped short of putting them in `out/nodes.csv` because §7.1 freezes the column order ("Part 2 parses positionally"). They are in `out/cracks/` instead. **Amend the contract to append them, or leave them in their own file?** See `walkthroughs/step-f10-cracks/WALKTHROUGH.md` §5.

- [ ] **Small wart from the session-23 fix (not blocking, `illinois_lw` only).** When the planner spreads a mine over all 99 anchors, the greedy capacitated assignment can leave one anchor with **zero** children — a ₹3,500 box that carries nothing. Adriyala is unaffected (its lightest anchor has 1). Fix is a post-pass that steals a child for any empty anchor, or drop empty anchors from the count. **Your call whether it is worth a step.**

### 2.2 Renderer / Window 1

- [ ] **F7 — calm view, status dots, single-hue fixed-scale depth ramp, thinner slab.** Not built. The depth ramp is still the running-peak rainbow. Prompt is ready: paste §1 of [steps/F7-calm-view-nodes-colour.md](steps/F7-calm-view-nodes-colour.md) into Antigravity.
- [ ] **F12 — say whether the green is right.** Built and headless-checked. Green went L\* 27.3 → 62.6. Look at the screenshots in `walkthroughs/step-f12-view-cleanup/WALKTHROUGH.md`.
- [ ] **F9 hand check** — `walkthroughs/step-f9-shell/WALKTHROUGH.md` §5.
- [ ] **F10 hand check** — `walkthroughs/step-f10-cracks/WALKTHROUGH.md` §4.
- [ ] **F6 is superseded** for the district part (by F8) and never committed. Decide: drop the leftover or fold it in.

### 2.3 Scenario Lab (Windows 2 and 3)

Built so far: **T5** (frozen snapshot, `derive_fields`, gates **L4** + **L5**) and **W1** (sudden sinking, edge collapse).

- [ ] `pip install -e scenario-lab`, then the hand check in `walkthroughs/step-t5-w1-scenario-lab/WALKTHROUGH.md` §6.
- [ ] **W2 — crack scenario.** Prompt ready.
- [ ] **W3 — lab server + store + gates L1, L2, L3, L7.** Prompt ready. Nothing serves the pages until this exists.
- [ ] **W4 — Window 2 page + Window 3 placeholder.** Needs W3.
- [ ] **W5 — blast scenario.**
- [ ] **W6 — sinkhole + railway + pipe.**
- [ ] **The "Freeze + create subsidence" header button stays disabled until W3 + W4 land.** T5 + W1 gave it its physics, not its page.

### 2.4 Forecast path (Part 2 hand-off)

- [ ] **T7 — read + validate the ML forecast file** (gate **L6**: rejects p10 > p50, missing horizon, unknown node_id, NaN, wrong sign).
- [ ] **W7 — forecast → damage results.** Do this **before** W8.
- [ ] **W8 — forecast page.** Needs W7.
- [ ] **W9 — swap in the real ML file** — only if it has actually arrived.

### 2.5 v1 leftovers still not built

- [ ] **T1 — one script runs all gates** (gate checker).
- [ ] **T2 — live replay stream server** for backend/frontend.
- [ ] **T3 — same-seed determinism + timing check.**
- [ ] **T4 — 3D view: 5 fixes checked but never applied or committed.** Paste §4 of `steps/T4-3d-view.md`, then `Check step T4`.
- [ ] **T6 — cracks + damage grades for houses/roads/poles.** Largely overtaken by F10; decide whether T6 still has anything left in it.
- [ ] **V1 / V2 — demo script and dry run.**

### 2.6 Repo hygiene — this one is getting expensive

- [ ] **Nothing since 15 Sep is on `main`, and `main` itself is 2 commits ahead of `origin/main`.** Everything from sessions 16–22 (F1–F5, F9–F12, T5, W1) lives on branches that were never merged: `fix-the-system`, `feat/viz-darker-ground-bigger-nodes`, `fix/f1-no-wires` … `fix/f5-playback`, `docs/session-16-f1-f5`, `feat/realistic-mine-terrain-viz`, plus `fix/g15-mine-independence-cap5` (session 23, the G15 fix — branched off `feat/viz-darker-ground-bigger-nodes`, so it carries sessions 20–22's uncommitted work with it). **Merge to `main` and push.**
- [ ] **Sessions 20–22 are entirely uncommitted** — 27 modified files and 15 new paths in the working tree (`scenario-lab/`, `cracks.py`, `vibration.py`, `export_cracks.py`, four step files, four walkthroughs, today's project update).
- [ ] **Say `commit`** so sessions 10–12 (`run-simulation.sh`, `steps/`) get saved.
- [ ] **CI has not seen any of this** — it runs on push to `main` only. Check with `gh run list --limit 3` after the merge.

### 2.7 Parameters still not pinned to real data

52 values in `mine-sim/config/assumptions.yaml` are flagged `OPEN`: **32 `OPEN — guess`** (need a spec sheet or a field measurement), **14 `OPEN — VERIFY`** (mostly the new crack / damage / vibration constants from F10 — including `dgms_tensile_strain_limit_ue: 5300.0`, which the file itself says to "verify hard"), **5 `OPEN — design`** (our choice, just undocumented as final).

- [ ] Radio: `tx_power_dbm`, `sensitivity_dbm`, `link_margin_db_min`, `bernoulli_loss_prob` — replace with the SX1276-class spec sheet and a field packet-loss measurement.
- [ ] Site: `temperature_amplitude_c`, `temperature_period_days` — replace with a site temperature record.
- [ ] Crack / damage / vibration: the 14 `OPEN — VERIFY` values from F10. These feed damage grades, so they are the ones a judge can question.
- [ ] Read the survey line S position off the JMMF figure (not urgent).

### 2.8 Team and admin (not Antigravity's work, not Claude's)

- [ ] Send the teammate messages — `files/MY-STEPS.md` §E.
- [ ] GitHub invites for teammates.
- [ ] Hardware: `files/HARDWARE-CHECKLIST.md`.

---

## How to use this file

Pick **one** unticked box, do it, tick it. If a box needs a decision from you, it is in §2.1 — one of those three is left (the contract §7.1 crack-column question), and it comes first.
