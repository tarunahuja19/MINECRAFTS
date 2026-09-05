# Part 1B — Data Generation and the Four Files

**Scope.** How six panel numbers become a few million numbers, where those numbers live, and
who is allowed to read them. No maths derivations (those are in `part1-maths-spec.md`), no
dashboard, no PINN.

**One sentence:** two hand-written input files go in, one generator runs, two generated output
files come out, and only one of those four files is allowed to touch the backend.

---

## 1. The four files, on one page

| File | Format | Written by | Read by | Size | Lifetime |
|---|---|---|---|---|---|
| `nodes.json` | JSON | **you, by hand** | sim + gateway + backend | 8 KB | never regenerated |
| `events.csv` | CSV | **you, by hand** (or a 20-line script) | sim **and** detector, separately | 4 KB | per scenario |
| `truth.npz` | numpy zip | generator | **nothing downstream** — quarantined | ~32 MB | per scenario |
| `nodes.csv` | CSV | generator | backend, and only this | ~20 MB | per scenario |

Two are **inputs you author**. Two are **outputs the machine emits**. That split is the whole
mental model.

```
        AUTHORED                    GENERATED
   ┌──────────────┐            ┌──────────────┐
   │ nodes.json   │──┐      ┌──│  truth.npz   │  slow lane, 30 min
   │ the who/where│  │      │  │  the terrain │  → quarantined, never crosses the seam
   └──────────────┘  │      │  └──────────────┘
                     ├─ GEN ┤
   ┌──────────────┐  │      │  ┌──────────────┐
   │ events.csv   │──┘      └──│  nodes.csv   │  fast lane, 10 min
   │ the what/when│            │  the telemetry│ → the ONLY thing the backend sees
   └──────────────┘            └──────────────┘
```

**Analogy.** `nodes.json` is the seating chart. `events.csv` is the event diary — who set off
fireworks and when. `truth.npz` is God's own recording of what actually happened. `nodes.csv`
is the pile of scribbled notes the thirty witnesses handed in. Your product is only allowed to
read the scribbled notes. `truth.npz` exists purely so *you* can mark the exam afterwards.

---

## 2. File 1 — `nodes.json`, the registry

Everything constant lives here. If a number does not change during a run, it belongs in this
file and nowhere else.

```json
{
  "schema": 1,
  "scenario": "slow_sag_40d",
  "master_seed": 20260315,
  "sim": {
    "start_iso": "2026-03-06T00:00:00Z",
    "duration_days": 40,
    "sample_s": 60,
    "transmit_s": 600,
    "truth_frame_s": 1800
  },
  "panel": {
    "x1": 100, "y1": 100, "x2": 700, "y2": 300,
    "H": 150, "m": 3.0, "tan_beta": 2.0, "a": 0.65, "c": 0.01414
  },
  "grid": { "nx": 64, "ny": 64, "x0": 25, "x1": 775, "y0": 25, "y1": 375 },
  "conveyor": { "x0": 80, "y0": 380, "x1": 720, "y1": 380 },
  "nodes": [
    {
      "id": 17, "x": 400.0, "y": 130.0, "role": "field",
      "seed": 917423,
      "ext_to": [400.0, 140.0],
      "crack_theta_c_ue": 6183.0,
      "shade_s": 0.86, "temp_offset_c": -0.4
    },
    { "id": 29, "x": 860.0, "y": 340.0, "role": "anchor", "seed": 551209, "ext_to": null,
      "crack_theta_c_ue": 5940.0, "shade_s": 0.93, "temp_offset_c": 0.7 },
    { "id": 31, "x": 860.0, "y": 200.0, "role": "gateway", "seed": 100003, "ext_to": null,
      "crack_theta_c_ue": null, "shade_s": 0.9, "temp_offset_c": 0.0 }
  ]
}
```

**Rules:**
1. `seed` per node is written **once, by hand**, and never regenerated. If you regenerate seeds,
   node 17 behaves differently at every rehearsal and no bug is ever reproducible.
2. `shade_s`, `temp_offset_c` and `crack_theta_c_ue` are drawn **once** from their distributions
   (§3.4, §3.6 of the maths spec), then frozen into the file. They are per-node constants, not
   per-run draws.
3. `role` is `field` (28) | `anchor` (2) | `gateway` (1) = 31 entries.
4. To answer PS bullet 24 (multi-coalfield scale): make `panel` an **array** and add
   `"panel_id"` to each node. Costs nothing now, kills the "does this scale?" question later.

---

## 3. File 2 — `events.csv`, the register

Every disturbance that is **not** the ground subsiding. This is the file that carries your
best differentiator, so keep it a real file.

```csv
t_iso,kind,x_m,y_m,charge_kg,note
2026-03-08T11:30:00Z,blast,520,60,120,DGMS reg 4412
2026-03-08T14:05:00Z,truck,300,390,,haul road pass
2026-03-06T00:00:00Z,conveyor_on,,,,continuous
2026-03-11T02:00:00Z,node_kill,,,,"ids=[9,10,11,16,17,18]"
```

| Column | Meaning |
|---|---|
| `t_iso` | when, UTC |
| `kind` | `blast` / `truck` / `conveyor_on` / `conveyor_off` / `node_kill` / `radio_blackout` |
| `x_m,y_m` | where, for the distance term in the PPV law |
| `charge_kg` | max charge per delay `Q`, blasts only |
| `note` | free text; for `blast` this is the DGMS register reference |

**The rule that makes this worth points:** this file is read **twice, independently**.

- The **simulator** reads it to *add* the vibration spike (`PPV = 1140·(D/√Q)^−1.6`).
- The **detector** reads it, as a separate file open, to *suppress* the alarm that spike causes.

Never pass it between them as a Python object. A real mine hands you a paper register; your
simulation must hand your backend a file. That gap is the demo.

**Analogy.** The simulator is the neighbour who lets off fireworks. The detector is the security
guard. They are not allowed to talk. But they both have a copy of the council's fireworks permit
list, and that is how the guard knows not to call the police.

---

## 4. How the huge table is actually built — nothing loops over time

This is the answer to "how do we make so much data." **You never generate a row.** You build a
handful of large rectangles of numbers and then slice them.

**Analogy.** You are not stamping 1.8 million dots one at a time. You have one stencil — the
surface function — and you press it onto the whole sheet in a single motion. Then five more
stencils for the damage. Six presses total.

### 4.1 The array-shape pipeline

```
nodes.json  ─→  xy       (31, 2)          node positions
time        ─→  t        (57600,)         one entry per simulated minute
                            │
      ┌─────────────────────┴──────────────────────┐
      │  broadcast: (31,1) × (1,57600) = (31,57600)│   ← ONE numpy call per channel
      └─────────────────────┬──────────────────────┘
                            ▼
  TRUE          tilt_x, tilt_y, strain, ext, crack      each (31, 57600)
                            │
                            ▼  six whole-array operations, in order
  CORRUPT       + thermal → + bias(OU) → + white → × Vbat/Vnom → quantise → + event
                            │
                            ▼  ONE reshape
  SUMMARISE     (31, 5760, 10).mean(axis=2)  for slow channels
                (31, 5760, 10).max(axis=2)   for vib_peak and crack
                            │
                            ▼  the only real loop: 178,560 packets
  RADIO         drop / delay / duplicate / route
                            │
                            ▼
  WRITE         nodes.csv
```

### 4.2 The volume arithmetic

| Quantity | Count | Note |
|---|---|---|
| Simulated minutes, 40 days | 57 600 | |
| Nodes | 31 | 28 field + 2 anchor + 1 gateway |
| Reading structs conceptually computed | 1 785 600 | **never stored as objects** |
| 10-min transmit slots | 5 760 per node |
| Packets attempted | 178 560 | |
| Rows surviving in `nodes.csv` (~92%) | **164 275** | ~20 MB |
| 30-min truth frames at 64×64 | 1 920 | 31.5 MB |
| One channel as `float64 (31, 57600)` | 14.3 MB | ×10 channels = 143 MB peak |

Target runtime for the whole 40-day run: **under 30 seconds**. If it takes minutes, you have a
Python `for` loop where an array operation belongs.

### 4.3 The four things people assume need a loop, and do not

| Looks sequential | Actually is |
|---|---|
| bias random walk | `scipy.signal.lfilter` (exact OU), or pre-scaled `cumsum` |
| crack latch (never closes) | `np.maximum.accumulate(bucket, axis=1)` |
| 60 s → 10 min averaging | `arr.reshape(31, 5760, 10).mean(axis=2)` |
| peak-hold on vibration | same reshape, `.max(axis=2)` |

Only the **mesh radio** genuinely loops, because routing depends on per-packet dice rolls and
duty-cycle state. That is 178 560 iterations of about ten operations each — a few seconds in
plain Python. Leave it.

---

## 5. The two lanes — and the 60 s question, resolved

You said you want 30-minute data for the terrain and 60-second data for the alarm path. Those
are the right two products. But there are actually **three** cadences, and conflating two of
them costs you a slide.

| Cadence | What exists | Where it lives | Who sees it |
|---|---|---|---|
| **60 s** | node samples all seven sensors | **node RAM only** — overwritten every minute | nobody |
| **10 min** | node packs a summary into 21 bytes and transmits | `nodes.csv` | **the backend** |
| **30 min** | full-field surface snapshot | `truth.npz` | scoring only |

**Verdict: do not feed 60-second rows to the backend.**

A real node cannot transmit every 60 s. Your own duty-cycle arithmetic proves it — at 1-minute
reporting a hub node needs 493% of its airtime budget. That congestion finding is one of your
strongest slides, and giving the backend 60 s data throws it away.

The 60-second data is still real and still used. It is what gets **averaged into** the 10-minute
packet — nine of every ten readings are consumed by a `mean` or a `max`, not discarded. That is
what the reshape in §4.1 does.

**Analogy.** A person stands in a field counting cars. They glance at the road every minute.
They do not write every minute down — they keep three numbers in their head: the average, the
biggest, and whether anything alarming happened. Every ten minutes they shout those three
numbers across the field and start again. The minute-by-minute counts were real; they just never
left their head.

### If you want a live ticker on Website 1

Dump the 60 s series to a **fifth, optional file**: `truth/raw_60s.parquet`, `(31, 57600)` per
channel. It sits inside `truth/`, which the backend cannot import, so the seam holds. Use it for:
- the scrolling raw-data ticker on the simulator screen,
- your debug oracle when the detector misbehaves.

Never let `backend/` open it.

---

## 6. File 3 — `truth.npz`, the terrain (slow lane, 30 min)

Not a table. A stack of images.

```
truth.npz
├── x        (64,)                 grid x coordinates, metres
├── y        (64,)                 grid y coordinates, metres
├── t_days   (1920,)               30-min frame times
├── S        (1920, 64, 64)  float32   subsidence, metres, DOWN POSITIVE
├── dSdx     (1920, 64, 64)  float32   tilt x, rad
├── dSdy     (1920, 64, 64)  float32   tilt y, rad
├── eps_yy   (1920, 64, 64)  float32   strain, dimensionless
└── meta     (json string)          panel params, seed, generator version
```

At float32, 64×64: **31.5 MB**. At 128×128 it becomes 126 MB — do not. 64×64 is finer than the
75 m influence radius by a factor of ten; more resolution buys you nothing.

**Uses, all of them offline:**
1. Scoring the PINN's reconstruction — RMSE against the true field.
2. The "here is what was actually happening" overlay in the post-demo explanation.
3. Your own sanity checks (T1 volume conservation, T4 extremum locations).

**Quarantine, enforced by folders not discipline:**

```
repo/
  sim/          imports truth/          ← allowed
  truth/        truth.npz, raw_60s.parquet, NO __init__.py
  backend/      may open nodes.csv, events.csv, nodes.json — nothing else
```

Test T8 asserts `import truth` from `backend/` raises `ImportError`. One line of pytest. If C8
can reach `truth.npz`, the project is dead and nobody will notice.

---

## 7. File 4 — `nodes.csv`, the telemetry (fast lane, 10 min)

The big one. **One file for the whole network**, not one per node — because the gateway is the
first place in the system where all thirty nodes exist at once, so it is the first place a file
can exist.

```csv
# GENERATED BY SIMULATOR v1.0 scenario=slow_sag_40d seed=20260315 utc=2026-08-31T09:12:04Z
t_iso,node_id,seq,tilt_x_urad,tilt_y_urad,strain_ue,ext_delta_10um,vib_rms_x100,vib_peak_x100,vib_fdom_hz,temp_dc,vbat_mv,crack_flags,rssi_dbm,snr_db,hops,alive
2026-03-14T14:30:04Z,17,1152,3,13254,-726,-830,31,44,52,478,3611,0,-104,4.5,2,1
2026-03-14T14:30:00Z,22,,,,,,,,,,,,,,0
```

| Field group | Columns | Source |
|---|---|---|
| identity | `t_iso`, `node_id`, `seq` | gateway arrival clock + packet |
| the 21 bytes, unpacked | `tilt_x_urad` … `crack_flags` | the packet, **raw, uncorrected** |
| link quality | `rssi_dbm`, `snr_db`, `hops` | only the receiver can measure a journey |
| liveness | `alive` | 1 = packet arrived, 0 = silent |

**Three rules:**

1. **Values are raw and uncorrected.** No thermal correction, no sag correction. A node that
   corrects its own data has destroyed the evidence. Correction happens in `backend/` at C7,
   where it is auditable.
2. **A dead node is a present, blank row — never an omitted row.** Downstream must be able to
   tell "node 22 exists and is silent" from "node 22 was never installed." Omit the row and the
   PINN silently treats a dead zone as unmonitored territory.
3. **No `x`, `y`, no `source: sim`.** Position comes from `nodes.json` at the gateway. The
   simulated-data tag rides a separate MQTT topic (`mine/panel4/meta`) that the detection path
   does not subscribe to — otherwise someone eventually writes `if source == "sim"` in the
   detector and the seam is broken forever. The `#` watermark header is fine; the backend skips
   comment lines.

**Row count:** 31 nodes × 5 760 slots = 178 560 attempts, ~92% delivered ≈ **164 275 rows**.
(This settles Q7 in your checklist: rows are appended **on arrival**, i.e. one per node per
10-minute transmission — not per epoch.)

---

## 8. The generation runbook — eight steps, in order

```
 1. load nodes.json                    → 31 positions, 31 seeds, 6 panel numbers
 2. spawn the RNG tree from master_seed → field streams + 8 streams per node   (§5 maths spec)
 3. build the full time axis           → t = arange(57600)/1440 days
 4. LAYER 0: S, dS/dx, dS/dy, d²S/dy², u = B∇S   → (31, 57600) each, closed form
    ├─ also evaluate on the 64×64 grid at 1920 frames → truth.npz
 5. LAYER 1: driving functions          → T_air, cloud (shared) → T_chip, V_bat (per node)
    └─ sensors: tilt, strain, exact 3-D extensometer, crack latch
 6. LAYER 2: read events.csv            → blast PPV, truck, conveyor, microseismic → vibration
 7. LAYER 3: corruption, six stages, in the fixed order   → the damaged (31, 57600) arrays
    └─ optional dump → truth/raw_60s.parquet
 8. LAYER 4: reshape to 10-min summaries → pack 21 bytes → radio loop → nodes.csv
```

**Gates.** Do not proceed past step 4 until T1 (volume conservation, ratio = 1.000 ± 0.005) and
T2 (analytic vs central-difference derivatives, < 0.1%) pass. They are the only things standing
between you and a second generator.

Do not ship until T7 passes: correct the damaged values using the *true* `T_chip` and `V_bat`
and confirm the residual sits inside white noise. That proves the corruption chain is
**invertible**, which is exactly what C7 will have to do. If it is not invertible, your detector
cannot work, and you want to know that on day 3 rather than on stage.

---

## 9. The five rules that must not be broken

| # | Rule | What breaks if you break it |
|---|---|---|
| 1 | Exactly one implementation of `S(x,y,t)` | your detector spends the demo detecting the disagreement between your own two models |
| 2 | `truth/` has no import path from `backend/` | the project is dead and nobody notices |
| 3 | `events.csv` is opened as a file by both sides | the blast-suppression demo becomes a magic trick |
| 4 | `nodes.json` seeds written once, never regenerated | the demo behaves differently at every rehearsal |
| 5 | Noise arrays generated for the **full** span, then sliced | historical + live windows disagree; PS bullet 18 collapses |

Rule 5 is the one teams break without noticing. Node 17's values for days 20–40 must be
byte-identical whether you started the run at day 0 or day 20.

---

## 10. Say it in six lines

> We author two files: a registry of where the sensors are, and a register of what else was
> happening. We generate two: the true ground surface every thirty minutes, and the telemetry
> the nodes actually managed to transmit every ten. The generator never loops over time — the
> subsidence model is closed-form, so every channel is one numpy call on a 31 × 57,600 array,
> and forty days of a whole minefield takes under thirty seconds. Only the telemetry file
> crosses into the product. The true surface is locked in a folder the backend cannot import,
> and we only open it afterwards, to mark our own exam.
