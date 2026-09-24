# F10 — Surface cracks, structure damage, and ground vibration

> **BUILT by Claude, 17 Sep (session 21)** — not pasted into Antigravity. Results in [`walkthroughs/step-f10-cracks/WALKTHROUGH.md`](../walkthroughs/step-f10-cracks/WALKTHROUGH.md).
>
> **One deviation from §1 below, deliberate:** part E asked for fissure and vibration channels on the telemetry. They were NOT added to `out/nodes.csv`. Contract §7.1 freezes that column order ("Part 2 parses positionally") and RULES.md §0.6 puts the contract above any step's prose, so amending it is Adarsh's call. The new fields go to `out/cracks/` via `scripts/export_cracks.py` instead. Everything else in §1 was built.


**In plain words:** the simulator knows how far the ground has sunk. It does not yet know what that does to the ground surface (cracks), to what is built on it (damage), or what the mine shakes (vibration). This step adds those three, on top of the subsidence maths we already have — not instead of it.

**Plan:** Adarsh, 17 Sep (session 21). Needs a full re-run and re-export. Supersedes the un-started `T6-cracks-and-damage.md` for the physics half.

---

## 0 · First, what does NOT need fixing — measured, not assumed

Adarsh asked to "fix the maths" and to copy the old `sih26/simulation` sandbox. Both were checked before writing this step, and the answer is the opposite of what was expected in one place, so it is written down here rather than acted on silently.

**The current subsidence core is the better of the two. Do not replace it with the old sandbox's.**

| | old `simulation/sandbox` | current `mine-sim` |
|---|---|---|
| method | mask ⊛ Gaussian influence kernel, numerically | closed-form erf/erfc with a **travelling face** and the Knothe time lag solved analytically |
| tan β | 1.9 — *assumed*, Barapukuria analogue | **2.5676 — fitted** to the LW1 survey data |
| subsidence factor a | 0.75 — *literature range* | **0.45 — fitted** |
| Knothe c | 0.04 /day — *"matched via SDPS"* | **0.02358 /day — fitted** jointly with the survey line position |
| inflection offset d | absent (d = 0) | **58.96 m — fitted** (0.157 × depth) |
| district | one panel only | linear superposition of panels |

The old sandbox is an unfitted model of a *different* assumed mine. Copying its constants over the fitted ones would move every validated number off the field data without failing a single test. That is the trap; do not walk into it.

**The finite-difference derivatives are also fine.** The old sandbox's docstring warns at length that finite-differencing S injects "truncation error that looks exactly like a small strain signal". That warning is sound in general and was checked here against the actual code. It does not bite:

```
curvature along the transverse profile, x = 1200 m, t = 400 d
  step = 0.02 m → [-0.19477, +0.09662] 1/km
  step = 0.10 m → [-0.19477, +0.09662] 1/km      (the shipping value)
  step = 0.50 m → [-0.19476, +0.09662] 1/km
  step = 2.00 m → [-0.19473, +0.09660] 1/km
curvature across the advancing face, y = 0, t = 400 d
  step = 0.02 … 2.00 m → [-0.016377, +0.033722] 1/km, identical to 5 significant figures
```

Stable over two decades of step size, so neither round-off nor truncation is reaching the answer. The `np.clip`/`np.maximum(0, …)` kinks were the other suspicion; the largest second difference between adjacent transect points is 0.000279 1/km, i.e. no spike at the clip boundary. **Leave `tilt`, `curvature` and `strain` as they are.**

**Cost is not a problem either**, so do not "optimise" it: on the full 309 × 84 world grid, subsidence 1.6 ms, tilt 5.9 ms, curvature 7.5 ms, strain 12.3 ms per day — 8.5 s for all 690 days of the strain field on one panel.

### The two real gaps

1. **There is no cross-derivative.** `physics.curvature()` returns `∂²S/∂x²` and `∂²S/∂y²` and nothing else. With `U = B ∇S`, the strain tensor is `ε_ij = B ∂²S/∂x_i∂x_j`, so the missing `∂²S/∂x∂y` means there is no principal strain and therefore **no crack direction**. On the panel centre-line the principal axes are the panel axes and this costs nothing; at the four panel corners the trough is doubly curved, the principal axes rotate, and the corners are where field crews actually record the worst cracking. This is the one genuine maths gap, and the crack model cannot be built without closing it.

2. **`B` is the only unfitted constant in the chain — and cracks are linear in it.** Current `B = r/√(2π) = 0.3989 r = 58.27 m`; the old sandbox used `0.35 r`. Both sit inside the usual 0.3–0.4 r spread, and they disagree by 14 %. Crack width scales linearly with `B`, so every crack number this step produces inherits that 14 % as a systematic. `B` **cannot be fitted from the JMMF survey data**, because that data is vertical subsidence only — fitting `B` needs measured *horizontal* movement between pegs. So it stays an assumption, it gets labelled as one, and the crack output carries a sensitivity band rather than pretending to a precision it does not have.

### What the old sandbox IS worth copying

Its crack and vibration *structure*, with the numbers redone:
- **The latch.** `sensors.py:504` — "A crack opens only in tension, and does not close again — the latch is what makes it a fissure rather than strain." Correct, and keep it.
- **Vibration never touches S.** `session.py:610` — "Trigger a transient vibration without affecting ground subsidence S(x,y,t)." Correct, and keep it: blasting does not cause subsidence.
- **Frequency bands discriminate the source.** `sensors.py:151-154` — truck 8–20 Hz, conveyor 49–51 Hz, blast 40–80 Hz, microseismic 100–250 Hz. Keep.

And its two numbers that must **not** be copied:
- `opening = max(0, strain_x) * 1000.0 * 2.0` (`sensors.py:506`). The `2000` is an undocumented magic constant. Dimensionally it asserts that all tensile extension over a **2 m** gauge localises into one crack. Real crack spacing over a longwall panel is metres to tens of metres, so this understates opening by roughly the ratio of the true spacing to 2 m. Replace with an explicit, sourced crack-spacing parameter.
- `strain_ue > 4000 → flag 1`, `> 5300 → flag 2` (`sensors.py:565-568`). One ladder of raw-strain flags doing the work of three separate questions. Split them: does the ground crack (a µε threshold), is the structure damaged (NCB change of length — a 10 m frontage is already "very severe" at 40 mm, long before 4000 µε), and is a statutory line crossed. On that last one the `5300` turns out **not** to be arbitrary — the old sandbox calls 5.3 mm/m a "DGMS tensile limit" in four places, unsourced. Carry it as `dgms_tensile_strain_limit_ue` with an OPEN — VERIFY warning rather than dropping it.

---

## 1 · Paste into Antigravity

```text
Before you start, read AGENTS.md, files/11-interface-contracts-v1.md, sih-26-finale-brain/RULES.md, WP1-core-physics.md, WP4-sensor-models-provenance.md, steps/F0-fix-the-system-plan.md and this step IN FULL including section 0. Branch feat/viz-darker-ground-bigger-nodes, do not commit. Only edit the files listed. If the spec can't be implemented as written, STOP and tell me why. Python: /opt/miniconda3/envs/pinn-sandbox/bin/python3.11. Report exact pytest counts.

HARD RULES FOR THIS STEP
- Do NOT modify the body of physics.subsidence(). It is fitted to published field data (10.18311/jmmf/2022/32099). Invariant 4 / gate G01: S(x,y,t) appears once in the repository and this step does not add a second one.
- Do NOT change tan_beta, subsidence_factor, time_coefficient, inflection_offset_m or seam thickness. Do NOT import anything from /Users/adarshagarwala/Documents/sih26/simulation.
- Do NOT let vibration write into S, into the world grid, or into node Z. Vibration is a telemetry channel only.
- Every new constant goes in config/assumptions.yaml with a source comment, and any value I have marked OPEN below keeps the literal text "OPEN — VERIFY" in its comment.

STEP F10 · Cracks, damage, vibration

Files you may edit: mine-sim/src/minesim/physics.py, mine-sim/src/minesim/cracks.py (new), mine-sim/src/minesim/vibration.py (new), mine-sim/src/minesim/sensors.py, mine-sim/src/minesim/config.py, mine-sim/config/assumptions.yaml, mine-sim/config/mines/adriyala_lw1.yaml, mine-sim/tests/unit/test_cracks.py (new), mine-sim/tests/unit/test_vibration.py (new), mine-sim/tests/unit/test_physics.py, walkthroughs/step-f10-cracks/*.

A. Close the maths gap: the strain tensor
1. Add physics.curvature_xy(x, y, t, panel, params) -> d2S/dxdy in 1/km, as a mixed central difference on the SAME 0.1 m step the existing curvature() uses, so all three components share one convention:
     (S(x+h,y+h) - S(x+h,y-h) - S(x-h,y+h) + S(x-h,y-h)) / (4 h^2)
2. Add physics.principal_strain(x, y, t, panel, params) -> (e1, e2, theta_deg).
   Build the 2x2 strain tensor as eps_ij = B * d2S/dx_i dx_j with B = r/sqrt(2*pi), exactly the b_factor already in displacement() — import it, do not rewrite the expression in a second place.
   e1 = major principal strain (most tensile), e2 = minor, theta_deg = direction of e1 measured counter-clockwise from +x. Standard closed form from the tensor components; no eigen-solver call per point, it is 2x2.
   Units: microstrain, positive = tension, matching strain().
   Keep it vectorised over x and y like every other function in the module.
3. Sanity assertions to put in test_physics.py: on the panel centre-line (y = 0) theta is 0 or 90 deg to within 1e-6 and e1/e2 match the existing axis-aligned strain(); at a panel corner theta is NOT axis-aligned; e1 >= e2 everywhere; the tensor trace equals B*(curv_x + curv_y).

B. Surface cracks — new module minesim/cracks.py
A crack opens perpendicular to e1 where e1 exceeds the ground's tensile capacity.
1. crack_state(x, y, t, cfg, previous) -> per-cell: is_cracked (bool), width_mm, azimuth_deg, first_cracked_day.
2. Width: width_mm = max(0, e1 - e_threshold) * 1e-6 * crack_spacing_m * 1000.0
   i.e. the tensile extension accumulated over one crack spacing localises into one crack. crack_spacing_m is the explicit replacement for the old sandbox's hidden 2.0. Write the derivation as a comment; this is the number the whole crack scale hangs on.
3. Azimuth: the crack runs PERPENDICULAR to e1, so azimuth_deg = theta_deg + 90.
4. LATCH IT. Once a cell has cracked it stays cracked for the rest of the run and first_cracked_day is never rewritten. width_mm may shrink but never below partial_closure_fraction * its own recorded maximum: a crack that opens in the tensile zone ahead of the advancing face partially closes as the compressive zone passes over it, but it does not heal. Record max_width_mm alongside the current width — the maximum is what a field crew measured, the current value is what they would see today, and both are wanted.
5. Config, in config/assumptions.yaml under a new `cracks:` block:
     tensile_strain_threshold_ue: 3000.0   # OPEN — VERIFY: first visible surface fissure; literature spread for cohesive cover is ~2000-5000 ue and it falls with thinner/weathered cover. Adriyala cover is not characterised in the JMMF paper.
     crack_spacing_m: 8.0                  # OPEN — VERIFY: spacing between successive tension cracks in the tensile zone. Replaces the old sandbox's undocumented 2.0 m.
     partial_closure_fraction: 0.35        # OPEN — VERIFY: residual opening once the compression zone has passed.
   Every one of these three keeps its "OPEN — VERIFY" text. They are placeholders with a rationale, not measurements, and they must read that way to anyone who opens the file.
6. B-sensitivity: expose cracks.width_sensitivity(...) returning the width recomputed at B = 0.35r and B = 0.40r as well as the shipping B = r/sqrt(2pi). The renderer and any report must be able to show the band. Do not present a single crack width as if it were certain.

C. Structure damage — in cracks.py, separate from ground cracking
These are two different scales and the old sandbox conflated them. Classify by NCB change of length = e1 * structure_length_m, NOT by raw strain:
     < 30 mm negligible · 30-60 very slight · 60-120 slight · 120-180 appreciable · 180-300 severe · > 300 very severe
1. damage_grade(e1_ue, structure_length_m) -> one of those six strings.
2. Config `damage:` block with the six edges in mm and the comment "# source: NCB Subsidence Engineers' Handbook change-of-length classification. OPEN — VERIFY edition and exact edges against the printed table."
3. default_structure_length_m: 10.0  # OPEN — VERIFY: assumed single-storey masonry dwelling frontage.
4. No structures are placed in this step. damage_grade is a pure function; siting buildings on the terrain is W6's job.

D. Vibration — new module minesim/vibration.py
Three sources, each with its own frequency band, ALL attenuating with distance. The old sandbox gave every node in the mine the same PPV regardless of where it stood, which makes the channel useless for locating anything — and locating things is the entire reason there are 375 nodes.
1. ppv_mm_s(node_x, node_y, source) -> peak particle velocity at that node, mm/s.
   Blast: the standard scaled-distance law PPV = K * (D / sqrt(W)) ** (-B_att), D = 3-D slant distance in m, W = maximum charge per delay in kg.
     blast_k: 800.0        # OPEN — VERIFY: site constant, Indian coal measures spread ~400-1200
     blast_b: 1.5          # OPEN — VERIFY: site exponent, typical 1.4-1.6
   Longwall is mechanised, not blasted, so a blast source here is a development heading or a neighbouring opencast — put that sentence in the module docstring so nobody later "fixes" the model by attaching blasts to the longwall face.
   Caving / periodic weighting: microseismic, tied to face advance, NOT to a button. First main fall after first_fall_advance_m of face advance, then an event every periodic_weighting_interval_m thereafter. Source located at the current face. This one is genuinely driven by the simulation we already have, so it is the channel worth having.
     first_fall_advance_m: 40.0              # OPEN — VERIFY
     periodic_weighting_interval_m: 20.0     # OPEN — VERIFY
     caving_ppv_at_100m_mm_s: 0.8            # OPEN — VERIFY
   Machinery: a steady background floor, no event structure.
2. dominant_frequency_hz(source) using the old sandbox's bands, which are sound: truck 8-20, conveyor 49-51, blast 40-80, microseismic 100-250.
3. dgms_limit_mm_s(structure_class, f_dom_hz) -> the statutory limit, and exceeds_limit(...). DGMS limits are banded by dominant frequency, which is why (2) must exist before (3).
     # source: DGMS (Tech) Circular No. 7 of 1997. OPEN — VERIFY every number against the circular before this appears in any demo.
     domestic:   {"<8": 5.0,  "8-25": 10.0, ">25": 15.0}
     industrial: {"<8": 10.0, "8-25": 20.0, ">25": 25.0}
4. Coupling to cracks — exactly one rule, and it is deliberately narrow:
   a vibration event may EXTEND an existing crack, and may bring a cell that is already above trigger_fraction of the tensile threshold over it early. It may NOT create a crack in ground that is not already near failure, and it may NOT alter S, the world grid, or node Z. One config value:
     vibration_trigger_fraction: 0.8   # OPEN — VERIFY
   If you cannot implement this without touching S, STOP and say so rather than finding a way.

E. Telemetry
1. Add to sensors.Reading, following the existing Value/provenance pattern and the contract's null rule — a channel a tier does not carry is None, never 0:
   1B gains fissure_mm (from cracks.crack_state at the node's position) and crack_flag (0 none / 1 open / 2 beyond threshold).
   1A, 1B, 1C gain vib_rms_mm_s, vib_peak_mm_s, vib_fdom_hz.
2. Run the whole pipeline through apply_sensor exactly as the existing channels do: ideal -> quantise -> bias -> temperature drift -> noise, in that order (contract section 5). No smoothing, no filtering, no alarm logic anywhere in minesim — Invariant 3. exceeds_limit returns a boolean for a consumer to act on; it must not gate, suppress or rewrite a reading.
3. Do not change the uniaxial strain sensor. A rod extensometer physically measures one axis and strain_axis() already models that correctly. Principal strain is GROUND TRUTH feeding the crack model; it is not what the hardware reports. Keep the two apart.

Tests: test_cracks.py — width is zero below threshold and linear in (e1 - threshold) above it; the latch survives the compression zone passing over (walk t forward past the face and assert is_cracked stays True and width never drops below partial_closure_fraction * max_width); azimuth is perpendicular to e1 to within 1e-6; damage_grade returns each of the six grades for a hand-computed change of length; width_sensitivity spans at least 10% between B = 0.35r and B = 0.40r.
test_vibration.py — PPV falls monotonically with distance and matches a hand-computed scaled-distance value at one point; two nodes at different distances from the same blast get different PPV (this is the old model's defect, so assert against it directly); caving events occur at the expected face advances; each source lands in its own frequency band; the DGMS limit changes with the frequency band.
test_physics.py — the four principal-strain assertions from A3.
REGRESSION, and this is the one that matters most: every existing subsidence, tilt, curvature, strain and fitting test must still pass UNCHANGED. If you had to edit one of them, STOP and tell me which and why — that means this step moved a fitted number, which it must not.

Then: full re-run and re-export, report the exact pytest count before and after, and produce walkthroughs/step-f10-cracks/WALKTHROUGH.md with a plan view at day 345 showing the crack set around the panel with azimuths, and a PPV map for one blast at a stated location and charge.
```

## 2 · Paste into Claude (check)

```text
Check step F10.
```

Claude verifies: `physics.subsidence()`'s body is byte-identical to before; no fitted parameter moved; `git diff` touches no test that existed before this step; the strain tensor uses the same `b_factor` expression as `displacement()` rather than a second copy; every "OPEN — VERIFY" comment survived; nothing imports from the old `simulation/` tree; vibration writes nothing into `S`, the world grid or node Z; the crack latch holds across the compression zone; NCB grading is on change of length and not on raw strain; no alarm or filtering logic entered `minesim/` (Invariant 3); exact pytest counts before and after.

## 3 · You check by hand

1. Open the walkthrough plan view. Cracks should form a **ring** around the panel — along both rib lines and an arc ahead of the advancing face — not a solid fill over the trough. The trough floor is in *compression*; if it is covered in cracks, the sign is inverted somewhere.
2. Crack azimuths along the rib lines should run roughly parallel to the ribs. At the panel corners they should visibly swing off-axis. That swing is the whole point of part A.
3. On the PPV map, a node near the blast and a node 1 km away must read different numbers.
4. Check the three crack config values still say "OPEN — VERIFY". If any of them has quietly become a bare number, that number is now pretending to be a measurement.

## 4 · Fix prompt (only if Claude's check found problems)

```text
Fix step F10: <paste Claude's findings>. Same file list and same hard rules as the F10 prompt. In particular do not resolve anything by editing physics.subsidence() or a fitted parameter. Re-run the full suite and report exact counts.
```
