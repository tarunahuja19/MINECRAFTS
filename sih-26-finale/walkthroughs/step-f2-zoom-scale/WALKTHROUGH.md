# Step F2 — True scale, fixed zoom levels, level of detail, bigger terrain

| Field | Details |
|---|---|
| **Built by** | Claude Code (Adarsh asked Claude to build F1–F5 directly, 16 Sep) |
| **Branch** | `fix/f2-zoom-scale` → merged into `fix-the-system` |
| **Files** | `mine-sim/config/assumptions.yaml` (`placement.dem_margin_m` only), `mine-sim/data/real/adriyala_lw1_dem.npz` (regenerated), `renderer/config.yaml`, `renderer/export_scene.py`, `renderer/index.html`, `renderer/js/app.js`, `renderer/js/network.js`, `renderer/js/terrain.js`, `renderer/tests/test_export_scene.py` |
| **Tests** | renderer **13 passed** (10 + 3 new) · mine-sim **137 passed, 1 failed** after the DEM refetch (see §4; fixed in F3) |
| **scene.json** | 8.14 MB (was 5.72 MB) |

## 1. Bigger terrain

`placement.dem_margin_m` 1300 → **3000** and `scripts/fetch_dem.py` rerun unchanged.

| | Before | After |
|---|---|---|
| DEM shape (cells) | 380 × 230 | **607 × 457** @ 15 m |
| x extent (panel frame) | −1,592 … 4,108 m | **−3,292 … 5,798 m** (9.09 km) |
| y extent | −1,717 … 1,733 m | **−3,417 … 3,423 m** (6.84 km) |
| Elevation | 71–212 m AMSL | **71–239 m AMSL** |
| Tiles | — | z13 x 5905–5907, y 3664 |
| fetched_utc | — | 2026-09-15T18:46:59Z (laptop clock) |

Renderer: new key `terrain_extent: full | margin` (default `full`), `context_margin_m` used only for `margin`. The render grid stays cell-aligned with the downsampled world grid (10 m), so `full` draws **909 × 684 = 621,756 vertices** in one draw call. That is below `terrain_max_vertices: 1,500,000`, so **no downsampling was needed**. The exporter raises an error instead of drawing a larger mesh. Padding can now differ per side (`sim_offset` = low-side pad).

Performance on the bigger mesh: a day change redraws only the world-grid region plus a one-cell rim. Normals come straight from the height grid (central differences), and `computeVertexNormals` is no longer called per frame. The whole mesh is redrawn only on the first draw and when the relief changes.

Horizontal scale is still 1 scene unit = 1 m on x and y. Only vertical uses exaggeration (sag slider, relief select).

## 2. Zoom

- `zoom.levels_view_width_m: [8000, 4000, 2000, 1000, 500, 250, 120, 60]`, `default_level: 2`.
- Camera distance for level width *w*: *d* = (*w*/2) / tan(horizontal FOV / 2). The chip shows "view ≈ N m wide · zoom L/8", with **L = level index + 1** (level 0 → 1/8, level 7 → 8/8).
- `+` / `−` buttons (top right, left of the inspector). Keys `+` `=` zoom in, `−` `_` zoom out. Wheel: one level per notch; events closer than `wheel_step_ms` (220 ms) count as one notch. OrbitControls zoom is off; `minDistance` / `maxDistance` = the 60 m and 8,000 m levels.
- Zoom centre: the selected node, else the ground under the screen centre (raycast), else the orbit target. The target is clamped inside the terrain extent.
- Scale bar (bottom left): the longest of `scale_bar_lengths_m` that fits in `scale_bar_max_px`. Compass: red N from `geometry.advance_direction_deg` (site bearing is still **OPEN — VERIFY**), orange arrow = face advance (+x).
- Presets snap to the nearest level. Measured: Overview 4,000 m, Face 1,000, Section 2,000, Network 1,000, Underground 4,000, Top 8,000.
- Fog and near plane scale with camera distance (`fog_near_factor`, `fog_far_factor`, `near_clip_factor`), so the 8 km view is not fogged out and the 60 m view does not clip.

Measured in headless Chrome: key `+` 0→1 (4,000 m), `=` 1→2, `_` 2→1, two wheel events in one notch 1→2, four `−` presses stop at 0 (8,000 m), badge click 0→1 centred on the cluster, click 3 px from an icon selects that node.

## 3. Level of detail

| View width | Drawn |
|---|---|
| > 1,000 m (`icon_above_view_m`) | Icons only (3D models hidden) |
| 250 … 1,000 m | Icons fading out + true-size models |
| ≤ 250 m (`models_below_view_m`) | Models only |

- Icons: one `THREE.Points` per tier with a canvas-drawn sprite (no image files). The red channel is the fill mask (tier colour), the green channel the outline mask (tinted with the live sink colour, the same colour as the beacon). Triangle 1A, square 1B, diamond 1C, hexagon anchor, star gateway. Size `icon_px` = 10 px; the selected node is drawn 1.6× larger.
- Clusters: greedy on a screen-space hash. A seed takes every free icon within `cluster_px` (22 px, the badge diameter, ≥ `icon_px`), so overlapping icons always merge and badges don't overlap each other. The badge shows the count and a click zooms one level in on the cluster centre. **Deviation from the prompt:** it says "within icon_px"; with 20 px badges that radius let badges pile on top of each other (first screenshot attempt), so the merge radius is the badge size.
- Picking: icons use a `pick_px` (9 px) radius test on screen; 3D models use the ray. The 1C wire additionally needs the models visible.
- FPS at level 0: **60** (vsync cap), headless Chrome 1280 × 800, ANGLE Metal on Apple M4 (`window.__mine.fps`).

## 4. mine-sim test after the DEM refetch

`tests/unit/test_placement.py::test_nodes_avoid_steep_terrain_and_sit_on_moving_ground` **fails**: scout #110 (1A, x 11 m, y 183 m) has peak subsidence 7.6 mm < 10 mm.
Cause: `plan_network` jitters each dart up to half a planning cell away from a moving cell's centre and never rechecks the jittered point against the threshold. The new DEM origin changes slope samples and therefore which darts get accepted, and that exposed the edge case. S(x,y,t) is unchanged (the DEM never feeds it). The test was **not** edited. The fix belongs in `placement.py` and is done in F3.

## 5. Screenshots (day 345, 1280 × 800)

1. `01_zoom0_whole_terrain.png`: level 0, whole 9 km terrain, cluster badges on the panel.
2. `02_zoom3_1c_node.png`: level 3 (1,000 m) on 1C #135: icons + badges + models.
3. `03_zoom5_1c_node.png`: level 5 (250 m): models only, selection links.
4. `04_zoom7_1c_true_size.png`: level 7 (60 m): true-size 1C model with its 30 m wire.
5. `05_preset_top.png`: Top preset snapped to 8,000 m.

## 6. Tests added

- `test_terrain_extent_full_covers_the_dem`: every render-grid edge is within one render cell of the DEM edge; ≤ 1.5 M vertices.
- `test_world_grid_area_unchanged_by_terrain_extent`: `margin` vs `full` exports on the 80-day run give identical grid metadata, day grids (`array_equal`), node dZ, and elevation under the world grid.
- `test_config_has_zoom_keys_and_scene_carries_them`: exact levels, default 2, thresholds ordered, `scene.zoom` equals config, `advance_direction_deg` exported.
- Still passing: `test_no_physics_import_in_renderer`.
