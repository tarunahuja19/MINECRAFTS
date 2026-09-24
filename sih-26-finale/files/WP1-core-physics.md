# WP1 — Core Physics `S(x,y,t)`

| | |
|---|---|
| **Owner** | Claude Code (Lane B) |
| **Depends on** | WP-C |
| **Accepted against** | WP0 (code may proceed on defaults; acceptance waits for real params) |
| **Blocks** | WP2, WP3 |
| **Days** | D1–D2 |
| **Gates** | G1 |

## Goal

One module that answers "how far has the ground moved at this point at this time", and every derivative of that answer. Everything else in the repository calls into it.

## Files owned

```
src/minesim/physics.py
tests/unit/test_physics.py
tests/gates/test_g01.py
```

## The single-implementation rule

`physics.py` holds **the only implementation of `S(x,y,t)` in the repository.** Tilt, curvature, strain and displacement are all derived numerically from `subsidence`. Do not write a second closed form for any of them, however tempting the algebra — a hand-derived tilt formula that drifts out of sync with the subsidence formula is the exact failure G1 exists to catch, and it fails silently.

## Model

Knothe influence function over a rectangular panel, erf closed form for the transverse profile, with a time factor for the settling tail.

Coordinate frame: origin at the starting face centre. `+x` is the advance direction along the panel axis. `+y` is transverse, positive toward the tailgate. `z` positive up. **`subsidence` returns millimetres, positive downward.**

Three components compose:

1. **Transverse profile** — erf-based, spanning `width + 2r` where `r = depth / tan_beta`.
2. **Longitudinal profile** — the travelling front, with the face at `face_position(t)` and a settling tail behind it.
3. **Time factor** — Knothe `1 - exp(-c·t)`, `t63 = 1/c`.

### Subcritical correction

**Peak subsidence is not `a · m`.** The panel is subcritical: 250 m is narrower than the 187.5 m influence radius, so the trough never reaches full depth. Under the pre-WP0 defaults, `a·m = 1800 mm` but actual peak is **1630 mm**. The correction must be computed from geometry, not hardcoded — after WP0 repins `a` and `m`, both numbers change and the test must follow.

## Signatures

Exactly as in `11-interface-contracts-v1.md` §2. Restated for convenience; the contract wins on any difference.

```python
def subsidence(x, y, t_days, panel, params) -> float | np.ndarray
def tilt(x, y, t_days, panel, params) -> tuple[..., ...]          # microradians
def curvature(x, y, t_days, panel, params) -> tuple[..., ...]     # 1/km
def strain(x, y, t_days, panel, params, baseline_m, axis) -> ...  # microstrain
def displacement(x, y, t_days, panel, params) -> tuple[..., ...]  # mm
def face_position(t_days, params) -> float                        # m
```

All must vectorise over numpy arrays of `x` and `y`. WP3 evaluates them across a full grid every timestep; a scalar-only implementation will be too slow to run 690 days.

### `strain` is a finite difference, not a derivative

A 10 m rod and a 30 m wire measure stretch **across a baseline**. Compute `strain` as `(S(p + b/2) - S(p - b/2)) / b`-style finite difference over `baseline_m`, not as a point derivative. Over the high-gradient band the two differ materially, and the finite difference is what the hardware actually reports.

## Tests

`tests/unit/test_physics.py`. **Expected values are read from the config, not hardcoded** — after WP0 repins the parameters, these tests must still pass without editing.

| Assertion | Check |
|---|---|
| Zero at t=0 | `subsidence(x, y, 0) == 0` everywhere |
| Peak location | Maximum sits at the panel centre transversely |
| Subcritical peak | Peak at `t → ∞` equals the geometry-derived value, not `a·m` |
| Edge decay | `subsidence` at `y = ±(width/2 + r)` is ≈ 0 |
| Symmetry | `S(x, y) == S(x, -y)` to float tolerance |
| Monotone in time | `S(x, y, t₂) ≥ S(x, y, t₁)` for `t₂ > t₁` at fixed `x` |
| Tilt zero at centre | `dS/dy == 0` on the panel centreline |
| Tilt peak at inflection | `|dS/dy|` maximises near the inflection point |
| Strain sign flip | Tensile outside the inflection, compressive inside |
| Vectorisation | Array input returns an array of matching shape, equal elementwise to scalar calls |
| Baseline sensitivity | `strain` with `baseline_m=30` differs from `baseline_m=10` in the high-gradient band |

### `tests/gates/test_g01.py`

Static check: exactly one definition of the subsidence formula exists in `src/`. Implement by AST-walking `src/minesim/`, collecting function definitions whose body references `erf` or the characteristic Knothe expression, and asserting the count is one and that it lives in `physics.py`.

## Definition of done

- [ ] All six functions implemented and vectorised
- [ ] Every unit test above passes, with expected values read from config
- [ ] G1 passes
- [ ] Grid evaluation of `subsidence` over a 625 × 800 m area at 5 m cells completes in under 50 ms — WP3 calls this thousands of times
- [ ] No numeric constant from the assumption register appears in the file
- [ ] Re-running the suite after WP0 repins `a` and `m` requires no test edits

## Do not

- Write a closed-form tilt, curvature or strain function.
- Hardcode 1630, 1800, 187.5 or 625 anywhere.
- Add asymmetric angle-of-draw handling for the 10° seam inclination. The symmetric residual is expected, WP0 reports it, and asymmetry is a v2 item.
- Add alarm logic, thresholds, or anything that decides whether a movement is dangerous. That is Part 2's detector.
- Build a PINN or any learned surface. Invariant 2.
