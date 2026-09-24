# Step 6b — Stress test of the v1 simulator (Claude Code, 14 Sep night)

> **Superseded by [step 6c](../step-06c-w1-w4-fixes/WALKTHROUGH.md):** W1–W4 below are fixed and the expected numbers in §4–§5 changed (129 tests; stress 55/0/0). Kept as the record of what was found.

| | |
|---|---|
| **Asked by** | Adarsh: "stress test the system — physics and anything else — fix any issue, give me a step-by-step way to try it and a checklist" |
| **Files changed** | `mine-sim/src/minesim/physics.py` (overflow fix), `mine-sim/tests/unit/test_physics.py` (+2 tests), `mine-sim/scripts/stress_test.py` (new), `handoff/v1-sample/README.md` (one sentence corrected) |
| **Result** | `stress_test.py`: **49 pass, 4 warn, 0 fail** · pytest **123 passed** (was 121) · 690-day re-run **byte-identical** to the shared sample |

---

## 1. What was stressed

| Area | How | Result |
|---|---|---|
| Closed-form Knothe time lag | Compared with direct numerical integration of `dS/dt = c(S_static − S)` at 49 (x, t) points, before and after the panel end | error 1.8e-12 mm |
| Same, extreme mine | slow face 0.5 m/d, fast settling c = 0.2/d, 800 m panel | error 9.4e-10 mm |
| Whole grid, 690 days, every hour | NaN, negative, ground rising, jumps per hour | 0 / 0 / 1.5e-13 mm / max 0.37 mm per hour |
| Cliffs | largest step between 5 m cells vs the analytic slope limit | 37.6 mm vs 38.7 mm limit |
| Limits | long time → static full-panel trough; very large c → static moving face | exact / 0.6 mm |
| Horizontal movement and strain | direction (into the trough), compression centre / tension at ribs, strain integrates to zero | all correct |
| **180 extreme mine configs** | advance 0.25–20 m/d × c 0.001–50 × depth 50–1000 m | **was 89 NaN, now 0** (see §2) |
| World state | 16,560 hourly steps: no cell rises; node Z from grid vs physics | 0 rising; max 0.52 mm |
| Sizing | spacing 10–400 m × 1–16 children per anchor: IDs, backup parent ≠ primary, child_index 0..n-1, TDMA slots fit the 11.5 s window | all valid; 155 anchors refuses loudly (ID range 1–99) |
| Radio | loss 0 → 100%, loss 1 → 0%, −60 dBm TX → link failures, 2,000 epochs with a reboot mid-way → dedup correct | all correct |
| Payload | peak tilt/strain + bias/drift/noise vs 16-bit field | 6,725 (limit 32,767) |
| Run | same seed identical, other seed differs, `--days 0`, 1 hour, half day, Illinois swap, 1,500 daily steps past the panel end + replay | all correct; replay == model exactly |
| Sensor noise (on the shared 690-day sample) | subsidence reading − physics | mean −0.03 mm, σ 1.53 mm (configured 1.5) |

## 2. Bug fixed — NaN for slow-advancing or fast-settling mines

`physics.subsidence` multiplied `exp(c·x/v)` by an `erfc` difference. When c/v is large (slow face or fast settling) the exponential overflows ahead of the face to `inf`, and `inf × 0 = NaN`. Cast to the int32 grid, NaN silently becomes 0 on this Mac and −2,147,483,648 mm on Intel/Linux. Example: advance 0.25 m/d, c = 0.1/d, day 10 → 42,624 NaN grid cells. Adriyala (c/v = 0.003) never hit it; 89 of 180 plausible other mines did. That breaks invariant 8 (any mine yaml must work).

**Fix:** the exponent collapses exactly — `exp(c·u/v + g)·erfc(a(u+β)) = erfcx(a(u+β))·exp(−a²u²)` — so the term is computed with `scipy.special.erfcx` where its argument is ≥ 0, and directly where it is < 0 (the exponent is already negative there). Same maths, no overflow.

**Proof it changes nothing for Adriyala:** new vs old differ by 1e-12 mm; the 690-day `nodes.csv` re-run has the same SHA-256 as `handoff/v1-sample/nodes.csv.gz` (12e3eff4…). New tests `test_closed_form_matches_numeric_knothe_integral` and `test_finite_for_slow_face_and_fast_settling`; the second fails on the old code.

## 3. Warnings — work as coded, need Adarsh's decision (not changed)

**W1 · Correction: the survey line will NOT switch tags on by itself.** The survey data already shows −1,198 mm at the line on day 210 (the first survey). So the face passed line S well before day 210 (x < 840 m); the model's best fit puts it around x ≈ 130 m (model-implied, not a sourced number). The node cross is fixed at mid-panel, x = 1,250 m. With `survey_line_x_m = 130` the day-210 tags stay `{'synthetic': 33}`. Last session said "switches on with no code change" — only true if the line happens to be at 1,250 m. Worse, forcing it at 1,250 m would put measured −1,198 mm on nodes the model says are at 0 mm (the face is not there yet) — a 1.2 m spike in the ML data.
*Options:* (a) when `survey_line_x_m` is set, sizing centres the transverse line on it (needs the paper's epoch-day origin to match the sim's day 0 too); (b) accept 100% synthetic for v1 and say so in the pitch. **Recommendation: (b) for Tuesday's demo, (a) in v2.**

**W2 · Tier percentiles split identical nodes.** All 22 longitudinal nodes see the same face pass, so their peak strains tie (1,371–1,432 µε). The 66.7th-percentile cut falls inside that cluster: Adriyala makes 3 of them 1C and 19 1B (x = 800 m is 1C, x = 850 m is 1B on a 1 µε difference). Illinois is worse: 23 of 27 scouts become 1C instead of a third. *Fix option:* group values within one sensor noise σ and put a whole group on one side of the cut. Changes the tier mix and the ₹99,500 cost, so not applied without your call.

**W3 · The two tilt sensors see no signal.** Tier 1A sits at the far edges (±250 m) where peak tilt is 274 µrad; the tilt model has 500 µrad bias and ±3,000 µrad daily temperature drift. It matches WP2 ("secondary vote only") but the 1A tilt column is effectively pure drift.

**W4 · Peak 930 mm vs field 1,267 mm (−27%).** Already open as DEC-1 / R0-3.

Smaller notes: battery model ignores the 20 mA sensing current (battery goes 4,205 → 3,712 mV over 690 d, far from empty); the 10 cm differentiation step in `physics.py` is a literal.

---

## 4. Try it yourself — step by step

Run from the repo root. `P=/opt/miniconda3/envs/pinn-sandbox/bin/python3.11`.

**Step 1 — Tests (1 min)**
```bash
cd mine-sim && $P -m pytest -q | tail -1
```
You should see `123 passed`.

**Step 2 — Stress test (1 min)**
```bash
$P scripts/stress_test.py
```
You should see five sections and `RESULT: 49 pass, 4 warn, 0 fail`. The 4 WARN lines are W1–W4 above.

**Step 3 — See the bug that was fixed (30 s).** A slow mine (0.25 m/day, c = 0.1/day), a point ahead of the face on day 10. The old code printed `nan`:
```bash
$P -W ignore -c "
import dataclasses; from minesim.config import load_config; from minesim import physics
c=load_config('config/assumptions.yaml'); k=dataclasses.replace(c.knothe, advance_m_per_day=0.25, time_coefficient=0.1)
print(physics.subsidence(2400.0, 0.0, 10.0, c.panel, k), physics.subsidence(300.0, 0.0, 3000.0, c.panel, k))"
```
You should see `0.0 930.02…` — ground ahead of the face has not moved, ground 450 m behind it has sunk ~930 mm. No `nan`.

**Step 4 — Check one node by eye (2 min).** Is the ground moving as the face passes?
```bash
gunzip -c ../handoff/v1-sample/nodes.csv.gz | awk -F, 'NR==1 || ($3==104 && $1%240==0)' | cut -d, -f1,3,4,6,8 | head -75
```
One row every 10 days for node 104 (transverse line, y = −50 m). Watch `subsidence_mm`: near 0 (±3 mm noise) until about epoch 7,200 (day 300), then it falls smoothly to about −876 mm on day 690. No two consecutive rows differ by more than ~90 mm.

**Step 5 — Same seed gives the same file (1 min)**
```bash
$P -m minesim.run --days 2 --out /tmp/r1 >/dev/null && $P -m minesim.run --days 2 --out /tmp/r2 >/dev/null
shasum /tmp/r1/nodes.csv /tmp/r2/nodes.csv
```
Both hashes should be the same.

**Step 6 — Swap the mine with no code change (1 min)**
```bash
sed -i '' 's/^mine: adriyala_lw1/mine: illinois_lw/' config/assumptions.yaml
$P -m minesim.run --days 2 --out /tmp/ill | head -4
git checkout config/assumptions.yaml
git status --short src/
```
You should see a run summary (27 scouts). After the checkout, `git status` shows nothing under `src/`.

**Step 7 — Break the radio on purpose (30 s)**
```bash
$P -c "
import dataclasses, numpy as np
from minesim.config import load_config; from minesim.sizing import size_network; from minesim.world import WorldState
from minesim.sensors import read_node, SCOUT_TIERS; from minesim.radio import Superframe
c=load_config('config/assumptions.yaml'); L=size_network(c); w=WorldState(c,L); w.step()
rd=[read_node(n,w,c,np.random.default_rng(0)) for n in L.nodes if n.tier in SCOUT_TIERS]
for p in (0.0,0.5,1.0):
    c2=dataclasses.replace(c, radio=dataclasses.replace(c.radio, bernoulli_loss_prob=p))
    r=Superframe(c2,L).run(rd,1,np.random.default_rng(0)); print(p, sum(x.delivered for x in r),'/',len(r))"
```
You should see `0.0 33 / 33`, around 25 of 33 at 0.5 (the emergency retry helps), and `1.0 0 / 33`.

## 5. Checklist — tick every box

- [ ] `pytest` shows **123 passed**, 0 failed
- [ ] `stress_test.py` ends **49 pass, 4 warn, 0 fail**
- [ ] Step 3 prints `0.0 930.02…`, no `nan`
- [ ] Step 4: node 104 flat until ~day 300, then smooth fall to about −876 mm
- [ ] Step 5: two identical hashes
- [ ] Step 6: Illinois runs; `git status --short src/` empty afterwards
- [ ] Step 7: 33/33 at loss 0, 0/33 at loss 1
- [ ] `python3 sync_vault.py --check` → 0 broken / 0 orphans / 0 frontmatter
- [ ] Decide W1 (survey line: accept synthetic for v1, or move the cross in v2)
- [ ] Decide W2 (tier ties: keep, or group within noise σ — changes cost)
- [ ] Note W3 (1A tilt is pure drift) for the pitch Q&A
