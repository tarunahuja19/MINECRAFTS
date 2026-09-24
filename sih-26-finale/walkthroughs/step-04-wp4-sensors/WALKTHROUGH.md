# Step 04 — WP4 sensors + provenance, v1 cut (BUILD-PLAN M3 Part B)

| | |
|---|---|
| **Built by** | Claude Code (at Adarsh's request, 14 Sep) |
| **Files** | `mine-sim/src/minesim/sensors.py`, `mine-sim/src/minesim/provenance.py`, `mine-sim/tests/unit/test_sensors.py`, `mine-sim/tests/gates/test_g04.py`; also `packet.py` `airtime_ms` (the battery model needs it; tested in step 05), `config.py` (`survey_line_x_m`, CSV path fallback), `config/mines/adriyala_lw1.yaml` (`survey_line_x_m: null`) |
| **Contract** | §5 `Value`, `Reading`, `read_node(node, world, cfg, rng)` unchanged. `Value` now raises `ProvenanceError` on a bad tag |

## Output signs (at the Reading / csv boundary)

| Field | Sign |
|---|---|
| `subsidence` | `world.z_at(x, y) − z0_mm` → **negative = ground down** (before noise; noise can make an early reading a few mm positive) |
| `tilt_x`, `tilt_y` | `−physics.tilt` → **+ = surface rises toward +x / +y** |
| `strain` | fixed `physics.strain` → **+ = tension** |
| `displacement` | `physics.displacement` component along the rod → + = moves toward +axis |

Checked by `test_signs_outside_the_rib` at (900, +150) on day 300: subsidence < 0, strain > 0, tilt_y > 0 (physics tilt_y < 0).

## Sensor pipeline

`ideal → round to resolution → + bias → + temp_drift_per_c · ΔT → + N(0, noise_sigma)`, all from `cfg.sensors`, rng passed in. ΔT = `temperature_amplitude_c · sin(2π t / temperature_period_days)`, the same for every node (common-mode weather).
- 1A: tilt x and y.
- 1B: strain over A8 plus displacement.
- 1C: strain over A9.
- Rods and wires lie along their line: the transverse line and crossing measure y, the longitudinal line measures x.
- Battery: linear state of charge from the average current of one 23 B uplink + one 6 B ACK per 60 s superframe plus sleep current (A18/A19). Sense current has no duration in config, so it is not modelled.
- **Tilt drift is not flattered:** 300 µrad/°C × 10 °C = 3000 µrad, larger than the peak tilt at the far-edge 1A nodes (test).

## Provenance — the honest finding

`real` = digitised measurement at a monument position **and** a monument epoch (value = the measured number). `pinned` = model at a monument position off-epoch. Everything else = `synthetic`. Tilt, strain, displacement and battery are always `synthetic`.

**The Adriyala CSV gives each monument's distance across the panel, not the survey line's position along the panel.** No node can honestly be "at a monument" without that. So:
- `config/mines/adriyala_lw1.yaml` → `pinning.survey_line_x_m: null` (OPEN).
- **30-day run: 100.00% synthetic.**
- With `survey_line_x_m` set (tested at 1250 m, our transverse line): a node at y = −200 on day 210 → `real` (the measured value); one hour later → `pinned`; moved 5 m → `synthetic`. Monuments are about every 10 m, so 10 of 11 transverse nodes would be monument positions.

**Adarsh action:** find where survey line S sits along panel 1 (metres from the starting face) in the JMMF paper's monitoring-layout figure. Put it in `survey_line_x_m`. Note R0-7: the CSV's distance origin is the trough minimum, not the panel centre.

## Runtime

`read_node` ≈ 0.21 ms per call → 33 Scouts × 16,560 steps ≈ **2 min** of sensor time for a 690-day run.

## Tests

Tier fields; anchors rejected; derived fields always synthetic; different rng → different values, same seed → identical; signs outside the rib; 30 m vs 10 m baseline differ by more than noise; tilt drift dominates the low-gradient 1A node; battery drains and stays in range; Adriyala all synthetic while `survey_line_x_m` is null; real/pinned/synthetic rules. **G04:** a 30-day run, every value one of the three tags, derivatives synthetic; negative case with a "measured" tag and a pinned strain → 2 violations. G05 → v3.
