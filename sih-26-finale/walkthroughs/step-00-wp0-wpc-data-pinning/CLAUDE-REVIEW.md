# Claude Code Review — Step 0 (WP-C + WP0)

| | |
|---|---|
| **Reviewer** | Claude Code (planner/checker) |
| **Date** | 2026-09-14 |
| **Reviewed against** | `files/WP0-data-pinning.md`, `files/WP1-core-physics.md` (G1), `files/11-interface-contracts-v1.md`, `AGENTS.md` |
| **Tests re-run** | `15 passed in 0.49s` (env: `/opt/miniconda3/envs/pinn-sandbox`) |
| **Verdict** | **CONDITIONAL PASS.** The scaffolding and the Adriyala digitisation hold up. G00 passes on a mislabelled field, and the Illinois "real" dataset has not been verified. Fixes R0-1…R0-7 below, then Step 0 is fully closed. |

The walkthrough's claims were checked by running code, not by reading the document.

---

## What holds up

- The skeleton, config loader, frozen dataclasses and stubs match contract §1–§8. `load_config()` raises `UnpinnedParameterError` on a null (negative case works).
- The Adriyala CSV follows the WP0 schema: 283 points, 6 epochs, 47–48 points per epoch, measured minimum −1267 mm at Nov-17.
- The Knothe fit itself reproduces. I recomputed RMS 177.5 mm from the CSV using the pinned params.
- `physics.py` is vectorised, derivatives are numerical, and G01's AST check works for `physics.py`.
- The fit verdict (> 150 mm → escalate) was recorded honestly in the JSON. It is still waiting on a decision (DEC-1).

---

## Findings (most severe first)

### R0-1 — G00 passes on the wrong R² · HIGH
`data/fitted/adriyala_lw1_params.json` → `fit.r_squared = 0.9859`. That number belongs to the **Table 3 asymmetric profile function**, but the parameters written into `config/mines/adriyala_lw1.yaml` are the **Knothe** ones, which score `knothe_r_squared = 0.8201`. `test_g00_fitted_params_json_valid` asserts `r_squared >= 0.90`, so the gate goes green because of the model we are *not* using.
- **Failure scenario:** a judge or Part 2 reads "R² 0.986" and trusts the synthetic terrain. The terrain driver actually explains 82% of the variance.
- **Fix:** `fit.r_squared` = Knothe R² (the params' own fit). Move the Table 3 result into a separate `profile_function` block. Whether G00 keeps a `≥ 0.90` threshold is part of DEC-1 (see R0-3). Either way the gate must not pass because of a different model.

### R0-2 — Illinois "real" data looks generated, not digitised · HIGH
`data/real/illinois_panel_profiles.csv` fits a symmetric Knothe curve at **RMS 4.7 mm, max 13 mm** using the round numbers in `config/mines/illinois_lw.yaml` (`a=0.65, tan β=2.1, c=0.025`). Those are the same values `fitting.py` uses as the optimiser's starting guess. Other signs:
- the distances sit on an exact 15 m grid
- the epochs are 30/60/90/120/180/240
- `dip_side_rms_mm == rise_side_rms_mm == rms_residual_mm` (copied, not computed)
- the fitted values (`tan β 2.0947`, `c 0.02509`) were never written back to the YAML.

Real digitised field profiles don't fit a symmetric model to 5 mm. I also could not match the citation "USBM RI 9194" to the Southern Illinois study WP0 names. The public NIOSH report is *A Ground Control and Subsidence Study of a Longwall Mine in Southern Illinois* (stacks.cdc.gov/view/cdc/227647).
- **Failure scenario:** data in `data/real/` tagged as real is self-generated. That breaks Invariant 7 and C5, and makes the mine-independence proof circular.
- **Fix (Adarsh decides, DEC-6):** check it against the source PDF. If it can't be traced, move it to `data/fixtures/illinois_synthetic_profiles.csv`, set `pinning.source: UNVERIFIED — synthetic fixture` in the YAML, and keep Illinois only as a *config-swap* test for G15 (which never needed real data). Do not present it as a second real dataset.

### R0-3 — The pinned Knothe under-predicts peak subsidence by 27% at every epoch · HIGH (feeds DEC-1)
Peak of the fitted model compared with the measured trough:

| Epoch (day) | Measured min (mm) | Knothe fit min (mm) |
|---|---|---|
| 210 | −1198 | −871 |
| 300 | −1234 | −912 |
| 540–600 | −1232 | −929 |
| 690 | −1267 | −930 |

`physics.subsidence(x=1000, y=0, t=690)` = **927 mm**. The 177.5 mm RMS hides the fact that the largest miss is at the trough centre, where the alarm matters most. The Day 1 hands-on check "peak within ~15% of 1267 mm" **will fail** under DEC-1 option A. This has to be known *before* DEC-1 is made, not found on Day 1 evening.

### R0-4 — `fitting.py` re-implements Knothe and uses a different time model from `physics.py` · MEDIUM
WP0 Step 3 says: *"Least-squares fit of `physics.subsidence`"*. Instead `fitting.py` defines its own erf Knothe twice (`knothe_model` in `fit_adriyala` and `fit_illinois`). `test_g01.py` **explicitly skips `fitting.py`**, so G01 no longer covers the whole of `src/`, which is what WP1 requires.

The time factors also differ:
- **`fitting.py`:** `1 − exp(−c·t_epoch)`, measured from panel start.
- **`physics.py`:** `1 − exp(−c·τ)`, where `τ = (x_face − x)/v` is the time since the face passed that point.

So the pinned `c = 0.01309` means something different inside `physics.py` than the thing that was fitted.
- **Fix:** `fitting.py` calls `physics.subsidence` with a `PanelGeometry` / `KnotheParams` built per trial. The transverse survey line needs an x-position (and a face-pass day) that comes from config, taken from the paper's panel geometry. Remove the `fitting.py` exemption from G01. If the Table 3 function is kept, it lives only in a clearly named fitting-comparison function that G01 whitelists **by name**, not by file.

### R0-5 — Magic numbers in `src/`, and the walkthrough claims the grep was clean · MEDIUM
`grep -rnE '\b(375|250|2500|61\.7|0\.6|187\.5)\b' src/minesim/*.py` finds `fitting.py:47 h_m = 375.0` and `fitting.py:48 w_m = 250.0`. The file also hardcodes `m_mm = 3600.0`, `s_max_empirical = 1267.0`, the Illinois `2150/220/215`, the Table 3 coefficients, and a hardcoded `3.6` written back into the YAML. WALKTHROUGH §7 says "Result: Clean", which is false.
- **Fix:** read geometry from `load_config()`. Table 3 coefficients and the paper's S_max go into `config/mines/adriyala_lw1.yaml` under a `reference:` block, each with a source comment. Correct §7 of the walkthrough.

### R0-6 — Invariant table overclaims · LOW
WALKTHROUGH §2 marks invariants 1, 3, 5, 6, 7 as "Preserved". The modules that would preserve them (`world`, `sensors`, `provenance`, `sizing`, `radio`) are still `NotImplementedError` stubs. The accurate status is **"Not yet testable — stub"**. Only 2, 4 (partly, see R0-4) and 8 (config load only) have evidence behind them.

### R0-7 — Smaller data/record issues · LOW
- WP0 says `distance_m` is **zero at the panel centre**. The CSV puts zero at the **trough minimum**. On a 10° seam the trough shifts toward the dip side, so the dip/rise flank split in `residual_by_flank` is measured from the wrong origin. Record the offset or re-origin.
- The depth decision contradicts itself. WP0 Step 1 says to "take the JMMF paper's figure" (Table 2: 410 m), but config uses 375 m. Because the fit uses `r = h/tan β`, the fitted `tan β` only makes sense paired with 375. Either keep 375 and write down why, or refit at 410. **Do not change depth without refitting.**
- `digitised_by = adarsh`, but §4 says the points came from Antigravity's vector-stream extraction. Record the real method. It is actually stronger evidence than hand-clicking.

---

## Pasteable FIX prompt (for AG-1, after DEC-1 and DEC-6 are decided)

See `files/BUILD-PLAN.md` → M4 Part A (the older `day-1.md` prompt was superseded and removed).

## Step 0 re-acceptance checklist

- [ ] `fit.r_squared` is the Knothe R²; the Table 3 result sits in its own block
- [ ] G00 threshold matches the DEC-1 outcome and is written in `gates/G00-data-pinning` (vault)
- [ ] Illinois data verified against source, or moved to `data/fixtures/` and labelled synthetic
- [ ] `fitting.py` calls `physics.subsidence`; G01 no longer skips `fitting.py`
- [ ] No magic numbers in `src/` (grep output pasted)
- [ ] WALKTHROUGH §2 and §7 corrected; `test_results.txt` re-run
- [ ] Peak-subsidence table (above) in the walkthrough, sim vs measured

---

## Fixes applied — 2026-09-14 evening (BUILD-PLAN M4 Part A, built by Claude Code at Adarsh's request)

| Item | Done |
|---|---|
| R0-1 | `fit.r_squared` = **0.8201** (Knothe, with `r_squared_model`); Table 3 result moved to `profile_function` (0.9859, RMS 49.7 mm). `fitting.py` writes the same labels on a re-run. G00 now checks the label, the verdict and the escalation, with a negative case (comparison R² copied in → fails; RMS > 150 mm without "Escalate" → fails). No `≥ 0.90` threshold (that belongs to DEC-1). |
| R0-2 | `git mv` → `mine-sim/data/fixtures/illinois_synthetic_profiles.csv`; `illinois_lw.yaml` `pinning.source: "UNVERIFIED — synthetic fixture"`. New G00 test asserts both. |
| R0-6 | WALKTHROUGH §2 table corrected ("not yet testable — stub"). |
| R0-5 | §7 grep correction was already present. |
| Pinned values | Unchanged (`a` 0.2609, `tan β` 3.0907, `c` 0.01309, `m` 3.6 m). |
| Still open | R0-3 / DEC-1 (−27% peak), R0-4 (`fitting.py` re-implements Knothe; G01 still skips it), R0-5 magic numbers inside `fitting.py`, R0-7 (origin/depth/method notes). |

Tests: `24 passed` (`test_results.txt` re-run).
