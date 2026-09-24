---
title: "WP0 Field Data Guide: Grounding Simulation in Reality"
slug: wp0-data-pinning-guide
type: guide
module: physics
status: reviewed
tags: [wp0, data-pinning, empirical-data, adriyala, jmmf-paper, curve-fitting, webplotdigitizer]
created: 2026-09-14
updated: 2026-09-14
author: adarsh
last_agent_edit: antigravity
source_file: explainers/01_wp0_data_pinning_explainer.md (source folder removed 2026-09-14; this note is the canonical copy)
---

# WP0 Field Data Guide: Grounding Simulation in Reality

---

## 1. What is WP0? (The Core Idea)

**WP0** stands for **Work Package 0: Data Pinning** (see [[work-packages/WP0-data-pinning|WP0 Specification]]). 

In simple terms: **Before we write a single line of simulation code, we anchor our equations to real-world ground measurements taken by human mining engineers at real coal mines.**

| Summary Card | |
|---|---|
| **Owner** | [[people/adarsh-agarwala|Adarsh]] (with Claude assistance) |
| **Stage** | Days 1 to 4 |
| **Input** | Published academic research paper (PDF figures & tables) |
| **Output** | `data/real/adriyala_lw1_profiles.csv` & `data/fitted/adriyala_lw1_params.json` |
| **Pass/Fail Gate** | **[[gates/G00-data-pinning|Gate G00]]** (Verification that fitted parameters replace all `null`s with residual < 150 mm) |

---

## 2. Why WP0 Exists: The "Self-Deception" Trap

Most student simulation projects fall into what engineers call a **Closed Validation Loop**:
1. You use a mathematical formula (like the [[notes/physics/knothe-time-dependent-model|Knothe equation]]) to generate fake ground movement.
2. You feed that fake movement into your sensor network and AI models.
3. Your AI model scores 99% accuracy!
4. You celebrate — but in the real world, the software is useless, because the AI only learned to mimic your formula, not the actual ground.

```
       The Dangerous Trap:               Our Approach (WP0):
     ┌───────────────────────┐         ┌───────────────────────┐
     │ Guessed Knothe Model  │         │ Real Surface Survey   │
     │   (Arbitrary Math)    │         │ (80 monument paths)   │
     └───────────┬───────────┘         └───────────┬───────────┘
                 │ (Fake data)                     │ (Fitted to)
                 ▼                                 ▼
     ┌───────────────────────┐         ┌───────────────────────┐
     │       Simulator       │         │ Calibrated Simulator  │
     └───────────┬───────────┘         │  (Known, proven error)│
                 │                                 │
                 ▼                                 ▼
         Self-Deception!                    Real Engineering!
```

> **The Analogy:**  
> Imagine tailoring a suit for an astronaut.  
> - *The Trap:* Guessing the astronaut is 6 feet tall, sewing the suit to your guess, and giving yourself an award because the suit matches your drawing.  
> - *WP0:* Taking a tape measure to the actual human body first, writing down their exact shoulder width and arm length, and tailoring the suit to fit the real human.

---

## 3. The 3x Error Caught at Adriyala

Before WP0 was introduced, early design documents assumed standard textbook numbers for the Adriyala Longwall mine (see [[docs/assumption-register|Assumption Register A3 & A4]]):
- Assumed seam thickness: $m = 3.0\text{ meters}$
- Assumed subsidence factor: $a = 0.6$
- This predicted a maximum surface drop of:
  $$S_{max} = 1.63\text{ meters (which is } 54\% \text{ of the seam height)}$$

### But what actually happened in the real mine?
When mining researchers (**Ramalingeswarudu et al., 2022**) measured the actual ground with physical survey instruments over 690 days, they found:
- Real maximum surface drop: **1.267 meters**
- Real subsidence ratio: **only 19.5% of the seam height** ($S_{max} / m = 0.195$)!

**The textbook guess was wrong by nearly a factor of THREE.**  
If we had built the simulator using the old guess, all 690 days of synthetic data would have depicted a violent, exaggerated ground collapse that never happened in reality. WP0 stopped this catastrophic flaw before it was coded.

---

## 4. Where the Real Data Comes From

Our primary ground truth comes from an open-access research paper:
> **Source:** Ramalingeswarudu, Dundra, Sastry & Murty (2022).  
> *"Analysis of Surface Subsidence and Relative Movements of Underground Rock Strata over an Inclined Longwall Panel"*, Journal of Mines, Metals and Fuels, 70(9):484–491.  
> **DOI:** `10.18311/jmmf/2022/32099`

### Key Field Facts from the Paper:
- **Location:** Adriyala Project Area, Ramagundam Region, Telangana (SCCL).
- **Longwall Panel 1:** 250 meters wide, 2,333 meters long, buried ~375 meters underground.
- **Physical Survey Setup:** 
  - **80 transverse survey lines** across the width.
  - **13 longitudinal survey lines** along the length.
  - Physical concrete survey monuments placed **every 30 meters**.
  - Surveyors recorded Easting, Northing, and Elevation every 30 days out to **690 days**.

*(Note: The monitoring layout they used in real life — a cross of transverse and longitudinal lines — is identical to the sensor layout we independently designed in [[work-packages/WP2-sizing-algorithm|WP2]]!)*

---

## 5. Step-by-Step: How WP0 Is Executed

```
  [Step 1: Read Paper] ──► Extract seam height & resolve depth (375m vs 410m)
          │
  [Step 2: Digitise]   ──► Use WebPlotDigitizer on Figs. 6 & 7 → CSV file
          │
  [Step 3: Curve Fit]  ──► Run src/minesim/fitting.py to solve for a, tan β, c
          │
  [Step 4: Audit Gate] ──► Check RMS residual against Gate G00 threshold (<150mm)
          │
  [Step 5: Unlock]     ──► Write numbers into YAML; load_config() stops raising!
```

### Step 1: Read Table 1 (Day 1)
- Read the paper's Table 1 to extract the exact extracted seam thickness $m$.
- Resolve the depth conflict: One source says 375 m, another says 410 m. We take the figure from the JMMF paper (375 m) and document the discrepancy in [[docs/assumption-register|Assumption A2]].

### Step 2: Digitise the Curves (Day 2)
Academic papers publish curves as figures (raster plots), not downloadable CSV spreadsheets.
- We open **Figure 6** and **Figure 7** from the paper in WebPlotDigitizer.
- We click on each monument data point along the transverse path at day 30, 60, 90... up to 690 days.
- Save output as: `data/real/adriyala_lw1_profiles.csv`
- **Strict Rule:** We only record points at the real 30 m monument intervals. We do **not** interpolate fake points in between.

### Step 3: Curve Fitting with `fitting.py` (Day 3)
We run a SciPy non-linear least-squares optimisation script (`src/minesim/fitting.py`) that compares our theoretical [[notes/physics/knothe-time-dependent-model|Knothe formula]] against the real digitised points.

It tunes 3 core "knobs":
1. **$a$ (Subsidence Factor):** What fraction of the underground void reaches the surface?
2. **$\tan \beta$ (Main Influence Angle):** How widely does the surface bowl spread outward?
3. **$c$ (Time Coefficient):** How many days does the surface take to settle after coal is extracted?

Output is saved to `data/fitted/adriyala_lw1_params.json`.

### Step 4: Judge the Fit (Day 4)
We evaluate the **Root Mean Square (RMS) Residual** (the average millimeter difference between our formula and real ground):

| RMS Residual | Verdict | What It Means & What We Do |
|---|---|---|
| **< 50 mm** | **Excellent** | The Knothe equation matches the real earth very well. Proceed with full confidence! |
| **50 mm – 150 mm** | **Usable** | Minor geological variations exist. Proceed, but report the exact error number honestly. |
| **> 150 mm** | **Failed** | The Knothe formula is too simplistic for this mine. **Escalate immediately.** Switch to the custom empirical formula from Table 3 of the paper. |

### Step 5: Unlock the Simulator!
In `config/mines/adriyala_lw1.yaml`, the values for `subsidence_factor` and `tan_beta` start as `null`.  
Until WP0 finishes, calling `load_config()` deliberately crashes with `UnpinnedParameterError`.

Once the fitted parameters are verified and pasted into the YAML file, `load_config()` succeeds. **The entire rest of the simulation is now officially unlocked!**

---

## 6. The Second Mine (Proving Mine Independence)

To prove to SIH evaluators that our simulator isn't an "Adriyala-only trick," on Day 8 we repeat this exact process for a second mine:
- **Study:** A US National Institute for Occupational Safety and Health (NIOSH) longwall panel study in southern Illinois.
- Output: `config/mines/illinois_lw.yaml`.
- **[[gates/G15-config-driven-mine-independence|Gate G15 Check]]:** The entire simulator must run on the Illinois mine **without modifying a single line of Python code**.

---

## 7. The Golden Rules of WP0

1. **Never guess a number to unblock code:** If a parameter is unknown, leave it `null` and let the code crash. The crash is a safety feature that keeps us honest.
2. **Never interpolate fake precision:** If monuments were spaced 30 m apart, keep points at 30 m. Never invent fake data points in between.
3. **Model output is NEVER tagged as `real`:** Only the actual surveyor monument coordinates are `real`. Simulated numbers calibrated to this data are tagged `pinned`. Pure mathematical calculations are tagged `synthetic`. See [[notes/sensors/sensor-provenance-and-tagging|Sensor Provenance & Tagging]].
4. **Don't hide the dip-side tilt:** The Adriyala coal seam is inclined 10°. Because of this, the slope is slightly steeper on one side. Our symmetric formula will have slightly higher residual on the dip side. **Do not fudge the math to hide this.** We document it proudly as a geological reality.
