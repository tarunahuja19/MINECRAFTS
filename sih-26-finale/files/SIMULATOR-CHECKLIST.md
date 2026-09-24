# SIMULATOR + CONSEQUENCE RENDERER CHECKLIST — PS 26025

**Owner:** Adarsh (one person), with Antigravity (AG-1…AG-4) writing code and Claude Code planning and checking.
**Companion files:** `HARDWARE-CHECKLIST.md`, `SOFTWARE-CHECKLIST.md`, `RECOMMENDATIONS.md`.
**Scope rule:** every item traces to one of: a gate (G00–G15), a work package (WP0–WP8), a recommendation (R1–R7), a hardware/software checklist item it depends on, or a review finding (R0-x). Anything that traces to none of these doesn't belong in this list.
**Sprint:** Sep 14–16 (3 days). Code floor first, renderer second. The hard stop (R1) is written in §3.4.

---

## 0. The one-sentence job

Generate ground movement from real fitted mine data, simulate the node mesh that reads it, stream every value with an honest provenance tag, and **draw what a forecast means on the ground in a way nobody can mistake for footage.**

---

## 1. Step 0 closure — data pinning must be honest before anything downstream is trusted

Source: `walkthroughs/step-00-wp0-wpc-data-pinning/CLAUDE-REVIEW.md`

| # | Item | Done when | ☐ |
|---|---|---|---|
| S0.1 | **DEC-1 decided** with the real peak numbers in front of you: pinned Knothe peaks at ~930 mm vs measured 1267 mm (−27%) | Decision written in vault `projects/subsidence-simulator/decisions` | ☐ |
| S0.2 | `fit.r_squared` in `adriyala_lw1_params.json` is the **Knothe** R² (0.82), not the Table 3 R² (0.986) — R0-1 | JSON fixed; G00 threshold rewritten to match DEC-1; gate still has a negative case | ☐ |
| S0.3 | **Illinois dataset traced to its source PDF, or relabelled synthetic** — R0-2 | Either page/figure references in the CSV `source` column, or file moved to `data/fixtures/` and removed from any "two real datasets" claim | ☐ |
| S0.4 | `fitting.py` fits `physics.subsidence` itself (one S(x,y,t) — Invariant 4); G01 stops skipping `fitting.py` — R0-4 | G01 scans all of `src/` | ☐ |
| S0.5 | No magic numbers in `fitting.py` — R0-5 | grep output pasted in the walkthrough, genuinely empty | ☐ |
| S0.6 | Depth → **410 m** (paper Table 2) with refitted `tan β = 3.379`. Refit at 375/410/458 gives identical `a`, `c`, `r = 121.3 m`, RMS 177.5 mm, so terrain doesn't change (DEC-12). Never change depth without `tan β` — R0-7 | YAML + fitted JSON updated together | ☐ |
| S0.7 | Walkthrough §2/§7 corrected, `test_results.txt` re-run | Step 0 row in `walkthroughs/README.md` reads PASSED | ☐ |

---

## 2. Simulator core — the floor (WP1–WP7)

Plan and prompts live in `files/BUILD-PLAN.md`. This list is what *you* sign off.

### 2.1 Physics + sizing (WP1, WP2)
- [ ] WP1 missing tests added: monotone in time, tilt peak at inflection, strain sign flip, grid < 50 ms
- [ ] `size_network(cfg)` — one argument (G02); cost reported, never capped (G03, G12)
- [ ] **Node count = output of the sizing algorithm on the pinned terrain** (DEC-2 ratified). No fixed count anywhere; the deck reads it from `size_network(load_config())`
- [ ] "Why N nodes" has a number behind it: sampling error vs spacing table computed on **pinned** parameters (R6 differentiator #4)
- [ ] G15: mine swap changes the layout with zero `src/` edits

### 2.2 World state (WP3)
- [ ] `int32` mm grid; G06 `array_equal` full + partial replay; float variant fails it
- [ ] G13: `z0_mm` never mutated
- [ ] 690-day run < 60 s
- [ ] **Sim vs measured overlay plot** at days 210/300/540/690 against `data/real/adriyala_lw1_profiles.csv`. This is the one honest validation picture, and it goes in the deck

### 2.3 Sensors + provenance (WP4)
- [ ] Only `real` / `pinned` / `synthetic` (G04); `real` share is small and explained
- [ ] G05 isn't trivially satisfied: wrong fitted params → measurably different synthetic values
- [ ] Sensor noise/drift values come from **the hardware team's measured spec sheet** (H6), not datasheet guesses. Until then every value stays `# OPEN` in `assumptions.yaml`
- [ ] **Tilt drift vs signal numbers** exported for R5 (see §5)

### 2.4 Radio + stream (WP5, WP6)
- [ ] Airtimes vs contract table; Anchor duty ≤ 1% (G08); Scout RX < 0.5 s (G09)
- [ ] Dedup `(node_id, epoch)` (G07); emergency slot `child_index` (G10, G11)
- [ ] `nodes.csv` header byte-exact to contract §7.1; undelivered rows present
- [ ] `terrain_state.npz` + `terrain_changes.jsonl` replay exactly
- [ ] `run_summary.json` has real/pinned/synthetic counts and %
- [ ] Same seed twice → byte-identical `nodes.csv`

### 2.5 Early-warning lead time (DEC-11, proposed — confirm form)
- [ ] Seeded, config-driven randomness: face-advance schedule within 2.7–4.8 m/day, stoppages, parameter draws within fit uncertainty, node dropouts. Same seed → identical run (G06)
- [ ] Event time x per location = first crossing of a named threshold (subsidence ≥ A10 10 mm + a tilt/strain threshold), logged to `events.jsonl` as ground-truth labels
- [ ] ML teammate reports **lead time y = x − warning time (days)** and false-warning rate
- [ ] Baseline to beat: Knothe given face position. If ML can't beat it, say so
- [ ] Sudden random collapses: **v1.1 only**, after freeze, labelled SCENARIO, excluded from real-data evaluation

### 2.6 Harness + freeze (WP7)
- [ ] `scripts/run_gates.py` → 16 rows; `GATES.md` lists which gates have **no** negative case, honestly
- [ ] G14: no NN import, no alarm/threshold logic anywhere in `src/`
- [ ] 690-day run, replay check at day 345, WebSocket pause/seek, tag `v1.0-part1`

---

## 3. Consequence Renderer (WP8) — the demo asset

Source: `RECOMMENDATIONS.md` Part 1. Vault spec: `work-packages/WP8-consequence-renderer`.

### 3.1 The three jobs
| Job | What the judge sees | Minimum to claim it |
|---|---|---|
| J1 Scale | The mesh working across a full 250 × 2500 m panel | Build steps 1 + 3 |
| J2 Consequence | "380 mm here in 6 days" drawn as a dip, a leaning structure, a bent road | Build steps 4 + 6 |
| J3 Scenario | Change face advance rate → re-projected surface | Build step 5 |

### 3.2 Safety requirements — ship none of the renderer without these
- [ ] **Persistent mode banner**, never hidden: `SIMULATED` / `LIVE (MEASURED)` / `FORECAST (PREDICTED)` / `SCENARIO (HYPOTHETICAL)`
- [ ] **`SIMULATED` exists as its own mode.** In the demo, the "live" surface comes from the simulator, not from real ground. Labelling simulator output `LIVE (MEASURED)` would be exactly the lie §1.3 of the recommendations warns about. `LIVE (MEASURED)` is only allowed when real node data is on screen
- [ ] Measured / simulated / predicted geometry look different at a glance (e.g. solid shaded vs wireframe/hatched vs translucent band). A legend alone doesn't count
- [ ] Node markers coloured by their `_prov` tag (real / pinned / synthetic)
- [ ] Forecasts draw the **uncertainty band** (p10–p90), not just p50
- [ ] Forecast issue time + horizon always on screen
- [ ] **Vertical exaggeration stated on screen** ("vertical ×N"). A 1.27 m trough over 500 m is invisible at 1:1, and at ×50 it looks like a collapse. The factor must be visible whenever it isn't 1
- [ ] No animation of a predicted collapse that reads as footage: no debris, no camera shake, no "real-time" playback of forecasts
- [ ] The renderer has **no path to the alarm** and no code that computes subsidence. It reads files and frames only (Invariants 3, 4; C1)
- [ ] No click-to-subside, no blast/kill/collapse controls (contract §7.4, R7)

### 3.3 Build order (RECOMMENDATIONS §1.4)
| Step | Deliverable | Input it reads | Done when | ☐ |
|---|---|---|---|---|
| 1 | Static surface | `terrain_state.npz` + replay of `terrain_changes.jsonl` to day T (via exporter) | Surface at day 690 matches `WorldState` snapshot; trough visible with exaggeration label | ☐ |
| 2 | Time evolution | Same, scrubbed by day | Slider day 0→690; face position shown; replay equals direct run | ☐ |
| 3 | Node overlay | `nodes.csv` / WS frames | Nodes on surface at live Z, coloured by tier + provenance, `delivered=false` visibly different | ☐ |
| 4 | Forecast ingest | ML output file per `docs/interface-ml-to-renderer` (draft) | A **real** ML output rendered with p10/p50/p90 + FORECAST banner. No real ML output → step not done. Don't demo a mock forecast | ☐ |
| 5 | Scenario | Re-run simulator with a changed config (e.g. `A6_face_advance_m_per_day`) | Side-by-side baseline vs scenario, SCENARIO banner, config diff shown | ☐ |
| 6 | Reference objects | Static polylines/footprints in a scene config | Road centreline, building footprint, pole line deform with the surface; tilt (mm/m) labelled on the object | ☐ |

### 3.4 Hard stop (R1) — agreed now, while it's easy
- [ ] **Stop condition:** once steps 1–4 work (or 1–3 if ML output hasn't arrived by Day 3 13:00), renderer work stops and Adarsh switches to helping the hardware pair until a node transmits reliably on the table.
- [ ] Steps 5–6 happen only after the hardware node is solid **and** the simulator floor (§2) is green.
- [ ] Signed: ____ Date: ____

---

## 4. Interfaces this segment owns or consumes — write down before coding

| # | Interface | Between | Where it's written | ☐ |
|---|---|---|---|---|
| I1 | **Units + sign convention** (one document everyone cites) | all teams | **DEC-8 ratified: negative = down** in `nodes.csv`, WS frames and ML I/O; `physics` positive-down internally only. Written in `docs/interface-ml-to-renderer` §1. Send it to backend + ML | ☐ |
| I2 | Sensor spec: range, resolution, noise, drift, rate, per modality | hardware → simulator (H6) | `config/assumptions.yaml` `sensors:` block, each value citing the hardware bench test | ☐ |
| I3 | Radio packet format parity | simulator `packet.py` (contract §6) ↔ hardware firmware ↔ backend ingest | Simulator packet layout shared with hardware + backend so all three agree byte-for-byte. Otherwise the simulator is simulating a radio nobody built | ☐ |
| I4 | Stream schema | simulator → backend + ML | Contract §7.1/§7.4, already frozen. Hand it over as-is and don't let backend rename columns | ☐ |
| I5 | **ML output format** (spatial field, horizon, p10/p50/p90, missing regions, lead-time report, what it may not decide) | ML teammate → renderer, → alarm detector | `docs/interface-ml-to-renderer` (vault, DRAFT). ML teammate agrees it **by Day 2 18:00** (R3) | ☐ |
| I6 | Scene export | simulator artefacts → renderer | `renderer/export_scene.py` output schema, documented in WP8 | ☐ |

---

## 5. Validation, external data, tilt

- [ ] **R4 status is recorded correctly.** Adriyala is real: 283 digitised monument points, JMMF 2022. That closes the "no real series" gap for *terrain parameters*. The second dataset (Illinois) is not yet verified (S0.3). Don't claim two real datasets until S0.3 is closed
- [ ] ML evaluation (B3) uses the 283 real Adriyala points as the hold-out, never simulator output (C5). Tell the ML owner which file
- [ ] Optional stretch, only if a named person owns it with a date: one Sentinel-1 InSAR series or a second published Indian longwall profile (JMMF 70(2) 2022, Chitti Ravi Kiran et al.)
- [ ] **R5 tilt decision, simulator half:** from WP4, export "simulated tilt signal at a low-gradient node vs modelled drift" as two numbers. **Hardware half:** measured diurnal drift curve (H2.1). The deck sentence needs both: "drift measured at X mm/m over a diurnal cycle vs subsidence tilt of Y". Simulator numbers alone are a model grading itself

---

## 6. Cross-team items the lead has to drive (not code, but blocking)

- [ ] **R2:** S12 GIS, S13 alert delivery, S14 three roles, S15 offline sync, S16 mobile each get a named owner, or are explicitly thinned to demo depth. Decide Day 1
- [ ] **Blast-filter demo data gap.** The DGMS seismograph cross-check (differentiator #1) needs blast events to filter. The simulator deliberately does **not** inject blasts (R7, build-order exclusions). Its demo input must come from a real/sample DGMS log or the hardware vibration sensor, and a named person owns getting it
- [ ] Differentiator order in the deck: 1 DGMS blast reuse, 2 consequence renderer, 3 two-tier alerts, 4 physics-grounded sizing (R6)
- [ ] Every pitch number traces to a file + field (Day 3 pitch sheet), including the corrected node count and the 930 vs 1267 mm peak

---

## 7. Deliberately not doing (say so if asked)

- Operator interventions in the simulator: node kill, blast injection, manual collapse (R7, v2)
- Asymmetric draw / Table 3 profile as terrain driver in v1 (if DEC-1 = A; v2)
- Rainfall, groundwater, InSAR context layers (v2)
- A third mine dataset (WP0 "stop at two")
- Any NN or threshold logic in `mine-sim/src/` (G14)

---

## THE FLOOR — if everything goes wrong, these must still exist

Ordered. Cut from the bottom.

1. Step 0 honest: R² field correct, Illinois provenance settled, DEC-1 written (§1)
2. 690-day run with every value provenance-tagged, replay bit-identical, 16-gate table
3. Sim-vs-measured overlay plot against the 283 real Adriyala points
4. `nodes.csv` + WS stream handed to backend/ML with units + sign convention written (I1, I4)
5. Renderer steps 1–3 with SIMULATED banner, exaggeration label, provenance colouring
6. Renderer step 4: a real ML forecast with uncertainty band
7. Illinois mine swap run (G15 alone already proves config-only)
8. Renderer steps 5–6: scenario + reference objects

Items 1–4 are what make the simulator true. Items 5–6 are what make it memorable.

---

## The four things most likely to go wrong

1. **The deck quotes stale numbers.** "35 nodes", "R² 0.986" and "two real datasets" are each currently wrong or unverified. A judge who checks one will stop trusting the rest.
2. **The renderer eats the sprint.** A pretty surface is addictive to polish. The §3.4 stop is signed or it doesn't exist.
3. **Sign/units mismatch between simulator, backend and ML.** A −380 mm that one team reads as +380 mm produces a wrong picture in front of judges (I1).
4. **The sensor spec never arrives from hardware.** Then WP4's noise models stay guesses and the simulation drifts from the real parts without anyone noticing (I2, H6).
