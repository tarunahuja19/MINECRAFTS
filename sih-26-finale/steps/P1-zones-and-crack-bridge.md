# P1 — Zones, and one crack model shared with the simulator

**Branch:** `feat/p1-zones-and-crack-bridge` · **Built by:** Claude (Adarsh asked for the code this time)
**Written:** 17 Sep 2026 (session 26). **Part 1 of 6** — see [S0](S0-terrain-events-plan.md) for the whole shape.

**In plain words:** before there is a window to click in, the lab has to know (a) what a **zone** is, so you can pick 1–10 or the whole mine instead of hunting for a pixel, and (b) what a **crack** is — using the simulator's own crack maths, not a second copy of it.

---

## 0 · What Adarsh decided (session 26), and what follows from it

| Decision | Answer | What it changes |
|---|---|---|
| **D-S1** — one crack model or two? | *"the maths and simulation, it's on you"* → **one.** The lab imports `minesim.cracks` and `minesim.vibration`. | `lab/cracks.py` is a bridge, not a model. WP9 §6 amended. |
| **D-S3** — which damage scale? | **NCB** (the simulator's). Follows from D-S1. | One scale on screen. |
| **D-S4** — blast constants | **Deferred.** *"blast keep it for afterwards."* | No blast event in P1–P4. Vibration still gets its layer, from caving, which our own face advance drives. |
| **D-S5** — where does it live? | **A new, separate window.** *"create a new window for it, where I can go and see simulation going on."* | Window 2 is its own page. Window 1 is untouched. |
| **NEW — zones** | *"first select the zone with 1 to 10 or full and then do it."* | Not in WP9. Added here. |
| **NEW — geometry** | *"use the radius tech for subsidence from beforehand, line for crack and vibration also that."* | Subsidence keeps the radius taper. Cracks are **line segments**, oriented by the principal-strain direction. Vibration is a distance field with contour **lines**. |

**Order of parts** (one branch each, checked before the next starts, merged at the end):

| Part | Branch | What you can check when it lands |
|---|---|---|
| **P1** *(this one)* | `feat/p1-zones-and-crack-bridge` | pick a zone, get its crack field, and it equals the simulator's |
| P2 | `feat/p2-consequence-and-events` | crack + vibration on a frozen day; houses/roads graded |
| P3 | `feat/p3-lab-server` | the server the page talks to, plus the safety gates |
| P4 | `feat/p4-window-2` | **the window** — pick a zone, run it, see before/after/difference |
| P5 *(tomorrow)* | `feat/p5-schemas` | the schemas pinned down |
| P6 *(tomorrow)* | `feat/p6-end-to-end` | frontend + backend wired, working end to end |

---

## 1 · The maths problem P1 exists to solve

### 1.1 A zone mask is a cliff, and a cliff is a fake crack

This is the whole reason zones need a plan rather than an `if`.

Pick zone 4 and drop the ground inside it. The obvious implementation is a boolean mask — `ds` inside the rectangle, zero outside. The surface then has a **vertical step at the zone boundary**. Everything downstream takes derivatives of that surface:

```
tilt      = first derivative   → a spike at the boundary
curvature = second derivative  → a much bigger spike
strain    = B × curvature      → far past the 3000 µε crack threshold
```

So a boolean zone mask draws **a crack around the edge of every zone you select** — a perfect rectangle of cracking that is an artefact of the UI control, not of the ground. It would look plausible on screen and it would be entirely false.

`lab/events/base.taper` already exists for exactly this reason, and says so in its docstring:

> *A raised cosine rather than a step so the ground does not gain a vertical cliff, which would give a fake infinite tilt and strain at the rim and light up every consequence downstream.*

**So: a zone is not a boolean. It is a weight field in [0, 1]** — 1 inside, raised cosine to 0 over a fade distance outside, using the same `taper` on the distance to the zone rectangle. The fade defaults to `r` (the influence radius, 146 m here), because that is the distance over which real subsidence effects die away anyway.

**This is tested, not asserted:** `test_hard_mask_would_fake_a_crack` builds both versions and shows the boolean one pushes peak strain past the crack threshold at the boundary while the tapered one leaves it at the unmasked value.

### 1.2 The crack model can't answer a "what if" as written

`minesim.cracks.CrackField.update(x, y, t_days, cfg)` recomputes strain **from the analytic model at (x, y, t)**. A scenario surface is one that no `t` produces, so `update` can never be called on it.

But the model is already split in the right place: `opening_mm(e1_ue, threshold_ue, spacing_m)` and `damage_grade(e1_ue, length_m)` take **strain as an argument**. What is missing is principal strain *from a gridded surface*. `lab/fields.py` computes `strain_x` and `strain_y` but has no `strain_xy`, so it cannot form the tensor.

**P1 adds the missing component and proves the two routes agree** (gate L8-1).

### 1.3 Microstrain vs mm/m

`mine-sim` speaks µε. The lab speaks mm/m. `1 mm/m = 1000 µε`. One conversion point, in `lab/cracks.py`, named, and round-tripped in a test. `1000` is already on gate L4's allow-list as the m↔mm conversion.

---

## 2 · What gets built

| File | New / changed | What it is |
|---|---|---|
| `scenario-lab/config/zones.yaml` | new | `n_zones`, how they slice, the boundary fade, all with `source:` |
| `scenario-lab/lab/zones.py` | new | `Zone`, `zones_for(cfg)`, `zone_by_id`, `zone_weight(zone, grid, fade_m)` |
| `scenario-lab/lab/fields.py` | changed | `strain_xy_mm_per_m` on `Fields`; `principal_from_fields()` |
| `scenario-lab/lab/cracks.py` | new | the bridge to `minesim.cracks` + the one unit conversion. **No formula of its own** |
| `scenario-lab/lab/events/base.py` | changed | `zone_weight` applied to `ds`; `EventResult` carries `zone_id` |
| `scenario-lab/lab/events/*.py` | changed | accept a zone instead of / as well as a bare click |
| `scenario-lab/tests/gates/test_l8.py` | new | **gate L8** — the lab and the simulator agree |
| `scenario-lab/tests/test_zones.py` | new | zone geometry, coverage, the cliff test |
| `scenario-lab/tests/test_cracks_bridge.py` | new | unit round-trip, identity of thresholds |

### Zone geometry

Zones slice the district **along x, the advance direction**, because that is the axis the face travels and therefore the axis along which the ground is at different stages of sinking. Zone 1 is the start-of-panel end, zone 10 the far end. Each spans the **full district width**, so `y_offsets_m` and `n_panels` need no special case.

```
zone k (1..n):  x from (k-1)·L/n to k·L/n,  y across the whole district
zone "full":    the entire grid
```

With `L = 2500 m` and `n = 10`, each zone is **250 m** long — the same as the panel width, so a zone is roughly square and roughly one trough-width across. That is a sensible unit to reason about, not an arbitrary one.

### What P1 deliberately does **not** do

- No `consequence.py`, no `objects.py`, no houses or grades — **P2**.
- No crack *event* — **P2**. P1 gives the crack **field** of an existing frozen day.
- No blast — deferred by Adarsh.
- No server, no page — **P3**, **P4**.

---

## 3 · Gate L8 — the check that keeps the two halves honest

| # | Assertion | Catches |
|---|---|---|
| L8-1 | `principal_from_fields` on a surface sampled from `physics.subsidence` matches `physics.principal_strain` in **magnitude and angle** | two crack models drifting apart |
| L8-2 | the unit round-trip mm/m ↔ µε is exact | the silent factor of 1000 |
| L8-3 | every threshold the lab reports **is the same object** as the one in `assumptions.yaml` — asserted by identity, never by copying the number into the test | someone editing one config and not the other |
| L8-4 | a hard zone mask pushes boundary strain past the crack threshold; the tapered one does not | the fake-crack cliff of §1.1 |
| L8-5 | zones tile the panel with no gap and no overlap; `full` covers every cell | a zone quietly losing ground |

*(L8's cell-for-cell comparison against `out/cracks/` needs `consequence.py` and the exported baseline — it lands in **P2**, together with S7.)*

---

## 4 · How you check it

```bash
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q
```

Expect the previous **42** plus P1's new tests, and gate L4 still passing (no new magic numbers).

Then, to see a zone's crack field as numbers rather than a promise:

```bash
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m lab.tools.show_zone --run ../mine-sim/out/v2-690d --day 300 --zone 5
```

It prints the zone's bounds, how much of it has cracked, the widest crack, the NCB grade spread, and the crack bearing — and the same numbers come out of `out/cracks/summary_day0300.json` for the overlapping cells.

---

## 5 · Status

**Built 17 Sep 2026. scenario-lab: 70 passed** (was 42). Results and the by-eye check:
[`walkthroughs/step-p1-zones-crack-bridge/WALKTHROUGH.md`](../walkthroughs/step-p1-zones-crack-bridge/WALKTHROUGH.md).

| Item | Written | Checked by Adarsh |
|---|---|---|
| zones.yaml + zones.py | ✅ | ⬜ |
| strain_xy + principal_from_fields | ✅ | ⬜ |
| cracks bridge | ✅ | ⬜ |
| events take a zone | ✅ | ⬜ |
| gate L8 (10 assertions, incl. the cell-for-cell check against `out/cracks/`) | ✅ | ⬜ |
| `show_zone` tool | ✅ | ⬜ |

**L8's cell-for-cell check landed in P1, not P2** — `out/cracks/` happened to be present for day 690,
so the comparison could be made now rather than promised. It skips when that export is missing, which
after a full rebuild it is, until **S7** wires `export_cracks.py` in.
