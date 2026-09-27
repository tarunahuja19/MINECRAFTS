# Cleanup — remove dead scaffolding and a switched-off dead UI overlay

Not a DATA-365 doc segment; part of the separate "make sim/forge data patterned"
request (2026-09-27), item 5 (remove dead files/UI). Independent of the M/D
steps, safe to land first.

## What changed
- Deleted `simulation/ogs_pyvista_mine/` and `simulation/opensees_sim/` —
  confirmed empty (`find <dir> -type f` returned nothing for either) before
  deleting.
- Deleted `dashboard_electron/renderer/js/map/trough-overlay.js`. It hardcoded
  `ENABLE_SUBSIDENCE_BOWL = false` and exposed a `setFeatureEnabled()` toggle
  that nothing ever called — no UI control existed to turn it on. Its function
  is superseded by the G2 work: the district ground's Knothe bowl is now
  rendered live via `bowl_terms_px`/`bowl_terms_py` through `MineViewport.tsx`
  / `geomechanicsEngine.ts`.
- Removed its `<script src="js/map/trough-overlay.js">` tag,
  `dashboard_electron/renderer/index.html:1837` (confirmed by
  `grep -rn "trough-overlay" dashboard_electron/` to be its only reference —
  no other JS file called into it).
- Left `sih-26-finale/` untouched — it has real content (`renderer/`,
  `scenario-lab/`, `mine-sim/`) and is run via `run-simulation.sh` /
  `scripts/start_all.js`'s Scenario Lab (:8010); it is a lightly-touched side
  track, not dead code.

## Files
- `simulation/ogs_pyvista_mine/` (deleted)
- `simulation/opensees_sim/` (deleted)
- `dashboard_electron/renderer/js/map/trough-overlay.js` (deleted)
- `dashboard_electron/renderer/index.html`
- `walkthroughs/data-365/CLEANUP-dead-files.md` (this file)

## Verify
No `verify_map_*.js` script exists in `dashboard_electron/test/` to run against
the map layer specifically, and confirming "no missing-script console error"
properly needs the full Electron app running, which this trivial deletion
doesn't warrant on its own. Verified statically instead:
- The deleted script's only reference (the `<script>` tag) was removed in the
  same change, so the browser will not attempt to load a missing file.
- `grep -rn "ENABLE_SUBSIDENCE_BOWL\|setFeatureEnabled\|trough-overlay" dashboard_electron/renderer/`
  returns one hit: `panel-grid.js:536`, a same-named `setFeatureEnabled` on an
  unrelated module (`ENABLE_GRID_FEATURE`, the sector grid overlay, not the
  subsidence bowl) — confirmed by reading it, not a cross-reference to the
  deleted file. No other file referenced any export of the deleted module.

Commit: not committed — left for the reviewer.
