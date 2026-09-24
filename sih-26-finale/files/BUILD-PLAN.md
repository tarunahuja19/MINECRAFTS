# BUILD PLAN — Mon 14 → Wed 16 Sep

**This is the only build plan.** Superseded plans were deleted on 14 Sep (backup: `~/Documents/sih26-cleanup-backup-2026-09-14.zip`).

- **What we're building (plain words):** `files/SIMULATION-IDEA.pdf`
- **Order of prompts per day:** `work-with-tools/<date>.md` · **What Adarsh does by hand per day:** `work-with-system/<date>.md` · **Decisions + messages:** `files/MY-STEPS.md`
- **Scenario Lab spec (formulas, JSON, owners):** `sih-26-finale-brain/work-packages/WP9-scenario-lab.md`
- **Team brief:** `files/TEAM-BRIEF-V1.md`

| Milestone | Time | Done means |
|---|---|---|
| **v1** | Tue 15 Sep 20:00 | Job 1: run → `nodes.csv` + terrain + stream → Window 1 (3D, SIMULATED). Team demo |
| **v2 first batch** | Wed 16 Sep 18:00 | Window 2 with sudden sinking, crack, edge collapse · houses, roads, poles · forecast view with test file |
| **v2 complete** | Wed 16 Sep 23:00 | + blast, sinkhole · railway, pipe · real ML file if it arrived |
| v3 | later | Window 3, more types, second mine, detailed radio TDMA, better formula |

**Rule for slips:** a first-batch item that isn't green by Wed 18:00 takes the owner's next slot, and the second-batch item it displaces moves to Thursday. Never skip a review to save time.

---

## 0. How every step works (the loop)

1. Adarsh pastes **PREAMBLE + the step prompt** into that AG window.
2. AG builds and writes `walkthroughs/step-XX-*/WALKTHROUGH.md` + `test_results.txt`.
3. Adarsh pastes the **REVIEW prompt** (§5) into Claude Code with the step id.
4. Claude replies **PASS** or a **numbered fix list**. Fixes go back to the same AG window.
5. On PASS Adarsh says "commit step XX". Claude commits only that step's owned files.

**PREAMBLE (paste before every AG prompt):**
> Before you start, read `AGENTS.md`, `files/11-interface-contracts-v1.md` (authoritative inside `mine-sim/`), `sih-26-finale-brain/RULES.md`, your WP file, and `files/BUILD-PLAN.md` (the step you're given). For anything in `scenario-lab/` or `renderer/`, `sih-26-finale-brain/work-packages/WP9-scenario-lab.md` is authoritative. **Only edit the files your step lists.** If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in `scenario-lab/` gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: **negative = ground went down**. Python: `/opt/miniconda3/envs/pinn-sandbox/bin/python3.11`. Run tests from inside `mine-sim/` (or `scenario-lab/`). Report the exact pytest count; never say "tests pass" without it.

**Step ids:** `M` = Monday, `T` = Tuesday, `W` = Wednesday. Number = order in the day.

---

## 1. MONDAY 14 SEP — Job 1 core

### M1 · AG-1 · Config keys → WP2 sizing (v1 cut) · ~4 h

> [PREAMBLE] **Part A — config** (files: `mine-sim/config/assumptions.yaml`, `mine-sim/src/minesim/config.py`, `mine-sim/tests/unit/test_config.py`). Add a `sensors:` block (per tier 1A/1B/1C: `resolution`, `bias`, `temp_drift_per_c`, `noise_sigma`; shared: `temperature_amplitude_c`, `temperature_period_days`, `monument_position_tolerance_m`) and radio keys (`A11_frequency_mhz`, `tx_power_dbm`, `sensitivity_dbm` per SF, `link_margin_db_min`, `bernoulli_loss_prob`). Use datasheet-plausible values, each commented `# OPEN — guess, replace with hardware spec sheet`. A null raises `UnpinnedParameterError`. Existing fields unchanged. Run pytest and report.
>
> **Part B — WP2 sizing, v1 cut** (files: `mine-sim/src/minesim/sizing.py`, `mine-sim/tests/unit/test_sizing.py`, `mine-sim/tests/gates/test_g02.py`, `test_g03.py`, `test_g12.py`, `test_g15.py`). `size_network(cfg)` takes ONE parameter. Travelling cross: a transverse line across `cfg` extent (`width + 2r`) and a longitudinal line along the travelling window, spacing from config, the shared crossing counted once. Tier from strain-field percentiles (no literals). Anchors hold ≤ `max_children_per_anchor`; every Scout has `child_index` and a `backup_parent_id` different from its parent. IDs: Gateway 0, Anchors 1–99, Scouts 100+. Cost breakdown reported, never capped. **Node count is whatever this outputs; a test asserts it changes when `spacing_m` changes.** v1 cut: no Fresnel/relaxation loop; `relaxation_steps = ()` with a `# v3: Fresnel relaxation` comment. Each gate has a negative case. Walkthrough `walkthroughs/step-02-wp2-sizing/`. Report counts per tier, cost and test count.

### M2 · AG-3 · Physics bug fix (FIRST, ~45 min) → WP5 radio (v1 cut) → run.py

> [PREAMBLE] **Part 0 — physics fix, do this first** (files: `mine-sim/src/minesim/physics.py`, `mine-sim/tests/unit/test_physics.py`). Claude found two bugs on 14 Sep:
> (1) `displacement()` points **away** from the trough. At (x=1000, y=150, t=690), `uy` = +327 mm, but ground moves toward the trough centre, so it must be negative. Fix: `ux = +B · tilt_x_urad · 1e-3` (and the same for y), with `B = r/√(2π)` unchanged.
> (2) `strain()` differences **vertical subsidence**, so it returns tilt (at y=150, strain −6744 µε equals tilt −6753 µrad). Fix: horizontal strain = `(u(x + b/2) − u(x − b/2)) / b`, using `displacement()` along the axis, in µε.
> (3) `subsidence()` never uses `panel.length_m`, so the face keeps going past the panel end: at day 690 it is at 2760 m on a 2500 m panel. Fix inside `subsidence()`: `x_face = min(face_position(t_days, params), panel.length_m)`. Leave `face_position`'s signature alone (contract); callers that need the face on screen use the same `min`.
> New tests: `uy(1000,150,690) < 0`; `strain_y(1000,150,690,b=10) > 0` (tension outside the rib); `strain_y(1000,0,690,b=10) < 0` (compression over the centre); `strain` no longer equals `tilt`; `subsidence(2500 + 3r, 0, 690) < 1` mm (today it's 14.7 mm because the face runs on to 2760 m); peak at (1000, 0, 690) still ≈ 930 mm; G01 still passes. Don't change any signature. Walkthrough `walkthroughs/step-01b-physics-sign-fix/`. Report before/after values at y = 0, 60, 150, 200 and S at x = 2400, 2500, 2600 on day 690.
>
> **Part A — WP5 radio, v1 cut** (files: `mine-sim/src/minesim/packet.py`, `mine-sim/src/minesim/radio.py`, `mine-sim/tests/unit/test_radio.py`, `mine-sim/tests/gates/test_g07.py`). Semtech airtime formula, tested against the contract table within 0.5 ms (23 B SF7 = 61.7 ms, 98 B SF8 = 297.5 ms, 6 B SF7 = 36.1 ms). One superframe per simulated hour. Each Scout packet gets free-space path loss, a link-margin check and Bernoulli loss from config → `TxRecord(delivered, rssi_dbm, parent_used)`. Undelivered packets still produce a record. Dedup key `(node_id, epoch)`, never `seq`; G07 = AST check + reboot test. Keep `Superframe`'s contract signatures; unimplemented methods raise `NotImplementedError("v3")`. Walkthrough `step-05`.
>
> **Part B — wire `run.py`** once AG-4's writers exist (files: `mine-sim/src/minesim/run.py`, `mine-sim/tests/unit/test_run.py`). Load config → `size_network` → `WorldState` → per step: `world.step()` → write delta → `read_node` per Scout → radio → write rows. CLI `python -m minesim.run --days N --out DIR`. Use fakes for modules not merged yet. Test: a 2-day run produces all four artefacts.

### M3 · AG-2 · WP3 world state (full) → WP4 sensors (v1 cut) · ~6 h

> [PREAMBLE] **Part A — WP3, full** (files: `mine-sim/src/minesim/world.py`, `mine-sim/tests/unit/test_world.py`, `mine-sim/tests/gates/test_g06.py`, `test_g13.py`). `np.int32` mm grid, **shape `(nx, ny)` with `i` ↔ x and `j` ↔ y**, cell centre `origin + (i + 0.5)·cell`. Integer accumulation, one vectorised `physics.subsidence` call per step, `z = z0 − S`, every `dz ≤ 0`, empty `cells` on zero-motion steps. **Compute `dz = round(S_t) − current_int_S`, never `round(S_t − S_{t−1})`**: rounding each increment drifts by up to 0.5 mm per step over 16 560 steps. Test: after the 690-day run, `max |grid_S − round(physics S)| ≤ 1` mm. G6 uses `np.array_equal` for full and partial replay, and a float-accumulation variant must fail it. G13: `z0_mm` never changes. Time a 690-day world-only run and report it (don't block if > 60 s). Use a hand-made Layout fixture if sizing isn't merged. Walkthrough `step-03`. Report runtime and peak subsidence at day 690 (expect ≈ 930 mm, ~27% below the measured 1267 mm; report it, don't tune it).
>
> **Part B — WP4, v1 cut** (files: `mine-sim/src/minesim/sensors.py`, `mine-sim/src/minesim/provenance.py`, `mine-sim/tests/unit/test_sensors.py`, `mine-sim/tests/gates/test_g04.py`). **Wait for M2 Part 0 (physics fix) to be committed.** `read_node(node, world, cfg, rng)` exactly per contract §5. **Output signs:** `subsidence_mm = world.z_at(x,y) − z0_mm` (≤ 0); `tilt_*_urad = −physics.tilt(...)` (so + = surface rises toward +x/+y); strain from the fixed `physics.strain` (+ = tension). 1A tilt; 1B strain over `A8` + displacement; 1C strain over `A9`. Pipeline: ideal → quantise → bias → temperature drift → Gaussian noise, params from `cfg.sensors`, rng passed in. Provenance per contract rules; tilt/strain/displacement/battery always `synthetic`. G04 test. G05 → v3 (TODO in walkthrough). Walkthrough `step-04`. Report the real/pinned/synthetic % over a 30-day run and the sign of each column at a node outside the rib.

### M4 · AG-4 · Step 0 minimal fix → WP6 writers · ~4 h

> [PREAMBLE] **Part A — Step 0 fixes** (see `walkthroughs/step-00-wp0-wpc-data-pinning/CLAUDE-REVIEW.md`; files: `mine-sim/data/fitted/*.json`, `mine-sim/tests/gates/test_g00.py`, the Illinois CSV (move), `mine-sim/config/mines/illinois_lw.yaml` (`pinning.source` only), `walkthroughs/step-00-wp0-wpc-data-pinning/*`). (1) R0-1: `fit.r_squared` = Knothe R² (0.8201); Table 3 numbers go in a separate `profile_function` block; G00 asserts the verdict + escalation are recorded and reports Knothe R², with no `≥ 0.90` check on the wrong model; keep a negative case. (2) R0-2: `git mv` the Illinois CSV to `mine-sim/data/fixtures/illinois_synthetic_profiles.csv`, set `pinning.source: "UNVERIFIED — synthetic fixture"`, fix paths in tests. (3) R0-6: WALKTHROUGH §2 stub modules → "not yet testable"; §7 grep correction. Don't change any pinned value. pytest → `test_results.txt`. Report.
>
> **Part B — WP6 writers** (files: `mine-sim/src/minesim/stream.py`, `mine-sim/tests/unit/test_stream.py`). `nodes.csv` header EXACTLY contract §7.1 (21 columns in order); empty string for fields a tier lacks; rows for undelivered packets; flush per epoch. `terrain_state.npz` keys: `origin_x_m`, `origin_y_m`, `cell_m`, `shape`, `z0_mm` (int32, `(nx, ny)`, i ↔ x). `terrain_changes.jsonl`: one line per step, ints, empty cells allowed. `run_summary.json`: mine, DOI, node counts per tier, cost, epochs, `timestep_s`, packets, delivery rate, real/pinned/synthetic counts + %, fit RMS + Knothe R², sign string `"negative_down"`. Tests: header order, jsonl round-trip exact, replay npz + jsonl == final grid. Build against fake `Reading`s until M3 lands. Walkthrough `step-06`.

### M5 · Claude · 20:00 sample (FAKE if needed) → real 30-day run when M1–M4 pass

> **At 20:00, whatever state the code is in:** if `run.py` can't do a 30-day run yet (likely: M3 alone is ~6 h), write `handoff/v1-sample/README.md` + `nodes_FAKE.csv` with the exact header and 20 hand-written rows labelled FAKE, for parser development only, commit it, and give me the message so ML and backend aren't waiting. **When M1–M4 have all passed (tonight or Tue 09:00):** run pytest; `python -m minesim.run --days 30 --out out/v1-30d`. Check the csv header matches §7.1, subsidence ≤ 0, tilt/strain signs match BUILD-PLAN M3 at a node outside the rib, replay equals the final grid, every value column has a valid `_prov`. Fix-list anything cross-lane, tagged by AG window. If it passes, copy the outputs to `handoff/v1-sample/` with a README (how generated, seed, row count, sign rule, "synthetic data, not field measurements"), commit, and give me the one-line message for the ML and backend teammates. Delete `nodes_FAKE.csv` in the same commit. Then write the session log.

---

## 2. TUESDAY 15 SEP — finish Job 1 (v1) + start v2 groundwork

| Window | 09:15 → ~12:00 (v1) | 13:00 → 18:00 (v2 groundwork) |
|---|---|---|
| AG-1 | T1 WP7-lite harness + G14 | T5 lab skeleton: snapshot + fields |
| AG-2 | T2 WebSocket replay | T6 cracks + objects + damage |
| AG-3 | T3 690-day run + performance | T7 forecast input pipe |
| AG-4 | T4 Window 1 renderer (until ~16:00) | demo polish with Claude |

**09:00 · Claude:** "Start-of-session per CLAUDE.md. Gate table for what exists. Anything from Monday that didn't pass goes first in its AG window."

### T1 · AG-1 · WP7-lite harness + G14

> [PREAMBLE] Files: `mine-sim/tests/gates/test_g14.py`, `mine-sim/scripts/run_gates.py`, `mine-sim/GATES.md`. G14: static scan of all `mine-sim/src/`: no torch/tensorflow/jax/keras/sklearn imports, no alarm/threshold/classify/should_alarm logic; negative cases with temp files. `run_gates.py` runs each existing gate file alone and prints gate / pass-fail / seconds, then writes `GATES.md` (gates not built are listed as "v3 — not built", never faked). Exit 1 on failure.

### T2 · AG-2 · WebSocket replay server

> [PREAMBLE] Files: `mine-sim/src/minesim/stream.py` (add the server, keep the writers unchanged; AG-4 no longer touches this file), `mine-sim/tests/unit/test_ws.py`. FastAPI `/ws/run` streams frames exactly per contract §7.4 by reading a finished run's `nodes.csv` + `terrain_changes.jsonl` (replay mode). Controls: start, pause, seek (seek replays from t=0). No endpoint deforms terrain. TestClient test: ordered, gap-free epochs. Document the one-line start command for the backend team in the walkthrough.

### T3 · AG-3 · Full run + performance

> [PREAMBLE] Run `python -m minesim.run --days 690 --out out/v2-690d`. Report wall time and `run_summary.json`. If > 20 min, profile and fix only your own modules (vectorise; no Python loops over grid cells), or report which module is slow and who owns it. Run the same seed twice for 7 days → `cmp` the csvs (must be identical).

### T4 · AG-4 · Window 1 renderer (WP8 steps 1–3)

> [PREAMBLE] Read `sih-26-finale-brain/work-packages/WP8-consequence-renderer.md` (§3 safety rules) and `WP9-scenario-lab.md` §9 (Window 1 row, Three.js URLs). Nothing to install.
>
> **Files you may create (nothing else):** `renderer/config.yaml`, `renderer/export_scene.py`, `renderer/index.html`, `renderer/js/terrain.js`, `renderer/tests/test_export_scene.py`, `renderer/.gitignore` (ignore `scene/`), `walkthroughs/step-09-wp8-renderer/WALKTHROUGH.md`, `test_results.txt`, 3 screenshots. Do not edit anything in `mine-sim/` or the vault.
>
> **Input** = a finished run folder, default `mine-sim/out/v2-690d` (made by `./run-simulation.sh`; do not rerun it). `terrain_state.npz`: `z0_mm` int32 (617, 167), `origin_x_m`, `origin_y_m`, `cell_m`. `terrain_changes.jsonl` (243 MB): one line per hour `{"epoch", "t_s", "cells": [[i, j, delta_mm], …]}`. `nodes.csv`: columns in `files/11-interface-contracts-v1.md` §7.1 (use `node_id, epoch, tier, x_m, y_m, z0_mm, subsidence_mm, subsidence_prov, delivered`; a column is blank when that node's tier doesn't measure it). `run_summary.json`: `timestep_s`, `days`. Reference replay: `minesim.stream.replay_terrain(run_dir, to_epoch)`.
>
> **`config.yaml`** (every key with a `# source:` comment): `run_dir`, `day_step_days` (10), `downsample_cells` (2), `vertical_exaggeration` (display choice).
>
> **`export_scene.py --run DIR`** → `renderer/scene/scene.json`. Read the jsonl **once** (no replay per day), take a grid snapshot at day 0, every `day_step_days`, and the last day (epoch = day·86400/timestep_s). Grid = `z[::k, ::k]` int mm, negative = down, plus origin and cell size. Face x per day = `min(cfg.knothe.advance_m_per_day · day, cfg.panel.length_m)` with `cfg = minesim.config.load_config("mine-sim/config/assumptions.yaml")`: **never import `minesim.physics`**. Nodes per exported day: node_id, tier, x, y, live z = z0_mm + subsidence_mm, subsidence_prov, delivered. Print the file size (target < 30 MB).
>
> **Page** (`index.html` + `js/terrain.js`; Three.js r128 + OrbitControls from the WP9 §9 URLs; all paths relative): **SIMULATED** banner always visible; "vertical ×N" label; day slider over exported days; face marker; nodes coloured by provenance with a legend; undelivered nodes visibly different (hollow/grey); **"Freeze + create subsidence"** button → `scenario.html?day=<day>` if a `fetch('scenario.html', {method: 'HEAD'})` succeeds, otherwise the message "available in v2 (Wednesday)". No control changes terrain. `terrain.js` holds reusable surface drawing (Wednesday reuses it). Opened with `cd renderer && python3 -m http.server 8000`.
>
> **Tests** (`renderer/tests/`, run from repo root with the pinn-sandbox python): make an 80-day run once per test session (`minesim.run.run_sim` into tmp, ~6 s; a 2-day run has no subsidence and proves nothing) → assert the grid actually changed, then the single-pass snapshots at days 40, 70, 80 `array_equal` `replay_terrain` at those epochs; exported grid equals `replay[::k, ::k]`; face x never above panel length; `grep` proves no `minesim.physics` in `renderer/`; `index.html` contains `SIMULATED`. Also export `mine-sim/out/v2-690d` for real and report size + time.
>
> **Report:** pytest count for `renderer/tests` and for `mine-sim` (must still be 129), scene.json size, export time, screenshots at day 0 / ~345 / 690, the open command. Then STOP and wait for review.

### T5 · AG-1 · Scenario Lab skeleton (after T1 passes)

> [PREAMBLE] WP9 §2–§4, §8 (L4, L5). Files: `scenario-lab/pyproject.toml`, `scenario-lab/config/lab.yaml`, `scenario-lab/lab/__init__.py`, `lab/config.py`, `lab/snapshot.py`, `lab/fields.py`, `lab/events/__init__.py`, `lab/events/base.py`, `scenario-lab/tests/test_snapshot.py`, `tests/test_fields.py`, `tests/gates/test_l4.py`, `tests/gates/test_l5.py`, `scenario-lab/.gitignore` (ignore `store/`). Install with `pip install -e scenario-lab`. `lab.yaml` keys (each with a `source:` comment): `settled_time_coefficient_per_day`, `min_effect_mm`, `world_model_tolerance_mm`, `display_cell_m`, `spread_min_weight`, `store_dir`, `port`, `id_hash_chars`, `test_forecast_band_fraction`, `test_forecast_band_min_mm`. Implement `Grid`, `Snapshot`, `load_snapshot`, `Fields`, `derive_fields`, `EventResult` and an empty `EVENTS` registry **exactly** as WP9 §4 with the §3 conventions. `load_snapshot` replays npz + jsonl up to `epoch = round(day · 86400 / timestep_s)` and must `array_equal` the WP3 replay; it also fills `s_model_mm` from `physics.subsidence` and checks it against `s_mm` (WP9 §3 derivatives rule: **fields never come from the int grid**). Tests: snapshot equality on `out/v2-690d` (or a 2-day run made in the test); `s_model_mm` within tolerance of `s_mm`; day beyond run → ValueError; L4 literal scan; L5 as written in WP9 §8 (float grid, int array → TypeError). Walkthrough `walkthroughs/step-10-lab-skeleton/`.

### T6 · AG-2 · Cracks + objects + damage limits (after T2 passes)

> [PREAMBLE] WP9 §6. Files: `scenario-lab/config/damage_limits.yaml`, `scenario-lab/config/objects.yaml`, `scenario-lab/lab/cracks.py`, `lab/objects.py`, `lab/consequence.py`, `scenario-lab/tests/test_cracks.py`, `tests/test_consequence.py`. If T5 isn't merged, code against the WP9 §4 dataclasses with hand-built arrays. `damage_limits.yaml`: house grades I–IV exactly as WP9 §6 (`verified` flags as stated, source strings), DGMS PPV table for domestic houses (5/10/15), `crack.threshold_mm_per_m: 3.0` with the WP9 §6 source and `width_model_sourced: false`. `objects.yaml`: first-batch objects exactly as WP9 §6 (H1–H8, R1, R2, P1–P8, T1) with `layout: illustrative, not the real Adriyala surface`. `consequence.evaluate(before_s_float_mm, after_s_float_mm, grid, cfg, ppv_mm_s=None, frequency_band=None) -> dict` (when `ppv_mm_s` is given, each house also gets the DGMS check for `frequency_band`) returns the `cracks`, `objects` and `summary` parts of the WP9 §7 JSON (negative-down numbers), with one plain sentence per object. Tests: grade boundaries at exactly 2.0 / 3.0 / 0.2 and just above; worst-of-three rule; pole lean = tilt × height; road crack found only within search distance; objects outside the grid → error; identical before/after → no new cracks and grades unchanged; on the float day-300 surface H1 = III, H2 = II, H5 = I (values checked by Claude on 14 Sep); an object in a masked cell → "No forecast covers this object"; a PPV array above the DGMS limit gives the "over limit" sentence. Walkthrough `step-11-lab-consequence`.

### T7 · AG-3 · Forecast input pipe (after T3 finishes)

> [PREAMBLE] WP9 §7 (Forecast input, Spread) and `sih-26-finale-brain/docs/interface-ml-to-renderer.md` §2b. Files: `scenario-lab/lab/forecast.py`, `lab/spread.py`, `lab/tools/__init__.py`, `lab/tools/make_test_forecast.py`, `scenario-lab/fixtures/`, `scenario-lab/tests/test_forecast.py`, `tests/test_spread.py`, `tests/gates/test_l6.py`. `forecast.load_forecast(path, run_dir) -> ForecastNodes` validates every §2b rule and raises `ContractViolation`-style `ValueError`s with plain messages. `make_test_forecast --run DIR --issued-day D --out FILE`: p50 = the run's true cumulative subsidence at each Scout at +24 h / +72 h (terrain replay at the node position); p10/p90 = p50 ∓ band, band = `test_forecast_band_fraction · |p50 − current| + test_forecast_band_min_mm`; `model_id: "TEST-FIXTURE-simulator-truth-not-ML"`. `spread.spread(forecast, snapshot, horizon, pct) -> (after_s_mm, mask)` per WP9 §7. Tests: L6 negative cases (5); the test fixture validates; spread equals Δ at an isolated node; far cells masked. Commit `fixtures/test_forecast_day300.json` made from `out/v2-690d` (or the longest run). Walkthrough `step-12-lab-forecast-input`.

### Tuesday integration and demo

- **16:00 · Claude:** "Integration v1: pytest count in `mine-sim/`; `python scripts/run_gates.py`; confirm the 690-day (or longest) run's artefacts parse and replay exactly; start the WS server and receive 100 ordered frames; export the renderer scene. Refresh `handoff/v1-sample/` with the longest run (≤ 50 MB, otherwise a 120-day run). Write `handoff/DEMO-SCRIPT-V1.md` with the exact commands for the 20:00 demo, each with what the team should see. Commit. Session log."
- **18:00 · Adarsh:** dry run following the demo script.
- **20:00 · Team demo.**
- **After the demo · Claude:** review T5, T6, T7 (REVIEW prompt, §5).

---

## 3. WEDNESDAY 16 SEP — Jobs 2 and 3 (v2)

| Window | 09:00 → 13:00 | 14:00 → 18:00 | 19:00 → 22:00 |
|---|---|---|---|
| AG-1 | W1 sudden sinking + edge collapse | W5 blast vibration | fixes from the 18:00 review |
| AG-2 | W2 crack scenario | W6 sinkhole + railway + pipe | fixes |
| AG-3 | W3 lab server + store + L1–L3, L7 | W7 forecast consequence endpoint | W9 real ML file (if arrived) |
| AG-4 | W4 Window 2 + Window 3 placeholder | W8 forecast view | fixes + screenshots |

**09:00 · Claude:** "Start-of-session per CLAUDE.md. Status of T5–T7. Anything not passed goes first."
**13:30 · Claude:** mid-day review of W1–W4.
**18:00 · Claude:** first-batch gate (§4).
**22:00 · Claude:** final integration (§4).

### W1 · AG-1 · Scenario types 1 and 3

> [PREAMBLE] WP9 §5 rows 1 and 3. Files: `scenario-lab/config/events/sudden_sinking.yaml`, `config/events/edge_collapse.yaml`, `scenario-lab/lab/events/sudden_sinking.py`, `lab/events/edge_collapse.py`, `lab/events/__init__.py` (register both), `scenario-lab/tests/test_sudden_sinking.py`, `tests/test_edge_collapse.py`. Each yaml lists every input with `default`, `min`, `max`, `unit`, `source: "scenario input — not measured at this mine"`. Call `physics.subsidence` only; **never write a second trough formula**. Tests on `out/v2-690d`: (a) sudden sinking 10 m behind the face at day 300 → possible, `max(ds) > 0` at the click; (b) at (100, 0) on day 690 → not possible, reason says "already settled"; (c) at (1500, 0) on day 300 (300 m ahead of the face) → not possible, reason says "no extracted coal"; (d) `ds ≥ 0` everywhere and `ds == 0` beyond `R + r`; (e) edge collapse at (600, +150) on day 300 with `pillar_width_m = 20` → `ds` ≈ 147 mm at (600, 150) (± 5%), `ds < min_effect` at (600, −150), max tilt near the +y rib increases; (f) y0 = 0 → not possible; (g) same inputs → identical arrays. Walkthrough `step-13-lab-sinking-edge`. Report `max(ds)` and the reason text for each test. Reference values (Claude, 14 Sep): sudden sinking capacity U at (1190, 0), day 300 ≈ 524 mm; at (100, 0), day 690 ≈ 0.15 mm.

### W2 · AG-2 · Scenario type 2 (crack)

> [PREAMBLE] WP9 §5 row 2 and §6 cracks. Files: `scenario-lab/config/events/crack.yaml` (`days_ahead` input spec; `nearby_radius_m`, `min_rate_mm_per_day`, `rate_window_days` with sources), `scenario-lab/lab/events/crack.py`, `scenario-lab/tests/test_crack_event.py`. Tests: `days_ahead = 0` → `ds == 0`; a huge `days_ahead` never makes `ds` exceed U (the cap); a point where the 24 h rate is 0 → not possible, reason "not moving now"; near the face at day 300 with `days_ahead = 30` → possible, and `consequence.evaluate` reports new cracks > 0 or the "strain stays below threshold" reason with the numbers; deterministic. Walkthrough `step-14-lab-crack`.

### W3 · AG-3 · Lab server + store + gates L1–L3, L7

> [PREAMBLE] WP9 §7, §8. Files: `scenario-lab/lab/scenario.py` (`run_scenario(run_dir, request) -> dict`: snapshot → event → `consequence.evaluate` → full WP9 §7 JSON, window crop, negative-down ints), `lab/store.py`, `lab/server.py` (all endpoints in §7 except `/api/forecast/consequence`; serves `renderer/` at `/`), `scenario-lab/tests/test_server.py`, `tests/gates/test_l1.py`, `test_l2.py`, `test_l3.py`, `test_l7.py`. `/api/events` builds the form spec from `config/events/*.yaml`, never from code. Unknown type or out-of-range param → HTTP 422 with a plain message. If W1/W2 aren't merged, register a fake event in tests only. Tests: every endpoint via TestClient; L1 hashes the run dir before and after running every registered type; L2 byte-identical repeat; L3 import scan + write-location check; L7 `label` present. Walkthrough `step-15-lab-server`. One-line start command.

### W4 · AG-4 · Window 2 (scenario page) + Window 3 placeholder

> [PREAMBLE] WP9 §7 (JSON), §9 (Windows 2 and 3). Files: `renderer/scenario.html`, `renderer/js/scenario.js`, `renderer/after.html`, `renderer/tests/test_pages.py`, `renderer/fixtures/scenario_example.json` (hand-written from WP9 §7 so you aren't blocked on W3). Reuse `js/terrain.js`. Page: SCENARIO banner "SCENARIO (HYPOTHETICAL) · frozen at day T · not sent to backend or ML", always visible; frozen surface from `/api/snapshot?day=T`; objects drawn (house = box, road/railway/pipe = line, pole = cylinder); click → marker + x, y + current subsidence; form built from `/api/events`; Run → POST `/api/scenario`; Before / After / Difference toggle; tilt and strain colour layers with legends and units; cracks as short red segments; PPV layer when present; objects coloured by grade (I green → IV red, "no limit" grey) + the plain sentences list; summary box on top; when `possible` is false, the reason appears in large text and the surface doesn't change; saved scenarios list from `/api/scenarios`. `after.html`: banner + "Window 3 — sensor data after the event — planned for v3" + a link back. `test_pages.py`: banner strings present in every page; JS fetches only `/api/...` paths; no element changes Window 1. Screenshots into `walkthroughs/step-16-window2/`: before, after sudden sinking, a not-possible case, a crack case.

### W5 · AG-1 · Scenario type 4 (blast)

> [PREAMBLE] WP9 §5 row 4 and §6 (DGMS). Files: `scenario-lab/config/events/blast.yaml` (`charge_kg_per_delay`, `frequency_band` input specs; `K: null`, `b: null`. **First 20 minutes:** look for one published USBM-form regression (K, b) from an Indian coal mine; if found, fill both with the full citation and `verified: true`; if not, leave them null so the event returns its "not set" reason. Never enter guessed values; `min_distance_m`, `display_min_mm_s`), `scenario-lab/lab/events/blast.py`, register it, `scenario-lab/tests/test_blast.py`. `consequence.evaluate` already handles PPV (T6); don't edit it. Tests (use test-only K, b injected in the test, not the yaml): PPV decreases with distance; formula checked at 3 points; null constants → not possible with the reason; doubling Q scales PPV by `2^(b/2)`; house over the DGMS limit for the chosen band → "over limit" sentence; `ds_mm is None`. Walkthrough `step-17-lab-blast`.

### W6 · AG-2 · Scenario type 5 (sinkhole) + railway + pipe

> [PREAMBLE] WP9 §5 row 5 and §6 (railway, pipe, RL1, PP1). Files: `scenario-lab/config/events/sinkhole.yaml` (all five inputs with defaults/ranges and `source: "scenario input — typical Indian bord & pillar, not this mine"`; `indian_max_cover_ratio` with the ResearchGate source), `scenario-lab/lab/events/sinkhole.py`, register it, `scenario-lab/config/objects.yaml` (add RL1, PP1), `lab/objects.py` + `lab/consequence.py` (railway and pipe metrics), `scenario-lab/tests/test_sinkhole.py`, `tests/test_consequence.py` (extend). Tests: k = 1.5, m_g = 3, h_c = 10 → not possible, reason gives H = 6 m and includes the erosion note (10 ≤ 35 × 3); h_c = 120 → not possible and no erosion note; h_c = 5 → depth 500 mm at the click and the reason says "upper bound"; railway Δs over the base; pipe strain projection at α = 0 equals εx and at α = 90° equals εy. Walkthrough `step-18-lab-sinkhole`.

### W7 · AG-3 · Forecast consequence endpoint

> [PREAMBLE] WP9 §7 (Forecast consequence result). Files: `scenario-lab/lab/forecast_consequence.py`, `lab/server.py` (add `POST /api/forecast/consequence` and `GET /api/forecasts`, which lists `scenario-lab/fixtures/*.json` plus any file in `lab.yaml` `forecast_dir`), `scenario-lab/tests/test_forecast_consequence.py`. For each horizon × percentile: `spread` → `consequence.evaluate` → the result block, with `mask`. `test_input` true when `model_id` starts with `TEST-FIXTURE`. Tests: the test fixture produces 6 blocks; the p10 block has max sinking ≥ p50 ≥ p90 at the same cell; an invalid file → 422 with the validator message. Walkthrough `step-19-lab-forecast-consequence`.

### W8 · AG-4 · Forecast view

> [PREAMBLE] WP9 §9 (Forecast row). Files: `renderer/forecast.html`, `renderer/js/forecast.js`, `renderer/tests/test_pages.py` (extend). File picker from `/api/forecasts` + upload; FORECAST banner; a red TEST INPUT banner when `test_input`; issued day and horizon always visible; 24/72 h switch; p10/p50/p90 switch (default p50) and a "range" view showing p10 and p90 side by side; masked cells hatched grey with "no prediction here"; objects + plain sentences; node markers. A link from Window 1. Screenshots into `walkthroughs/step-20-forecast-view/`.

### W9 · AG-3 · Real ML file (only if the ML teammate sent one)

> [PREAMBLE] Validate the ML teammate's file with `lab.forecast.load_forecast`. If it fails, write the exact failures into `handoff/ML-FORECAST-FEEDBACK.md` in plain words, and don't modify their file. If it passes, copy it to `scenario-lab/fixtures/` and run W7's test on it. Report.

---

## 4. Claude integration prompts (Wednesday)

**18:00 · first-batch gate:**
> First-batch gate: pytest counts in `mine-sim/` and `scenario-lab/`; `run_gates.py`; start `lab.server` on the 690-day run; run sudden_sinking, crack and edge_collapse through the API at the three WP9 test points each; confirm L1–L7; open Window 1 → Freeze → Window 2 → run each type → screenshots; forecast view with the test fixture. PASS/FAIL table per first-batch item. Anything failing gets a fix list per AG window, and the second-batch item it displaces moves to Thursday.

**22:00 · final integration:**
> Final v2 integration: everything from the 18:00 gate plus blast, sinkhole, railway, pipe, and the real ML file if present. Write `handoff/DEMO-SCRIPT-V2.md` (commands + what to show, Windows 1 → 2 → 3 → forecast). Update `walkthroughs/README.md`. List what moved to v3. Commit. Session log. Run the vault check + both pytest suites and report the counts.

---

## 5. REVIEW prompt (Claude, after any step)

> Review step `<id>` (`walkthroughs/step-XX-*`) against `files/11-interface-contracts-v1.md` (inside mine-sim), WP9 (scenario-lab/renderer), and BUILD-PLAN `<id>`. Run the full pytest for the affected package and this step's gates alone; diff dataclasses/signatures/JSON keys against the spec; grep for numeric literals; break one invariant in a scratch copy to confirm the gate fails; check that only owned files changed; check signs at every boundary. PASS or a numbered fix list.

---

## 6. Who owns which file (conflict check)

| Window | Mon | Tue | Wed |
|---|---|---|---|
| AG-1 | config.py, assumptions.yaml, sizing.py | GATES/run_gates, lab skeleton (config, snapshot, fields, events/base) | events/sudden_sinking, edge_collapse, blast |
| AG-2 | world.py, sensors.py, provenance.py | stream.py (WS only), cracks, objects, consequence, damage_limits, objects.yaml | events/crack, sinkhole; objects/consequence (railway, pipe) |
| AG-3 | physics.py (fix), packet.py, radio.py, run.py | (run only), forecast, spread, make_test_forecast | scenario, store, server, forecast_consequence |
| AG-4 | Step 0 files, stream.py (writers) | renderer index/export/terrain.js | renderer scenario/after/forecast pages |

`stream.py` passes from AG-4 (Mon) to AG-2 (Tue) after M4 is committed. `consequence.py` is AG-2's only. `server.py` is AG-3's only.
