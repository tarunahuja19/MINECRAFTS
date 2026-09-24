---
title: "Gate G00 — Real Data Pinning & Residual Verification"
slug: G00-data-pinning
type: gate
module: physics
status: draft
tags: [gate, g00, data-pinning, knothe, empirical, residuals]
created: 2026-09-13
updated: 2026-09-14
author: adarsh
last_agent_edit: claude-code
source_file: files/WP0-data-pinning.md
---

# Gate G00 — Real Data Pinning & Residual Verification

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP0-data-pinning\|WP0]] |
| **Owner** | [[people/adarsh-agarwala\|Adarsh]] |
| **Verification Target** | Pre-mining parameter grounding & residual validation |
| **Test Script** | `scripts/verify_pinning.py` |

---

## 1. Assertion

Every assumption tag marked `BROKEN` in `config/mines/adriyala_lw1.yaml` (specifically seam thickness $m$ and subsidence factor $a$) must be repinned from real measured field survey data from Ramalingeswarudu et al. (2022). Furthermore, the fitting residual report must exist at `data/fitted/adriyala_lw1_params.json` demonstrating $R^2 \ge 0.90$.

---

## 2. Test Implementation

```python
def test_g00_data_pinning():
    with open("config/mines/adriyala_lw1.yaml") as f:
        mine_cfg = yaml.safe_load(f)
    assert mine_cfg["geometry"]["A3_seam_thickness_m"] is not None
    assert mine_cfg["knothe"]["A4_subsidence_factor"] is not None

    with open("data/fitted/adriyala_lw1_params.json") as f:
        fit = json.load(f)
    assert fit["fit"]["r_squared"] >= 0.90
    assert fit["fit"]["n_points"] >= 200
```

---

## 3. Negative Case

Attempting to run `load_config()` while `A3_seam_thickness_m` or `A4_subsidence_factor` is `null` must raise `UnpinnedParameterError`.

---

## Conflicting finding (claude-code, 2026-09-14)

Status set to `draft` pending review per [[RULES]] §6. Full review: `walkthroughs/step-00-wp0-wpc-data-pinning/CLAUDE-REVIEW.md`.

1. **The R² this gate asserts belongs to a different model.** `fit.r_squared = 0.9859` is the JMMF Table 3 profile function. The parameters actually pinned into config are Knothe, with `knothe_r_squared = 0.8201`. The `≥ 0.90` assertion passes only because of that substitution. Fix: `r_squared` reports the pinned model's own fit, and the threshold follows DEC-1 in [[projects/subsidence-simulator/decisions]].
2. **Peak under-prediction** *(resolved 2026-09-14 session 08 — see below)*. Pinned Knothe reaches ~930 mm against a measured 1267 mm (−27%) at all six epochs. RMS 177.5 mm understates how large the miss is at the trough centre.
3. **Second-mine data unverified.** `data/real/illinois_panel_profiles.csv` reproduces the config's round-number Knothe parameters at RMS 4.7 mm, and its flank RMS values are copies of the total. Until traced to source (DEC-6), it cannot count toward "real data" claims.
4. **Test script path.** The implementation lives in `mine-sim/tests/gates/test_g00.py`, not `scripts/verify_pinning.py` as listed above.

## Refit with inflection offset (claude-code, 2026-09-14, session 08)

Adarsh asked to fix the −27% peak (W4). Cause: the measured trough is narrow and deep (half-depth width ~160 m, peak 1,267 mm); classical Knothe on the full 250 m width makes a wide, flat-bottomed trough holding the same volume (232,620 vs 234,750 mm·m), so its peak was shallower.

- `physics.subsidence` now carries the standard **inflection-point offset** d: the trough edge sits d inside every panel edge (effective panel W − 2d × L − 2d). d = 0 is classical Knothe; one implementation still ([[docs/agents-invariants]] invariant 4).
- `fitting.fit_adriyala` now fits with `physics.subsidence` itself (closes R0-4): free `tan β`, `c`, `d`, survey-origin offset y0 (R0-7), survey-line x.
- **Result:** RMS **52.1 mm** (was 177.5), R² **0.9845** (was 0.8201), peak **1,202 mm vs 1,267** (−5%, was −27%). Table 3 profile function for comparison: 49.7 mm.
- Pinned: a 0.45, tan β 2.5676, c 0.02358/day, d 58.96 m, y0 13.47 m, survey line x 258 m.
- **Identifiability (stated, not hidden):** a is flat from 0.45 to 0.9 (RMS 52→50 mm) → the smallest a within 5% of the best is taken. Survey-line x trades off against c (200–650 m all RMS ≈ 52 mm) → OPEN until the JMMF layout figure is read.
- Gate test adds `test_g00_mine_yaml_matches_fit_record`. Verdict band: "usable (50–150 mm)". Decision record: [[projects/subsidence-simulator/decisions]] §10.
