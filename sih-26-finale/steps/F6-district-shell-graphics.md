# F6 — Mine district, thin-shell ground, 360° camera, better graphics

**Written 16 Sep 2026 by Claude. Branch `fix-the-system`. Answers Adarsh's six questions of 16 Sep.**

Baseline at the time of writing: vault PERFECT (0/0/0), mine-sim **150 passed**, renderer scene.json 3.2 MB, frames 37 MB.

---

## 1. Question 1 — is any of this real?

Checked against the files, not from memory.

| Part | Verdict | Evidence |
|---|---|---|
| Terrain | **Real** | `data/real/adriyala_lw1_dem.npz` `meta_json`: AWS Open Data Terrain Tiles (terrarium), SRTM-derived, zoom 13, 6 tiles, `fetched_utc 2026-09-15T18:46:59Z`. 607 × 457 cells × 15 m = **9.09 × 6.84 km**, elevation **70.97 – 238.87 m** AMSL, lat 18.6128–18.6742, lon 79.5294–79.6156. |
| Panel geometry | **Real** | `config/mines/adriyala_lw1.yaml`: 250 m × 2500 m, depth 375 m, seam 3.6 m, advance 4.0 m/day. |
| Subsidence physics | **Real-anchored** | Knothe fitted to 283 digitised points, 6 epochs, from `10.18311/jmmf/2022/32099`. RMS 52.1 mm, R² 0.9845, modelled peak 1202 mm vs measured 1267 mm. |
| Sensor readings, radio, battery, cost | **Synthetic** | Every entry in `assumptions.yaml sensors:` / `radio:` / `power:` / `cost:` carries `OPEN — guess, replace with hardware spec sheet`. `run_summary.json data_label = "synthetic simulator output, not field measurements"`. |
| Node positions | **Ours** | Output of `minesim.placement`, not a real deployment. |

**Open caveat, already flagged in config:** `site.panel_centre_lat_deg 18.6435` / `lon 79.5725` are marked `OPEN — VERIFY` — approximate, carried from an old sandbox. Real ground, possibly a few hundred metres off the real panel.

## 2. Question 3 — is the deformation where it should be?

**Yes.** Measured on the exported day-345 frame (`renderer/scene/frames`, grid 309 × 84 @ 10 m):

- Peak **−1198 mm at x = 238 m, y = −7 m** — on the panel axis (ribs at ±125 m), deep in the settled goaf.
- Face at **x = 1380 m**. Sinking reaches x = 1398 m (18 m ahead); **exactly 0 at face + 100 m**. Subsidence lags the face and never leads it.
- Transverse trough reaches **±207 m** for ribs at ±125 m → 82 m draw outside the rib → **angle of draw 12.3°** at 375 m depth.
- Peak 1198 mm vs fitted 1204 mm vs measured 1267 mm.

No change needed.

## 3. Question 2 — the mine uses 4 % of the land

The subsidence world grid is **3.09 × 0.84 km** inside a **9.09 × 6.84 km** terrain. That is because one longwall *panel* is a narrow strip. **Decision (Adarsh, 16 Sep): build a mine district of 8 panels.**

## 4. What gets built

Two phases so the visual fixes land before the expensive re-run.

### Phase A — renderer only, no re-run

| # | Change | Files |
|---|---|---|
| A1 | **Thin-shell ground.** The 375 m strata block, bottom plate and section wall stop being drawn by default. They become part of the existing **Underground X-ray** toggle. What is left is a crust: the real top surface plus a thin rim (`ground.shell_thickness_m`, default 12 m) so it reads as rock, not paper. | `js/terrain.js`, `config.yaml` |
| A2 | **360° camera.** `maxPolarAngle` goes from `π·0.495` to `π`, so the camera can pass under the ground and look up at the subsidence bowl from below. Surface is already `DoubleSide`; three.js flips normals on back faces, so the underside lights correctly. | `js/app.js` |
| A3 | **Zoom only on + / −.** Mouse-wheel zoom removed. Cluster-badge click-to-zoom removed. Buttons `+` / `−` and keys `+ = − _` stay. Click keeps selecting nodes (that is not zoom). | `js/app.js`, `js/network.js` |
| A4 | **Graphics.** sRGB output encoding, ACES filmic tone mapping, device pixel ratio capped at 2, gradient sky background, PMREM environment light off that sky, fog colour matched to the horizon, sun/fill re-balanced for tone mapping. | `js/app.js`, `config.yaml` |

Terrain stays context only: never feeds `S(x,y,t)`, never writes `Z`. No `minesim.physics` in `renderer/`.

### Phase B — 8-panel district, needs a re-run

| # | Change | Files |
|---|---|---|
| B1 | `PanelGeometry` gains optional `y_offsets_m: tuple[float, ...] = (0.0,)` — the transverse centre of each panel. Default `(0.0,)` is exactly today's behaviour. Precedent: `seam_inclination_deg`, `advance_direction_deg`, `inflection_offset_m` are already optional fields past the contract's four. | `src/minesim/config.py` |
| B2 | `PanelGeometry` gains optional `start_day_offsets_d` — panels are mined on a staggered schedule, not all at once. | `src/minesim/config.py` |
| B3 | `physics.subsidence` keeps its frozen signature. Its body moves to `_subsidence_one_panel`; `subsidence` sums that over the offsets — standard NCB superposition. **Invariant 4 holds: still exactly one implementation of the formula.** `tilt`, `curvature`, `strain`, `displacement` take numerical derivatives of `subsidence`, so they follow for free. | `src/minesim/physics.py` |
| B4 | The mine yaml gains a `district:` block — panel count, chain-pillar width, stagger. Invariant 8 holds: swapping the mine file still swaps mines with no code change. | `config/mines/adriyala_lw1.yaml` |
| B5 | `WorldState` footprint widens to cover every panel: `y_half = max|offset| + width/2 + 2r`. | `src/minesim/world.py` |
| B6 | Placement spreads over the district footprint with tier spacing scaled to hold the node budget near today's ~330. | `src/minesim/placement.py` |
| B7 | New gate test: **a single panel (`y_offsets_m = (0.0,)`) reproduces the fitted result bit-for-bit.** Guards the whole superposition change. | `tests/` |

**Honesty label:** panels 2–8 are *plausible* geometry — LW1 repeated on a real chain-pillar pitch. They are not in the JMMF paper. `scene.json` and `run_summary.json` will say so, per invariant 7.

## 4b. STOPPED — Phase B hits a frozen contract (16 Sep)

Phase B is **written, tested and switched off** (`district.n_panels: 1`). It cannot be switched on as
planned, and per AGENTS.md ("stop and escalate rather than work around") this is Adarsh's call.

**Measured, on this config:**

| `n_panels` | scouts | anchors | result |
|---|---|---|---|
| 1 | 327 | 47 | OK — unchanged from today |
| 2 | 694 | **100** | `ContractViolation: anchor ID range is 1-99` |
| 3 | 972 | **139** | `ContractViolation` |
| 8 | 1676 | **240** | `ContractViolation` |

The anchor ID range 1–99 is frozen (contract §6; enforced at `placement.py:453` and `sizing.py:208`).
The ceiling is 99 anchors × 8 children = **792 scouts**, so at the sourced tier spacing the network
cannot address even two full panels. The ground can be a district; the *sensor network* cannot.

**Three ways forward — Adarsh picks:**

| | Option | Cost | Honest? |
|---|---|---|---|
| **a** | **Instrument only the active panels.** Ground = 8 panels, sensors follow the working faces at LW1 density. | New `placement` concept (a moving instrumented subset); ~½ day. | ✅ This is what a real mine does. My recommendation. |
| **b** | **Widen tier spacing** until the count fits (1C 25 → ~45 m). | One config line. | ❌ Breaches the geotechnical note's 15–25 m for actively failing ground, which is **sourced**, not a guess. |
| **c** | **Change the node ID scheme.** | Frozen contract change; Part 2 and Part 3 build against it. | ⚠️ Not ours to change alone — needs the team. |

**Also found and fixed while doing this** (it would not have failed anything, which is the worrying
part): `physics.subsidence` is differentiated numerically by every downstream module, so a district
would have silently propagated into the **parameter fit** — `fitting.py` fitted against the LW1 survey
line would have been modelling eight superposed panels. Added `physics.as_single_panel()` and pinned
the three field-anchored call sites: `fitting.py`, `scripts/build_anchored_dataset.py`,
`scripts/stress_test.py`.

`tests/unit/test_district.py` (8 tests) guards all of this, including that a single panel still
reproduces the published peak.

## 5. Costs Adarsh should know before Phase B

- World grid grows ~3.4× (618 × 168 → 618 × ~573 cells @ 5 m).
- Last full run: **871 s wall, 864 MB** in `out/v2-690d`, 37 MB of exported frames. Expect the frame export to grow with the grid; `downsample_cells` may need to go 2 → 3 to hold the browser payload.
- Re-run is `./run-simulation.sh`. Placement test numbers will move because the footprint changed — any failure gets listed by name, tests do not get edited to fit.

## 6. Hand checks for Adarsh

1. Open the view. The ground is a crust, not a block. Drag the camera below the horizon — you can fly under and see the bowl from underneath.
2. Mouse wheel does nothing. `+` / `−` buttons and keys step one zoom level.
3. Tick **Underground X-ray** — strata, seam, goaf and the section wall come back.
4. Colours: sky gradient, warmer sun, no washed-out white.
5. (After Phase B) Zoom out to level 0: eight troughs in a row across the land, at different stages of sinking.
