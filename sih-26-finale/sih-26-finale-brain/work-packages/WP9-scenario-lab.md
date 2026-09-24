---
title: "WP9 — Scenario Lab (Job 2 freeze-and-create-subsidence + Job 3 forecast consequences)"
slug: WP9-scenario-lab
type: work-package
module: integration
status: draft
tags: [work-package, wp9, scenario, forecast, renderer, proposed]
created: 2026-09-14
updated: 2026-09-15
author: claude-code
last_agent_edit: claude-code
source_file: files/SIMULATION-IDEA.pdf
---

# WP9 — Scenario Lab

> [!WARNING]
> **Draft, proposed 2026-09-14 (DEC-13, DEC-14 in [[projects/subsidence-simulator/decisions]]).** Scope from Adarsh's answers on 14 Sep. It is binding for Antigravity once Adarsh confirms D1–D7 in `files/MY-STEPS.md`. Build prompts are in `files/BUILD-PLAN.md`. The frozen [[docs/interface-contracts]] still wins for everything inside `mine-sim/`.
>
> **Update 2026-09-15:** Adarsh confirmed D1–D7 (all yes). Binding. See [[projects/subsidence-simulator/decisions]] §11.

| Field | Details |
|---|---|
| **Owner** | [[people/adarsh-agarwala\|Adarsh]]; code by [[people/antigravity\|Antigravity]] AG-1…AG-4; review by [[people/claude-code\|Claude Code]] |
| **Depends on** | [[work-packages/WP1-core-physics\|WP1]] (`physics.subsidence`), [[work-packages/WP3-world-state-engine\|WP3]] + [[work-packages/WP6-stream-and-output\|WP6]] (run artefacts), [[work-packages/WP8-consequence-renderer\|WP8]] (Window 1) |
| **Blocks** | Nothing in the simulator. Pure consumer of a finished run |
| **Due** | First batch Wed 16 Sep 18:00 · complete Wed 16 Sep 23:00 |

---

## 1. Boundary (why this doesn't break the frozen contract)

Contract §7.4 says **"There is no click-to-subside"**. That stays true: the **main run and `/ws/run` are never changed**. The Scenario Lab:

1. reads a **finished run's** artefacts (`terrain_state.npz`, `terrain_changes.jsonl`, `nodes.csv`, `run_summary.json`) read-only;
2. builds a **frozen snapshot** at day T in its own memory;
3. computes the scenario on that copy and saves the result in `scenario-lab/store/` only;
4. never imports `minesim.world` or `minesim.stream`, never writes under `mine-sim/`, `handoff/` or any backend/ML path, and makes **no network calls** out.

Scenario results carry `kind: "scenario"` and the label `SCENARIO (HYPOTHETICAL)`. They never carry `real` / `pinned` / `synthetic` (Invariant 6 applies to emitted run data, and scenarios are not run data). Scenario inputs are user hypotheses, labelled as such (Invariant 7).

The only formula for the longwall trough stays `physics.subsidence` (Invariant 4). Scenario types 1 and 3 call it with modified parameters. Types 2, 4 and 5 add no trough formula.

Damage grades and vibration limits live **outside `mine-sim/src`** (so [[gates/G14-no-pinn-in-alarm-path|G14]] is unaffected). They **describe** the ground and never raise an alarm (Invariant 3).

## 2. Files and owners

```
scenario-lab/                         Python package `lab`, installed with pip install -e scenario-lab
  pyproject.toml                      AG-1 (T5)
  config/lab.yaml                     AG-1 (T5)   grid window, settled time coefficient, min effect, store dir, port, display cell
  config/events/sudden_sinking.yaml   AG-1 (W1)
  config/events/edge_collapse.yaml    AG-1 (W1)
  config/events/crack.yaml            AG-2 (W2)
  config/events/blast.yaml            AG-1 (W5)
  config/events/sinkhole.yaml         AG-2 (W6)
  config/damage_limits.yaml           AG-2 (T6)
  config/objects.yaml                 AG-2 (T6)
  lab/config.py                       AG-1 (T5)
  lab/snapshot.py                     AG-1 (T5)
  lab/fields.py                       AG-1 (T5)
  lab/events/base.py                  AG-1 (T5)   EventResult + registry
  lab/events/sudden_sinking.py        AG-1 (W1)
  lab/events/edge_collapse.py         AG-1 (W1)
  lab/events/crack.py                 AG-2 (W2)
  lab/events/blast.py                 AG-1 (W5)
  lab/events/sinkhole.py              AG-2 (W6)
  lab/cracks.py                       AG-2 (T6)
  lab/objects.py, lab/consequence.py  AG-2 (T6; railway + pipe added W6)
  lab/forecast.py, lab/spread.py      AG-3 (T7)
  lab/tools/make_test_forecast.py     AG-3 (T7)
  lab/scenario.py, lab/store.py       AG-3 (W3)
  lab/server.py                       AG-3 (W3; forecast endpoint W7)
  lab/forecast_consequence.py         AG-3 (W7)
  tests/                              each module's owner; tests/gates/test_l1..l7.py per §8
  store/                              git-ignored
  fixtures/                           test forecast files (AG-3)
renderer/
  index.html (Window 1), export_scene.py, js/terrain.js, tests/   AG-4 (T4)
  scenario.html + js/scenario.js (Window 2), after.html (Window 3 placeholder)   AG-4 (W4)
  forecast.html + js/forecast.js (Forecast view)   AG-4 (W8)
```

## 3. Conventions

| Item | Rule |
|---|---|
| Internal lab subsidence `s_mm` | **positive down** (same as `physics.subsidence`) |
| Every JSON the lab returns | **negative down** (same as `nodes.csv`, DEC-8) |
| Grid index | array shape `(nx, ny)`; `i` ↔ x, `j` ↔ y; cell centre x = `origin_x_m + (i + 0.5)·cell_m` |
| Tilt | mm/m, surface convention: `tilt_x = −∂s/∂x` (+ = surface rises toward +x) |
| Curvature | 1/km (= mm/m²), `−∂²s/∂x²` |
| Horizontal strain | mm/m, **+ = tension**, `ε_x = B·∂²s/∂x²`, `B = r/√(2π)`, `r = depth/tan β` (same B as `physics.displacement`) |
| Numbers | all from `scenario-lab/config/*.yaml` or the mine config. Each scenario/limit value has a `source:` string |
| **Derivatives (stress test 14 Sep)** | **Never take tilt/strain/curvature from the int-mm grid.** Rounding to 1 mm on 5 m cells gives strain errors up to 4.9 mm/m, bigger than the true peak of 4.5 mm/m. Fields come from the float model surface `s_model_mm` plus the float `ds`. The int grid `s_mm` is only for display and the before/after surface numbers |

## 4. Data contracts (Python)

```python
@dataclass(frozen=True)
class Grid:
    origin_x_m: float; origin_y_m: float; cell_m: float; shape: tuple[int, int]   # (nx, ny)

@dataclass(frozen=True)
class Snapshot:
    run_dir: Path; mine: str; run_id: str        # run_id = sha256(run_summary.json)[:8]
    day: float; epoch: int; t_s: float; face_x_m: float
    grid: Grid
    z0_mm: np.ndarray            # int32, from terrain_state.npz
    s_mm: np.ndarray             # int32, positive down, at `epoch` (replay of the world artefacts; display + surface numbers)
    s_model_mm: np.ndarray       # float64, positive down, physics.subsidence at cell centres and `day`; used for all derivatives and rates
                                 # test: max |s_model_mm − s_mm| ≤ lab.world_model_tolerance_mm, otherwise ValueError (world and physics disagree)
    cfg: "minesim.config.Config"

def load_snapshot(run_dir: Path, day: float) -> Snapshot: ...   # day beyond run → ValueError; face_x_m = min(face_position(day), panel length)

@dataclass(frozen=True)
class Fields:
    tilt_x_mm_per_m: np.ndarray; tilt_y_mm_per_m: np.ndarray; tilt_mag_mm_per_m: np.ndarray
    curv_x_per_km: np.ndarray; curv_y_per_km: np.ndarray
    strain_x_mm_per_m: np.ndarray; strain_y_mm_per_m: np.ndarray

def derive_fields(s_float_mm: np.ndarray, cell_m: float, cfg) -> Fields: ...   # float input only (raises TypeError on an integer array); np.gradient, edge_order=2

@dataclass(frozen=True)
class EventResult:
    possible: bool
    reason: str                      # plain words, always filled
    ds_mm: np.ndarray | None         # extra subsidence, positive down, float32, full grid; None for blast
    ppv_mm_s: np.ndarray | None      # blast only
    params_used: dict[str, dict]     # name -> {"value": ..., "unit": ..., "source": ...}

EVENTS: dict[str, Callable[[Snapshot, float, float, dict], EventResult]]
# keys: "sudden_sinking", "crack", "edge_collapse", "blast", "sinkhole"
```

## 5. Scenario types (formulas)

`X, Y` = grid cell centres. `d` = distance from the click `(x0, y0)`. `r = depth/tan β`. "Settled params" = `dataclasses.replace(cfg.knothe, time_coefficient=lab.settled_time_coefficient_per_day)`, a numerical stand-in for "all settlement has happened". `taper(d, R, r)` = 1 for d ≤ R, `0.5·(1 + cos(π·(d − R)/r))` for R < d < R + r, 0 beyond. `min_effect_mm` comes from `lab.yaml`.

| # | Type | Inputs (user, defaults + ranges in its yaml) | Computation | Not possible when (reason text) |
|---|---|---|---|---|
| 1 | `sudden_sinking` | `collapse_radius_m` | `S_pot = physics.subsidence(X, Y, day, panel, settled)`; `U = max(0, S_pot − s_model_mm)`; `ds = U · taper(d, R, r)` | `S_pot(click) < min_effect` → "no extracted coal under this spot, nothing to collapse into"; `U(click) < min_effect` → "ground here has already settled (N mm left)" |
| 2 | `crack` | `days_ahead` | `rate = (s_model_mm − physics.subsidence(X, Y, day − crack.rate_window_days)) / crack.rate_window_days`; `ds = min(days_ahead · max(0, rate) · taper(d, R_n, r), U)` with `R_n = crack.nearby_radius_m` and `U` as in type 1 (the ground can't sink more than is left) | `rate(click) < crack.min_rate_mm_per_day` → "ground near here is not moving now"; also reports if no new crack forms: "strain stays below crack threshold (max X vs Y mm/m)" |
| 3 | `edge_collapse` | `pillar_width_m`, `length_m` | `side = sign(y0)`; `S_wide = physics.subsidence(X, Y − side·Δw/2, day, replace(panel, width_m=W+Δw), settled)`; `S_set = physics.subsidence(X, Y, day, panel, settled)`; `ds = max(0, S_wide − S_set) · taper(|X − x0|, length/2, r)` | `y0 == 0` → "click nearer one panel edge"; `max(ds) < min_effect` → "no extracted panel next to this spot" |
| 4 | `blast` | `charge_kg_per_delay`, `frequency_band` (`lt8`, `8to25`, `gt25`) | `D = max(d, blast.min_distance_m)`; `PPV = K · (D/√Q)^(−b)`; K, b from `blast.yaml` | `K` or `b` null → "site constants K and b are not set from a published source yet". They stay **null** until a published Indian coal-mine regression is cited; no guessed values |
| 5 | `sinkhole` | `cover_depth_m`, `void_height_m`, `gallery_width_m`, `bulking_factor`, `flare_angle_deg` | `H = m_g/(k − 1)`; if `H ≥ h_c`: `depth = (m_g − (k−1)·h_c)·1000` mm (**upper bound**: ignores the crater spreading wider than the gallery; the reason text says so), `r_bot = w_g/2`, `r_top = r_bot + h_c·tan θ`, `ds = depth · taper(d, r_bot, r_top − r_bot)` | `H < h_c` → "broken rock swells and fills the void H m above the workings; cover is h_c m, so no sinkhole reaches the surface by caving". If also `h_c ≤ sinkhole.indian_max_cover_ratio · m_g`, add: "Indian cases with weathered or water-saturated cover have formed pot-holes up to 35× extraction height through erosion, which this model does not include" |

Pothole background: pot-holes are reported where cover is under ~10× extraction height, and up to 35× in Indian cases (ResearchGate, *Pot-hole Subsidence in Underground Coal Mining: Some Indian Experiences*).

## 6. Consequences (the same for every scenario and for forecasts)

1. `after = s_mm + ds` (positive down). `Fields` before and after.
2. **Cracks** (`cracks.py`): a cell cracks where `strain_x` or `strain_y` > `damage_limits.crack.threshold_mm_per_m` = **3.0** (source: "cracks tend to appear when tensile deformation exceeds 2–3 mm/m", Yan et al., cited in Sci. Rep. 2025 Yushenfu study; the upper end is used; `verified: true`). `width_mm = (ε − threshold) · cell_m` (the extra stretch over one cell opens as one crack; `width_model_sourced: false`, and the UI says "estimated width"). Axis = the axis that exceeded. New cracks = cracked after but not before. Expect cracks outside the panel edges even **before** a scenario (baseline max tension ≈ 4.1 mm/m at day 300); that is realistic.
3. **Objects** (`objects.py`, `consequence.py`), sampled over the footprint (houses) or along the polyline:

| Object | Metric | Grade / limit | Source (`damage_limits.yaml`) |
|---|---|---|---|
| `house` (brick / mud) | max \|tilt\|, max \|strain\|, max \|curvature\| | Grade = worst of: I (strain ≤ 2.0 mm/m, curvature ≤ 0.2 /km, tilt ≤ 3.0 mm/m), II (≤ 4.0, ≤ 0.4, ≤ 6.0), III (≤ 6.0, ≤ 0.6, ≤ 10.0), IV (beyond) | Regulations for coal pillar retention and mining under buildings, water bodies, railways (China). Grades I–II `verified: true`, III–IV `verified: false`. Used because no published Indian grade table was found |
| `house` under blast | PPV at house | DGMS (Tech)(S&T) Circular 7/1997, domestic houses (kuchcha, brick & cement): 5 / 10 / 15 mm/s for < 8 / 8–25 / > 25 Hz | `verified: true` |
| `road` | max crack width within `objects.road_crack_search_m` of the line; max \|tilt\| along the line | numbers only | — |
| `pole` | lean at top = `tilt_mag · height_m` | numbers only | — |
| `railway` (W6) | max \|Δs\| over `objects.rail_base_m` along the line | numbers only | — |
| `pipe` (W6) | max \|ε along pipe\| = `εx·cos²α + εy·sin²α` | numbers only | — |

Houses near the panel edges are already grade II–III before any scenario (checked 14 Sep: H1 III, H2 II, H4 II, H5 I at day 300). That is realistic for longwall mining at this depth. **Forecast view:** an object in masked cells returns `plain: "No forecast covers this object"` and no grade.

Each object returns `before`, `after` and one `plain` sentence, e.g. "House H1: grade I → III, wall cracks likely wider than 15 mm" or "Pole P3: top moves 12 cm sideways".

**Example village** (`objects.yaml`, labelled `layout: illustrative, not the real Adriyala surface`). Coordinates in the panel frame (m):

| id | type | position / line | size |
|---|---|---|---|
| H1–H4 | house | (580, 150) (600, 170) (620, 150) (640, 175) | 10 × 8 m, brick, mud, brick, mud |
| H5 | house | (600, −20) | 10 × 8 m, brick |
| H6 | house | (1500, 235) | 10 × 8 m, brick |
| H7, H8 | house | (1150, 0) brick, (1180, 140) mud | 10 × 8 m. Near the day-300 face, so sudden sinking and crack scenarios visibly change them |
| R1 | road | (1200, −235) → (1200, 235) | width 6 m |
| R2 | road | (300, −200) → (2200, −200) | width 6 m |
| P1–P8 | pole | y = 150, x = 400, 650, … 2150 (every 250 m) | height 9 m |
| T1 | pole (tower) | (1000, −235) | height 30 m |
| RL1 | railway (W6) | (0, 220) → (2500, 220) | — |
| PP1 | pipe (W6) | (800, −235) → (1400, 235) | — |

If the run's grid is smaller than these coordinates, the owner moves the outermost objects to 10 m inside the grid edge and records that in the walkthrough.

## 7. JSON and HTTP

**Server:** `python -m lab.server --run mine-sim/out/<run> --port <lab.yaml port>` serves `renderer/` at `/` and:

| Method | Path | Returns |
|---|---|---|
| GET | `/api/run` | mine, days, grid, `run_id` |
| GET | `/api/snapshot?day=T` | downsampled surface (`lab.display_cell_m`), `subsidence_mm` negative down, `face_x_m`, nodes |
| GET | `/api/events` | every type with its param spec: name, unit, default, min, max, source |
| GET | `/api/objects` | objects list |
| POST | `/api/scenario` | body `{"day","type","x_m","y_m","params"}` → scenario result (below), saved |
| GET | `/api/scenarios` · `/api/scenarios/{id}` | saved list · one saved result |
| POST | `/api/forecast/consequence` | body `{"forecast_path"}` or the forecast JSON → forecast consequence result |

**Scenario result:**
```json
{"schema_version": 1, "kind": "scenario", "label": "SCENARIO (HYPOTHETICAL)",
 "scenario_id": "sc-d300-sudden_sinking-1a2b3c4d", "run_id": "…", "mine": "adriyala_lw1",
 "request": {"day": 300, "type": "sudden_sinking", "x_m": 1190.0, "y_m": 0.0, "params": {"collapse_radius_m": 40}},
 "possible": true, "reason": "…",
 "params_used": {"collapse_radius_m": {"value": 40, "unit": "m", "source": "scenario input"}},
 "window": {"origin_x_m": 0.0, "origin_y_m": 0.0, "cell_m": 5.0, "shape": [0, 0]},
 "before_subsidence_mm": [[0]], "after_subsidence_mm": [[0]],
 "tilt_after_mm_per_m": [[0.0]], "strain_after_mm_per_m": [[0.0]], "ppv_mm_s": null,
 "cracks": {"before_count": 0, "after_count": 0, "new": [{"x_m": 0.0, "y_m": 0.0, "width_mm": 0.0, "axis": "y"}]},
 "objects": [{"id": "H1", "type": "house", "before": {}, "after": {}, "plain": "…", "limit_source": "…"}],
 "summary": {"max_extra_sinking_mm": 0, "max_tilt_mm_per_m": 0.0, "max_tensile_strain_mm_per_m": 0.0, "new_cracks": 0, "plain": ["…"]}}
```
- `window` = bounding box of cells with `ds ≥ min_effect` (or `PPV ≥ blast.display_min_mm_s`) padded by r and clipped to the grid. When the scenario is not possible, the window is ±r around the click and before equals after.
- `strain_after_mm_per_m` holds the larger-magnitude of `strain_x` / `strain_y`, sign kept.
- `scenario_id = "sc-d{day}-{type}-" + sha256(canonical_json(request) + run_id)[:lab.id_hash_chars]`. The same request gives the same id and byte-identical JSON.
- Stored at `scenario-lab/store/<run_id>/<scenario_id>.json`.

**Forecast input:** `forecast_nodes` form, [[docs/interface-ml-to-renderer]] §2b.

**Spread (`spread.py`):** `Δ_i = p_i − current_i` (negative down; `current_i = −s_mm` at the node, bilinear). Grid `Δ = Σ wᵢΔᵢ / Σ wᵢ`, `wᵢ = exp(−dᵢ²/(2r²))`. Cells with `Σ wᵢ < lab.spread_min_weight` are masked ("no prediction here"). `after_s = s_mm − Δ`.

Forecast consequence arrays are block-averaged to `lab.display_cell_m` (keeps the response a few MB). Scenario windows stay at native resolution.

**Forecast consequence result:** `{"schema_version":1, "kind":"forecast_consequence", "label":"FORECAST (PREDICTED)", "test_input": <model_id starts with "TEST-FIXTURE">, "model_id", "issued_epoch", "issued_day", "horizons_h", "results": {"24": {"p10": {…}, "p50": {…}, "p90": {…}}, "72": {…}}}`. Each inner object has the scenario result's `window`, `after_subsidence_mm`, `tilt_after_mm_per_m`, `strain_after_mm_per_m`, `mask`, `cracks`, `objects`, `summary`.

## 8. Lab gates

| Gate | Asserts | Owner |
|---|---|---|
| L1 | Running every scenario type leaves every file in the run dir byte-identical (sha256 before/after) | AG-3 (W3) |
| L2 | Same request twice → same id, byte-identical JSON | AG-3 (W3) |
| L3 | No `requests` / `httpx` / `urllib` / `socket` import in `lab/` (outside tests); no writes outside `scenario-lab/store/`; no import of `minesim.world` / `minesim.stream` | AG-3 (W3) |
| L4 | AST scan of `lab/**/*.py`: no numeric literal other than 0, 1, 2, 0.5, −1, 1000 (m↔mm) and 86400 (s/day); the id hash length comes from `lab.id_hash_chars`; HTTP codes use `fastapi.status` constants; every `params_used` entry has a `source` | AG-1 (T5) |
| L5 | `derive_fields` on a **float** grid of `physics.subsidence` matches `−physics.tilt` within 3 % where \|tilt\| > 0.5 mm/m, and matches the fixed `physics.strain` sign (> 0 outside the rib, < 0 over the centre); `derive_fields` on an int array raises TypeError | AG-1 (T5) |
| L6 | Forecast validator rejects: p10 > p50, missing horizon, unknown node_id, NaN, wrong sign field | AG-3 (T7) |
| L7 | Every result JSON has `label`; every page contains its banner text | AG-3 (W3) + AG-4 |

## 9. Windows (renderer pages)

| Window | Page | Must show | Must not |
|---|---|---|---|
| 1 Terrain running | `index.html` | SIMULATED banner, day slider, face marker, nodes by provenance, undelivered distinct, vertical exaggeration label, **"Freeze + create subsidence" button** → opens `scenario.html?day=<current>` | change terrain |
| 2 Frozen scenario | `scenario.html` | SCENARIO banner with frozen day and "not sent to backend or ML"; click → coordinates + current subsidence; type dropdown and form from `/api/events`; Before / After / Difference; tilt, strain, cracks, PPV layers; objects coloured by grade + plain sentences; summary; not-possible reason shown large; saved list | touch Window 1 or run files |
| 3 After the event | `after.html` | banner + "Planned for v3: sensor data after the event" + link back | — |
| Forecast | `forecast.html` | FORECAST banner; TEST INPUT banner when `test_input`; issued day + horizon always visible; 24/72 h switch; p10/p50/p90 switch; masked areas hatched "no prediction here"; objects + sentences | show a forecast without its range, or look like measured data |

Three.js: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`, OrbitControls from `https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js`.

## 10. Related

- [[work-packages/WP8-consequence-renderer]] (Window 1 base)
- [[docs/interface-ml-to-renderer]] (forecast input)
- [[projects/subsidence-simulator/decisions]] (DEC-13, DEC-14, DEC-15)
