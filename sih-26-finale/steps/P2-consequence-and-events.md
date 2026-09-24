# P2 — Consequences: cracks as lines, houses graded, and "what if it keeps moving"

**Branch:** `feat/p2-consequence-and-events` · **Built by:** Claude (Adarsh asked for the code again)
**Written:** 17 Sep 2026 (session 27). **Part 2 of 6** — see [S0](S0-terrain-events-plan.md) for the
whole shape and [CHECKLIST](CHECKLIST.md) for where everything stands.

**In plain words:** P1 could say *this ground is stretched 5 mm/m*. Nobody can act on that. P2 says
*House H5's walls change length by 118 mm, so it goes from slight to appreciable damage; the road
opens a 19 mm crack; the tower's top moves 3 mm sideways* — and it draws the cracks as lines running
the way the ground actually tore.

---

## 1 · What P2 is for, in one paragraph

Everything built so far produces **fields**: subsidence, tilt, curvature, strain. A field is not an
answer. The one thing that makes the Scenario Lab worth having is that it turns a field into a
sentence somebody can check, argue with, or act on — and that it produces that sentence **the same
way every time, from the same thresholds, whoever asked and whatever they asked about**. That is why
there is exactly one `evaluate()` and why the forecast view (P5/P6) will call the same one.

---

## 2 · The maths problems P2 had to close

### 2.1 Cracks latch, so "new crack" is meaningless without the run's history (hazard H5)

A fissure does not heal. Once open it narrows to 35 % of its widest as the compression zone behind
the face passes over it (`cracks.partial_closure_fraction`), and stays. So the cracks open at day T
are **every cell that was ever over the threshold**, walked forward from day 0 — not the cells over
it at day T.

That matters for the only crack number anyone reads. "New = cracked after, not cracked before" is
true only if *before* is the latched state. Evaluated at one instant, the lab would report a crack
that opened on day 120 and has since narrowed as though the scenario had just made it — a wrong
answer **in the direction that flatters the feature**, which is the worst direction.

**What P2 does:** reads the latched state from `out/cracks/crack_field_day<NNNN>.npz`, and when there
is none for the frozen day, **refuses to count** and says which command produces it. A plausible
wrong count is worse than a missing one.

### 2.2 …and a rebuild used to delete that history and never recreate it (S7)

The file the whole crack answer depends on was absent after every clean run. `run-simulation.sh` now
has a **step 9/9** that exports it, for four days across the run in one shared walk of the latch
(2.5 s), because the lab can freeze any day. The bare `cell = 10.0` in that script became
`cracks.export_cell_m` in `assumptions.yaml` — the lab resamples from that grid, and a number the lab
cannot read is a number it guesses (hazard H6). Closes `WHATS-LEFT.md` §1.5.

### 2.3 Three grids, one resample, stated in the open (hazard H6)

The export is on a 10 m grid of its own; the world is 5 m. The resample happens in exactly one place
(`lab/sampling.py`), is **bilinear**, and the crack mask — a boolean — is interpolated as a fraction
and cut at one half, so a crack edge moves by at most half an export cell instead of a whole one. A
nearest-cell lookup is the difference between a crack being *in* a road and *beside* it.

### 2.4 Objects are declared in the panel frame, not the world (hazard H8)

`objects.yaml` was written for one panel; the simulator now superposes several. Every object carries a
`panel:` index and is transformed once, at load, against `panel.y_offsets_m`. An object that lands
outside the grid is an **error** — WP9 §6 — never clamped to the edge, because a clamped house
quietly answers a question about ground nobody asked about, and answers it with a damage grade.

### 2.5 The event must not be able to invent subsidence

The crack event carries today's sinking rate forward N days, and is **capped by the ground's own
remaining capacity**: the settled trough for coal already extracted, minus where the surface is now.
180 days on ground with 40 mm left gives 40 mm, not 400. Ground that is not moving now gets a refusal
with the number in it, not a near-zero surface that reads as "it happened, barely".

---

## 3 · What got built

| File | New / changed | What it is |
|---|---|---|
| `lab/consequence.py` | new | the one `evaluate()`: crack lines, object answers, plain sentences |
| `lab/objects.py` | new | load, panel-frame transform, footprint/polyline sampling, refuse off-grid |
| `config/objects.yaml` | new | 8 houses, 2 roads, 8 poles, 1 tower — **illustrative, not the real Adriyala surface** |
| `lab/vibration.py` | new | the shaking layer, from caving only. **No blast** (D-S4 deferred) |
| `lab/baseline.py` | new | the run's latched crack state, resampled onto the lab grid |
| `lab/sampling.py` | new | the one bilinear sampler; polyline/footprint sampling; marching squares for contour lines |
| `lab/events/crack.py` + `config/events/crack.yaml` | new | "the ground keeps moving N more days" |
| `lab/snapshot.py` | changed | carries `crack_baseline` and, when absent, the plain reason |
| `lab/config.py`, `config/lab.yaml` | changed | four new display numbers, each with a source |
| `lab/tools/what_if.py` | new | prints the whole answer in words — the hand check |
| `mine-sim/scripts/export_cracks.py` | changed | cell from config; several days in one walk |
| `mine-sim/config/assumptions.yaml`, `src/minesim/config.py` | changed | `cracks.export_cell_m` |
| `run-simulation.sh` | changed | **step 9/9** exports the crack field |
| `tests/test_objects.py`, `test_consequence.py`, `test_crack_event.py`, `test_vibration_layer.py` | new | 46 new tests |
| `tests/gates/test_l8.py` | changed | **L8-6** and **L8-7** (below) |

### The geometry, as asked for (Adarsh, session 26)

- **subsidence** — keeps the radius taper.
- **cracks** — **line segments**, one per cracked cell, through the cell centre, one cell long, bearing
  = the principal-strain direction turned a quarter turn, because a fissure opens *across* the pull.
  Same convention as `minesim.cracks.CrackField.azimuth_deg`, so a lab line and an exported azimuth
  mean the same thing. The widest 4,000 are drawn and the payload says how many were dropped — a
  thinned picture must never read as a complete one.
- **vibration** — **contour lines** at the levels in `lab.yaml`, found by marching squares. A line is
  the honest shape for "this is where the limit is"; a filled patch suggests a measurement everywhere
  inside it.

### What is in the vibration layer, and what is not

**Caving only.** Roof falls behind the supports, from `minesim.vibration.caving_events`, driven by the
face advance we already simulate — so the layer needs no user input and no unverified constant. A
caving event sits at seam depth, 375 m down, so it is never closer than 375 m to anything on the
surface: the numbers are small (peak **0.11 mm/s** against a 15 mm/s domestic limit at 175 Hz) and
they are small for a physical reason, not because something is switched off.

**Blast is deferred** — your call, session 26. `blast_k` and `blast_b` are `OPEN — VERIFY`, and a PPV
computed from constants nobody measured cannot survive a question. Nothing in P2 reads them.

---

## 4 · Gate L8, extended — the cross-check now covers what the lab *says*

L8-1c (P1) compared the **strain** the two halves derive. P2 adds the comparison that matters
downstream: what the lab **says about it**.

| # | Assertion | Measured 17 Sep, day 690 |
|---|---|---|
| L8-6 | a null scenario (`ds = 0`) reproduces the exported crack field cell for cell: widths, NCB grades, and zero new cracks | widths **median 1.37 %** apart (p95 6.24 %) over 4,675 cells cracked in both · NCB grade differs on **0.14 %** of 25,564 cells · **0** new cracks |
| L8-7 | crack lines run **across** the exported principal-strain direction | median deviation from perpendicular **0.00°** over 4,000 lines |

L8-7 was **mutation-checked**: inverting the quarter turn in `consequence.py` fails this gate and
nothing else in the suite — so the assertion has teeth rather than just passing.

### Two defects the gates caught in this session's own code

1. `evaluate` opened with `np.asarray(s, dtype=np.float64)`, which **launders an int array into
   floats** — defeating gate L5 at the one boundary where the int-mm world grid can reach the
   derivative path. (Rounding to whole mm on 5 m cells gives strain errors *larger than the true
   peak*.) It now refuses a non-float surface outright.
2. A crack bearing of exactly 180° could reach the wire after rounding (179.998 → 180.0), outside the
   `[0, 180)` range the payload promises for a line.

Gate L4 refused two display literals as well; both became named values.

---

## 5 · How you check it

```bash
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q     # 125 passed
cd mine-sim    && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m pytest -q     # 198 passed, 1 skipped
python3 sync_vault.py --check                                                        # PERFECT
```

Then read the answer yourself, in words:

```bash
cd scenario-lab && /opt/miniconda3/envs/pinn-sandbox/bin/python3.11 -m lab.tools.what_if \
    --run ../mine-sim/out/v2-690d --day 345 --zone 6 --event crack --param days_ahead=45
```

The output and what to look for are in
[`walkthroughs/step-p2-consequences/WALKTHROUGH.md`](../walkthroughs/step-p2-consequences/WALKTHROUGH.md).

Worth trying on purpose: the same command with `--day 690`. Zone 6 has finished moving by then, so it
answers **"the ground near here is not moving now: 0.003 mm/day … there is no rate to carry
forward"** rather than producing a scenario. That refusal is the feature working.

---

## 6 · What P2 deliberately does not do

- No server, no HTTP, no page — **P3** and **P4**.
- No blast — deferred by Adarsh.
- No railway, no pipe (`RL1`, `PP1`) — **S6**, as planned; `objects.py` knows house, road and pole.
- No forecast input — **P5/P6**. `evaluate` already takes the `mask` it will need.

## 7 · Status

| Item | Written | Checked by Adarsh |
|---|---|---|
| objects.yaml + objects.py | ✅ | ⬜ |
| consequence.py (cracks as lines, objects, summary) | ✅ | ⬜ |
| vibration layer (caving, contour lines) | ✅ | ⬜ |
| crack event | ✅ | ⬜ |
| crack baseline (latched) wired in | ✅ | ⬜ |
| S7 — export in the rebuild, several days | ✅ | ⬜ |
| gate L8-6 and L8-7 | ✅ | ⬜ |
| `what_if` tool | ✅ | ⬜ |

**Next:** P3 — the lab server, the result store, and gates L1 (the run is byte-identical after every
event), L2, L3, L7.
