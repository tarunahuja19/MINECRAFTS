---
title: "WP0 — Data Pinning"
slug: WP0-data-pinning
type: work-package
module: physics
status: reviewed
tags: [work-package, wp0, empirical-data, knotthe-fitting, jmmf-paper, adriyala, data-pinning]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP0-data-pinning.md
---

# WP0 — Data Pinning

| Field | Details |
|---|---|
| **Owner** | [[people/adarsh-agarwala\|Adarsh]] + Claude Chat |
| **Agent Role** | Data analyst / WebPlotDigitizer / curve fitting script |
| **Depends on** | [[work-packages/WPC-contracts-and-skeleton\|WP-C]] |
| **Blocks** | Acceptance of [[work-packages/WP1-core-physics\|WP1]]; integrity of all downstream data |
| **Days Scheduled** | D1–D4 |
| **Enforces Gate** | [[gates/G00-data-pinning\|Gate G00]] |

---

## 1. Goal

Extract and digitise published field measurement data from the Adriyala Longwall Project (SCCL), fit empirical Knothe parameters ($a, \tan \beta, c$) via least-squares, and record residual statistics in `data/fitted/adriyala_lw1_params.json` to ground the simulator in real physical reality.

> [!TIP]
> **Explainer Guide:** Read the [[docs/wp0-data-pinning-guide|WP0 Field Data Guide]] for a complete, plain-English breakdown of why WP0 exists, the Adriyala 3x error, digitisation instructions, and the Gate G00 residual thresholds.

---

## 2. Primary Source Literature

**Ramalingeswarudu, Dundra, Sastry & Murty (2022)**, *"Analysis of Surface Subsidence and Relative Movements of Underground Rock Strata over an Inclined Longwall Panel"*, *Journal of Mines, Metals and Fuels* 70(9):484–491. DOI `10.18311/jmmf/2022/32099`. (Open access, CC BY-NC).

### Extracted Ground Truth Details:
- **Panel Location:** Adriyala Project Area, Ramagundam Region, SCCL (Godavari Valley Coalfield).
- **Geometry:** $250\text{ m}$ face length, $2333\text{ m}$ gate roadway.
- **Seam Dip:** Inclined ~10° (1 in 5.5) toward the tailgate.
- **Surface Monitoring:** 80 transverse paths, 13 longitudinal paths, monuments spaced at $30\text{ m}$, sampled at 30-day intervals out to 690 days.
- **Measured Peak Subsidence:** **$1.267\text{ m}$, or $19.5\%$ of seam thickness**.

> [!WARNING]
> **Contradiction Identified:** The baseline assumption pair ($m = 3.0\text{ m}, a = 0.6$) predicts $1.63\text{ m}$ ($54\%$ of seam height). Real field data demonstrates that the old parameter pair is wrong by nearly a factor of three.

---

## 3. Work Breakdown

### Step 1: Document Mining (D1)
Extract actual extraction height $m$ from Table 1 of the JMMF paper. Confirm depth ($375\text{ m}$ vs $410\text{ m}$). Populate `A3_seam_thickness_m` in `config/mines/adriyala_lw1.yaml`.

### Step 2: Digitisation (D2)
Digitise Fig. 6 (stage profiles) and Fig. 7 (Path S profile) using WebPlotDigitizer. Sample at actual monument spacing ($30\text{ m}$). Output `data/real/adriyala_lw1_profiles.csv`:
```csv
path_id,path_type,distance_m,epoch_days,subsidence_mm,source,digitised_by
S,transverse,-300,30,-2,10.18311/jmmf/2022/32099,adarsh
```

### Step 3: Least-Squares Curve Fitting (D3)
Execute `src/minesim/fitting.py` to fit `physics.subsidence` against the digitised dataset. Output `data/fitted/adriyala_lw1_params.json`:
```json
{
  "mine": "adriyala_lw1",
  "source_doi": "10.18311/jmmf/2022/32099",
  "fitted_at": "2026-09-16",
  "params": {
    "subsidence_factor": 0.0,
    "tan_beta": 0.0,
    "time_coefficient_per_day": 0.0
  },
  "fit": {
    "rms_residual_mm": 0.0,
    "max_residual_mm": 0.0,
    "n_points": 0,
    "n_epochs": 0,
    "r_squared": 0.0
  }
}
```

### Step 4: Gate Check (D4)
Verify that [[gates/G00-data-pinning|Gate G00]] passes, populating `config/mines/adriyala_lw1.yaml` with the repinned values.

---

## 4. Definition of Done

- [ ] `data/real/adriyala_lw1_profiles.csv` populated with $\ge 200$ digitised field points across $\ge 4$ epochs.
- [ ] Least-squares fitting script converges with $R^2 \ge 0.90$.
- [ ] Residuals reported honestly (including asymmetry on dip side).
- [ ] `config/mines/adriyala_lw1.yaml` contains no `null` values.
- [ ] `load_config()` successfully returns valid configuration.
- [ ] Gate G0 passes.
