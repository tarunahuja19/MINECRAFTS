# Step F5 — Simulation clock and speed control

| Field | Details |
|---|---|
| **Built by** | Claude Code (16 Sep) |
| **Branch** | `fix/f5-playback` → merged into `fix-the-system` |
| **Files** | `renderer/js/app.js`, `renderer/index.html`, `renderer/config.yaml`, `renderer/export_scene.py` (passes `playback`), `renderer/tests/test_export_scene.py` |
| **Tests** | renderer **19 passed** (15 + 4 new) · mine-sim unchanged since F4 |

## What it does

- `config.yaml playback`: `sim_seconds_per_real_second_at_1x: 360` (DF1), `speeds: [1, 10, 20, 40, 100, 250, 500, 1000, 5000, 10000]`, `default_speed: 1000`, `start_date: "2026-01-01"` (label only). Also `initial_day: 345` (was a literal in app.js), `ui_update_hz: 30`, `prefetch_days: 5`, `prefetch_real_s: 2`, `max_frame_dt_s: 1`, each with a `# source:`.
- **Clock** = simulated seconds. Each animation frame: `tSim += dt_real × 360 × speed`, clamped to `run.days × 86400`; with Loop on, it wraps to 0. Terrain and nodes use `tSim / 86400` as a fractional day (F4 interpolation). Redraw capped at 30 Hz.
- **Control bar:** Play/Pause (Space); speed segmented control with the active button highlighted (`[` slower, `]` faster); −1 d, −1 h, +1 h, +1 d; ⟲ Loop; day slider in fractional days (hour steps) that sets `tSim`.
- **Readout:** "Day 200 · 00:00" with "20 Jul 2026 (sim) · SIMULATED" and "at 1,000×: 1 real second = 4 d 4 h sim · to end: 1 min 58 s real".
- **Loading:** the next chunk is fetched once play is within max(5 days, 2 real seconds at the current speed) of its start. If a needed chunk is still missing, the clock and the drawn frame both hold and "loading…" shows. A wrong day is never drawn, and the hold time is counted.
- URL: `?day=`, `?speed=` (snaps to the nearest configured speed), `?play=1`. `window.__mine.clock` exposes `tSim, day, speed, playing, loop, loadingEvents, loadingMs, maxLoadingMs, chunkLoads`.
- Read-only: no control changes terrain truth (test `test_controls_never_write_terrain`: no POST / XHR in renderer JS).

## Measurements (headless Chrome, Apple M4, 690-day scene served from localhost)

| Check | Result |
|---|---|
| 40× for 10 real seconds | **10.002 s real → 40.00 sim hours** (expected ≈ 40 h) |
| 10,000× from day 0 to the end | **16.6 s real** (690 d × 86400 / 3.6 M = 16.56 s), ended on day 690 |
| "loading…" at 10,000× | **0 holds, 0 ms**; 23 chunk loads, 3 chunks in memory at the end; 0 backwards steps in 322 samples; 60 fps |
| Steps | +1 h = +3,600 s, +1 d = +86,400 s, −1 h −1 d back to the start: exact |
| Keys | `]` 40→100, `[` `[` 100→20 |
| Arithmetic | 1×: 365 d take 24.3 real hours |

Prefetch bug found and fixed before measuring: the first version requested the chunk 83 days ahead at 10,000× and skipped the chunks in between. It now requests the next chunk.

## Tests added

`test_playback_keys_present_and_passed_into_scene`, `test_speeds_strictly_increasing_and_contain_required` (1, 10, 20, 40 present), `test_one_x_plays_a_year_in_about_a_day` (23–25 h), `test_controls_never_write_terrain`.

## Screenshots

`control_bar_1x.png`, `control_bar_1000x.png`.
