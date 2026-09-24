---
title: "Decisions Log: Locked Baseline & Open Issues"
slug: decisions
type: project
module: governance
status: reviewed
tags: [decisions, ratified, baseline, open-decisions, trade-offs]
created: 2026-09-13
updated: 2026-09-15
author: adarsh
last_agent_edit: claude-code
source_file: files/10-build-order-v1.md
---

# Decisions Log: Locked Baseline & Open Issues

Official register of ratified design decisions, discarded architectural paths, and unresolved technical items for the Part 1 simulator.

> [!TIP]
> **Deep-Dive Guide:** For in-depth engineering explanations, rejected alternatives, and real-world analogies for every decision below, see [[docs/architectural-decisions-and-analogies|Architectural Decisions & Real-World Analogies]].

---

## 1. Locked Decisions (Non-Negotiable)

No agent may reverse or modify these without explicit escalation to [[people/adarsh-agarwala|Adarsh]]:

1. **D1 — Terrain Truth Ownership:** `WorldState` owns ground elevation truth. `node.z0_mm` is a static reference baseline set at $t=0$ and never modified.
2. **D2 — Total Discard of PINN:** Physics-Informed Neural Networks are discarded from Part 1. All references in early docs (00–07) are superseded.
3. **D3 — Classical Knothe Safety Detector:** The classical curve-fitting detector is the only path authorized to raise a safety alarm.
4. **D4 — Single Implementation of $S(x,y,t)$:** All derivatives (tilt, curvature, strain, displacement) are derived numerically.
5. **D5 — Dynamic Network Sizing:** Node count is an output of physics and Fresnel analysis, never an input.
6. **D6 — Three-Tag Provenance Model:** Strictly `real`, `pinned`, or `synthetic`. No `unknown`.
7. **D7 — Grounded Synthetic Generation:** Synthetic telemetry must derive from real data distributions or bounded datasheet noise.
8. **D8 — Mine Independence:** The simulator is configurable for any coalfield via YAML swap without code edits.
9. **D9 — Budget Cap (A22) Deleted:** Sizing is driven strictly by physics and RF link margins, not arbitrary financial ceilings.
10. **D10 — Grid Spacing Fixed at 50 m:** Yields 30 Scouts across the travelling cross with $32.6\text{ mm}$ worst-case sampling error.
11. **D11 — Integer Millimetre Terrain Grid:** Surface accumulation uses `int32` millimetres to guarantee bit-identical replay over 690-day runs.
12. **D12 — Dedup Key is `(node_id, epoch)`:** Sequence numbers (`seq`) reset on reboot and are diagnostic only.

---

## 2. Discarded Architectural Paths

| Proposal | Why Discarded |
|---|---|
| **$750\text{ m} \times 350\text{ m}$ Panel Dimensions** | That is a board-and-pillar extraction geometry, not a longwall panel. Adriyala LW1 is $250\text{ m} \times 2500\text{ m}$. |
| **Fixed Sensor Grid (Full Panel)** | Deploying across the full $2500\text{ m}$ panel triples node count without improving sampling fidelity. Travelling window is optimal. |
| **InSAR as Primary Validation** | Sentinel-1 C-band ($2.8\text{ cm}$ per fringe) suffers phase unwrapping failure and decorrelation over active mine subsidence basins. |
| **Per-Device ACKs in LoRa Mesh** | Six individual ACKs per Anchor cost $216.6\text{ ms}$, breaching the $1.0\%$ duty cycle ceiling. Replaced with single 6 B bitmap ACK. |
| **Node ID Modulo for Emergency Slots** | `node_id % 16` causes hash collisions when an entire cluster fails over simultaneously. Replaced with `child_index`. |
| **Floating-Point Terrain Grid** | Compounding additions drift by several millimetres over $16,500$ timesteps, failing bit-identical replay. |

---

## 3. Open Decisions (With Safe Defaults)

1. **Travelling Window vs Fixed Layout:**
   - *Default:* Travelling window (30 Scouts, 5 Anchors, 1 Gateway).
   - *Status:* Working default active. Full-panel fixed layout triples cost and hardware handling.
2. **Sensor Integration Baselines (A8, A9):**
   - *Default:* 10 m rod baseline for Tier 1B; 30 m wire baseline for Tier 1C.
   - *Status:* Practical engineering baselines setting finite-difference span in WP4.
3. **GSR 564(E) Regulatory Duty Cycle Text:**
   - *Default:* $1.0\%$ engineering ceiling adopted from international LPWAN practice.
   - *Status:* GSR 564(E) regulates power (1 W ERP) and bandwidth (200 kHz); 1% duty cycle is self-imposed.
4. **Adriyala Depth Conflict:**
   - *Default:* $375.0\text{ m}$ depth per strata control literature.
   - *Status:* Resolving against Table 1 of Ramalingeswarudu et al. (2022) during WP0.

---

## 4. Proposed Decisions — Sprint Day 1 (Claude Code, 2026-09-14)

Raised by [[people/claude-code|Claude Code]] after the Step 0 review and ingesting `files/RECOMMENDATIONS.md`, `files/SOFTWARE-CHECKLIST.md` and `files/HARDWARE-CHECKLIST.md`. **None is ratified until [[people/adarsh-agarwala|Adarsh]] writes a decision next to it.** DEC-1…DEC-4 are in [[changelog/2026-09-13-claude-code-three-day-sprint-plan]].

| ID | Question | Recommendation | Adarsh's decision |
|---|---|---|---|
| DEC-1 (new evidence) | Knothe vs Table 3 profile as terrain driver | Still **A (keep Knothe for v1)**, but with the numbers stated: the pinned Knothe peaks at ~930 mm vs measured 1267 mm (−27% at the trough centre, every epoch). The Day 1 "peak within 15%" check becomes "report the −27% and plot it". *(Superseded 2026-09-14 by §10: refit peak −5%.)* The G00 threshold changes to "verdict + escalation recorded" rather than R² ≥ 0.90 | ____ |
| DEC-5 | Adopt the Consequence Renderer ([[work-packages/WP8-consequence-renderer]]) into Part 1 scope, owned by Adarsh, with the R1 hard stop | **Yes**, built outside `mine-sim/` in `renderer/`, as a pure consumer, safety requirements mandatory | ____ |
| DEC-6 | Illinois "real" dataset: fits round-number Knothe at RMS 4.7 mm; source "USBM RI 9194" unverified | Verify against the NIOSH Southern Illinois report today. If it can't be traced, move to `data/fixtures/`, label synthetic, and keep Illinois only for the G15 config swap | ____ |
| DEC-7 | Renderer tech | Offline `export_scene.py` (npz + jsonl + csv → scene JSON) + a static Three.js page; live WS hookup optional. Reusable by Part 3 | ____ |
| DEC-8 | One sign convention across `nodes.csv`, WS frames, ML I/O | **Negative = down** at every team boundary (matches `dz`, survey CSV, §7.4 example); `physics` stays positive-down internally. Needs a one-line contract clarification | ____ |
| DEC-9 | R2: owners for S12 GIS, S13 alerts, S14 roles, S15 offline sync, S16 mobile | Name owners today or thin to demo depth deliberately (team decision, see `files/SOFTWARE-CHECKLIST.md`) | ____ |
| DEC-10 | Blast-filter demo data: the simulator deliberately doesn't inject blasts (R7) | Named person sources a sample DGMS seismograph log or uses the hardware vibration sensor; simulator stays blast-free | ____ |

Tickable owner checklist for this segment: `files/SIMULATOR-CHECKLIST.md`. Draft interface for R3: [[docs/interface-ml-to-renderer]].

## 5. Adarsh's Answers — 2026-09-14 (recorded by Claude Code)

| ID | Outcome | Status |
|---|---|---|
| DEC-2 | **Node count is whatever the sizing algorithm outputs** for the pinned terrain. No fixed "30/5/1" or "35" is quoted anywhere; the deck number is read from `size_network(load_config())` | Ratified |
| DEC-5 | **Renderer: yes.** [[work-packages/WP8-consequence-renderer]] is in scope, with the R1 hard stop | Ratified |
| DEC-8 | Delegated to Claude → **negative = ground moved down** in every file or frame that crosses a team boundary (`nodes.csv`, WS frames, ML input/output). `physics.subsidence` stays positive-down internally and is converted once at the output boundary. See [[docs/interface-ml-to-renderer]] §1 | Ratified (delegated) |
| ML owner | The forecasting model is built by a teammate. Its output feeds renderer step 4 through [[docs/interface-ml-to-renderer]] | Recorded |
| DEC-12 (new) | Depth: the paper gives 366–458 m (Table 1) and uses **410 m** (Table 2). Refitting at 375 / 410 / 458 m gives the **same** `a = 0.2609`, `c = 0.01309`, influence radius `r = 121.3 m` and RMS 177.5 mm; only `tan β` changes (3.091 / 3.379 / 3.775). Recommendation: use **410 m with `tan β = 3.379`** (matches the source, zero change to terrain) as part of the Step 0 rework. *(Numbers are for the superseded symmetric fit; not re-checked under §10.)* | Proposed |
| DEC-11 (new) | Adarsh wants the simulator to **create subsidence events at random times**, so the system can be tested on warning *early*: event at time x, warning at x − y with a useful lead time y | Proposed — see below |

### DEC-11 — Randomised events and early-warning lead time (proposed)

**Requirement (Adarsh):** the system must warn at x − y for an event at x, with y large enough to act on.

**Conflict:** `trigger_collapse` / random collapse injection is excluded by `files/RECOMMENDATIONS.md` R7, [[docs/build-order]] §6 (operator interventions → v2), WP3 "Do not", and Invariant 7 (synthetic only from behaviour of real data). No real dataset of sudden collapses exists in the repo to ground one.

**Recommended form (keeps invariants):**
1. **v1 — grounded randomness, seeded and config-driven:** random face-advance schedule within the paper's measured 2.7–4.8 m/day, random stoppages, parameter draws within fit uncertainty, random node/radio dropouts. Every run gets different event times x at every location, replay stays bit-identical per seed (G06), nothing is clickable.
2. **Event definition:** for each location, x = first time a damage-relevant threshold is crossed (subsidence ≥ A10 10 mm, and a tilt/strain threshold to be named). Computed from world state and logged to `events.jsonl` as ground truth labels for ML evaluation. Tagged `synthetic`.
3. **Lead-time metric (Part 2 acceptance):** y = x − first warning time, reported in days, with false-warning rate. Baseline to beat: Knothe given face position. If ML can't beat that baseline's lead time, it adds nothing.
4. **v1.1, only after freeze:** sudden anomalous events (e.g. old-workings collapse). Needs a contract amendment, a `SCENARIO` label, exclusion from the real-data evaluation, and a grounding source.

## 6. V1 / V2 Split — 2026-09-14 (Claude Code) — superseded by §7

> [!NOTE]
> Superseded the same day by §7. The plan files named below were deleted on 2026-09-14 (backup zip outside the repo); the current plan is `files/BUILD-PLAN.md`.

Per Adarsh's request for a working team demo by **Tue 15 Sep 20:00**, the sprint is re-cut into **v1** (thin end-to-end system: simulator → ML forecast → backend alarm → 3D view) and **v2** (Wed 16 Sep onward: full radio TDMA/failover, Fresnel relaxation, honest G05, remaining Step 0 fixes, DEC-11 lead time, forecast overlay, frontend). The plan is in `work-with-tools/V1-PLAN.md`, Adarsh's confirmations in `hands-on/START-HERE-V1.md` §1 (C1 split, C2 = DEC-1, C3 = DEC-6, C4 = DEC-3, C5 = DEC-4, C6 sample sharing), and the teammate brief in `files/TEAM-BRIEF-V1.md`. v1 cuts scope only; no invariant or contract shape changes. Deferred items stay tracked here and in [[work-packages/WP7-gate-harness]] as "v2 — not built".

## 7. Simulation Segment Redefined — Jobs 1–3 (Adarsh, 2026-09-14; recorded by Claude Code)

Adarsh's answers on 14 Sep (plain-words version: `files/SIMULATION-IDEA.pdf`).

### DEC-13 — Scope and dates (Adarsh, ratified)
- The simulation segment **generates, simulates and displays**. It has three jobs: **Job 1** virtual mine (mine data → fill gaps with the fitted formula → node placement → run → nodes send data); **Job 2** freeze the ground at a moment and create subsidence, computed from nearby current data, in three windows (1 terrain running · 2 frozen scenario · 3 after-event data); **Job 3** show what an ML prediction means on the ground (the pipe from input to output, not the ML).
- Alarm rules, SMS, app alerts and offline mode belong to the **backend**. ML belongs to the ML teammate.
- Scenario data is **stored in the simulator** and **not** sent to backend or ML.
- Scenario kinds: sudden sinking, cracking, tilt, vibration, plus the biggest mine-area hazards (→ sinkhole). Two or three first, the rest after. Objects on the ground chosen by research.
- **v1** = Job 1 + basic 3D view, Tue 15 Sep 20:00. **v2** = Jobs 2 + 3, complete by Wed 16 Sep night.
- Gap filling = the formula fitted to real data (keeps DEC-1 option A: Knothe, disclosed 27% low peak).

### DEC-14 — Scenario Lab boundary (Claude Code, proposed → D1–D4 in `files/MY-STEPS.md`)
The Scenario Lab ([[work-packages/WP9-scenario-lab]]) works on a frozen copy of a finished run and never writes the run, the stream or any team boundary. That keeps [[docs/interface-contracts]] §7.4 ("no click-to-subside" in the live stream) and Invariants 1, 4, 6 and 7 intact (reasoning in WP9 §1). DEC-11's "v1.1 sudden events" is realised here, with a SCENARIO label, instead of in the world engine.

### DEC-15 — Per-node forecast input (Claude Code, proposed → D5)
The ML output that Job 3 reads is the per-node file in [[docs/interface-ml-to-renderer]] §2b. The grid form (§2) is kept for later.

### Finding — physics sign/strain bugs (Claude Code, 2026-09-14)
`physics.displacement` points away from the trough (uy = +327 mm at x=1000, y=150, t=690), and `physics.strain` differences vertical subsidence, so it returns tilt (−6744 µε vs tilt −6753 µrad). Fix scheduled first on Monday (BUILD-PLAN M2 Part 0), before WP4 emits strain. Interface tilt convention (+ = surface rises) requires WP4 to negate `physics.tilt` at the boundary.

Plans: `files/BUILD-PLAN.md` (only plan), `files/MY-STEPS.md`. Old plans were removed 2026-09-14.

### Stress test of the plan (Claude Code, 2026-09-14, same day)
Checked by running the numbers:
- **Face runs past the panel end:** `physics.subsidence` never uses `panel.length_m`; at day 690 the face is at 2760 m on a 2500 m panel (S at 2500 + 3r = 14.7 mm instead of ≈ 0). Added to BUILD-PLAN M2 Part 0 (clamp inside `subsidence`, no signature change).
- **Int-mm grid can't give strain:** rounding to 1 mm on 5 m cells gives strain errors up to 4.9 mm/m (true peak 4.5 mm/m); smoothing still leaves ~0.9 mm/m. Float 5 m grid matches a 1 m grid within 1%. WP9 now takes all derivatives and rates from the float model surface; WP3 must round the cumulative S, not each increment.
- **Crack scenario:** 1-day int rate × 30 days gave ±30 mm noise; now uses the float model rate, capped by remaining capacity. Crack threshold 3.0 mm/m sourced (2–3 mm/m, Yan et al. via Sci. Rep. 2025).
- **Blast:** K, b not verifiable → null until a published Indian regression is cited.
- **Sinkhole:** the old note logic was backwards; now it flags erosion-driven pot-holes (up to 35×) as outside the model, and depth is labelled an upper bound.
- Confirmed unchanged: sudden-sinking capacity logic (U = 524 mm behind the day-300 face, 0.15 mm on settled goaf, 0 ahead), edge-collapse one-sidedness (147 mm at +150, 0 at −150 for a 20 m pillar), damage-grade units, per-node forecast sign rule.


## 8. Monday build results (Claude Code, 2026-09-14 night)

Adarsh asked Claude Code to build Monday's steps (M1–M5) directly instead of Antigravity. All committed; mine-sim suite **121 passed**. Walkthroughs `step-01b` … `step-06`.

### Finding — cliff at the moving face (fixed)
`physics.subsidence` used the time since the face passed *behind* the face but the whole run time *ahead* of it. On day 300 that gave a jump from 0.3 mm to 455 mm across the face, and unmined ground sank more than mined ground. It is replaced by the Knothe time model solved in closed form for a face that advances and stops at the panel end: `dS/dt = c (S_static − S)`. The surface is continuous at the face and monotone in time; peak at (1000, 0, 690) is 927 mm (unchanged). The same ODE is what the WP0 fit's `1 − exp(−c·t)` assumes, so the pinned `c` now means the same thing in fitting and physics (part of R0-4). The sign, strain and panel-end fixes in §7 landed as planned.

### Finding — provenance is 100% synthetic until the survey line is located (OPEN, Adarsh)
The Adriyala CSV gives monument distance across the panel but not where survey line S lies along it. Without that, no node can honestly be "at a monument", so the 690-day run tags every value `synthetic` (real 0%, pinned 0%). `config/mines/adriyala_lw1.yaml` → `pinning.survey_line_x_m: null`. When sourced from the JMMF paper, `real`/`pinned` switch on with no code change (tested). **Superseded by §9 W1: true only if the line lies on the node cross at x = 1250 m; the data puts it near the panel start.** This is the number for the pitch, per [[work-packages/WP4-sensor-models-provenance]].

### Result — layout is an output, and differs from the contract's example
*(Superseded by §10: 25 Scouts, ₹65,800.)* With pinned `tan β = 3.0907` (r = 121.3 m), sizing gives **33 Scouts (1A 2, 1B 20, 1C 11), 5 Anchors, 1 Gateway, ₹99,500** at 50 m, not the contract's pre-WP0 example of 30 / 5 / ₹82,100. The cross is centred at mid-panel, so the face reaches it on day 175 (x = 700 m) and day 312 (x = 1250 m); a 30-day sample shows only noise, so the handoff sample is the full 690-day run (`handoff/v1-sample/nodes.csv.gz`).

### Result — contract airtime table has two inconsistent cells
The Semtech formula reproduces 10 of 12 cells in [[docs/interface-contracts]] §6 within 0.1 ms, but gives 62.0 ms (table 65.9) for 6 B at SF8 and 123.9 ms (table 118.6) for 6 B at SF9. Neither is used by the schedule. Noted, not changed (a contract change is a team decision).

## 9. Stress test results (Claude Code, 2026-09-14 late night)

Adarsh asked for a stress test of everything built in §8. Script `mine-sim/scripts/stress_test.py`: **49 pass, 4 warn, 0 fail**; mine-sim suite **123 passed**. The closed-form time lag matches direct integration of the Knothe ODE to 1e-12 mm; ground is monotone, cliff-free and symmetric; world replay exact over 1,500 days; radio, dedup, determinism and the Illinois swap behave. Physics rule: [[work-packages/WP1-core-physics]].

### Finding — NaN for slow or fast-settling mines (fixed)
For large c/v the `exp · erfc` term overflowed ahead of the face and gave NaN (89 of 180 plausible mine configs; 42,624 grid cells for 0.25 m/d, c = 0.1/d). Rewritten with `erfcx`, same maths. Adriyala output unchanged: the 690-day `nodes.csv` is byte-identical to the handoff sample. Breaks nothing in [[docs/agents-invariants]]; restores invariant 8.

### W1 — survey line will not switch provenance on by itself (FIXED in §10)
Survey line S already shows −1,198 mm on day 210, so it lies well behind the day-210 face (x < 840 m; model-implied best fit ≈ 130 m, not a sourced value). The node cross is at x = 1,250 m, so setting `survey_line_x_m` leaves every value `synthetic`. Forcing tags at 1,250 m would inject −1.2 m "real" values where the model is at 0 mm. Options: (a) centre the transverse line on the survey line when it is set (also needs the paper's day-0 to match the sim's); (b) accept 100% synthetic for v1. Claude recommends (b) now, (a) in v2. See [[work-packages/WP4-sensor-models-provenance]].

### W2 — tier percentile cut splits identical nodes (FIXED in §10)
Longitudinal nodes have near-identical peak strain; the 66.7th-percentile cut lands inside that cluster (Adriyala: 3 × 1C, 19 × 1B on 1 µε differences; Illinois: 23 of 27 scouts 1C). Fix option: group peaks within one noise σ before cutting. Changes tier mix and cost, so not applied. See [[work-packages/WP2-sizing-algorithm]].

### W3 — tier 1A tilt is pure drift (FIXED in §10)
1A nodes sit at ±250 m where peak tilt is 274 µrad against 500 µrad bias and ±3,000 µrad daily drift. Consistent with WP2 ("secondary vote only"); say so if asked.

### W4 — peak 930 mm vs field 1,267 mm (FIXED in §10)
Unchanged; still DEC-1 / R0-3.

## 10. W1–W4 fixed, real-anchored data (Adarsh's direction; Claude Code, 2026-09-14, session 08)

**Adarsh's direction:** (1) a value that exists in the field data is never changed; missing values are derived from existing ones with equations or ML; do not ship 100% synthetic. (2) Fix W2, W3, W4. (3) One project-update file per date. Physics rules: [[work-packages/WP1-core-physics]]; tiers: [[work-packages/WP2-sizing-algorithm]]; provenance: [[work-packages/WP4-sensor-models-provenance]].

### W4 fixed — peak −27% → −5%
Inflection-point offset added to `physics.subsidence`; refit through physics itself. RMS 177.5 → **52.1 mm**, R² 0.82 → **0.985**, peak 930 → **1,202 mm** (field 1,267). Details and identifiability caveats in [[gates/G00-data-pinning]]. **Contract note:** `PanelGeometry` gains `inflection_offset_m` (default 0) and `Config` gains `survey_origin_offset_m` (default 0) — additive fields, same precedent as `seam_inclination_deg`; mine yaml gains required `A1b_inflection_offset_m`.

### W1 fixed — not 100% synthetic
The node cross is centred on the survey line (x = 258 m, fitted) and transverse Scouts snap to the nearest monument (within half the monument pitch). The 690-day run: **real 54 (0.003%), pinned 148,986 (9.09%), synthetic 90.9%**; 9 of 11 transverse nodes stand on monuments. Worst gap between a real value and the simulated terrain at that node: 54 mm (was 1,198 mm).

### W2 fixed — tiers from natural breaks
Percentile cuts replaced by Fisher-Jenks natural breaks of peak strain into three bands (no threshold to tune; breaks fall only between distinct values). Also fixed a sizing bug: peak strain now uses the rod's own axis (longitudinal x, transverse y); before, every along-panel node saw the transverse compression it cannot measure. Illinois: 1C 85% → 15%; identical nodes share a tier.

### W3 fixed — tilt-only nodes see their tilt
1A is assigned only where peak tilt ≥ `layout.tilt_detection_snr` (3, OPEN) × the tilt noise floor after one temperature period (drift is a daily sine and cancels in a 24 h mean; floor = 100/√24 ≈ 20 µrad). Otherwise the node gets 1B. All 15 Adriyala 1A nodes pass.

### Layout result
25 Scouts (1A 15, 1B 9, 1C 1), 4 Anchors, 1 Gateway, **₹65,800** (was 33 / 5 / ₹99,500). Only one 1C: the crossing node's centre compression (−13,153 µε) is a band of its own under natural breaks.

### Real-anchored survey-line dataset (Adarsh's rule)
`mine-sim/scripts/build_anchored_dataset.py` → `handoff/v2-real-anchored/`: 48 monuments × 691 days. Subsidence: the 283 measured values kept exactly (`real`); every other day = physics fit + Gaussian-process correction scaled by development (`pinned`, with σ). Tilt, curvature, U, strain, rate derived by the Knothe relations (`synthetic`, basis column says "derived from the real-anchored surface"). Leave-one-survey-day-out RMS: physics 52.1 mm → physics + GP **37.7 mm**. Caveat: data-anchored strain (−22,000 µε) vs physics (−13,000) differ ~2×; both columns shipped.

### Also
CI on GitHub Actions (vault check, pytest, stress test, dataset build). Project updates are one file per date with summaries on top.

### Still open (Adarsh)
- Read survey line S position (and ideally the day-0 definition) from the JMMF layout figure → replaces the fitted 258 m and firms up c.
- Subsidence factor a is not identifiable from one line; a sourced value would replace the 5% rule.
- `tilt_detection_snr = 3` is a design choice.

## 11. D1–D7 ratified; laptop is the data path (Adarsh, 2026-09-15; recorded by Claude Code, session 10)

- **D1–D7 in `files/MY-STEPS.md` §A: all yes, as written.** DEC-14 (Scenario Lab on a frozen copy, D1) and DEC-15 (per-node forecast file, D5) move from proposed to **ratified**. [[work-packages/WP9-scenario-lab]] is now binding for Antigravity.
- **DEC-16 — No database in Part 1.** No Postgres or other DB is built here. The simulator's output files on Adarsh's laptop (`mine-sim/out/v2-690d/`, `handoff/v2-*`) are the data source; the backend/frontend pair (same two people) read them. The contract column names and sign convention (§7.1, negative = down, dedupe on `(node_id, epoch)`) are unchanged.
- **One command rebuilds everything from scratch:** `./run-simulation.sh` at the repo root (erase generated data → refit from field data → tests → 690-day run with live progress read from `nodes.csv` → real-anchored dataset → handoff sample → verify). First run: 121 s, 414,000 rows, 0 duplicate keys, output byte-identical to the committed v2 data.

