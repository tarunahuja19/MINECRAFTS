# F5 — Playback clock: slow real-time-like play, speed buttons 1× … 10000×

**In plain words:** Press Play and the mine plays slowly. At 1× a whole year takes about one real day. Speed buttons 10×, 20×, 40×, 100×, 250×, 500×, 1000×, 5000× and 10000× make it faster. A clock shows the simulated date and hour.

**Plan:** [F0](F0-fix-the-system-plan.md) decision DF1. Needs F4 (daily frames).

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, WP8-consequence-renderer.md §3, steps/F0-fix-the-system-plan.md and this step. Branch fix-the-system, do not commit. Only edit the files listed. No control may change terrain truth (read-only view). No magic numbers: playback values in renderer/config.yaml with "# source:". Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

STEP F5 · Simulation clock and speed control

Files: renderer/js/app.js, renderer/index.html, renderer/config.yaml, renderer/export_scene.py (pass playback keys into scene.json), renderer/tests/test_export_scene.py, walkthroughs/step-f5-playback/*.

1. config.yaml:
   playback:
     sim_seconds_per_real_second_at_1x: 360    # source: F0 decision DF1 — 1x plays a full year in ~24 h real time
     speeds: [1, 10, 20, 40, 100, 250, 500, 1000, 5000, 10000]
     default_speed: 1000
     start_date: "2026-01-01"                 # source: display choice — label only, not a real mining date
2. Internal clock = simulated seconds (float). Each animation frame: t_sim += dt_real × sim_seconds_per_real_second_at_1x × speed. Clamp to run end (run_summary days × 86400). The terrain and nodes use t_sim / 86400 as a fractional day (F4 interpolation). Cap the UI update at 30 Hz as today.
3. Controls bar (replace the "d/s" select): Play/Pause, speed buttons as a segmented control (active one highlighted, keyboard [ and ] step slower/faster), step buttons −1 day, −1 h, +1 h, +1 day, a loop toggle, and the day slider (now in fractional days, dragging sets t_sim).
4. Clock readout: "Day 123 · 14:00 · 3 May 2026 (sim)" and "at 40×: 1 real second = 4 h sim · to end: 1 h 12 min real". Always also show "SIMULATED".
5. Chunk loading must keep up at 10000× (690 days in ~17 s): prefetch the next chunk when within 5 days of its start at the current speed; if a chunk isn't ready, hold on the last frame and show "loading…" (never show a wrong day).
6. URL params ?day=…&speed=… still work. window.__mine exposes clock state for tests.

Tests: config playback keys are present and pass into scene.json; speeds strictly increasing and contain 1, 10, 20, 40; at 1x, 365 days take between 23 and 25 real hours (pure arithmetic from config).

Manual proof (headless Chrome or the browser): at 40×, measure 10 real seconds → report sim hours advanced (expect ≈ 40 h). At 10000× play to the end, report whether any frame showed "loading…" and for how long. Screenshots of the control bar at 1× and 1000×.

Report: renderer pytest count, mine-sim pytest count (unchanged since F4), the timing measurements, screenshots. Write the walkthrough. STOP.
```

## 2 · Paste into Claude (check)

```text
Check step F5
```

Claude checks: clock arithmetic against config; no wrong-day frames while loading; speeds contain 10×, 20×, 40×; nothing writes terrain.

## 3 · You check by hand

| # | Do | You should see |
|---|---|---|
| 1 | Press Play at 1× | Clock minutes tick; the ground barely moves (1 real second = 6 sim minutes) |
| 2 | Click 40× | 1 real second = 4 sim hours; "to end" time drops |
| 3 | Click 10000× | The whole 690 days play in about 17 s without jumping backwards |
| 4 | Press ] and [ | Speed steps up and down one button |
| 5 | +1 day / −1 h buttons | Clock jumps exactly that much |

## 4 · Fix prompt (only if Claude's check found problems)

_Empty until Claude's check._
