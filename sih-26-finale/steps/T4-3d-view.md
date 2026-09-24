# T4 — Window 1 renderer (WP8 steps 1–3)

**In plain words:** The 3D picture of the ground sinking (Window 1). The first thing people will look at.

**Antigravity files owner:** AG-4 (one Antigravity chat for everything is fine; this only says whose files these are).

## 1 · Paste into Antigravity

✅ **Done 15 Sep** (AG-4 wrote it). Kept for the record; don't paste again.

New chat? Paste `steps/00-connect-antigravity.md` first and wait for `CONNECTED`.

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md (authoritative inside mine-sim/), sih-26-finale-brain/RULES.md, your WP file, and the step below. For anything in scenario-lab/ or renderer/, sih-26-finale-brain/work-packages/WP9-scenario-lab.md is authoritative. Only edit the files your step lists. If the spec can't be implemented as written, STOP and tell me why; don't work around it. No magic numbers: physical and assumption values come from config with a source comment (unit conversions like 1000 and 86400 are fine; in scenario-lab/ gate L4 lists the exact allowed literals). Sign at every file/JSON boundary: negative = ground went down. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Run tests from inside mine-sim/ (or scenario-lab/). Report the exact pytest count; never say "tests pass" without it.

STEP T4 · Window 1 renderer (WP8 steps 1–3)

Read sih-26-finale-brain/work-packages/WP8-consequence-renderer.md (§3 safety rules) and WP9-scenario-lab.md §9 (Window 1 row, Three.js URLs). Nothing to install.

Files you may create (nothing else): renderer/config.yaml, renderer/export_scene.py, renderer/index.html, renderer/js/terrain.js, renderer/tests/test_export_scene.py, renderer/.gitignore (ignore scene/), walkthroughs/step-09-wp8-renderer/WALKTHROUGH.md, test_results.txt, 3 screenshots. Do not edit anything in mine-sim/ or the vault.

Input = a finished run folder, default mine-sim/out/v2-690d (made by ./run-simulation.sh; do not rerun it). terrain_state.npz: z0_mm int32 (617, 167), origin_x_m, origin_y_m, cell_m. terrain_changes.jsonl (243 MB): one line per hour {"epoch", "t_s", "cells": [[i, j, delta_mm], …]}. nodes.csv: columns in files/11-interface-contracts-v1.md §7.1 (use node_id, epoch, tier, x_m, y_m, z0_mm, subsidence_mm, subsidence_prov, delivered; a column is blank when that node's tier doesn't measure it). run_summary.json: timestep_s, days. Reference replay: minesim.stream.replay_terrain(run_dir, to_epoch).

config.yaml (every key with a # source: comment): run_dir, day_step_days (10), downsample_cells (2), vertical_exaggeration (display choice).

export_scene.py --run DIR → renderer/scene/scene.json. Read the jsonl once (no replay per day), take a grid snapshot at day 0, every day_step_days, and the last day (epoch = day·86400/timestep_s). Grid = z[::k, ::k] int mm, negative = down, plus origin and cell size. Face x per day = min(cfg.knothe.advance_m_per_day · day, cfg.panel.length_m) with cfg = minesim.config.load_config("mine-sim/config/assumptions.yaml"): never import minesim.physics. Nodes per exported day: node_id, tier, x, y, live z = z0_mm + subsidence_mm, subsidence_prov, delivered. Print the file size (target < 30 MB).

Page (index.html + js/terrain.js; Three.js r128 + OrbitControls from the WP9 §9 URLs; all paths relative): SIMULATED banner always visible; "vertical ×N" label; day slider over exported days; face marker; nodes coloured by provenance with a legend; undelivered nodes visibly different (hollow/grey); "Freeze + create subsidence" button → scenario.html?day=<day> if a fetch('scenario.html', {method: 'HEAD'}) succeeds, otherwise the message "available in v2 (Wednesday)". No control changes terrain. terrain.js holds reusable surface drawing (Wednesday reuses it). Opened with cd renderer && python3 -m http.server 8000.

Tests (renderer/tests/, run from repo root with the pinn-sandbox python): make an 80-day run once per test session (minesim.run.run_sim into tmp, ~6 s; a 2-day run has no subsidence and proves nothing) → assert the grid actually changed, then the single-pass snapshots at days 40, 70, 80 array_equal replay_terrain at those epochs; exported grid equals replay[::k, ::k]; face x never above panel length; grep proves no minesim.physics in renderer/; index.html contains SIMULATED. Also export mine-sim/out/v2-690d for real and report size + time.

Report: pytest count for renderer/tests and for mine-sim (must still be 129), scene.json size, export time, screenshots at day 0 / ~345 / 690, the open command. Then STOP and wait for review.

When done: write walkthroughs/step-t4-3d-view/WALKTHROUGH.md and test_results.txt (skip if the step names its own walkthrough folder), report the exact pytest counts, then STOP and wait for review.
```

## 2 · Paste into Claude (check)

```text
Check step T4
```

Claude answers **PASS** or writes a **fix prompt** into section 4 of this file. On PASS say `commit T4`.

## 3 · You check by hand

Needs the fixes below done first.

```bash
./run-simulation.sh view
```
Open http://localhost:8000 in Chrome.

| # | Do | You should see |
|---|---|---|
| 1 | Page loads | **SIMULATED** banner on top and a "vertical ×N" label |
| 2 | Left-drag, then scroll | The ground rotates, then zooms |
| 3 | Drag the day slider 0 → end | A trough grows along the panel; the red face marker moves |
| 4 | Look at the nodes | Colours match the legend; day 0 shows "no reading yet" |
| 5 | Stop at the last day | Face marker stops at 2500 m |
| 6 | Click **Freeze + create subsidence** | Message "available in v2 (Wednesday)", not an error |
| 7 | Turn Wi-Fi off, reload, Wi-Fi on | Still draws → fine. Blank → tell Claude `renderer must work offline` |

## 4 · Fix prompt (only if Claude's check found problems)

**Claude's check, 15 Sep — 5 fixes (small).** What passed: files stay inside `renderer/` + walkthrough; no `mine-sim/` or vault edits; renderer tests **6 passed** when rerun by Claude; mine-sim **129 passed**; jsonl read once; exported grids equal the replay; face stops at 2500 m; no physics import; `scene.json` 4.99 MB, 70 days; screenshots show the SIMULATED banner and a trough behind the face.

Paste into the same Antigravity chat:

```text
T4 FIX LIST (from Claude's check). Only touch renderer/ files and walkthroughs/step-09-wp8-renderer/.

1. renderer/tests/test_export_scene.py::test_export_v2_690d_real: call pytest.skip(...) when mine-sim/out/v2-690d is missing, and export into tmp_path, not renderer/scene/scene.json. Tests must never overwrite the real scene file, and must not fail on a fresh clone.
2. renderer/export_scene.py: if renderer/config.yaml is missing, raise FileNotFoundError. Delete the hard-coded fallback dict in load_renderer_config and every .get(key, default) fallback for config keys (use cfg["key"]); in main() too. Values live only in config.yaml.
3. Day 0 has no sensor reading (nodes.csv starts at epoch 1). Don't invent one: for the day-0 frame set "delivered": null, "subsidence_prov": null, "subsidence_mm": null. In index.html/terrain.js draw these as plain white markers and add a legend row "No reading yet (day 0)". Legend counts must not count them as delivered.
4. Legend wording in index.html: "Real (Monument)" -> "Real (measured survey value)", "Pinned (Knothe)" -> "Pinned (fit to real survey)", "Synthetic (Noise)" -> "Synthetic (simulated)". The colour-bar labels must show the actual breakpoints in getSubsidenceColor (0 / -150 / -400 / -800 / -1200 mm). Fix the colour list in the walkthrough to match.
5. renderer/config.yaml: vertical_exaggeration 10 -> 50 (at x10 a 1.2 m trough is 12 m of relief on a 2.5 km panel and looks flat). Keep the source comment. Re-export and re-take the 3 screenshots (day 0 / ~345 / 690).

Report: renderer pytest count, mine-sim pytest count (must be 129), scene.json size, the 3 new screenshot paths. Add a "Fixes 15 Sep" section to the walkthrough. Then STOP.
```

After Antigravity reports, paste `Check step T4` into Claude again.
