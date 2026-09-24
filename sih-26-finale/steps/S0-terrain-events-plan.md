# S0 — Plan: freeze the ground, then create subsidence, cracks and vibration on it

**Who this is for:** Adarsh (decides), Antigravity (builds), Claude (checks).
**Written:** 17 Sep 2026 (session 25), branch `feat/terrain-events-scenario-lab`.
**Goal in one line:** make the **"Freeze + create subsidence"** button work — freeze a finished run at day T, click a spot on the terrain, pick an event (sinking, cracks, edge collapse, blast, sinkhole), and see what it does to the ground and to what is built on it — **without any of the numbers disagreeing with the simulator that produced the run.**

**This file is the plan only.** It writes no code. Each step below becomes (or amends) a file in `steps/`, and those files hold the prompt that goes into Antigravity. `files/BUILD-PLAN.md`, `steps/STATUS.md` and `WHATS-LEFT.md` stay the live trackers.

**Precedence, unchanged:** `files/11-interface-contracts-v1.md` beats everything inside `mine-sim/`. `sih-26-finale-brain/work-packages/WP9-scenario-lab.md` is authoritative inside `scenario-lab/` and `renderer/`. Where this plan disagrees with WP9, that is called out explicitly and needs Adarsh's sign-off plus a changelog entry — it is never silent.

---

## Part 0 — Where we actually are

### Built and tested

| Piece | Where | Tests |
|---|---|---|
| Subsidence physics, fitted to LW1 field data | `mine-sim/src/minesim/physics.py` | 198 passed, 1 skipped |
| Cross-derivative `curvature_xy` + `principal_strain` | same | ✅ F10 |
| Ground cracking: latched `CrackField`, `opening_mm`, NCB damage grades | `mine-sim/src/minesim/cracks.py` | ✅ |
| Vibration: blast + caving PPV, frequency bands, DGMS limits | `mine-sim/src/minesim/vibration.py` | ✅ |
| Crack/PPV exporter | `mine-sim/scripts/export_cracks.py` → `out/cracks/` | manual |
| Lab base: freeze a day on a copy, derive fields off the float surface | `scenario-lab/lab/{config,snapshot,fields}.py` | 42 passed |
| Events 1 and 3: sudden sinking, edge collapse | `scenario-lab/lab/events/` | ✅ gates L4, L5 |
| Window 1 (the 3D terrain view) | `renderer/` | 19 passed |

### Missing — this is the whole of the work

| Missing | Step below |
|---|---|
| One agreed crack + damage + vibration model that the lab and the simulator both use | **S1** |
| Crack event ("what if it keeps moving N more days") | **S2** |
| Lab server, result store, safety gates L1–L3, L7 | **S3** |
| Window 2 — the page with the button, the click, the before/after/difference toggle | **S4** |
| Blast event (vibration on the terrain) | **S5** |
| Sinkhole event + railway + pipe objects | **S6** |
| `export_cracks.py` wired into the rebuild | **S7** |
| The cross-check that stops the two halves drifting apart | **S8** |

---

## Part 1 — The eight ways the maths breaks, and the fix for each

This is the part to read twice. Every one of these is live right now, not hypothetical — each is a real difference between what F10 built on 17 Sep and what WP9 §6 specified on 14 Sep, or a real gap in the data path. None of them fails a test today, because nothing joins the two halves yet. **S1 exists to close all eight before any new event is written.**

### H1 — Two different crack models, both called "the crack model"

| | WP9 §6 (spec, 14 Sep) | F10 (built, 17 Sep) |
|---|---|---|
| strain used | axis-aligned `strain_x`, `strain_y` | **major principal** `e1` from `physics.principal_strain` |
| threshold | 3.0 mm/m | 3000 µε — *the same number*, different unit |
| width | `(ε − threshold) · cell_m`, i.e. spacing = the grid cell (5 m) | `(e1 − threshold) · crack_spacing_m`, spacing **8.0 m** from config |
| closure | none | `partial_closure_fraction: 0.35` — a crack narrows, never heals |
| damage grades | China I–IV on tilt / curvature / strain | **NCB** change-of-length: negligible → very severe |

Same click, two answers, and the width differs by 1.6× before anything else. On the panel centre-line the axis-aligned and principal strains agree; **at the four panel corners the principal axes rotate by tens of degrees, and the corners are where field crews record the worst cracking** — so the disagreement is worst exactly where a judge would look.

> **Fix (S1):** the F10 model wins, because it is the one with the cross-derivative, the sourced spacing and the closure behaviour. `scenario-lab/lab/cracks.py` is **not written**. The lab imports `minesim.cracks` and `minesim.vibration` and re-exports them. WP9 §6 is amended to say so.

### H2 — "damage lives outside `mine-sim/src`" is no longer true

WP9 §1 put damage grades and vibration limits outside `mine-sim/src` *so that gate G14 is unaffected*. F10 put them inside. **G14 is in fact unaffected** — it forbids `torch`/`tensorflow`/`jax`/`keras`/`sklearn` imports, anything named `pinn`/`neural`, and alarm thresholds or classification logic in `src/minesim/`. `cracks.py` and `vibration.py` import none of those, raise nothing, and say in their own docstrings that deciding what to do about a number belongs downstream. They **describe** the ground (Invariant 3 holds).

> **Fix (S1):** re-run G14 and quote the result, then amend WP9 §1 to record that the reason given for the boundary no longer applies and the boundary has moved. **Adarsh signs this off (decision D-S1) — it is a governance change, not a refactor.**

### H3 — The crack model cannot answer a "what if" question as written

`CrackField.update(x, y, t_days, cfg)` recomputes the strain **from the analytic model at (x, y, t)**. A scenario asks a different question: *given this extra sinking `ds` that the model does not predict, what cracks?* There is no `t` at which the model produces that surface, so `update` cannot be called.

> **Fix (S1):** split the model in two, which it almost already is.
> - `opening_mm(e1_ue, threshold_ue, spacing_m)` and `damage_grade(e1_ue, length_m)` already take strain **as an argument** — the lab calls these directly and nothing changes in `mine-sim`.
> - The missing half is **principal strain from a gridded surface** instead of from `(x, y, t)`. `lab/fields.py` computes `strain_x` and `strain_y` but has no `strain_xy`, so it cannot form the tensor. Add `strain_xy_mm_per_m` to `Fields` (cross derivative of the surface, `np.gradient` twice, `edge_order=2`) and a `principal_from_fields(fields)` helper returning `(e1, e2, theta)` in the **same units and sign convention** as `physics.principal_strain`.
> - Proof it is the same model: on a surface sampled from `physics.subsidence`, `principal_from_fields` must match `physics.principal_strain` — this becomes assertion 1 of gate **L8** (S8).

### H4 — Microstrain vs mm/m: a silent factor of 1000

`mine-sim` speaks **µε**. WP9 and the lab speak **mm/m**. `1 mm/m = 1000 µε`. Nothing currently converts, because nothing currently crosses.

> **Fix (S1):** exactly one conversion point, in `lab/fields.py`, named and tested. No `* 1000` anywhere else. Gate L4 already allows the literal `1000` only for m↔mm, so a second use of it in a crack path should be treated as a smell, not a convenience.

### H5 — The "before" state is a latch, and it is not in the run output

Cracks latch: once open they stay, narrowing to 35 %, never healing. So "new cracks = cracked after but not before" is only true if **before** is the *latched* state at day T from the real run — walked forward from day 0. Evaluated at one instant instead, the lab will report cracks as "new" that actually opened on day 120 and had partly closed by day T.

That latched state exists in exactly one place: `out/cracks/crack_field_day<NNNN>.npz`, written by `export_cracks.py`. **Which a full rebuild deletes and does not recreate** (`WHATS-LEFT.md` §1.5). So the file the crack scenario depends on is, today, absent after every clean run.

> **Fix (S7, and it moves ahead of S2):** wire `export_cracks.py` into `run-simulation.sh` as step 9. This stops being a nicety the moment S2 starts.
> **Fix (S1):** `load_snapshot` gains an optional `crack_baseline` read from `out/cracks/`, and S2 **refuses with a plain reason** ("baseline crack state has not been exported for this run — run step 9") rather than silently evaluating the latch at one instant.

### H6 — Three grids, none of them the same

| Grid | Cell | Extent |
|---|---|---|
| world / snapshot | 5 m | the world grid |
| `out/cracks/` | **10 m**, hardcoded | `±2r` margin around the panel, its own `x_m` / `y_m` axes |
| display (`lab.display_cell_m`) | block-averaged | for the response payload |

Reading the crack baseline means resampling between two of them. A nearest-neighbour lookup on a latched boolean field at 2× the cell size will move crack edges by up to 10 m.

> **Fix (S1):** `export_cracks.py`'s `cell = 10.0` moves into config (it is a magic number today and would fail gate L4 if it lived in `lab/`). The baseline is exported **on the snapshot grid**, or the lab resamples once, explicitly, with the method named in the walkthrough. Not both, and never implicitly.

### H7 — Blast constants: 800 / 1.5 in one place, `null` in the other

`assumptions.yaml` ships `blast_k: 800.0`, `blast_b: 1.5`, both marked `OPEN — VERIFY`. W5's prompt says `blast.yaml` must carry **`K: null`, `b: null`** until a published Indian coal-mine regression is cited, so that Blast answers *"site constants are not set"* — that was decision **D3**, and it is the honest answer in front of a judge.

> **Fix (D-S4 + S5):** Adarsh picks one. Either the lab reads the mine-sim values and every PPV number in the UI carries a visible **"unverified site constants"** label, or the lab keeps `null` and Blast refuses until someone finds the circular. **The two files must not disagree.** Same for the DGMS PPV table, which currently exists in both `assumptions.yaml` (`vibration.dgms_limits_mm_s`, domestic + industrial) and WP9's planned `damage_limits.yaml` (domestic 5/10/15) — one source, the other imports it.

### H8 — Objects sit in the panel frame, and there is now more than one panel

`objects.yaml` coordinates (H1 at (580, 150), R1 from (1200, −235)…) were written for a single panel. F10 added `y_offsets_m` and `start_day_offsets_d` for **linear superposition of panels**, and `n_panels: 8` is a live option in F8. The village does not move with the district.

> **Fix (S1):** objects are declared in the **panel frame** and transformed once, at load, against the current mine config; an object landing outside the grid is an error, not a clamp (WP9 §6 already says so). Re-check every coordinate after any change to `n_panels` or `y_offsets_m`.

---

## Part 2 — Decisions needed from Adarsh before any code

Nothing below S1 starts until these are answered. Each one changes what gets built, not just how.

| # | Decision | Options | Claude's recommendation |
|---|---|---|---|
| **D-S1** | Does the lab **import** `minesim.cracks` / `minesim.vibration`, or keep a separate `lab/cracks.py` per WP9 §6? | (a) import and amend WP9 · (b) reimplement and accept two models | **(a).** One model, one answer. G14 is unaffected — verified, not assumed. |
| **D-S2** | Contract §7.1 — do the fissure and vibration columns get appended to `out/nodes.csv`, or stay in `out/cracks/`? *(open since F10)* | (a) amend §7.1, append at the end · (b) leave them separate | **(b) for now.** Part 2 parses positionally; the lab reads `out/cracks/` directly and needs nothing from `nodes.csv`. Revisit only if Part 2 asks. |
| **D-S3** | Which damage scale does **Window 2** show — NCB (negligible → very severe) or the China I–IV table? | (a) NCB only · (b) both, side by side | **(a).** Two scales on one screen is how a demo gets a hard question. The China table stays in the vault as a cross-reference. |
| **D-S4** | Blast constants K, b — use the `OPEN — VERIFY` 800 / 1.5 with a visible warning, or keep `null` and refuse? | (a) use + label · (b) `null` + refuse | **(b), unless you want blast in the demo.** "We don't have a site trial" is a strong answer; a number we cannot cite is not. |
| **D-S5** | Does the "Freeze" button land on the **existing** Window 1 page or a separate Window 2 page? | (a) separate page per WP9 §9 · (b) in-place mode switch | **(a).** WP9 §9 already specifies it, and the SCENARIO banner has to be impossible to miss. |

---

## Part 3 — The steps, one feature at a time

Each step: what it is, the files it owns, what proves it, and what it must not do. **One step at a time, checked before the next starts** — per `WHATS-LEFT.md`, that is now the rule.

---

### S1 · One model, shared — the integration spine

**In plain words:** before adding any new event, make the lab and the simulator agree on what a crack is, what a damage grade is, and what a vibration limit is.

**Depends on:** D-S1, D-S3. **Blocks:** everything else.

**Files**
- `scenario-lab/lab/cracks.py` — **a thin re-export only.** `from minesim.cracks import opening_mm, damage_grade, damage_grade_field, NCB_GRADES, NCB_EDGES_MM` plus the µε↔mm/m conversion. No formula of its own.
- `scenario-lab/lab/fields.py` — add `strain_xy_mm_per_m` to `Fields`; add `principal_from_fields(fields) -> (e1_ue, e2_ue, theta_deg)`.
- `scenario-lab/lab/objects.py` — object loading, panel-frame transform, footprint/polyline sampling.
- `scenario-lab/lab/consequence.py` — `evaluate(before_s_float_mm, after_s_float_mm, grid, cfg, crack_baseline=None, ppv_mm_s=None, frequency_band=None) -> dict`, returning the `cracks`, `objects` and `summary` parts of the WP9 §7 JSON, negative-down, one plain sentence per object.
- `scenario-lab/config/objects.yaml` — H1–H8, R1, R2, P1–P8, T1, `layout: illustrative, not the real Adriyala surface`.
- `scenario-lab/config/damage_limits.yaml` — **imports** the mine-sim numbers; carries only what mine-sim does not have.
- `scenario-lab/lab/snapshot.py` — optional `crack_baseline` from `out/cracks/`.
- Tests: `tests/test_consequence.py`, `tests/test_objects.py`, `tests/test_cracks_bridge.py`.

**Proves it**
- `principal_from_fields` on a surface sampled from `physics.subsidence` matches `physics.principal_strain` — magnitude **and** angle — within tolerance (this is gate L8 assertion 1, S8).
- Unit round-trip: 3.0 mm/m → 3000 µε → 3.0 mm/m, exactly.
- Identical before/after → **zero** new cracks and unchanged grades.
- An object in a masked cell → `"No forecast covers this object"`, no grade.
- Missing `out/cracks/` → the plain refusal from H5, not a wrong answer.
- Gate L4 still passes (no new magic numbers).

**Must not**
- Write any crack or damage formula that does not live in `minesim.cracks`.
- Take any derivative from the int-mm grid (WP9 §3 — rounding gives strain errors *larger than the true peak*).
- Import `minesim.world` or `minesim.stream`; write anywhere outside `scenario-lab/store/`.

---

### S2 · Crack event — "what if the ground keeps moving N more days"

**In plain words:** the existing `steps/W2-crack-scenario.md`, amended for S1 and H5.

**Depends on:** S1, S7. **Amends:** `steps/W2-crack-scenario.md` §1.

**Files** `scenario-lab/config/events/crack.yaml` (`days_ahead`; `nearby_radius_m`, `min_rate_mm_per_day`, `rate_window_days`, each with a `source:`), `scenario-lab/lab/events/crack.py`, `tests/test_crack_event.py`.

**The formula, unchanged from WP9 §5 row 2**
`rate = (s_model_mm − physics.subsidence(X, Y, day − rate_window_days)) / rate_window_days`, then `ds = min(days_ahead · max(0, rate) · taper(d, nearby_radius_m, r), U)` where `U` is the remaining capacity — **the ground cannot sink more than is left**.

**Proves it**
- `days_ahead = 0` → `ds == 0` exactly.
- A huge `days_ahead` never pushes `ds` past `U`.
- A point with zero 24 h rate → not possible, reason *"ground near here is not moving now"*.
- Near the face at day 300, `days_ahead = 30` → possible, and either new cracks > 0 or the reason *"strain stays below crack threshold (max X vs Y mm/m)"* **with the numbers in it**.
- New cracks are counted against the **latched** baseline (H5), not an instantaneous one.
- Same request twice → identical result.

---

### S3 · Lab server + store + gates L1, L2, L3, L7

**In plain words:** `steps/W3-lab-server.md` as written. Nothing serves a page until this exists.

**Depends on:** S1, S2.

**Files** `lab/scenario.py`, `lab/store.py`, `lab/server.py`, `tests/test_server.py`, `tests/gates/test_l1.py`, `test_l2.py`, `test_l3.py`, `test_l7.py`.

`/api/events` builds the form spec from `config/events/*.yaml`, **never from code** — that is what lets S5 and S6 add an event without touching the page. Unknown type or out-of-range parameter → HTTP 422 with a plain message.

**Proves it**
- **L1:** sha256 every file in the run dir before and after running *every registered event type* — byte-identical. This is the one that keeps Invariant 4 and contract §7.4 ("there is no click-to-subside") true.
- **L2:** same request twice → same `scenario_id`, byte-identical JSON.
- **L3:** no `requests` / `httpx` / `urllib` / `socket` in `lab/`; no write outside `scenario-lab/store/`; no `minesim.world` / `minesim.stream` import.
- **L7:** every result JSON carries `label`.

---

### S4 · Window 2 — the page, and the button that starts all of this

**In plain words:** `steps/W4-scenario-page.md`. This is the step where **"Freeze + create subsidence"** stops being disabled.

**Depends on:** S3, D-S3, D-S5.

**Files** `renderer/scenario.html`, `renderer/js/scenario.js`, `renderer/after.html`, `renderer/tests/test_pages.py`, `renderer/fixtures/scenario_example.json`.

Reuses `js/terrain.js` — the frozen surface is drawn by the **same** terrain code as Window 1, so the ground cannot look like two different mines. Banner, always visible: `SCENARIO (HYPOTHETICAL) · frozen at day T · not sent to backend or ML`.

**Proves it**
- Banner string present in every page; JS fetches only `/api/...`; **no element on this page can change Window 1.**
- Screenshots: before, after sudden sinking, a not-possible case, a crack case.
- The hand check in W4 §3 — day 300 → Freeze → houses graded, Before/After/Difference toggling.

---

### S5 · Blast — vibration on the terrain

**Depends on:** S4, **D-S4**. **Amends:** `steps/W5-blast.md` for H7.

`PPV = K · (D/√Q)^(−b)`, `D = max(d, min_distance_m)`. `consequence.evaluate` already takes `ppv_mm_s` from S1 — **do not edit it.** `ds_mm` is `None`: a blast shakes the ground, it does not sink it.

**Proves it** PPV falls with distance; formula checked at 3 points; doubling Q scales PPV by `2^(b/2)`; null constants → not possible **with the reason**; a house over the DGMS limit for its band gets the "over limit" sentence. Tests inject their own K, b — never the yaml's.

---

### S6 · Sinkhole + railway + pipe

**Depends on:** S4.

`H = m_g/(k − 1)`; if `H ≥ h_c` no sinkhole reaches the surface by caving, and if additionally `h_c ≤ 35 · m_g` the reason carries the Indian pot-hole erosion note. A depth answer always says **"upper bound"** — the model ignores the crater spreading wider than the gallery.

Adds `RL1` (railway) and `PP1` (pipe) to `objects.yaml`; extends `lab/objects.py` and `lab/consequence.py` with `max |Δs|` over the rail base and the pipe strain projection `εx·cos²α + εy·sin²α`.

---

### S7 · Wire `export_cracks.py` into the rebuild — do this early

**Depends on:** D-S2 (answered (b) → this is required). **Blocks:** S2.

`run-simulation.sh` gains step 9, running `scripts/export_cracks.py` after the sensor run. Closes `WHATS-LEFT.md` §1.5. The `cell = 10.0` literal moves into config (H6). A partial run (`./run-simulation.sh 30`) exports for its own day.

**Proves it** A full rebuild from scratch leaves `out/cracks/` populated; `./run-simulation.sh view` on a fresh clone opens a working crack layer; the crack baseline is on a grid the lab can read without guessing.

---

### S8 · Gate L8 — the cross-check that stops the halves drifting apart

**In plain words:** the one gate that makes every fix in Part 1 stay fixed. **With `ds = 0`, the Scenario Lab's answer must be the simulator's answer.**

**Depends on:** S1. Written with S1, extended as each event lands.

**Assertions**
1. `principal_from_fields` on a `physics.subsidence` surface matches `physics.principal_strain` in magnitude and angle (H3).
2. A "null scenario" (any event with a parameter that produces `ds = 0`) gives, cell for cell on the overlap: the same crack mask, the same widths, the same NCB grades and the same PPV as `out/cracks/crack_field_day<T>.npz` at the same day (H1, H4, H5, H6).
3. The unit round-trip mm/m ↔ µε is exact (H4).
4. Every threshold the lab reports (crack threshold, NCB edges, DGMS limits, K, b) is **the same object** as the one in `mine-sim/config/assumptions.yaml` — asserted by identity, not by copying the value into the test (H7).
5. Objects load inside the current grid for the current `n_panels` and `y_offsets_m` (H8).

> Assertion 2 is the important one. It is cheap, it runs in seconds, and it fails the moment anybody edits one model and not the other.

---

## Part 4 — How it all holds together

### One source per number

| Number | Lives in | Everyone else |
|---|---|---|
| Subsidence `S(x, y, t)` | `physics.subsidence` — **Invariant 4, the only formula** | calls it |
| Principal strain | `physics.principal_strain` (analytic) / `lab.fields.principal_from_fields` (gridded) | L8-1 ties them together |
| Crack threshold, spacing, closure | `assumptions.yaml → cracks:` | `lab/cracks.py` re-exports |
| NCB damage edges | `assumptions.yaml → damage:` | same |
| PPV constants, bands, DGMS limits | `assumptions.yaml → vibration:` | `damage_limits.yaml` imports |
| Scenario inputs (radius, days ahead, …) | `scenario-lab/config/events/*.yaml`, each with `source:` | `/api/events` builds the form from these |
| Objects | `scenario-lab/config/objects.yaml` | — |

**Rule: a number appears in exactly one file. Everything else imports it.** Gate L8-4 enforces it by identity.

### Conventions that must not slip

| Item | Rule | Where it bites |
|---|---|---|
| Sign | `mine-sim` internal and lab internal: **positive down**. Every JSON boundary: **negative down** | every writer |
| Strain sign | **+ = tension**, both halves | crack threshold comparisons |
| Units | µε inside `mine-sim`, mm/m in the lab, **one** conversion point | H4 |
| Derivatives | **never** from the int-mm grid — always `s_model_mm` (float) + float `ds` | H3, WP9 §3 |
| Grid | `(nx, ny)`, `i ↔ x`, cell centre `origin_x_m + (i + 0.5)·cell_m` | H6 |
| Provenance | scenarios are `kind: "scenario"`, `label: "SCENARIO (HYPOTHETICAL)"` — **never** `real` / `pinned` / `synthetic` | Invariants 6, 7 |

### The boundary that keeps the contract true

The Scenario Lab reads a finished run **read-only**, works on its own copy in memory, and writes only to `scenario-lab/store/`. It never touches the main run or `/ws/run`, so contract §7.4 — *"there is no click-to-subside"* — stays literally true. **Gate L1 proves it by hashing every file in the run dir before and after.** That gate is not a formality; it is the reason this feature is allowed to exist at all.

### Order of work

```
D-S1 … D-S5  (Adarsh)
      │
      ├── S7  wire export_cracks.py ──┐
      │                               │
      └── S1  one shared model ───────┼──> S8  gate L8
                   │                  │
                   └── S2  crack ─────┘
                          │
                          └── S3  server + L1,L2,L3,L7
                                     │
                                     └── S4  Window 2  ← the button lights up here
                                                │
                                                ├── S5  blast
                                                └── S6  sinkhole + railway + pipe
```

**S4 is the demo milestone.** S5 and S6 are additive: because `/api/events` builds the form from yaml, neither touches the page.

### After the last step

1. `./run-simulation.sh` — full rebuild, now including step 9.
2. `cd mine-sim && pytest -q` → report the count. `cd scenario-lab && pytest -q` → report the count. `pytest renderer/tests -q` **from the repo root** → report the count.
3. `python3 sync_vault.py --check` → must be `0 broken / 0 orphans / 0 frontmatter issues`.
4. `mine-sim/scripts/stress_test.py`.
5. The hand check in each step's §3.
6. Changelog entries in `sih-26-finale-brain/changelog/` for the WP9 amendment (D-S1) and any contract change (D-S2).

---

## Part 5 — Tracking

Claude updates this table after every check. **Written** = built · **Checked** = Claude reviewed · **Fixed** = fix prompt done and rechecked · **Committed** = on a branch.

| # | Step | In plain words | Depends on | Written | Checked | Fixed | Committed |
|---|---|---|---|---|---|---|---|
| D-S1…D-S5 | [Part 2](#part-2--decisions-needed-from-adarsh-before-any-code) | Five decisions | — | ✅ answered session 26 (D-S2, D-S4 deferred) | — | — | — |
| S7 | export_cracks in the rebuild | the crack baseline survives a rebuild | D-S2 | ✅ P2 | ✅ | — | ✅ `feat/p2-consequence-and-events` |
| S1 | one shared model | lab and simulator agree | D-S1, D-S3 | ✅ P1 + P2 | ✅ | — | ✅ `3580475` + `feat/p2-consequence-and-events` |
| S8 | gate L8 | they keep agreeing | S1 | ✅ P1 (5) + P2 (L8-6, L8-7) | ✅ mutation-checked | — | ✅ |
| S2 | crack event | "keeps moving N more days" | S1, S7 | ✅ P2 | ✅ | — | ✅ |
| S3 | lab server + L1–L3, L7 | the thing the page talks to | S2 | ⬜ | ⬜ | ⬜ | ⬜ |
| S4 | Window 2 | **the button works** | S3 | ⬜ | ⬜ | ⬜ | ⬜ |
| S5 | blast | vibration on the terrain | S4, D-S4 | ⬜ | ⬜ | ⬜ | ⬜ |
| S6 | sinkhole + railway + pipe | last two event types | S4 | ⬜ | ⬜ | ⬜ | ⬜ |

**Branch:** `feat/terrain-events-scenario-lab`, off `fix/g15-mine-independence-cap5`.

**Related:** [WHATS-LEFT.md](../WHATS-LEFT.md) · [STATUS.md](STATUS.md) · [W2](W2-crack-scenario.md) · [W3](W3-lab-server.md) · [W4](W4-scenario-page.md) · [W5](W5-blast.md) · [W6](W6-sinkhole-railway-pipe.md) · [F10](F10-cracks-vibration-damage.md) · WP9 in the vault.
