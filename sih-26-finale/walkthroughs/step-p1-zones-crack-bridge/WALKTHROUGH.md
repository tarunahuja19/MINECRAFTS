# P1 — Zones, and one crack model shared with the simulator

**Branch:** `feat/p1-zones-and-crack-bridge` · **Built by:** Claude, 17 Sep 2026 (session 26)
**Plan:** [`steps/P1-zones-and-crack-bridge.md`](../../steps/P1-zones-and-crack-bridge.md) · **Shape:** [`steps/S0-terrain-events-plan.md`](../../steps/S0-terrain-events-plan.md)

**Tests: 70 passed** in `scenario-lab` (was 42 — 28 new). `mine-sim` untouched, so its 198 passed / 1 skipped stands.

---

## 1 · What you can do now that you could not before

Pick a zone and ask what the ground there is doing. There is no window yet — that is P4 — so this is the command-line version:

```bash
cd scenario-lab
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m lab.tools.show_zone \
    --run ../mine-sim/out/v2-690d --day 300 --zone 5
```

```
run 1a6a9a3a  mine adriyala_lw1  day 300  face at x = 1200 m  grid (617, 167) at 5 m

Zone 5 — 1000 to 1250 m along the panel
  bounds            x     1000 ..     1250 m   y     -125 ..      125 m
  centre            (1125, 0) m     boundary fade 146 m
  cells             2500  (0.062 km2 at 5 m)
  sinking           max 648 mm   mean 161 mm  (positive = down)
  tilt              max 5.91 mm/m
  principal strain  max +3.78 mm/m tension   min -0.95 mm/m
  cracked now       113 of 2500 cells (4.5%), threshold 3.0 mm/m
  widest crack      6.2 mm (spacing 8 m)
  crack bearing     25 deg median, 15 .. 165 deg spread
  NCB damage        negligible: 2387, very slight: 113
  worst grade       very slight (over a 10 m frontage)
```

`--zone full` for the whole district, `--all` for every zone in turn.

---

## 2 · The check to do by eye — every zone at day 300

This is the one to look at. On day 300 the face has travelled to **x = 1200 m**, and zone 5 runs 1000–1250 m. Nothing here was tuned to produce this; it falls out of the physics.

| zone | x range | possible? | max extra sinking | what it says |
|---|---|---|---|---|
| 1 | 0–250 m | no | — | *already settled (3.0 mm left, below the 10 mm we can call a change)* |
| 2 | 250–500 m | yes | 21 mm | nearly finished |
| 3 | 500–750 m | yes | 93 mm | |
| 4 | 750–1000 m | yes | 407 mm | |
| 5 | 1000–1250 m | yes | **680 mm** | at the face — most left to give |
| 6 | 1250–1500 m | no | — | *no extracted coal under this spot, nothing to collapse into* |
| 7–10 | 1500–2500 m | no | — | same — the face has not reached them |
| full | whole district | yes | 347 mm | |

**Read it as a story:** zone 1 was mined 300 days ago and has finished moving. Zones 2→5 ramp up 21 → 93 → 407 → 680 mm as you walk towards the face, which is the settlement gradient behind a travelling longwall. Zones 6–10 are ahead of the face, where there is no void to collapse into, so the honest answer is *not possible* rather than *zero*.

**If any of that table looked different, the maths would be wrong.** That is what makes it worth checking by eye.

> **Note on `full`:** the radius still applies, as you asked ("use the radius tech for subsidence"). `full` means the effect is not confined to a sub-zone, not that the whole district drops at once. Its 347 mm comes from the click defaulting to the grid centre (1250, 0), which sits right at the face edge.

---

## 3 · The maths problem this part existed to solve

### 3.1 A zone mask is a cliff, and a cliff is a fake crack — measured

The obvious way to build "only inside zone 5" is a boolean mask. It is wrong, and wrong in a way that would have looked convincing on screen.

Everything downstream takes derivatives of the scenario surface — tilt is the first, curvature the second, strain is B × curvature. A boolean mask leaves a **vertical step** at the zone boundary, so those derivatives see a cliff. Measured on the 690-day run at day 300, zone 5, with the same 100 mm of extra sinking confined two ways:

| confinement | peak tensile strain just outside the zone | cracks? |
|---|---|---|
| true ground (no event) | **5.28 mm/m** | yes — the panel edge genuinely cracks |
| raised-cosine zone weight | **5.28 mm/m** | unchanged — the confinement is invisible |
| **boolean mask** | **95.95 mm/m** | **18× the true value, 32× the 3.0 mm/m threshold** |

So a boolean zone mask draws **a crack around the outline of whichever zone you picked** — a tidy rectangle of cracking that is an artefact of the menu control, not of the ground. A zone is therefore a **weight in [0, 1]**: 1 inside, raised cosine to 0 over the influence radius outside, using the same `taper` the events already use for the same reason.

This is gate **L8-4**, and it asserts against the *true rim value*, not against the threshold — because the panel edge is already over the cracking threshold before any scenario, so "hard > threshold" would have passed even if the mask did nothing.

### 3.2 One crack model, and proof that it is one

Per your decision (*"the maths and simulation, it's on you"*), the lab does **not** get its own crack model. `lab/cracks.py` is a bridge: it re-exports `minesim.cracks` and adds exactly one thing of its own — the µε ↔ mm/m conversion, which was the silent factor of 1000.

The proof is gate **L8-1c**, which compares two genuinely different routes to the same answer:

- the **lab**: differentiate a *surface* on the 5 m grid → principal strain
- the **simulator**: `physics.principal_strain` *analytically* on the 10 m grid, as written to `out/cracks/crack_field_day0690.npz`

| | result |
|---|---|
| overlapping cells | 25,564 |
| relative difference in major principal strain | **median 0.58 %**, p95 1.7 %, max 2.2 % |
| cracked / not-cracked call | simulator 4,675 cells · lab 4,672 cells |
| cells that disagree | **3 of 25,564 (0.01 %)** — all sitting on the threshold |

Two models, two grids, one answer. That is the assertion that would have caught the whole H1–H8 family at once, and it is the one that keeps catching it.

### 3.3 The missing cross-derivative, on the lab side

`lab/fields.py` computed `strain_x` and `strain_y` but had no `strain_xy`, so it could not form the strain tensor and had no principal strain — which is to say, no crack direction. Added, along with `principal_from_fields()`, the gridded twin of `physics.principal_strain`.

This matters where the trough is doubly curved. Gate **L8-1b** pins it: the principal axes rotate away from the centre-line at the panel corners, which is where field crews record the worst cracking. On the centre-line the term is ~0 and costs nothing — which is exactly why its absence went unnoticed.

---

## 4 · What was built

| File | What |
|---|---|
| `scenario-lab/config/zones.yaml` | `n_zones: 10`, slice axis, boundary fade (defaults to r), `full` id — each with a `source:` |
| `scenario-lab/lab/zones.py` | `Zone`, `zones_for`, `zone_by_id`, `zone_weight`, `resolve_click`, `confine_to_zone` |
| `scenario-lab/lab/cracks.py` | the bridge to `minesim.cracks` + the one unit conversion. **No formula of its own** |
| `scenario-lab/lab/fields.py` | `strain_xy_mm_per_m`; `principal_from_fields()` |
| `scenario-lab/lab/events/base.py` | `EventResult.zone_id` |
| `scenario-lab/lab/tools/show_zone.py` | the command in §1 |
| `scenario-lab/tests/gates/test_l8.py` | **gate L8**, 10 tests |
| `scenario-lab/tests/test_zones.py`, `test_zone_confined_event.py` | 18 tests |

Gate **L4** (no magic numbers) caught three literals in my own `show_zone.py` — a `100` for percent, and `90`/`180` for the crack bearing. They were replaced with definitions (`HALF_TURN_DEG = degrees(π)`), **not** by adding them to the allow-list or exempting the directory. The gate was right.

---

## 5 · What P1 deliberately did not do

- **No `consequence.py`, no objects, no houses or roads** — P2.
- **No crack *event*** — P2. P1 gives the crack *field* of a frozen day.
- **No blast** — deferred, as you said.
- **No server, no page** — P3, P4.
- **`out/cracks/` is still not rebuilt by `run-simulation.sh`.** Gate L8-1c *skips* when it is missing, which after a full rebuild it is. That skip is a known gap, not an accepted one — **S7** closes it.

---

## 6 · How to check it yourself

```bash
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q      # expect 70 passed
/opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m lab.tools.show_zone \
    --run ../mine-sim/out/v2-690d --day 300 --all                                     # the §2 table
```

Then say whether the §2 table reads right to you, and I will start **P2** on its own branch.
