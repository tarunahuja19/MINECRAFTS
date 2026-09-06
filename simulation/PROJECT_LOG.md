# Project Log

## 1. What this project is

An interactive digital twin / synthetic telemetry testbed for the **Adriyala
Longwall Project** (SCCL, Godavari Valley Coalfield, Telangana, India).
Python physics backend (FastAPI + WebSocket) + React/Three.js frontend.
SIH problem ID **SIH-26025**.

## 2. Verified parameters (single source of truth = `sandbox/constants.py`)

| Parameter | Value | Note |
|---|---|---|
| Depth of cover H | 375.0 m | Adriyala, powered support |
| Panel width W | 250.0 m | |
| Panel length L | 2500.0 m | |
| Seam thickness m | 3.0 m | **ASSUMED — not in open literature** |
| Subsidence factor a | 0.75 | literature range 0.7–0.9 |
| tan β | 1.9 | 1.82 fitted at Barapukuria, same Gondwana strata |
| Knothe time constant c | 0.04 /day | |
| Radius of influence r = H/tanβ | 197.368 m | derived, never hand-typed |
| B_horiz = 0.35·r | 69.079 m | deliberately 0.35 not 0.32 — see constants.py:56-61 |
| S_max_full = a·m | 2.25 m | |
| W/H | 0.6667 | < 1.2 → panel is SUBCRITICAL |
| Window | 600 × 600 m | bowl spans 644.7 m; narrower clips signal |
| Terrain source | real DEM, 18.6435°N 79.5725°E | 196.2–370.3 m AMSL, **174.1 m relief** |
| Contours | 20 m interval / 100 m index | 1/2/5 series, 9 levels |
| Grid | 241 × 241 (2.5 m spacing) | |
| Tick | 60 sim-seconds | default speed 2000× |
| DGMS tensile limit | 5.3 mm/m | Kamptee coalfield |
| DGMS compressive limit | 6.6 mm/m | same |
| Sensor nodes | 33 | |
| Surface zones | 36 (6×6) | |

## 3. What is REAL (verified by running it)

Measured results:
- `pytest` → **58 passed** (35 baseline, +4 WebSocket round-trip, +9 DEM/hypsometry, +5 surface-placement, +2 node-telemetry contract T57, +3 strain-geometry T58)
- `tsc -b` in frontend → **exit 0, clean**
- Peak settled subsidence from `surface.S()` → **1.9970 m** (target 1.9971, below S_max_full 2.25)
- Strain channels from `surface.channels()` → **+6.06 mm/m tensile / −9.01 mm/m compressive**
- Backend synthetic baseline relief from `terrain.baseline_grid()` → **1.607 m** (kept as fallback)
- **Real DEM panel** from `dem.panel_dem()` → **196.2–370.3 m AMSL, 174.1 m relief**, zero NaNs,
  slope mean 13.5° / max 54.1° — verified genuine terrain (lag-1 autocorrelation 0.9896)

Why the physics is defensible:
- Real **Knothe influence function** `k(x) = (1/r)·exp(−πx²/r²)` with `r = H/tanβ`
- **Analytic Aviershin derivatives** — derivative kernels written symbolically and
  convolved, never finite differences, so truncation error cannot masquerade as a
  strain signal (`sandbox/surface.py:46-56`)
- **Convolution not the erf closed form**, chosen so a travelling extraction face
  can be modelled later (`sandbox/surface.py:24-43`)
- The subcritical reduction 2.25 → 1.997 m **emerges from convolution geometry**,
  with no hand-applied correction factor (`sandbox/constants.py:63-71` forbids one)
- Correct **OLS slope standard error** in `sandbox/gates.py:110`; its docstring proves
  the original spec's SNR gate was unpassable (n=20 → 2.41 < 3.0) and fixes it to n=40 → 6.81
- `sandbox/layout.py` rejects all three spec node-layout options with computed evidence:
  the tensile band is only 57 m wide, so 150 m spacing would detect 0.00 mm/m

## 4. What is SIMULATED / approximated (be explicit)

- `sandbox/collapse.py` is **phenomenological, not derived** — the 0.05 precursor
  fraction, 1.8 yield boost and 0.25 precursor amplitude are shape-fitting constants
- `sandbox/segments.py` CRITICAL-before-FAILED is a **hardcoded `if`**, not emergent
  physics — gate T50 therefore tests a code path, not a physical warning window
- Sensor hardware channels (V_bat, temperature, LoRa RSSI/SNR) are **algorithmic**,
  not real hardware
- Seam thickness 3.0 m is assumed
- **No factor-of-safety, stress, Mohr-Coulomb, cohesion or friction is computed
  anywhere in Python** — despite `FoS < 1.0` appearing in UI captions

## 5. KNOWN BROKEN — current state, do not present as working

1. ~~**Interventions never reach the backend.**~~ **FIXED in Phase 1** (`2c3ef18`).
   The server now accepts both `apply_collapse`/`collapse` and
   `apply_vibration`/`vibration`, honours `radius_m` and `warning_hours` (which
   were dropped even when the name matched), implements `session.reset()`, and
   returns an explicit `{"type": "error"}` for unknown actions instead of failing
   silently. Verified: triggering a collapse writes a real row to
   `out/events.csv`.
2a. ~~**Markers were placed on a different surface than the terrain.**~~
   **FIXED in Phase 3** (`c1652b1`). `NodeMarkers` and `TargetBeacon` sampled
   the retired procedural terrain (8–65 m) while the mesh drew the real DEM
   (0–174 m datum-relative). Measured against the live payload: **17 of 33
   sensor monuments buried, worst case 89.3 m underground**, and **75 of 128
   red-ring vertices up to 52.2 m below ground** at the reported coordinates.
   `frontend/src/utils/terrainSampler.ts` is now the single answer to "how
   high is the ground at (x, y)?". Both counts are now 0.
2. ~~**The rendered terrain is not the backend's terrain.**~~ **FIXED in Phase 2**
   (`364dc23`, `f4ab509`). The viewport now renders the real Adriyala DEM
   (196.2–370.3 m AMSL, **174.1 m of relief**) served from `sandbox/dem.py`.
   `z0Mesh` is destructured and drives the mesh; colouring uses the same
   hypsometric ramp, equal-area stretch and Horn (1981) hillshade on both
   client and server. The invented Gaussian hills are gone.
3. ~~**A second, unrelated physics engine runs in the browser.**~~
   **FIXED in Phase 3** (`94b6db9`). `geomechanicsEngine.ts` is rewritten on
   the real Knothe influence function with analytic first and second
   derivatives (never finite differences, per `surface.py`'s reasoning) and
   Aviershin strain `ε = B·d²S/dx²` with `B = 0.35r`. Drops are clamped to
   `S_MAX_FULL`. Its scope is now explicitly the operator's discrete pillar
   interventions between server ticks — the server remains authoritative.
4. ~~**Exaggeration leaks into reported numbers.**~~ **FIXED in Phase 3**
   (`c1652b1`). Neighbour elongation is computed at true physical elevations;
   exaggeration is rendering-only and reaches no reported number.
5. **The seismograph is `Math.random()`** —
   `frontend/src/components/SeismographOscilloscope.tsx:42-44`. STILL OPEN.
6. ~~**~4,500 lines of dead code.**~~ **FIXED in Phase 4** (`567488b`). 2,562
   lines removed by computing the import graph and deleting only zero-inbound
   nodes: 6 orphaned components (1,774), `pyvista_export.py`/`plots.py`/
   `plots_b.py` (631), and `opensees_sim/` + `ogs_pyvista_mine/` (788, self-
   referential only). Test count unchanged at 53, which was the point.
7. ~~**Four divergent copies of the Adriyala parameters.**~~ **FIXED in Phase 4**
   (`567488b`). The two drifted copies lived in the disconnected directories
   removed above, so `sandbox/constants.py` and the frontend's `ADRIYALA` are
   now the only two, and the frontend mirrors the backend.
8. ~~**Nodes ignored their own telemetry.**~~ **FIXED in Phase 4** (`5e0bc59`).
   `NodeMarkers` destructured the prop as `_nodeTelemetry` and discarded it,
   rendering all 33 monuments from the browser engine while the authoritative
   per-node reading sat unused in the same render — a node could show STABLE
   with the server holding a DGMS breach for that sensor. Verified: 9 nodes
   (13-21) reach a real breach at -32.77/+22.65 mm/m.
9. ~~**Three of seven intervention buttons never reached the server.**~~
   **FIXED in Phase 4** (`8a07c56`). STRAIN and TILT fired browser-only
   collapses (STRAIN's toast asserted a "> 5.3 mm/m" breach it never
   computed); CRACK did nothing but show a toast claiming a latch that never
   happened. STRAIN now solves the collapse geometry that lands a real DGMS
   breach on the selected ring (verified: 120 m breaches nodes 15/19, 180 m
   breaches 14/20); TILT offsets by the bowl radius instead of a fixed 30 m
   and reaches the server; CRACK is deleted, because the bit is latched by
   the server when strain passes 4000/5300 ue and is not an operator action.
   Six interventions remain, all of which reach the backend.
10. ~~**Client and server disagreed about terrain colour.**~~ **FIXED in
   Phase 4** (`33c44b9`). `equalAreaT` ignored both the 0.7 linear blend and
   RAMP_FLOOR, diverging up to 0.176 in ramp position and dropping 10% of the
   panel onto the ramp's black end. Now exactly 0.0 across all 58,081 cells.
   The subsidence colour mode also normalised over 20 m (retired-engine
   leftover) against a real 2.25 m ceiling, so it used only 11% of its ramp.

## 6. Why the green test suite did not catch this

Gates T52/T53/T54 call `session.apply_collapse()` directly in Python
(`tests/test_session_d_e.py`), bypassing the WebSocket dispatcher. No test did a
WS round-trip, and no test asserts the frontend consumes `z0_mesh`. 35/35 passing
was true and said nothing about the integration layer.

Phase 1 added gate T55: four tests that drive the real WebSocket dispatcher,
including one that sends the exact payload `App.tsx` emits. Suite is now 39
passing. The `z0_mesh` gap (item 2 above) is still invisible to pytest by
construction — it needs a browser-level check, which Phase 2 addresses.

## 7. How to run

```
uv sync
.venv/bin/python -m pytest -q
.venv/bin/uvicorn sandbox.server:app --reload    # terminal 1, port 8000
cd frontend && npm install && npm run dev        # terminal 2, port 5173
```

## 8. Repair phases

Reference `.claude/plans/so-the-first-ting-generic-widget.md`.

- Phase 0 — project + git logs — DONE (`d90b53d`)
- Phase 1 — reconnect backend (fix action names, add else-error, session.reset(), WS round-trip test) — DONE (`2c3ef18`)
- Phase 2 — real terrain (real DEM, hypsometric colouring, contours, hillshade, bounding sphere) — DONE (`364dc23`, `f4ab509`)
- Phase 3 — surface placement, soil body, zoom, browser physics, legend —
  DONE (`c1652b1`, `94b6db9`, `25303df`)
- Phase 4 — declutter + palette + real interventions — DONE
  (`567488b` dead code, `33c44b9` palette and colour-scale bugs,
   `5e0bc59` node telemetry, `8a07c56` STRAIN/TILT solver, CRACK removed)
- Phase 5 — honest docs (README, architecture diagram, stress-report label, gate T49 regex) — NOT STARTED

### Phase 4 notes — the terrain palette

The ramp was a direct sampling of matplotlib's `gist_earth`, which reserves
its bottom third for deep ocean. This panel is dry land at 196-370 m AMSL, so
a third of the ramp encoded an impossible condition while real relief was
compressed into what was left, and its saturated blue-green-white sweep read
as a false biome gradient over uniform Gondwana scrub. `TERRAIN_STOPS`
replaces it: monotonic in luminance (relief reads in greyscale and for
colour-blind viewers), peak saturation 0.28 so saturated red/amber is free to
mean hazard, and it never reaches black. `RAMP_FLOOR` drops 0.1 → 0.0 because
it existed only to dodge the black bottom. 500 UI colour literals moved off
neon cyan onto neutral greys; every role holds WCAG AA-large or better, body
text at 13.25:1.

### Phase 4 notes — why STRAIN needed a solver

Strain is not a force an operator can apply; it is what the bowl's curvature
does to the ground. Two relations, measured by sweeping the real solver:

- peak tensile strain lands at **sqrt(3) x collapse radius** (1.7319 ± 0.0004)
- **eps_peak = magnitude x 86315.9 / R²**, linear in magnitude, 0.00% error

Inverting them turns "breach the limit at this ring" into a real collapse.
Sensors sit on discrete rings (60/120/180/240 m), so the aimed ring should be
matched to one for the breach to land on named monuments.

## 9. Scale note — why the collapse looks shallow

Real subsidence maxes at `S_max = a·m = 2.25 m` against this panel's **174 m
of relief**: **1.3%**. It is nearly invisible at true scale, which is what the
old engine's invented 22 m drops were papering over. Visible depression comes
from the **exaggeration slider** (15× → 33.8 m, ~19% of relief), which is a
labelled rendering control and never touches a reported number. The result is
a subsidence *bowl*, not an open pit — that is what the physics gives.

Measured ranges (settled field, `surface.channels`):
- `S` 0.03 – 1.997 m
- `strain_x` −9.01 – +6.06 mm/m (breaches both DGMS limits — CRITICAL/FAILED
  are reachable from the server's regional field)
- `tilt_x` ±11.33 mm/m (**0.28° peak** — this is why the old degree-based
  thresholds of 8°/18°/22°/35° could never fire)

Last updated: 2026-09-04
