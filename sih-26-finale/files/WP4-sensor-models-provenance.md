# WP4 — Sensor Models and Provenance

| | |
|---|---|
| **Owner** | Antigravity (Lane C) |
| **Depends on** | WP3 |
| **Blocks** | WP5 |
| **Days** | D4–D6 |
| **Gates** | G4, G5 |

## Goal

Turn "the ground here moved 3.2 mm" into "this specific cheap sensor, with its specific noise, drift and resolution, reported this number" — and tag every single value with where it actually came from.

## Files owned

```
src/minesim/sensors.py
src/minesim/provenance.py
tests/unit/test_sensors.py
tests/gates/test_g04.py
tests/gates/test_g05.py
```

## Why provenance is load-bearing

Part 2 trains a forecasting model on this output. Without provenance tags, that model cannot tell a measured value from an interpolation from pure simulator noise — it weights them equally and learns our simulator instead of the ground. The tag is what lets Part 2 weight `real` values in its loss and refuse to fit `synthetic` ones as if they were ground truth.

Get this wrong and every downstream number is untrustworthy in a way nobody can detect by looking at it.

## The three tags

Binding. There is no fourth tag and no `unknown`. A `Value` that cannot be assigned one of these three is a bug and should raise `ProvenanceError`.

| Tag | Assigned when |
|---|---|
| `real` | The value **is** a digitised field measurement — a monument position, at a monument epoch, from `data/real/*.csv` |
| `pinned` | Model output whose parameters were fitted to real measurements, evaluated where real data exists |
| `synthetic` | Everything else — spatial interpolation between monuments, temporal interpolation between epochs, all derivatives, all noise, all drift, all battery modelling |

### What this means concretely

The real monuments sit at 30 m spacing and were read at 30-day intervals. Our nodes sit at 50 m spacing and report every 60 s. So:

- A node that happens to land on a monument position, at a timestep that lands on a monument epoch → `real`
- A node on a monument position at an off-epoch time → `pinned`
- Everything else → `synthetic`

Expect the `real` fraction to be **small**, likely a few percent. That is the honest number and it should be reported in the pitch, not hidden. A system claiming 100% real data from a simulator is lying.

**Every tilt, strain and displacement value is `synthetic`, always.** No real strain or tilt time series exists for the Adriyala surface — those readings are derivatives of a fitted surface. Say so.

## Sensor models

Applied in this order. Every step after the first is `synthetic`.

```
physics ideal value  →  resolution quantisation  →  bias  →  temperature drift  →  Gaussian noise
```

| Tier | Sensor | Measures | Notes |
|---|---|---|---|
| 1A | MPU-6050 | tilt x, y (microradians) | **Largest drift term by design** |
| 1B | Foil strain gauge on 10 m rod (A8) + slide potentiometer | strain (microstrain), displacement (mm) | Strain is a finite difference over the 10 m baseline |
| 1C | Wire extensometer, 30 m baseline (A9) | strain (microstrain) | Finite difference over 30 m |

All tiers also report subsidence (derived from `world.z_at` against `z0`) and battery voltage.

### Tilt is a secondary signal, never primary

Consumer MEMS tilt chips drift with temperature by **more than the subsidence signal is worth**. Model that drift honestly — do not make tilt look better than it is to produce a cleaner demo. Strain and displacement are the primary detection modalities.

Related, and this is a note for Part 2 rather than something to implement here: common-mode rejection is applied **after** computing σ, not before.

### Parameters

Noise σ, bias and drift coefficients per tier go in `config/assumptions.yaml` under a new `sensors:` block. They are guesses until someone benchmarks real parts — mark them OPEN in the register and add them to Open Decisions. No literal in `src/`.

Use `cfg.sim.rng_seed` for a seeded `np.random.Generator`. Same seed, same config, byte-identical output — that is what makes Part 2's A/B tests meaningful.

## Tests

| Test | Assertion |
|---|---|
| Every value tagged | No `Value` exists without a valid tag |
| Tag correctness | A node placed at a known monument position and epoch gets `real`; move it 5 m and it gets `pinned` or `synthetic` |
| Derivatives synthetic | Every tilt, strain and displacement value is `synthetic`, in every run |
| Tier fields | 1A has tilt and no strain; 1B has strain and displacement; 1C has strain and no displacement |
| Noise is noise | Two reads at the same point and time with different RNG draws differ |
| Reproducibility | Same seed, same config → identical readings |
| Drift dominance | Over a full run, tilt drift magnitude exceeds the tilt signal for a low-gradient 1A node — the honest result, and the reason tilt is secondary |
| Baseline effect | A 1C node's 30 m strain differs from the same position modelled at 10 m |

### `tests/gates/test_g04.py`

Every value column in `nodes.csv` has a populated paired `_prov` column. Not just present — populated, with one of exactly three allowed strings. Run over a full simulated run, not a single row.

### `tests/gates/test_g05.py`

The hard one. Assert no `synthetic` value is generated from anything other than observed data behaviour. Practically:

- Every `synthetic` value traces back through a call chain to `physics` evaluated with **fitted** parameters, or to a noise model whose parameters are in config.
- No value is generated from a hardcoded constant, a made-up trend, or a random walk with no physical basis.
- Implement as a provenance-chain assertion: each `Value` carries enough origin information for the test to verify its ancestry.

A useful concrete form: assert that a run performed with a **deliberately wrong** fitted parameter set produces measurably different `synthetic` values. If it does not, those values were not derived from the fit and the tag is a lie.

## Definition of done

- [ ] All tests pass
- [ ] G4 and G5 pass over a full run
- [ ] `real` / `pinned` / `synthetic` fractions reported at the end of a run — that number goes in the pitch
- [ ] Sensor parameters live in config, nothing in `src/`
- [ ] Seeded runs reproduce byte-identically
- [ ] Tilt drift modelled honestly, not flattered

## Do not

- Invent a fourth tag, or an `unknown` fallback.
- Tag a derivative of a fitted surface as `real`.
- Reduce tilt drift to make the demo cleaner.
- Reimplement any physics. Call `physics`. Invariant 4.
- Add alarm logic, thresholds, or any judgement about whether a reading is dangerous. Part 2 owns the detector, and no neural network goes in the safety path. Invariant 3.
- Filter, smooth or clean readings before emitting them. Part 2 wants the raw mess, including gaps.
