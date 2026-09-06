# Git Log

Claude drafts the commit message body and records what each phase covered under
a "Work notes" heading. Commits are made per phase, one phase per commit, and
pushed to `origin` on the working branch. `main` is never committed to or pushed
without asking first.

Each entry moves `STATUS: draft — not committed` → `in progress` → `committed`.

## Existing history (already committed, for context)

| Commit | Message |
|---|---|
| `496da82` | baseline: state before repair work |
| `521d83a` | fix: correct triggerCollapse argument order |

Branch: `work/collapse-base`
Remote: `origin` → `https://github.com/agarwaladarshcoding-maker/sih26-mine-subsidence-simulator.git`

## Phase 0 — Project and git logs

STATUS: committed

Files:
- PROJECT_LOG.md (new)
- GIT_LOG.md (new)

Drafted commit message:

    docs: add project and git logs

    Add PROJECT_LOG.md recording the verified state of the simulator:
    the Adriyala parameter set, which physics is real (Knothe/Aviershin,
    verified peak subsidence 1.9970 m) and which is phenomenological,
    plus the known-broken integration layer.

    Add GIT_LOG.md as a running commit ledger.

    Written before any repair work so the audit findings are recorded
    against the current state rather than reconstructed later.

    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

--- your extra lines below this marker ---

### Work notes (what this covered)

- Full read-only audit of the repo before any code change: backend physics,
  frontend rendering, WebSocket contract, tests, and dead code.
- Verified by running, not by reading docs: pytest 35 passed, `tsc -b` exit 0,
  peak subsidence 1.9970 m, strain +6.06/-9.01 mm/m, backend terrain relief
  1.607 m.
- Found two integration-breaking bugs the green test suite cannot see:
  WebSocket action names do not match, and the frontend discards the backend's
  terrain mesh.
- No source file was modified in this phase. Documentation only.

## Phase 1 — Reconnect backend

STATUS: committed

Files:
- sandbox/session.py (added `reset()`)
- sandbox/server.py (action aliases + explicit error branch, both transports)
- tests/test_session_d_e.py (4 new tests appended)

Drafted commit message:

    fix: reconnect frontend interventions to the ground model

    The frontend sends WebSocket actions apply_collapse / apply_vibration /
    reset; the server only handled collapse / vibration / stop. The dispatch
    chain had no else branch, so every mismatched action was discarded in
    silence — the UI animated a local effect while the backend recorded
    nothing and out/events.csv stayed empty.

    Accept both spellings on the WebSocket and REST paths, and read the keys
    the client actually sends (magnitude_m, radius_m, warning_hours,
    duration_s) instead of falling back to defaults. radius_m and
    warning_hours were previously dropped even when the action name matched.

    Add an explicit {"type": "error"} reply for unrecognised actions so this
    class of mismatch can never fail silently again.

    Implement SimulationSession.reset(), which had no implementation at all.

    Add four round-trip tests over the real WebSocket. The existing gates
    called session.apply_collapse() directly in Python and so stayed green
    throughout the bug; these exercise the dispatcher itself.

    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

--- your extra lines below this marker ---

### Work notes (what this covered)

- Verified end-to-end, not just via unit tests: sent the exact payload
  App.tsx emits over a live WebSocket and confirmed it reaches the ground
  model with radius and magnitude intact.
- Confirmed the judge-facing symptom is gone: triggering a collapse now
  writes a real row to out/events.csv.
- Confirmed unknown actions now return an explicit error instead of silence.
- Tests: 35 -> 39 passing.
- No physics, constant, or frontend file was touched.

## Phase 2 — Real terrain (backend)

STATUS: committed

Files:
- data/adriyala_dem_regional.json (new, canonical)
- frontend/public/adriyala_dem_regional.json (new, Vite-served copy)
- sandbox/dem.py (new)
- sandbox/hypsometry.py (new)
- sandbox/server.py (init payload now ships the real DEM + metadata)
- scripts/pyvista_terrain_render.py (new)
- tests/test_dem.py (new, 9 tests)

Drafted commit message:

    feat: render the real Adriyala terrain instead of invented hills

    The 3D view was drawing procedural Gaussian hills (8-65 m) while a real
    DEM of the mine site sat orphaned in gitignored build output. Verified
    it is genuine terrain: lag-1 autocorrelation 0.9896, and its stored
    delta about 208 m AMSL reproduces its own declared 83-529 m range.

    Add sandbox/dem.py to bicubically resample that regional tile (36.2
    m/px, 4.6 km) down to the 600 m panel window. The panel has 174.1 m of
    real relief - more dramatic than the hills that replaced it.

    Add sandbox/hypsometry.py for industry-standard presentation: gist_earth
    hypsometric tint, survey-convention contour intervals from the 1/2/5
    series, Horn (1981) hillshade at the cartographic NW 315/45 standard,
    and engineering slope classes.

    Colour is assigned by equal-area rank, not a linear stretch. The median
    elevation sits at only 9% of the range, so a linear ramp collapses over
    half the panel into one dark mass and discards detail that is present
    in the data.

    Copy the DEM into data/ and frontend/public/ so a frontend rebuild can
    no longer delete it.

    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

--- your extra lines below this marker ---

### Work notes (what this covered)

- Terrain and visuals only. No physics touched: surface.py, collapse.py,
  segments.py, constants.py and terrain.py are all unchanged.
- Measured, not assumed: panel elevation 196.2-370.3 m AMSL, relief 174.1 m,
  slope mean 13.5 deg / max 54.1 deg, zero NaNs.
- Contours resolve to 20 m interval / 100 m index, 9 levels - inside the
  readable 8-15 band.
- PyVista renderer reproduces the reference figure from backend truth, so the
  report figure cannot drift from what the simulator uses.
- Tests 39 -> 48.
- Still outstanding: the React client does not yet consume this DEM. That is
  the next step.

## Phase 2b — Frontend renders the real terrain

STATUS: committed

Files:
- frontend/src/utils/hypsometry.ts (new, mirrors sandbox/hypsometry.py)
- frontend/src/components/TerrainMesh.tsx (the actual bug fix)
- frontend/src/components/MineViewport.tsx (camera/grid/light rescaled)
- frontend/src/App.tsx, frontend/src/types.ts (carry DEM metadata)

Drafted commit message:

    fix: render the server's terrain instead of discarding it

    TerrainMesh declared z0Mesh and baseBowlMesh as props and never
    destructured them, so the real terrain arriving over the WebSocket was
    silently dropped and the viewport drew invented Gaussian hills instead.
    Destructure z0Mesh and drive the mesh from it.

    Port the backend's hypsometric colouring to TypeScript so client and
    server agree on what an elevation looks like: same gist_earth stops,
    same equal-area rank stretch, same Horn (1981) hillshade.

    Render datum-relative. Elevations are 196-370 m AMSL while the scene is
    built around y=0, so the datum is subtracted at vertex-write time and
    the true AMSL value kept for colouring.

    Add the missing computeBoundingSphere() after vertex displacement, which
    was silently breaking frustum culling and raycast picking on deformed
    ground, and reuse the colour buffer instead of reallocating it.

    Rescale the strata box, coal seam, camera presets, reference grid and key
    light, all of which were framed for the old 8-65 m hills and mismatched
    174 m of real relief.

    Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

--- your extra lines below this marker ---

### Work notes (what this covered)

- Verified the full pipeline numerically, not just by eye: server ships
  121x121 at 196.2-370.3 m AMSL, client bilinear-upsamples to 160x160 and
  renders y=0.00 to 174.05, zero NaNs.
- Confirmed terrain no longer intersects the strata box (top now y=-4.5,
  terrain floor y=0), so the old punch-through geometry bug is gone.
- Camera presets retuned: they targeted y=20-60, framed for terrain that no
  longer exists; the ridge now tops out at 174 m.
- Terrain and visuals only. No physics, no buttons, no panels.
- pytest still 48 passed (no Python touched); tsc and vite build both clean.

## Phase 3 — Declutter

STATUS: not started

## Phase 4 — Honest docs

STATUS: not started
