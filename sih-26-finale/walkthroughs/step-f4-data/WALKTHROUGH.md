# Step F4 — Planned network in the sensor run, daily binary frames

| Field | Details |
|---|---|
| **Built by** | Claude Code (16 Sep) |
| **Branch** | `fix/f4-daily-frames` → merged into `fix-the-system` |
| **Tests** | mine-sim **150 passed** (147 + 3 in `test_layout_from_plan.py`) · renderer **15 passed** on this step (19 with F5) · stress test **60 pass / 0 fail** |

## Part A — the sensor run simulates the planned network

- `assumptions.yaml` `layout.source: plan` (# F0 DF3). `size_network(cfg)` keeps **exactly one argument** (G2 passes). With `plan` it builds the same `Layout` dataclass from `placement.plan_network`, imported inside the function: same tiers, IDs, parents, backups, `child_index`, positions (`test_layout_equals_node_plan`). `v1` runs the old code unchanged.
- **Config:** the contract's `Config` field list is unchanged. `LayoutConfig` (fields not listed in the contract; the code already added `tilt_detection_snr` there) gains `source`, `placement` (yaml section) and `site` (DEM path resolved at load time, so configs written to temp dirs still find the DEM). `placement.plan_config_from(dict, site)` is shared by the CLI and `size_network`.
- Plans are cached per config (key = `repr(cfg)` + DEM size/mtime; `plan_network` is deterministic). Without the cache the test suite took 288 s.
- **Planner fix found by the stress test:** `max_children_per_anchor = 1` divided by zero. It now raises `ContractViolation` (needs ≥ 2: one fail-over slot).
- **Tests written for v1 node counts now run with `layout.source: v1`** through a conftest fixture that patches `load_config` (assertions untouched):
  - `tests/unit/test_sizing.py` (whole module: `test_counts_follow_geometry`, `test_spacing_sensitivity`, `test_transverse_covers_extent`, `test_longitudinal_covers_window`, `test_relaxation_steps_empty_in_v1`, `test_identical_longitudinal_positions_share_a_tier` and the rest of the module)
  - `tests/unit/test_sensors.py` (whole module; its module fixtures feed `test_transverse_scouts_stand_on_monuments`)
  - `tests/gates/test_g15.py::test_g15_spacing_change_changes_count`
  - Every other gate (G2, G3, G4, G6, G7, G12, G13, the rest of G15, radio, stream, run) runs on the planned network and passes.
- `scripts/stress_test.py` (outside the listed files; CI runs it): sections 1–5 were written for the travelling cross and now run on `source: v1`. The new section 6 checks the plan: parents/backups/child_index, **last uplink slot ends 9.49 s** (window closes 11.5 s), cap 1 refuses loudly, 1-day run rows = scouts × epochs, same seed gives identical bytes. 60 pass in 44 s.
- `run-simulation.sh`: 8 steps; **plan before simulate**. Verify compares rows with plan scouts × epochs. Handoff gz ≤ 50 MB, else survey-line nodes only (`scripts/handoff_survey_line_gz.py`, new, plus `NODES_GZ_CONTENTS.txt`). The end-of-run 3D step only plans if the plan is missing.

### Full 690-day run (`./run-simulation.sh --no-view`)

| | v2 (14 Sep, 25-node cross) | **F4 (16 Sep, planned network)** |
|---|---|---|
| Scouts / anchors | 25 / 4 | **327 / 47** |
| Rows | 414,000 | **5,415,120** (expected 5,415,120), 0 duplicates |
| Wall time (simulate) | 70 s | **871 s**; whole script 1,096 s (tests 172 s) |
| nodes.csv | 54 MB | **624 MB** (terrain_changes.jsonl 240 MB) |
| Delivery | 0.9996 | **0.999611**, 108,218 via emergency |
| Peak subsidence | 1,204 mm | 1,204 mm |
| Provenance | 9.09 % pinned | real 102 values · pinned 1.51 % · synthetic 98.49 % |
| Handoff gz | full, 54 MB unzipped | **survey-line only**: 17 nodes, 281,520 rows, 5.9 MB |

Anchored dataset (step 6) is byte-identical to the committed one (the script kept the committed files).

## Part B — renderer daily frames

- `config.yaml`: `day_step_days: 1`, `frame_chunk_days: 30`, `frame_max_chunks_in_memory: 3`.
- `export_scene.py` reads `nodes.csv` once (only daily epochs are parsed) and `terrain_changes.jsonl` **once**, streaming. Memory stays at one full grid plus one chunk. It writes:
  - `scene/scene.json`: static only (terrain, geometry, plan, zoom, playback, frame index with `epoch_of_day`, `face_x_m`, chunk list, dtypes, row order). **No per-day grids.**
  - `scene/frames/grid_DDDD.bin`: little-endian **int16** mm, C order `[day, i, j]` of `z[::k, ::k]`. The dtype is chosen from the run's peak (+ z0) and asserted per chunk before the cast; int32 is the fallback, recorded in `frames.grid.dtype`.
  - `nodes_DDDD.bin`: float32 `[day, plan node]` live world-grid dZ (bilinear). `readings_DDDD.bin`: float32 `nodes.csv` `subsidence_mm`. `prov_DDDD.bin`: uint8 code (0 none, 1 real, 2 pinned, 3 synthetic, 4 undelivered).
- **690-day export:** scene.json **3.12 MB** (was 5.72 MB with 70 frames), frames **36.4 MB** in 24 chunk sets (96 files, 691 days), **6.2 s**. Largest one-day change: **16 mm** for any cell, **16.0 mm** for any node.
- `terrain.js` `FrameStore`: fetches a chunk's 4 files lazily, keeps ≤ 3 chunks (least recently used evicted), linear interpolation between floor/ceil day. `setDay` returns false and draws nothing if a chunk is missing; the page shows "loading…" and keeps the last drawn day.
- The v1 "Sensor-run nodes" layer is gone. New toggle **"Colour nodes by reading provenance (nodes.csv)"**: icons and beacons take real / pinned / synthetic / undelivered colours for the current day. The inspector shows "Reading day N (nodes.csv)" next to the world-grid ΔZ.

## Tests

`test_daily_frames_decode_to_replay_slice` (days 0, 1, 40, 79, 80 `array_equal` replay[::k, ::k]; scene.json < 10 MB), `test_node_readings_match_nodes_csv` (5 random node/day pairs: reading and provenance), `test_plan_node_dz_is_read_from_world_grid` (now from `nodes_DDDD.bin`, days 40 and 80, ≤ 0.01 mm), `test_face_x_never_above_panel_length` (frame index), `test_export_v2_690d_real` (690-day export: < 10 MB, 691 days, no `days` key, node count = plan), `test_world_grid_area_unchanged_by_terrain_extent` (compares frame bytes), `test_config_has_frame_keys`. `test_no_physics_import_in_renderer` still passes.

## Screenshots (taken on the F5 build, same frames)

`day_1.png`, `day_200.png`, `day_690.png` (4 km view), `day_200_provenance.png` (500 m view, scout #150: world ΔZ −244 mm, reading −245.2 mm synthetic).
