# Walkthrough — P2: consequences, objects, the crack event, the shaking layer

**Branch:** `feat/p2-consequence-and-events` · **Date:** 17 Sep 2026 (session 27)
**Step file:** [`steps/P2-consequence-and-events.md`](../../steps/P2-consequence-and-events.md) ·
**Progress:** [`steps/CHECKLIST.md`](../../steps/CHECKLIST.md)

**Numbers:** scenario-lab **125 passed** (was 70) · mine-sim **198 passed, 1 skipped** (unchanged) ·
renderer **19 passed** (untouched) · vault **PERFECT**. Raw output:
[`test_results.txt`](test_results.txt).

---

## 1 · What to look at first

P1 could say *"this ground is stretched 5.3 mm/m."* P2 says this
([`what_if_day345_zone6.txt`](what_if_day345_zone6.txt), trimmed):

```
SCENARIO (HYPOTHETICAL) — not a forecast, not sent to the backend or to any model
adriyala_lw1  ·  run 1a6a9a3a  ·  frozen at day 345  ·  face at 1380 m
Zone 6 — 1250 to 1500 m along the panel  ·  crack  ·  {'days_ahead': 45.0}

  crack history: 8836 cells already cracked at day 345

  CAN HAPPEN: sinking at 2.96 mm/day now, so 45 more days drops the ground within 150 m by up to 680 mm

  WHAT HAPPENS
    · the ground sinks up to 680 mm more, tilting up to 10.5 mm/m
    · 2233 cells crack that were not cracked before, the widest of them 58 mm
    · 4000 of 11097 crack lines are drawn — the widest ones
    · 3 of 19 things on the surface are worse off
    · shaking peaks at 0.11 mm/s against a 15 mm/s limit for houses

  CRACKS  (threshold 3.0 mm/m, one fissure per 8 m of stretched ground)
    open after: 11408 cells · new: 2233 · widest: 58 mm · lines drawn: 4000 of 11097
         58 mm at (1160, -2) m, running 90° — NEW

  SHAKING  peak 0.11 mm/s at 175 Hz · limits {'domestic': 15.0, 'industrial': 25.0} · over the domestic limit: False

  WHAT IS BUILT ON IT
    · House H5 (brick): damage stays appreciable — walls change length by 121 mm over a 10 m frontage…
    · House H7 (brick): damage stays slight — walls change length by 99 mm over a 10 m frontage…
    · Road R1: widest crack in the road 37 mm (was 5 mm); the road tilts 10.4 mm/m…
    · transmission tower: top moves 5 mm sideways (was 5 mm) on a 30 m pole…

  (illustrative, not the real Adriyala surface)
```

**Read that carefully, because it is less dramatic than it could have been made to look.** In zone 6
at day 345, **no house changes damage grade** — H5 was already "appreciable" and stays there. The
three things that get worse are Road R1 (its crack goes 5 mm → 37 mm) and two poles. The houses in
this illustrative village sit where the trough has already done its work; the scenario deepens ground
that was mostly already damaged.

That is the honest answer for this zone and this day, and it is the kind of answer that has to survive
being unexciting. A version of this tool that moved a house from "negligible" to "severe" on every
click would be more impressive and would be lying.

Where grades **do** move is earlier in the run, when the face is still approaching the village —
day 172, zone 3, 60 days ahead ([`what_if_day172_zone3_grades_move.txt`](what_if_day172_zone3_grades_move.txt)):
**6 of 19** things worse off, and four houses change grade, H1/H2/H3 negligible → very slight and H5
negligible → slight. That is the same code and the same thresholds; the difference is that this ground
had not been damaged yet.

Three things below are worth your attention, and one of them is a refusal.

---

## 2 · The crack lines run the way the ground tore

Every crack comes back as a **line segment** with a bearing, not a coloured square — your ask from
session 26. The bearing is not decoration: a fissure opens **perpendicular** to the direction the
ground is being pulled, so the bearing is the principal-strain direction turned a quarter turn.

At (1160, −2) m the lines run **90°**, i.e. straight across the panel. That is the transverse tension
front travelling with the face, which is where longwall cracking is actually recorded — so the
picture should read as bands across the panel, not a random scatter.

**How I know it is not just plausible:** gate **L8-7** compares every drawn line against the
principal-strain direction the simulator itself exported, independently, from the analytic model.
Median deviation from perpendicular: **0.00°** over 4,000 lines. And it is mutation-checked — I
inverted the quarter turn on purpose, and L8-7 failed while nothing else in the 125 tests noticed.
That is the difference between a test and an assurance: had the direction been inverted, the crack
map would have looked exactly as busy and been rotated 90° from the truth.

---

## 3 · "New cracks" is now honest, and it was not free

Cracks **latch**. Once a fissure opens it narrows to 35 % of its widest as the face passes and never
heals. So the cracks open at day 345 are every cell ever over the threshold — **8,836 of them**,
before your scenario does anything.

Count "new cracks" against an instantaneous *before* instead, and the lab reports cracks that opened
on day 120 and have since partly closed as though your scenario had just made them. Wrong, and wrong
in the direction that flatters the feature.

So P2 counts against the **latched** state from the run's own exported history. Two consequences:

1. **Gate L8-6, the null check:** freeze the exported day, change nothing, and the lab must report
   **0 new cracks**, with widths matching the simulator's own to a median **1.37 %** and the NCB
   damage grade differing on **0.14 %** of 25,564 cells. It does.
2. **When there is no history for the frozen day, the lab refuses to count** and names the command
   that produces it. It does not fall back to an instant and call the difference new.

That second point turned into real work: a full rebuild used to **delete** the crack history and
never recreate it, so the file this all depends on was missing after every clean run. Fixed as
**S7** — `run-simulation.sh` now has a step 9/9, and it exports **four days across the run in one
shared walk** of the latch (2.5 s for all four), because you can freeze any day:

```
day 172: 950 cracked cells, widest 23.48 mm
day 345: 2209 cracked cells, widest 28.36 mm
day 517: 3457 cracked cells, widest 28.49 mm
day 690: 4669 cracked cells, widest 28.49 mm
```

Note the widest crack stops growing after day 517 while the cracked **area** keeps spreading — the
face has moved on and the tension front with it. That is the latch behaving.

---

## 4 · The refusal — run this one too

```bash
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m lab.tools.what_if \
    --run ../mine-sim/out/v2-690d --day 690 --zone 6 --event crack --param days_ahead=45
```

([`what_if_day690_refusal.txt`](what_if_day690_refusal.txt))

```
  crack history: 18676 cells already cracked at day 690

  CANNOT HAPPEN: the ground near here is not moving now: 0.013 mm/day over the last 7 days,
  under the 0.05 mm/day we can tell from rounding — there is no rate to carry forward
```

By day 690 the face has finished and zone 6 has settled, so "what if it keeps moving" has nothing to
carry forward. The alternative — multiplying 0.013 mm/day of rounding noise by 45 days and drawing
the result — is how a demo gets a question it cannot answer. **Every refusal carries the number it
refused on**, so you can check the judgement rather than take it.

The same shape of refusal covers: 0 days ahead, day 0, a click on ground with no coal under it, and a
zone where confining the event leaves nothing above 10 mm.

---

## 5 · The shaking layer, and what is deliberately missing

Peak **0.11 mm/s at 175 Hz**, against a **15 mm/s** DGMS domestic limit. Nothing is over the limit,
and that is the honest answer: the source is roof caving at **375 m depth**, so it is never closer
than 375 m to anything on the surface. The numbers are small for a physical reason, not because a
switch is off. 68 roof falls by day 345, driven by our own face advance — no user input, no unverified
constant.

**Blast is not in P2** — your call ("blast keep it for afterwards"). `blast_k` and `blast_b` are
`OPEN — VERIFY` in `assumptions.yaml`, and a PPV computed from constants nobody measured is a number
that cannot survive a question. Nothing in P2 reads them.

Vibration is drawn as **contour lines** at 2 / 5 / 10 mm/s, for the same reason cracks are lines: a
filled patch suggests a measurement everywhere inside it. And it is asserted, not assumed, that
**shaking does not sink the ground** — `test_shaking_the_ground_does_not_sink_it` runs the same
scenario with and without the layer and requires every surface consequence to be identical.

---

## 6 · Two defects the gates caught in my own code

Worth recording, because both would have been invisible in a demo:

1. **`evaluate` was laundering the int grid into floats.** It opened with
   `np.asarray(s, dtype=np.float64)`, which succeeds silently on an integer array — so the int-mm
   world grid could have reached the derivative path, where rounding to whole millimetres on 5 m
   cells produces strain errors *larger than the true peak* (4.9 mm/m against 4.5). Gate L5 exists to
   forbid exactly that, and my own conversion defeated it. `evaluate` now refuses a non-float surface.
2. **A crack bearing could leave as 180°.** Rounding 179.998 for the wire gives 180.0, outside the
   `[0, 180)` range the payload promises for a line. Wrapped at the rounding step.

Gate **L4** also refused two display literals in the new code (a corner index and a preview row
count). Both became named values — one in `lab.yaml`, with a source.

---

## 7 · What to check by eye

1. Run §1's command. Read the "WHAT IS BUILT ON IT" block. **Does any sentence in it sound wrong to
   you?** That is the block a judge will read.
2. Run §4's command. Satisfy yourself the refusal is the right behaviour.
3. Run it with `--event sudden_sinking` ([`what_if_sudden_sinking.txt`](what_if_sudden_sinking.txt)) —
   568 mm, 1,822 new cracks, 2 objects worse. The same `evaluate`, a different event: that is the
   point of there being one.
   Then `--day 172 --zone 3 --param days_ahead=60`, which is the case where houses change grade (§1).
4. `--zone full` vs `--zone 6`: the full district moves more ground and damages more objects. If a
   *smaller* zone ever reported *more* damage, something is wrong with the confinement.
5. Say whether the village layout is worth keeping as it is. It is **illustrative** — nobody surveyed
   it — and every sentence about it carries that label. If you would rather it matched a real
   settlement near Adriyala, that is a data task, and it is better to know now than during P4.

## 8 · Still open

- **D-S2** — crack/vibration columns in `out/nodes.csv`, or their own file? Unchanged: their own file.
- **D-S4** — blast constants. Deferred; nothing quotes them.
- Railway and pipe objects are **S6**, as planned.
- The lab still has no server and no page: **P3**, then **P4** — where the button lights up.
