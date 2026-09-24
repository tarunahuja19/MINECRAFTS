# Real-anchored survey-line dataset (v2)

**One row per survey monument per day, days 0–690, on Adriyala survey line S. 33,168 rows, 48 monuments.**
Built by `mine-sim/scripts/build_anchored_dataset.py` (2 s). For the ML team: this shows what a field-anchored dataset looks like and which columns can honestly be filled from how little data.

## The rule

1. **A value that exists in the field data is never changed.** The 283 digitised measurements (48 monuments × 6 survey days) appear exactly as digitised, tagged `real`.
2. **A missing value is derived from the values that exist**, in two layers:
   - *Physics:* the fitted Knothe model (`physics.subsidence`, RMS 52 mm against those same 283 points).
   - *ML:* a Gaussian process learns what physics gets wrong (measured − physics) across position and time, and gives an uncertainty. Its correction is scaled by how far the ground has developed, so nothing moves before the face arrives.
3. **Everything else follows from subsidence** by the Knothe relations: tilt = dS/dy, curvature = d²S/dy², horizontal movement U = B·tilt (B = r/√2π), strain = dU/dy over the 10 m rod.

## Does the ML layer help? (leave one survey day out)

Hide one survey day, rebuild from the other five, predict the hidden day:

| Held-out day | Physics only | Physics + GP |
|---|---|---|
| 210 | 56.9 mm | 42.7 mm |
| 300 | 52.1 | 39.5 |
| 540 | 46.3 | 28.2 |
| 570 | 46.3 | 28.7 |
| 600 | 46.3 | 29.5 |
| 690 | 62.5 | 51.4 |
| **All** | **52.1** | **37.7** (28% lower) |

GP settings learned from the data: correlation length 20 m across the panel (floored at two monument gaps — below that it fit digitisation wiggles), 768 days in time, noise 35 mm (≈ digitisation error). Full numbers: `validation.json`.

## Columns

| Column | Unit | Provenance | Built from |
|---|---|---|---|
| `day` | days since the face started at x = 0 | — | — |
| `monument_distance_m` | m, as in the paper | — | measured frame (origin = trough minimum) |
| `y_panel_m` | m from panel axis | — | `monument_distance_m − 13.47` (fitted origin offset) |
| `x_line_m`, `face_x_m`, `face_ahead_of_line_m` | m | — | geometry (face 4 m/day; line at 258 m is fitted, OPEN) |
| `subsidence_mm` | mm, **negative = down** | `real` on survey days, else `pinned` | measured / physics + GP |
| `subsidence_basis` | text | — | `measured: JMMF 2022 digitised` or `physics fit + GP correction` |
| `subsidence_sigma_mm` | mm, 1σ | — | GP uncertainty (0 for measured) |
| `subsidence_rate_mm_per_day` | mm/day | synthetic | day-to-day change of the derived surface |
| `tilt_y_urad` | µrad, + = surface rises toward +y | synthetic | derivative of the derived surface |
| `curvature_y_per_km` | 1/km | synthetic | second derivative |
| `disp_y_mm` | mm, + = toward +y | synthetic | U = B·tilt |
| `strain_y_ustrain` | µε, + = tension | synthetic | dU/dy over 10 m |
| `tilt_y_physics_urad`, `strain_y_physics_ustrain` | as above | synthetic | physics model only, for comparison |
| `tilt_x_urad` | µrad | synthetic | physics model only — nothing was surveyed along the panel |

Provenance uses only the contract's three tags (invariant 6); `*_basis` says what a value is built from, so a derivative of real data is not mistaken for noise.

## Read this before using the numbers

- **Subsidence: 283 real + 32,885 pinned, 0 synthetic.** Before day ~60 values are physics only (σ = 0 because D(t) = 0; no survey constrains them).
- **Strain and tilt are uncertain by up to ~2×.** From the data-anchored surface, centre compression is −22,000 µε; physics alone says −13,000 µε. A digitised profile with 10 m spacing and 35 mm noise cannot pin curvature more tightly. Both columns are there so you can see the spread.
- **Ground only sinks:** 2,438 derived values (7%) rose by 0.1–3.75 mm from one day to the next and were held at the previous value. Measured values are never adjusted, so a `real` row can sit up to ~2σ off the derived curve.
- The survey line position (258 m) and the settling rate are fitted together and trade off; the paper's layout figure would fix both.
