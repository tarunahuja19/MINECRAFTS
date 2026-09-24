# Step 6c — W1–W4 fixed, real-anchored data (Claude Code, 14 Sep, session 08)

| | |
|---|---|
| **Asked by** | Adarsh: keep what the field data has, derive what it lacks (equations or ML), don't ship 100% synthetic; fix W2, W3, W4; explain −27%; CI; one project-update file per date |
| **Code changed** | `physics.py` (inflection offset), `fitting.py` (fit through physics), `sizing.py` (cross on survey line, natural-break tiers, rod-axis strain, tilt detectability), `config.py`, `provenance.py`, `sensors.py`; `config/mines/*.yaml`, `config/assumptions.yaml`, `data/fitted/adriyala_lw1_params.json` |
| **New** | `scripts/build_anchored_dataset.py`, `handoff/v2-sim-sample/`, `handoff/v2-real-anchored/`, `.github/workflows/ci.yml`, 6 tests |
| **Result** | pytest **129 passed** · stress test **55 pass / 0 warn / 0 fail** · vault 0/0/0 |

---

## 1. What "−27%" was, and the fix (W4)

The mine's measured deepest point is **−1,267 mm**. The model's was **−930 mm**. (930 − 1267) / 1267 = −26.6% ≈ **−27%**: the simulator made the ground sink about a quarter less than it really did.

**Why.** Seen across the panel, the real trough is **narrow and deep**: half its depth spans only ~160 m. The old model (classical Knothe over the full 250 m panel width) makes a **wide, flat-bottomed** trough. Both hold about the same volume of sunk ground (232,620 vs 234,750 mm·m), so the wide one is shallower. The fit had matched the volume, not the shape.

**Fix.** Standard Knothe practice adds an **inflection-point offset** d: the rock over the edges of the panel bridges instead of collapsing, so the trough's edges sit d metres *inside* the panel edges. The influence function then acts on an effective panel of W − 2d by L − 2d. d is fitted from the data. The fit now also runs through `physics.subsidence` itself, so fitting and simulation use the same equation.

| | Before | After |
|---|---|---|
| RMS error vs 283 field points | 177.5 mm | **52.1 mm** |
| R² | 0.8201 | **0.9845** |
| Peak | 930 mm (−27%) | **1,202 mm (−5%)** |
| Paper's own profile function (for comparison) | 49.7 mm | 49.7 mm |

Pinned: a = 0.45, tan β = 2.5676, c = 0.02358/day, **d = 58.96 m**, survey origin offset 13.47 m, survey line x = 258 m.

**Two caveats, stated in the fit record:**
- **The subsidence factor a is not identifiable from one survey line.** RMS is 52 → 50 mm anywhere from a = 0.45 to 0.9, so the rule takes the smallest a within 5% of the best.
- **Survey line x trades off against the settling rate c.** Anywhere from 200 to 650 m fits equally well, because there is no survey before day 210. The paper's layout figure fixes both.

## 2. Not 100% synthetic (W1)

- The node cross now sits **on survey line S** (x = 258 m). Transverse Scouts move to the nearest survey monument when one is within half the monument spacing.
- **9 of 11 transverse nodes stand on monuments.** On the 6 survey days their subsidence is the measured value (`real`); on every other hour it is the simulated value at that monument (`pinned`).
- 690-day run, all value columns: **real 0.003%, pinned 9.09%, synthetic 90.9%** (was 100% synthetic). Subsidence column only: 54 real, 148,986 pinned, 264,960 synthetic.
- The gap between a `real` reading and the simulated terrain at that node is at most **54 mm** (it would have been 1,198 mm before the refit).

## 3. Your data rule — the real-anchored dataset

`handoff/v2-real-anchored/`: one row per monument per day (48 × 691 = 33,168 rows, 22 columns). The README there is the data dictionary.

| Layer | What | Tag |
|---|---|---|
| Present in the data | 283 measured subsidence values, **copied exactly** | `real` |
| Missing, derived by physics + ML | subsidence on the other 685 days: fitted Knothe + a Gaussian process that learns the misfit, with 1σ uncertainty | `pinned` |
| Missing, derived by equations | tilt, curvature, horizontal movement U = B·tilt, strain dU/dy, sinking rate | `synthetic` + `derived_basis` column |
| Not derivable (nothing surveyed along the panel) | tilt along x | `synthetic`, physics only |

**Does the ML layer earn its place?** Hide one survey day, rebuild from the other five, predict it: physics alone misses by 52.1 mm RMS, physics + GP by **37.7 mm** (28% better on every held-out day).

**Honest limits:**
- Strain derived from the data-anchored surface peaks at −22,000 µε, against −13,000 µε from physics alone. Both columns are included.
- 7% of derived values had a 0.1–3.75 mm day-to-day rise clamped ("ground only sinks").
- Measured values are never adjusted.

## 4. Tiers (W2) and tilt sensors (W3)

- **W2:** percentile cuts are replaced by **natural breaks** (Fisher-Jenks): three strain bands with no threshold to tune, and breaks only fall in real gaps between values.
  - Illinois: 1C share **85% → 15%**; identical nodes now share a tier.
  - **Bug found on the way:** peak strain was taken as the larger of x and y, but a rod only measures along its own line. Every along-panel node was being ranked by a compression it can't see.
- **W3:** a tilt-only (1A) node is placed only where its peak tilt is at least 3× the tilt noise left after averaging one day. The ±3,000 µrad day/night drift is a pure daily cycle and cancels in a 24 h mean, leaving about 20 µrad. **All 15 Adriyala 1A nodes pass.** Positions that fail get 1B, since the rod still sees strain.
- **Layout:** 25 Scouts (1A 15, 1B 9, 1C 1), 4 Anchors, 1 Gateway, **₹65,800** (was 33 / 5 / ₹99,500). There is one 1C because the centre node's −13,000 µε compression is a band by itself.

---

## 5. Try it yourself

From `mine-sim`, with `P=/opt/miniconda3/envs/pinn-sandbox/bin/python3.11`.

**Step 1 — Tests and stress test (2 min)**
```bash
$P -m pytest -q | tail -1            # 129 passed
$P scripts/stress_test.py | tail -1  # RESULT: 55 pass, 0 warn, 0 fail
```

**Step 2 — The −27% is gone (10 s)**
```bash
$P -c "
import json; f=json.load(open('data/fitted/adriyala_lw1_params.json'))
print('RMS', f['fit']['rms_residual_mm'], 'mm | R2', f['fit']['r_squared'], '| peak', f['fit']['peak_model_mm'], 'vs', f['fit']['peak_measured_mm'], 'mm')
print('history:', f['history'])"
```
You should see `RMS 52.14 mm | R2 0.9845 | peak 1201.7 vs 1267.0 mm`, then the old fit (peak 930 mm, −27%).

**Step 3 — Not 100% synthetic (20 s)**
```bash
gunzip -c ../handoff/v2-sim-sample/nodes.csv.gz | awk -F, 'NR>1{c[$9]++} END{for(k in c) print k, c[k]}'
```
You should see `real 54`, `pinned 148986`, `synthetic 264960` (in any order).

**Step 4 — Measured values are kept, gaps are filled (10 s)**
```bash
$P -W ignore scripts/build_anchored_dataset.py | sed -n 12,15p
gunzip -c ../handoff/v2-real-anchored/survey_line_daily.csv.gz | awk -F, 'NR==1 || ($2==9.9 && ($1==60||$1==150||$1==209||$1==210||$1==211||$1==690))' | cut -d, -f1,2,7,8,10
```
You should see `physics_only 52.1` and `physics_plus_gp 37.7`, then monument 9.9 m:

| day | subsidence_mm | prov | σ |
|---|---|---|---|
| 60 | −16.0 | pinned | 0.2 |
| 150 | −992.7 | pinned | 11.9 |
| 209 | −1179.1 | pinned | 12.8 |
| **210** | **−1188.0** | **real** | 0.0 |
| 211 | −1181.9 | pinned | 12.8 |
| **690** | **−1250.0** | **real** | 0.0 |

Day 210 and 690 are the paper's numbers, untouched. Day 211 sits 6 mm above day 210: that is the measurement's own noise (σ ≈ 35 mm), not the ground rising.

**Step 5 — Tiers follow the ground (20 s)**
```bash
$P -W ignore -c "
from collections import Counter
from minesim.sizing import size_network
from tests.helpers import load_mutated_config
from minesim.config import load_config
for name,c in (('adriyala',load_config('config/assumptions.yaml')),('illinois',load_mutated_config(lambda d: d.__setitem__('mine','illinois_lw')))):
    L=size_network(c); print(name, dict(Counter(n.tier for n in L.nodes if n.tier in ('1A','1B','1C'))), 'INR', L.cost.total_inr)"
```
You should see `adriyala {'1A': 15, '1B': 9, '1C': 1} INR 65800` and `illinois {'1B': 23, '1C': 4} INR 80800`.

**Step 6 — CI (1 min)**
```bash
gh run list --limit 3
```
The newest run on `main` should say `completed  success`. Or open the repo's **Actions** tab on GitHub.

## 6. Checklist

- [ ] pytest **129 passed**
- [ ] stress test **55 pass, 0 warn, 0 fail**
- [ ] Step 2: RMS 52.14, peak 1201.7 vs 1267.0
- [ ] Step 3: real 54 / pinned 148,986 / synthetic 264,960
- [ ] Step 4: CV 52.1 → 37.7; days 210 and 690 show `real` with the paper's values
- [ ] Step 5: Adriyala 15 / 9 / 1, Illinois 23 × 1B + 4 × 1C
- [ ] Step 6: CI green
- [ ] `python3 sync_vault.py --check` → 0 / 0 / 0
- [ ] **Your task:** find survey line S's position along panel 1 in the JMMF paper's layout figure → replaces the fitted 258 m
