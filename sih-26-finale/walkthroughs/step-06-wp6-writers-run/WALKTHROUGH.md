# Step 06 — WP6 file writers + run loop (BUILD-PLAN M4 Part B + M2 Part B)

| | |
|---|---|
| **Built by** | Claude Code (at Adarsh's request, 14 Sep) |
| **Files** | `mine-sim/src/minesim/stream.py`, `mine-sim/src/minesim/run.py`, `mine-sim/tests/unit/test_stream.py`, `mine-sim/tests/unit/test_run.py` |
| **Tests** | step files: see `test_results.txt`; whole suite at commit **121 passed** |

## Command

```bash
cd mine-sim
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m minesim.run --days 30 --out out/v1-30d
```
Options: `--config` (default `config/assumptions.yaml`), `--seed` (default `sim.rng_seed`).

Loop per step: `world.step()` → `read_node` for every Scout → `Superframe.run` → write the jsonl line + csv rows, flushed per epoch.

## Artefacts

| File | Format |
|---|---|
| `nodes.csv` | Header **exactly** contract §7.1 (21 columns, test compares the literal string). One row per Scout per epoch, including `delivered=false`. Empty string for fields a tier lacks, and an empty `_prov` next to them. `tilt_prov` covers both tilt columns. Floats rounded to 3 decimals, booleans `true`/`false` |
| `terrain_state.npz` | compressed; keys `origin_x_m`, `origin_y_m`, `cell_m`, `shape`, `z0_mm` (int32, `(nx, ny)`, i ↔ x) |
| `terrain_changes.jsonl` | `{"epoch","t_s","cells":[[i,j,dz],...]}` compact, ints untouched, a line for every step (empty `cells` allowed) |
| `run_summary.json` | sign `"negative_down"`, data label, config hash, seed, fit (DOI, RMS 177.5 mm, Knothe R² 0.8201), epochs, `timestep_s`, nodes per tier, cost, packets, delivered, delivery rate, emergency count, duty cycle per tier, **real/pinned/synthetic counts + %**, peak subsidence, grid, wall time |

`stream.replay_terrain(run_dir, to_epoch=None)` rebuilds the int32 surface from the npz + jsonl (used by the tests; the Scenario Lab and renderer can use it).

## Tests

Header literal; four artefacts; rows = Scouts × epochs with dense epochs; **csv G04** (every populated value column has a tag from the three, empty value → empty tag); tier empty fields; jsonl dense epochs, empty-cell lines, int values; jsonl cells equal a fresh world's deltas **and** replay equals the final grid; npz keys and dtype; summary fields (provenance adds to 100%); 100% loss still writes every row with `delivered=false`; same seed → byte-identical `nodes.csv` and jsonl; CLI 2-day run writes all four files.

## Not built (v1 cut)

WebSocket `/ws/run` → Tuesday T2 (AG-2), which reads these files.

The `battery_mv` and `rssi_dbm` columns have no `_prov` column in the contract header. Battery is always synthetic; RSSI is a radio-model output.
