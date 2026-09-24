# Step 02 — WP2 sizing, v1 cut (BUILD-PLAN M1 Part A + Part B)

| | |
|---|---|
| **Built by** | Claude Code (at Adarsh's request, 14 Sep) |
| **Part A files** | `mine-sim/config/assumptions.yaml`, `mine-sim/src/minesim/config.py`, `mine-sim/tests/unit/test_config.py` |
| **Part B files** | `mine-sim/src/minesim/sizing.py`, `mine-sim/tests/unit/test_sizing.py`, `mine-sim/tests/gates/test_g02.py`, `test_g03.py`, `test_g12.py`, `test_g15.py`, `mine-sim/tests/helpers.py` (shared temp-config loader) |
| **Tests** | Step files: see `test_results.txt`. Whole suite at commit: `63 passed` |

## Part A — config

- New `sensors:` block: `subsidence` (all tiers), `tier_1a.tilt`, `tier_1b.strain`, `tier_1b.displacement`, `tier_1c.strain`, each with `resolution`, `bias`, `temp_drift_per_c`, `noise_sigma`; `battery` (`full_mv`, `empty_mv`, `noise_sigma`); shared `temperature_amplitude_c`, `temperature_period_days`, `monument_position_tolerance_m`.
- New radio keys: `A11_frequency_mhz`, `tx_power_dbm`, `sensitivity_dbm` (per SF 7/8/9), `link_margin_db_min`, `bernoulli_loss_prob`.
- New layout keys (Part B needed them, so tier cut-offs aren't literals): `tier_1c_strain_percentile: 66.7`, `tier_1b_tilt_percentile: 50.0`.
- `Config` gains `sensors` and `profiles_csv` (the resolved real-survey CSV path WP4 uses for provenance).
- **Every value is marked `# OPEN — guess, replace with hardware spec sheet`.** Tilt drift (300 µrad/°C × 10 °C swing) is deliberately larger than most tilt signal (WP4 "drift dominance").
- Any null → `UnpinnedParameterError` (8 parametrised negative cases). Existing fields unchanged.

## Part B — algorithm

1. Cross centred at **x = panel length / 2, y = 0**. The face passes it inside a standard run (day 312 at Adriyala), so its nodes see onset, growth and settling.
2. Transverse line along y and longitudinal line along x, both laid out **symmetrically from the crossing** at `spacing_m`, each spanning at least the extent (`width + 2r`) and window (`r + tail`). The crossing is one shared node.
3. Tier from each position's **peak |horizontal strain| over A8** and **peak |tilt|**, sampled daily over `sim.duration_days`. Peaks are rounded to sensor resolution. Top `tier_1c_strain_percentile` of strain → **1C**; of the rest, tilt at or above `tier_1b_tilt_percentile` → **1B**, else **1A**.
4. Anchors: Scouts are grouped per line in order along the line and split into the fewest chunks with ≤ `max_children_per_anchor` each (at least 2 anchors overall). Anchor sits at its chunk's centroid. `child_index` = position in chunk. `backup_parent_id` = nearest other anchor.
5. Gateway (id 0) at the crossing's x, `extent/2 + spacing` off-axis, outside the sinking zone.
6. Cost per tier from `A21_unit_inr`; reported, never checked.
7. `relaxation_steps = ()`, `# v3: Fresnel relaxation`.

## Results (Adriyala, spacing 50 m, r = 121.33 m, extent 492.7 m, window 1038.1 m)

| | Count |
|---|---|
| Transverse | 11 (incl. crossing) |
| Longitudinal | 23 (incl. crossing) |
| **Scouts** | **33** — 1A: 2 · 1B: 20 · 1C: 11 |
| Anchors | 5 (ids 1–5; children 6, 5, 8, 7, 7) |
| Gateway | 1 |
| **Cost** | **₹99,500** (gateway 15,000 · anchors 17,500 · 1A 2,400 · 1B 36,000 · 1C 28,600) |

The contract's "30 Scouts / 5 Anchors / ₹82,100" was computed with the pre-WP0 `tan β = 2.0` (r = 187.5 m). With the pinned `tan β = 3.0907` the extent shrinks and the window grows, so this output differs. **This is expected: node count is an output.**

Transverse tiers by y: −250 1A · −200…−50 1C · 0 1B · +50…+200 1C · +250 1A. 1C sits in the peak-strain band either side of the ribs, 1A at the far edges. The longitudinal line is 1B except x = 700–800 (1C): every longitudinal node sees nearly the same ground history, so strain decides.

| Spacing | Scouts | Anchors |
|---|---|---|
| 40 m | 41 | 6 |
| **50 m** | **33** | **5** |
| 60 m | 29 | 5 |
| 75 m | 23 | 4 |

Illinois (config swap only, synthetic fixture): 27 Scouts (1A 2 · 1B 2 · 1C 23), 4 anchors, ₹94,800.

## Gates

| Gate | Test | Negative case |
|---|---|---|
| G02 | exactly one parameter, name not `node/count/n_/num` | defaulted `n_nodes`, parameter named `node_count` |
| G03 | non-empty `CostBreakdown` | empty breakdown detected |
| G12 | unit costs × 10⁶ → identical nodes, cost × 10⁶; AST: no `if/while/assert` reads cost/budget/cap/inr | a budget-cap `if` is detected |
| G15 | spacing 75 m changes the count; `mine: illinois_lw` gives a valid, different layout; AST literal scan of `sizing.py` (allowed: 0, 1, 2, 0.5, ID bounds 99/100) | `spacing = 50.0` detected |

## Known limits (honest)

- **Ties go up a tier.** When many positions have the same rounded peak (Illinois longitudinal line), all of them land at or above the percentile cut. Illinois therefore gets 23 × 1C. Valid, but not a balanced split. v3 can rank ties by distance from the rib.
- Anchors sit at chunk centroids, which can be on top of a Scout's position; flat terrain, no link check (v3).
- The layout is fixed for the run (no relocation as the face advances — Open Decision 1, not Part 1's problem).
- Tier sampling is daily; sizing takes < 1 s.
