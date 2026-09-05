# Part 1B — Data Generation, the Four Files, and the PINN Handoff (v3)

**Scope.** How six panel numbers become a few million numbers, where those numbers live, and
who is allowed to read them. No maths derivations (those are in `part1-maths-spec.md`), no
dashboard, no PINN.

**One sentence:** two hand-written input files go in, one generator runs, two generated output
files come out, and only one of those four files is allowed to touch the backend.

**What changed in v2.** Added §0 (the eight kinds of information), a concept-abstract and a
field-by-field meaning table for every one of the four files, a much longer §4 on why
`truth.npz` exists at all, a plain-English §7 on how the volume is actually produced, and §9
on the repo layout — what `sim/` is, what `truth/` is, what `backend/` is, and why the walls
between them are folders and not good intentions.

**What changed in v3.** Added §11 (why a PINN is necessary at all, and what replaces
`truth.npz` in a real mine), §12 (three flowcharts — data creation, timed data insertion, and
the join to the frontend, with every clock marked), and §13 (the Part 2 handoff: exact arrays
in, exact arrays out, the five loss terms, and the circularity trap). §13 is written to be
detached and given to whoever builds the network.

---

## 0. First — the eight kinds of information

Before any file, learn this vocabulary. Every field in every one of the four files is exactly
one of these eight kinds. Once you can name the kind, you can always answer "which file does
this belong in?" without asking anyone.

| # | Kind | The question it answers | Changes during a run? |
|---|---|---|---|
| 1 | **Identity** | *which* thing is this? | never |
| 2 | **Geometry** | *where* is it? | never |
| 3 | **Schedule** | *when* does the clock tick, and for how long? | never |
| 4 | **Physics** | what is the ground *doing*? | continuously |
| 5 | **Determinism** | how is the randomness *pinned down*? | never |
| 6 | **Personality** | what is this individual unit's *fixed quirk*? | never |
| 7 | **Measurement** | what did a sensor *say*? | every sample |
| 8 | **Provenance** | how did this number *get here*, and is it trustworthy? | every packet |

**The sorting rule that falls out of this:** kinds 1, 2, 3, 5, 6 never change → they belong in
an **authored** file. Kinds 4, 7, 8 change → they belong in a **generated** file.

**Analogy.** A school. Kind 1–2 is the class register and seating plan. Kind 3 is the timetable.
Kind 5 is the rule "we always use the same dice, and we number them." Kind 6 is "Ravi sits by
the window so he always feels warmer." Kind 4 is what actually happened in the lesson. Kind 7
is what each student wrote in their notebook. Kind 8 is whether their notebook made it to the
staff room or got left on the bus.

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
   │ nodes.json   │──┐      ┌──│  truth.npz   │  one frame per 30 sim-minutes
   │ the who/where│  │      │  │  the terrain │  → quarantined, never crosses the seam
   └──────────────┘  │      │  └──────────────┘
                     ├─ GEN ┤
   ┌──────────────┐  │      │  ┌──────────────┐
   │ events.csv   │──┘      └──│  nodes.csv   │  one row per node per 10 sim-minutes
   │ the what/when│            │  the telemetry│ → the ONLY thing the backend sees
   └──────────────┘            └──────────────┘
```

> **Read "30 min" and "10 min" as cadences, not runtimes.** They are how often a row or a frame
> is *stamped inside the simulated world*. The generator that produces all forty days of both
> files finishes in under thirty **seconds** of real wall-clock time. Do not let anyone in the
> room conflate the two — it is the single most common misreading of this diagram.

**Analogy.** `nodes.json` is the seating chart. `events.csv` is the event diary — who set off
fireworks and when. `truth.npz` is God's own recording of what actually happened. `nodes.csv`
is the pile of scribbled notes the thirty witnesses handed in. Your product is only allowed to
read the scribbled notes. `truth.npz` exists purely so *you* can mark the exam afterwards.

### 1.1 The same four files, as concepts

Strip the formats away and this is what each one **is**:

| File | Abstractly, it is… | Kinds it carries | If it did not exist |
|---|---|---|---|
| `nodes.json` | a **registry of unchanging facts** — the network's constitution | 1, 2, 3, 5, 6 | every constant would be hard-coded in three places and drift apart |
| `events.csv` | a **register of external disturbances** — everything that is not the ground sinking | 3, 2 | the detector could not tell a blast from a collapse; your best differentiator vanishes |
| `truth.npz` | the **ground-truth field** — reality at full resolution, before any sensor touched it | 4 | you could never prove your system was right, only assert it |
| `nodes.csv` | the **degraded observation record** — reality after sensors, noise, quantisation and a lossy radio got hold of it | 7, 8 | there is no product; this file *is* the input to everything downstream |

**The one-line version:** `nodes.json` says *who*, `events.csv` says *what else*, `truth.npz`
says *what really happened*, `nodes.csv` says *what we managed to hear*.

---

## 2. File 1 — `nodes.json`, the registry

### 2.1 Abstract

Everything constant lives here. If a number does not change during a run, it belongs in this
file and nowhere else. It carries five of the eight kinds: identity, geometry, schedule,
determinism and personality — and deliberately carries **no physics and no measurements**.

It is the only file read by all three programs (simulator, gateway, backend), so it is the only
place where a disagreement between them is impossible by construction.

**Analogy.** The birth certificate plus the address. It is written once, in ink, and everyone
in the system is looking at the same copy.

### 2.2 Example

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

### 2.3 What every field stands for

**Top level**

| Field | Kind | Stands for | Example | Why it must be here |
|---|---|---|---|---|
| `schema` | Identity | version of this file's *shape* | `1` | when you add a field on day 3, old runs still parse |
| `scenario` | Identity | human name of this run | `slow_sag_40d` | stamped into every output; tells you which run a CSV came from |
| `master_seed` | Determinism | the single root integer all randomness descends from | `20260315` | change this one number → a completely different but equally valid 40 days |

**`sim` — the schedule block**

| Field | Kind | Stands for | Example | Note |
|---|---|---|---|---|
| `start_iso` | Schedule | wall-clock instant simulated time zero maps to | `2026-03-06T00:00:00Z` | UTC always; timezone bugs eat demos |
| `duration_days` | Schedule | how long the run covers | `40` | drives every array length |
| `sample_s` | Schedule | how often a node *reads* its sensors | `60` | the 60 s cadence — lives in node RAM only |
| `transmit_s` | Schedule | how often a node *speaks* | `600` | the 10 min cadence — becomes `nodes.csv` rows |
| `truth_frame_s` | Schedule | how often the full surface is photographed | `1800` | the 30 min cadence — becomes `truth.npz` frames |

Those three cadences (60 / 600 / 1800) are the spine of the whole system. §6 is about nothing
else.

**`panel` — the physics parameters**

This block is the *only* physics in the file, and it is only the six free numbers, never any
derived value. Derived quantities (`S_max`, `r`, `B`, …) are computed at load time from these,
in one place, per §1.2 of the maths spec.

| Field | Kind | Stands for | Example | Unit |
|---|---|---|---|---|
| `x1,y1,x2,y2` | Geometry | the extracted panel's rectangle at seam level | `100,100,700,300` | metres |
| `H` | Physics | depth of the seam below surface | `150` | metres |
| `m` | Physics | seam thickness extracted | `3.0` | metres |
| `tan_beta` | Physics | how steeply the influence zone flares out to the surface | `2.0` | dimensionless |
| `a` | Physics | subsidence factor — what fraction of `m` the surface actually drops | `0.65` | dimensionless |
| `c` | Physics | time-constant of the Knothe settling curve | `0.01414` | per day |

**Analogy for the six.** Imagine pressing your thumb into the underside of a stretched rubber
sheet. `x1..y2` is how wide your thumb is. `H` is how thick the rubber is. `m` is how far you
push. `a` is how much of that push the top surface actually shows. `tan_beta` is how far
sideways the dimple spreads. `c` is how quickly the rubber gives in after you push.

**`grid` and `conveyor`**

| Field | Kind | Stands for | Why |
|---|---|---|---|
| `grid.nx, ny` | Geometry | resolution of the truth field snapshot | 64×64; see §7.3 for why not 128 |
| `grid.x0..y1` | Geometry | the rectangle the truth field is evaluated over | wider than the panel, so you capture the trough's outer rim |
| `conveyor.*` | Geometry | the line the haul road / conveyor runs along | vibration sources in `events.csv` need a geometry to sit on |

**`nodes[]` — one entry per physical unit**

| Field | Kind | Stands for | Example | Note |
|---|---|---|---|---|
| `id` | Identity | the node's permanent number | `17` | appears in every CSV row forever |
| `x`, `y` | Geometry | where the node is planted, in metres | `400.0, 130.0` | this is the **only** place position exists — never in `nodes.csv` |
| `role` | Identity | `field` (28) / `anchor` (2) / `gateway` (1) | `field` | 31 entries total |
| `seed` | Determinism | this node's private random root | `917423` | hand-written once; §2.4 rule 1 |
| `ext_to` | Geometry | coordinates of this node's extensometer anchor peg | `[400.0, 140.0]` | ~10 m away, across panel width; `null` for anchor/gateway |
| `crack_theta_c_ue` | Personality | the strain at which *this* crack line snaps | `6183.0` µε | drawn once from a distribution, then frozen |
| `shade_s` | Personality | how much sun this node actually gets | `0.86` | 1.0 = full sun; drives solar heating and battery |
| `temp_offset_c` | Personality | this node's permanent thermal bias | `-0.4` °C | one sits in a hollow, one on a rock |

The last three are the "personality" fields, and they are the reason your thirty nodes do not
behave like thirty copies of one node.

**Analogy for personality fields.** Thirty identical thermometers bought from the same shop.
One is nailed to a shaded fence post, one sits on a black rock, one is in a puddle. They are
the same instrument; they will never agree. `shade_s` and `temp_offset_c` *are* that
disagreement, written down in advance so it is reproducible.

### 2.4 Rules

1. `seed` per node is written **once, by hand**, and never regenerated. If you regenerate seeds,
   node 17 behaves differently at every rehearsal and no bug is ever reproducible.
2. `shade_s`, `temp_offset_c` and `crack_theta_c_ue` are drawn **once** from their distributions
   (§3.4, §3.6 of the maths spec), then frozen into the file. They are per-node constants, not
   per-run draws.
3. `role` is `field` (28) | `anchor` (2) | `gateway` (1) = 31 entries.
4. To answer PS bullet 24 (multi-coalfield scale): make `panel` an **array** and add
   `"panel_id"` to each node. Costs nothing now, kills the "does this scale?" question later.
5. **No derived constants in the file.** `S_max`, `r`, `B` are computed on load. A derived
   number written into JSON is a number that will one day disagree with its own formula.

---

## 3. File 2 — `events.csv`, the register

### 3.1 Abstract

Every disturbance that is **not** the ground subsiding. Abstractly it is a **timestamped list
of external causes** — things that will move a sensor needle for reasons that have nothing to do
with subsidence. It carries schedule and geometry, and no physics: it says *a blast of this size
happened here at this time*, and leaves the simulator to work out what that does.

This is the file that carries your best differentiator, so keep it a real file.

### 3.2 Example

```csv
t_iso,kind,x_m,y_m,charge_kg,note
2026-03-08T11:30:00Z,blast,520,60,120,DGMS reg 4412
2026-03-08T14:05:00Z,truck,300,390,,haul road pass
2026-03-06T00:00:00Z,conveyor_on,,,,continuous
2026-03-11T02:00:00Z,node_kill,,,,"ids=[9,10,11,16,17,18]"
```

### 3.3 What every field stands for

| Column | Kind | Stands for | Empty when |
|---|---|---|---|
| `t_iso` | Schedule | when it happened, UTC | never |
| `kind` | Identity | which *class* of disturbance | never |
| `x_m,y_m` | Geometry | where it happened — feeds the distance term `D` in the PPV law | the event has no location (`conveyor_on`, `radio_blackout`) |
| `charge_kg` | Physics | max charge per delay `Q` | anything that is not a `blast` |
| `note` | Provenance | free text; for `blast`, the DGMS register reference | optional |

**The six `kind` values, and what each one is for:**

| `kind` | Physically it is | What it perturbs | Why it is in your scenario |
|---|---|---|---|
| `blast` | a production blast, `PPV = 1140·(D/√Q)^−1.6` | a large, short vibration spike | **the** false-positive source; suppressing it is your headline |
| `truck` | a haul truck passing on the road | a moderate, brief vibration bump | proves the detector is not just blast-aware but noise-aware |
| `conveyor_on` / `conveyor_off` | continuous machinery running | a low, sustained vibration floor | shows a *changing baseline*, not just spikes |
| `node_kill` | hardware failure or vandalism of listed node ids | those nodes go silent | proves the system degrades gracefully, not catastrophically |
| `radio_blackout` | mesh outage over a window | packets stop arriving network-wide | proves you can tell "no data" from "no movement" |

### 3.4 The rule that makes this worth points

This file is read **twice, independently**.

- The **simulator** reads it to *add* the vibration spike (`PPV = 1140·(D/√Q)^−1.6`).
- The **detector** reads it, as a separate file open, to *suppress* the alarm that spike causes.

Never pass it between them as a Python object. A real mine hands you a paper register; your
simulation must hand your backend a file. That gap is the demo.

**Analogy.** The simulator is the neighbour who lets off fireworks. The detector is the security
guard. They are not allowed to talk. But they both have a copy of the council's fireworks permit
list, and that is how the guard knows not to call the police.

**Why it matters beyond the demo:** DGMS Circular 7/1997 already mandates blast seismograph
records at Indian coal mines. This file is not an invention — it is a file the mine is legally
required to keep. You are reusing existing compliance paperwork as a sensor input. That is the
sentence to say on stage.

---

## 4. File 3 — `truth.npz`, the terrain

### 4.1 Abstract

Not a table. **A stack of images.** Where `nodes.csv` is thirty-one point measurements, this is
the entire continuous surface, sampled on a grid, with no sensor anywhere in the picture.

Abstractly it is the **ground truth field** — pure kind-4 information, physics with nothing done
to it. No noise, no quantisation, no dropped packets, no thermal drift. It is what a perfect
instrument with infinite resolution at every square metre would have recorded.

It is generated by the same run that generates `nodes.csv`, from the same `S(x,y,t)`, at the same
instant — and then it is **locked away**.

### 4.2 Example / layout

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

### 4.3 What every array stands for

| Array | Shape | Kind | Stands for | Unit | Read it as |
|---|---|---|---|---|---|
| `x` | (64,) | Geometry | column positions of the grid | m | "the x ruler" |
| `y` | (64,) | Geometry | row positions of the grid | m | "the y ruler" |
| `t_days` | (1920,) | Schedule | when each frame was taken | days | "the timestamps on the photos" |
| `S` | (1920,64,64) | Physics | how far the ground has sunk | m, **down positive** | 1920 greyscale photos of a dent |
| `dSdx` | (1920,64,64) | Physics | slope east-west | rad | the same dent, lit from the side |
| `dSdy` | (1920,64,64) | Physics | slope north-south | rad | lit from the other side |
| `eps_yy` | (1920,64,64) | Physics | stretch/squeeze across panel width | dimensionless | where the ground is being pulled apart |
| `meta` | JSON string | Provenance | which panel params, which seed, which generator version made this | — | the label on the film canister |

`1920` is not arbitrary: 40 days × 24 h × 2 frames/h = 1920. `64 × 64` is the grid resolution.
So `(1920, 64, 64)` reads literally as **"1920 photographs, each 64 pixels by 64 pixels."**

**Analogy.** A time-lapse of a dent forming in a car bonnet, shot from directly above, one frame
every thirty minutes for forty days. `S` is the raw time-lapse. `dSdx` and `dSdy` are the same
time-lapse re-lit from two different angles so the slope shows up. `eps_yy` is a false-colour
overlay showing where the metal is under tension. All four are the same dent.

### 4.4 Why it exists — the part worth understanding properly

This is the question you asked, so here is the long answer.

**The problem it solves:** your entire system's job is to look at thirty-one noisy point
readings and infer a surface. The PINN reconstructs a 64×64 field from 31 points. The detector
fires an alarm based on a fitted trough shape. Both of these produce a **claim about reality**.

Without `truth.npz`, you have no way to check either claim. You can look at a dashboard and say
"that looks about right." A judge can ask "how do you know?" and your only honest answer is
"we don't."

With `truth.npz`, the answer becomes a number: *the PINN reconstructed the surface with an RMSE
of 4.2 mm against ground truth, from 31 points, with 8% packet loss.* That sentence is the
single strongest thing you can say in the room, and this file is the only reason you can say it.

**The four uses, all offline:**

| # | Use | What you actually do |
|---|---|---|
| 1 | **Score the PINN** | `rmse(pinn_output, truth.S[frame])` — a real accuracy number, not a vibe |
| 2 | **Score the detector** | you know the exact minute the trough became dangerous; measure how many minutes late the alarm was |
| 3 | **Explain, after the fact** | the "here is what was actually happening" overlay in the post-demo slide — the reveal |
| 4 | **Sanity-check yourself** | T1 volume conservation, T4 extremum locations — catches a broken sign or a wrong constant on day 1, not on stage |

**Analogy.** You are training someone to estimate a room's temperature by feel. `nodes.csv` is
their guesses. `truth.npz` is the calibrated thermometer in your pocket. You do not let them see
it — that would defeat the exercise — but without it you can never tell them whether they are
getting better or worse. And crucially: it is not cheating to *own* the thermometer. It is only
cheating to let the student read it.

**Why it must be quarantined:** every use above happens *after* the system has committed to an
answer. The moment any code path in `backend/` can read `truth.npz`, your system stops being a
monitoring system and becomes an elaborate way of copying a file. Worse, it will still *look*
like it works — the dashboard will be beautiful and the alarms will be perfect. This is the
failure mode that kills silently.

**Analogy.** The answer key exists. Every exam has one. The point is that it lives in the
examiner's locked drawer, not in the student's pocket — and the lock is a physical lock, not a
promise from the student.

### 4.5 Why 64×64 and not more

At float32, 64×64 × 1920 frames × 4 arrays: **31.5 MB**. At 128×128 it becomes **126 MB** — do
not. The panel is 600 m × 200 m and the influence radius is 75 m; a 64×64 grid over an 750×350 m
window gives roughly 12 m spacing, which is about six samples across the narrowest real feature.
More resolution buys you a bigger file and nothing else. Your nodes are 30–60 m apart; the
truth grid is already ten times finer than the thing you are trying to reconstruct.

### 4.6 The quarantine, enforced by folders not discipline

```
repo/
  sim/          imports truth/          ← allowed
  truth/        truth.npz, raw_60s.parquet, NO __init__.py
  backend/      may open nodes.csv, events.csv, nodes.json — nothing else
```

Test T8 asserts `import truth` from `backend/` raises `ImportError`. One line of pytest. If C8
can reach `truth.npz`, the project is dead and nobody will notice.

---

## 5. File 4 — `nodes.csv`, the telemetry

### 5.1 Abstract

The big one. Abstractly it is the **degraded observation record**: everything that survived the
journey from the ground, through a cheap sensor, through thermal drift and noise and 16-bit
quantisation, through a lossy mesh radio, to a gateway. It carries kinds 7 and 8 — measurement
and provenance — and deliberately carries **no geometry and no physics**.

**One file for the whole network**, not one per node — because the gateway is the first place in
the system where all thirty nodes exist at once, so it is the first place a file can exist.

This file is your product's entire universe. If a fact is not in here (or in `nodes.json` /
`events.csv`), your system does not know it.

### 5.2 Example

```csv
# GENERATED BY SIMULATOR v1.0 scenario=slow_sag_40d seed=20260315 utc=2026-08-31T09:12:04Z
t_iso,node_id,seq,tilt_x_urad,tilt_y_urad,strain_ue,ext_delta_10um,vib_rms_x100,vib_peak_x100,vib_fdom_hz,temp_dc,vbat_mv,crack_flags,rssi_dbm,snr_db,hops,alive
2026-03-14T14:30:04Z,17,1152,3,13254,-726,-830,31,44,52,478,3611,0,-104,4.5,2,1
2026-03-14T14:30:00Z,22,,,,,,,,,,,,,,0
```

### 5.3 What every column stands for

**Identity — where and when the packet landed**

| Column | Kind | Stands for | Example | Note |
|---|---|---|---|---|
| `t_iso` | Provenance | **arrival** time at the gateway, UTC | `…T14:30:04Z` | not the sample time — the 4 s is mesh latency, and that gap is real information |
| `node_id` | Identity | which node sent it | `17` | join key into `nodes.json` for position |
| `seq` | Provenance | the node's own packet counter | `1152` | gaps in `seq` = packets lost; this is how you *measure* loss |

**The 21 bytes, unpacked — raw and uncorrected**

| Column | Kind | Stands for | Unit on the wire | Example → real value |
|---|---|---|---|---|
| `tilt_x_urad` | Measurement | ground slope, along panel length | int16 µrad | `3` → 3 µrad |
| `tilt_y_urad` | Measurement | ground slope, across panel width | int16 µrad | `13254` → 13 254 µrad ≈ 0.76° |
| `strain_ue` | Measurement | stretch/squeeze of the ground surface | int16 µε | `-726` → −726 µε (compression) |
| `ext_delta_10um` | Measurement | change in the 10 m wire length to the anchor peg | int16, ×10 µm | `-830` → −8.30 mm |
| `vib_rms_x100` | Measurement | average ground shaking over the slot | uint16, ×0.01 mm/s | `31` → 0.31 mm/s |
| `vib_peak_x100` | Measurement | worst shaking in the slot | uint16, ×0.01 mm/s | `44` → 0.44 mm/s |
| `vib_fdom_hz` | Measurement | dominant frequency of the shaking | uint8 Hz | `52` → 52 Hz (blast-like) |
| `temp_dc` | Measurement | chip temperature | int16, ×0.1 °C | `478` → 47.8 °C |
| `vbat_mv` | Measurement | battery voltage | uint16 mV | `3611` → 3.611 V |
| `crack_flags` | Measurement | latched crack state, 2 bits | uint8, 0–3 | `0` → no crack yet |

Note the `_x100`, `_10um`, `_dc` suffixes. They are not decoration — they are the **scale factor
baked into the column name**, so nobody downstream ever has to guess whether `478` is degrees or
tenths. Keep this convention.

**Link quality — only the receiver can measure a journey**

| Column | Kind | Stands for | Why it matters |
|---|---|---|---|
| `rssi_dbm` | Provenance | received signal strength | a node whose RSSI is collapsing is about to disappear; that is a maintenance alert, not an alarm |
| `snr_db` | Provenance | signal-to-noise ratio | distinguishes "weak but clean" from "loud but garbled" |
| `hops` | Provenance | how many nodes relayed it | `2` means it went via two neighbours — mesh topology, visible in the data |

**Liveness**

| Column | Kind | Stands for |
|---|---|---|
| `alive` | Provenance | `1` = packet arrived; `0` = the slot came and went in silence |

### 5.4 Three rules

1. **Values are raw and uncorrected.** No thermal correction, no sag correction. A node that
   corrects its own data has destroyed the evidence. Correction happens in `backend/` at C7,
   where it is auditable.
2. **A dead node is a present, blank row — never an omitted row.** Downstream must be able to
   tell "node 22 exists and is silent" from "node 22 was never installed." Omit the row and the
   PINN silently treats a dead zone as unmonitored territory. This is what the second example
   row above is: node 22, everything blank, `alive=0`.
3. **No `x`, `y`, no `source: sim`.** Position comes from `nodes.json` at the gateway. The
   simulated-data tag rides a separate MQTT topic (`mine/panel4/meta`) that the detection path
   does not subscribe to — otherwise someone eventually writes `if source == "sim"` in the
   detector and the seam is broken forever. The `#` watermark header is fine; the backend skips
   comment lines.

**Row count:** 31 nodes × 5 760 slots = 178 560 attempts, ~92% delivered ≈ **164 275 rows**.
(This settles Q7 in your checklist: rows are appended **on arrival**, i.e. one per node per
10-minute transmission — not per epoch.)

---

## 6. The three cadences — and the 60 s question, resolved

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
what the reshape in §7.2 does.

**Analogy.** A person stands in a field counting cars. They glance at the road every minute.
They do not write every minute down — they keep three numbers in their head: the average, the
biggest, and whether anything alarming happened. Every ten minutes they shout those three
numbers across the field and start again. The minute-by-minute counts were real; they just never
left their head.

### 6.1 If you want a live ticker on Website 1

Dump the 60 s series to a **fifth, optional file**: `truth/raw_60s.parquet`, `(31, 57600)` per
channel. It sits inside `truth/`, which the backend cannot import, so the seam holds. Use it for:
- the scrolling raw-data ticker on the simulator screen,
- your debug oracle when the detector misbehaves.

Never let `backend/` open it.

---

## 7. How the huge table is actually built — nothing loops over time

This is the answer to "how do we make so much data."

### 7.1 The idea in plain language

**You never generate a row.** You build a handful of large rectangles of numbers, and then you
slice them.

The reason you can do this is the single most important consequence of the maths spec:
`S(x, y, t)` is **closed-form**. There is a formula. You do not have to know what the ground did
at minute 4,000 in order to work out minute 4,001 — you can jump straight to any minute you like.

That one property collapses the entire problem. If the ground model needed stepping (like a
weather simulation does), you would be stuck with 1.79 million sequential iterations. Because it
does not, you can ask numpy for **all 1.79 million values at once**, in a single call.

**Analogy 1 — the stencil.** You are not stamping 1.8 million dots one at a time. You have one
stencil — the surface function — and you press it onto the whole sheet in a single motion. Then
five more stencils for the damage. Six presses total.

**Analogy 2 — the multiplication table.** If someone asks you to write out a 31 × 57,600
multiplication table, you do not do 1.79 million multiplications in your head one after another.
You write the 31 row-headers down the side, the 57,600 column-headers across the top, and the
whole grid is determined. Numpy calls this **broadcasting**, and it is exactly that: give it a
`(31, 1)` column of node values and a `(1, 57600)` row of time values, and it fills in the
1.79-million-cell rectangle for you in one operation.

**Analogy 3 — the reshape.** You have 57,600 minutes in a long line. You want ten-minute
averages. You do not walk the line adding things up. You just decide to *look at the same line
differently* — as 5,760 groups of 10 — and take the average of each group. Nothing moved. You
relabelled the shelf. That is `arr.reshape(31, 5760, 10).mean(axis=2)`, and it is free.

### 7.2 The array-shape pipeline

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

Read the shapes down the left and the story is obvious: everything stays a `(31, 57600)`
rectangle until the reshape squashes it to `(31, 5760)`, and only then does anything become a
row.

### 7.3 The volume arithmetic

| Quantity | Count | Note |
|---|---|---|
| Simulated minutes, 40 days | 57 600 | 40 × 24 × 60 |
| Nodes | 31 | 28 field + 2 anchor + 1 gateway |
| Reading structs conceptually computed | 1 785 600 | **never stored as objects** |
| 10-min transmit slots | 5 760 per node | 57 600 ÷ 10 |
| Packets attempted | 178 560 | 31 × 5 760 |
| Rows surviving in `nodes.csv` (~92%) | **164 275** | ~20 MB |
| 30-min truth frames at 64×64 | 1 920 | 31.5 MB |
| One channel as `float64 (31, 57600)` | 14.3 MB | ×10 channels = 143 MB peak |

Target runtime for the whole 40-day run: **under 30 seconds**. If it takes minutes, you have a
Python `for` loop where an array operation belongs.

Note the phrase "never stored as objects." There is no point at which 1.79 million Python
objects exist. There are about ten arrays of 1.79 million floats, which is a completely
different thing — 143 MB instead of several gigabytes, and a thousand times faster.

**Analogy.** 1.79 million loose beads in a jar versus ten strings of beads. Same beads. One of
them you can pick up.

### 7.4 The four things people assume need a loop, and do not

| Looks sequential | Actually is | Why it works |
|---|---|---|
| bias random walk | `scipy.signal.lfilter` (exact OU), or pre-scaled `cumsum` | a random walk is just a running total, and running totals are one call |
| crack latch (never closes) | `np.maximum.accumulate(bucket, axis=1)` | "the worst it has ever been so far" is a running maximum |
| 60 s → 10 min averaging | `arr.reshape(31, 5760, 10).mean(axis=2)` | relabelling, not moving |
| peak-hold on vibration | same reshape, `.max(axis=2)` | same relabelling, different summary |

The crack latch is the nicest one. It *feels* like it needs a loop with an `if` in it — "once
it cracks, it stays cracked." But "stays cracked" is literally the definition of a running
maximum. One call, no branch.

### 7.5 What genuinely does loop

Only the **mesh radio**, because routing depends on per-packet dice rolls and duty-cycle state —
whether a packet gets through depends on what happened to the packets before it. That is
178 560 iterations of about ten operations each — a few seconds in plain Python. Leave it.

**Analogy.** Everything up to here is printing the phone book: one press, all pages. The radio
is posting the phone book, one envelope at a time, where whether each envelope arrives depends
on how full the postbox already is.

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

## 9. The repo layout — what `sim/`, `truth/` and `backend/` actually are

You asked what `/sim` is. It is not a data folder. It is **one of three programs**, and the
folder boundary between them is the most load-bearing design decision in the project.

```
repo/
  nodes.json            ← authored input, read by all three
  events.csv            ← authored input, read by sim AND backend, separately
  sim/                  ← THE SIMULATOR.       components C1–C5.  may import truth/
  truth/                ← THE ANSWER KEY.      truth.npz, raw_60s.parquet.  NO __init__.py
  backend/              ← THE PRODUCT.         components C6–C10.
  nodes.csv             ← generated output, the only bridge between sim/ and backend/
```

### 9.1 What each one is

| Folder | It is | Components | May read | Analogy |
|---|---|---|---|---|
| `sim/` | the **fake mine** — pretends to be thirty-one buried devices and the ground under them | C1 ground engine, C2 sensor sampler, C3 node firmware model, C4 mesh radio, C5 gateway | everything | the film set, the actors, the special effects team |
| `truth/` | the **answer key** — what really happened, at full resolution | none (it is data, not code) | — | the sealed envelope with the answers |
| `backend/` | the **actual product** — the thing you are pitching | C6 store, C7 epoch assembler, C8 detector, C9 PINN, C10 explainer, C12 alert chain | `nodes.csv`, `events.csv`, `nodes.json` **and nothing else** | the audience, watching the film, trying to work out the plot |

### 9.2 Why the wall matters

In Phase 2, `sim/` gets deleted and replaced by actual ESP32 boards on an actual hillside.
`backend/` does not change by one line.

That is the whole point of the split, and it is also the thing that makes the demo honest. If
`backend/` never imports from `sim/` or `truth/`, then swapping simulated hardware for real
hardware is a *configuration change*, not a rewrite. If it does import, you have not built a
monitoring system — you have built a very elaborate playback device, and Phase 2 is a
from-scratch rebuild that will never happen.

**Analogy.** A flight simulator and a cockpit. The instruments in the cockpit do not know or
care whether the numbers coming down the wire were produced by real air or by a computer in the
next room. That ignorance is not a limitation — it is the entire reason a simulator is worth
building. The moment the instruments start peeking at the simulator's internal state to make
themselves look good, the training is worthless and the pilot dies.

### 9.3 How the wall is enforced

`truth/` contains **no `__init__.py`**. That single missing file means Python cannot import it as
a package from `backend/`. Test T8 asserts that `import truth` from inside `backend/` raises
`ImportError`. It is one line of pytest and it is the most valuable test in the repository.

Do not enforce this with a code review rule or a comment. Enforce it with the filesystem.
Discipline erodes at 2 a.m. the night before a demo; a missing `__init__.py` does not.

---

## 10. The five rules that must not be broken

| # | Rule | What breaks if you break it |
|---|---|---|
| 1 | Exactly one implementation of `S(x,y,t)` | your detector spends the demo detecting the disagreement between your own two models |
| 2 | `truth/` has no import path from `backend/` | the project is dead and nobody notices |
| 3 | `events.csv` is opened as a file by both sides | the blast-suppression demo becomes a magic trick |
| 4 | `nodes.json` seeds written once, never regenerated | the demo behaves differently at every rehearsal |
| 5 | Noise arrays generated for the **full** span, then sliced | historical + live windows disagree; PS bullet 18 collapses |

Rule 5 is the one teams break without noticing. Node 17's values for days 20–40 must be
byte-identical whether you started the run at day 0 or day 20.

**Analogy for rule 5.** If you deal a deck of cards, the twentieth card is the twentieth card
whether or not you looked at the first nineteen. Generating noise incrementally is like
reshuffling every time someone walks in — the second half of the run stops matching itself.

---

## 11. Why a PINN at all — and what happens to `truth.npz` in the real world

This section answers three questions that a judge will ask and that Part 2 needs answered in
writing. It ends with the tables to hand to whoever builds the network.

### 11.1 The knockout fact — no node measures subsidence

Go back to the master sensor table. Look at what each channel actually is:

| Sensor | What it physically measures | In maths |
|---|---|---|
| Tilt | slope of the ground | `∂S/∂x`, `∂S/∂y` |
| Extensometer | stretch between two pegs | `B·∇S` along a line |
| Strain | how fast the slope is changing | `B·∂²S/∂y²` |
| Crack | worst strain ever seen here | latch on `∂²S/∂y²` |

**Not one of them reports `S`.** You have exactly zero measurements of the quantity you want to
draw.

So "we already have the parameters, why not just build the terrain from the node data and skip
the neural network" runs into a wall immediately: there is nothing to interpolate. You cannot
interpolate a surface from samples of its *derivatives*. You would have to **integrate a noisy,
scattered 2-D gradient field** — and that is an ill-posed problem:

- it needs a constant of integration (your two anchor nodes supply it: `S = 0` out there),
- and noisy measured gradients are almost never curl-free, so the answer **depends on the path
  you integrate along**. North-then-east gives one surface; east-then-north gives a different
  one. There is no correct choice.

Turning 28 scattered derivative samples into one self-consistent surface *is* the PINN's job.
No interpolator does it.

**Analogy.** Thirty people scattered in a dark field. None of them can tell you how deep the
ground is where they stand. Each can only tell you **which way it slopes under their feet**, and
some of them are lying because they are cold. Your job is to draw the shape of the whole field.
Averaging slopes gets you nothing. You have to find the one landscape that would make all thirty
of those slope-reports true at once.

### 11.2 The four sensors are four different derivative orders of one surface

This is your "one surface, four questions" principle running backwards.

An interpolator handles **one scalar field at a time**. Interpolate tilt, then separately
interpolate strain, and you get two surfaces that **contradict each other** — differentiate your
interpolated tilt and it will not equal your interpolated strain. Nothing in a spline or an IDW
or a kriging fit forces those to agree.

A PINN fits **a single function** `S(x, y, t)`, then asks it:
- what tilt do you imply at node 17? → compare to node 17's tilt
- what strain do you imply at node 17? → compare to node 17's strain
- what extensometer delta do you imply along node 17's wire? → compare to that

All four channels constrain the **same object**. That is sensor fusion, and it is not optional —
it is the only way to use all your channels at once instead of picking a favourite.

**Analogy.** Three witnesses describe a robber. One saw the height, one saw the jacket, one saw
the walk. None saw the whole person. The job is to construct the **one person** consistent with
all three — not to average the descriptions and not to pick the most reliable witness.

### 11.3 The other four things the PINN buys, and the interpolator does not

| # | Problem | What an interpolator does | What the PINN does |
|---|---|---|---|
| 1 | **Six nodes die** | draws a smooth, flat, featureless patch across the hole — which is exactly what a forming trough does *not* look like | the physics loss still samples that region, so the gap is filled with the shape a coal panel *must* make |
| 2 | **Noise** | passes exactly through every data point, faithfully reproducing every bit of thermal drift and quantisation error | is allowed to disagree with a noisy node, weighted by that node's sigma |
| 3 | **You need derivatives everywhere** | differentiating a spline amplifies its noise; curvature comes out unusable | derivatives are exact and analytic via autodiff, at any point, free |
| 4 | **Impossible shapes** | will happily draw a trough with a spike or a cliff, because it has no idea what a subsidence bowl is | physically impossible surfaces score badly and get thrown away |

Point 1 is the one you will demo. You are going to press the Kill Cluster button in front of the
judges, and the answer to "how do you know what happened where the sensors died?" needs to be
*"physics decided, and here is the loss term that did it"* — not *"we averaged the edges."*

### 11.4 And the safety rule that makes all of this low-risk

> **The PINN draws. It never decides.**

Alarms are owned entirely by the classical bowl-fit plus the blast cross-check (C8). So even if
the reconstruction is imperfect, nothing unsafe follows from it. The neural network produces the
**picture**; the classical layer produces the **decision**. Keep saying this out loud — it is
what makes an AI component acceptable in a safety system.

### 11.5 Does `truth.npz` exist in a real mine? No. And that is fine.

**It does not exist, it cannot exist, and the system does not need it.**

Here is why that is not a problem: **the PINN is never trained on `truth.npz`.** Not one loss
term touches it. Delete the file and the network trains identically, because what it is actually
trained on is:

- the residual between each node's measured value and the value the surface implies there, and
- a physics term evaluated at random points where no node exists.

Both of those are available in a real mine on day one. What you lose by deleting `truth.npz` is
not the ability to **run** the system — it is the ability to **score** it.

**Analogy.** You are training someone to estimate a room's temperature by feel. `truth.npz` is
the calibrated thermometer in your pocket. They never see it — that would defeat the exercise.
Take the thermometer away and they can still practise; you just can't tell them whether they are
getting better.

### 11.6 What replaces it in the field — four things

| # | Real-world substitute | Coverage | Frequency | Accuracy | Notes |
|---|---|---|---|---|---|
| 1 | **Periodic survey** — total station / DGPS on benchmark pegs | ~15 points | monthly | mm | the industry's literal term for this is *ground truth*; sparse and late, but real |
| 2 | **InSAR** — Sentinel-1 satellite radar | whole panel, as an image | every 6–12 days | mm, line-of-sight | **free**, and it is genuinely a low-res, slow `truth.npz` frame. One line in your deck. |
| 3 | **The event itself** | the collapse location | once, grimly | exact | every real subsidence event is a labelled datapoint forever |
| 4 | **Leave-one-node-out cross-validation** | every node, always | every epoch | relative | **needs no ground truth at all** |

**Number 4 is the real answer, and it is the thing to say on stage.**

Hide node 17 from the network. Reconstruct the surface from the other 27. Now predict what node
17 *should* be reading. Compare it to what node 17 actually reported.

That runs in production, continuously, forever, on a live mine, with no survey team and no
satellite. It produces an accuracy number on the dashboard. It is how you know the system is
working when nobody has the answer key.

**Analogy.** A weather service does not need to know the future to know it is good at
forecasting. It forecasts, waits, and checks. Leave-one-out is the same trick played across
space instead of time: hold one sensor back, predict it, check it.

### 11.7 The paragraph to memorise

> `truth.npz` is not the PINN's teacher — the network never sees it. It is our **examiner**, and
> it exists only because we are in a simulation, where we can afford one. In the field the
> examiner becomes a monthly total-station survey, free Sentinel-1 InSAR, and continuous
> leave-one-node-out cross-validation. The PINN itself is completely unaffected, because it was
> never trained against truth in the first place — it is trained on sensor residuals plus a
> physics constraint, and both of those exist on a real hillside.

---

## 12. The three flowcharts — data creation, data insertion, and the screen

Everything below is the same system viewed at three different distances. Times are marked on
every arrow. Read the units carefully: **real time** is wall-clock seconds on your laptop;
**sim time** is time inside the simulated mine.

### 12.1 Flow A — making the data (happens ONCE, before the demo)

```
                    ══ REAL TIME: under 30 seconds, one command ══
                    ══ SIM TIME COVERED: 40 days ══

  ┌──────────────┐   ┌──────────────┐
  │  nodes.json  │   │  events.csv  │      you wrote both of these by hand
  │  31 nodes    │   │  blasts,     │
  │  6 panel nos │   │  trucks,     │
  │  seeds       │   │  node kills  │
  └───────┬──────┘   └───────┬──────┘
          │                  │
          └────────┬─────────┘
                   ▼
        ┌─────────────────────────┐
        │  STEP 1  THE GROUND     │   S(x,y,t) — one formula, closed form
        │  "what the earth does"  │   no loop over time, one numpy call
        └───────┬─────────────────┘
                │
      ┌─────────┴──────────┐
      │                    │
      ▼                    ▼
┌─────────────┐    ┌──────────────────────┐
│ evaluate on │    │  STEP 2  THE SENSORS │  ask S four questions at 31 points
│ 64×64 grid  │    │  tilt, strain, ext,  │  → clean values, (31, 57600)
│ 1920 frames │    │  crack               │
│             │    └──────────┬───────────┘
│             │               ▼
│             │    ┌──────────────────────┐
│             │    │  STEP 3  THE DAMAGE  │  thermal drift, bias walk, white
│             │    │  6 stages, in order  │  noise, battery sag, quantise,
│             │    │                      │  + blast/truck vibration
│             │    └──────────┬───────────┘
│             │               ▼
│             │    ┌──────────────────────┐
│             │    │  STEP 4  THE SQUASH  │  60 s → 10 min
│             │    │  reshape + mean/max  │  (31, 57600) → (31, 5760)
│             │    └──────────┬───────────┘
│             │               ▼
│             │    ┌──────────────────────┐
│             │    │  STEP 5  THE RADIO   │  the ONLY real loop
│             │    │  178 560 packets     │  ~8% get lost forever
│             │    └──────────┬───────────┘
▼                             ▼
┌──────────────┐      ┌──────────────┐
│  truth.npz   │      │  nodes.csv   │
│  31 MB       │      │  20 MB       │
│  THE ANSWERS │      │  THE EVIDENCE│
└──────┬───────┘      └──────┬───────┘
       │                     │
   locked in              this is the
   truth/ —               ONLY thing
   nobody                 that crosses
   downstream             the seam
   may read it
```

**The one thing to notice:** both files come out of the **same** `S(x,y,t)`, at the same instant,
from the same run. `truth.npz` is that surface photographed perfectly. `nodes.csv` is that same
surface felt by thirty-one cheap devices over a bad radio link. Same reality, two levels of
damage.

### 12.2 Flow B — feeding the data in, over time

Now the generator is finished and `nodes.csv` is just sitting on disk. This is what happens
during the demo.

```
             ┌────────────────────────────┐
             │  nodes.csv  (164 275 rows) │   sitting on disk / in SQLite
             └─────────────┬──────────────┘
                           │
                           │  replayed in timestamp order
                           │  1 sim-second → 1/60 real-second at 60× speed
                           ▼
             ┌────────────────────────────┐
   EVERY     │  C6  STORE                 │   rows land as they "arrive"
  10 SIM-MIN │  one row per node per slot │   dead nodes land as blank rows
             └─────────────┬──────────────┘
                           ▼
             ┌────────────────────────────┐
   EVERY     │  C7  EPOCH ASSEMBLER       │   this is the ONLY place raw
  10 SIM-MIN │  ─────────────────────     │   numbers become physical ones
             │  1 gather the slot         │
             │  2 dedupe                  │
             │  3 undo thermal drift      │   ← uses temp from the same row
             │  4 undo battery sag        │   ← uses vbat from the same row
             │  5 convert to SI units     │
             │  6 ATTACH SIGMA            │   ← big correction → big sigma
             │  7 look up x,y from        │
             │    nodes.json              │
             │  8 emit silent nodes       │
             └─────────────┬──────────────┘
                           ▼
                  ╔═══════════════════╗
                  ║  THE EPOCH OBJECT ║   31 observations, in metres/radians,
                  ║  ~4 KB            ║   each with an uncertainty attached
                  ╚═════════╤═════════╝
                            │
          ┌─────────────────┴──────────────────┐
          │                                    │
   FAST LANE                             SLOW LANE
   every 10 sim-min                      every 30 sim-min
          │                                    │
          ▼                                    ▼
┌──────────────────────┐          ┌────────────────────────────┐
│  C8  THE DETECTOR    │          │  C9  THE PINN              │
│  ─────────────────   │          │  ─────────────────         │
│  classical, no AI    │          │  warm start from last time │
│  fit a Knothe bowl   │          │  ~400 Adam steps           │
│  check R²            │          │  5 loss terms              │
│                      │          │  1–3 real seconds          │
│  vibration spike?    │          │        │                   │
│      ↓ yes           │          │        ▼                   │
│  open events.csv ────┼──┐       │  forward pass on 64×64     │
│  blast logged?       │  │       │  ~5 milliseconds           │
│      ↓ yes           │  │       │        │                   │
│  SUPPRESS + log      │  │       │        ▼                   │
│      ↓ no            │  │       │  a continuous surface,     │
│  ALARM LEVEL         │  │       │  including where nodes died│
│  + days to next      │  │       │                            │
│                      │  │       │  ► DRAWS. NEVER DECIDES.   │
│  ► OWNS THE ALARM    │  │       └────────────┬───────────────┘
└──────────┬───────────┘  │                    │
           │              │                    │
           │      ┌───────┴──────┐             │
           │      │  events.csv  │             │
           │      │  opened as a │             │
           │      │  SEPARATE    │             │
           │      │  FILE        │             │
           │      └──────────────┘             │
           └──────────────┬───────────────────-┘
                          ▼
                    to Flow C
```

**The two lanes and why they run at different speeds:**

| Lane | Cadence | Why that cadence |
|---|---|---|
| Detector (C8) | **10 sim-min** | it is the alarm path; it must be as fast as data arrives |
| PINN (C9) | **30 sim-min** | subsidence moves in days. Retraining every 10 min would cost 3× the compute to redraw a surface that has barely moved. |

**The demo-clock caveat (your Q1).** At 14 400× speedup, 30 sim-minutes is 0.125 real seconds —
and a PINN retrain takes 1–3 real seconds. The numbers do not fit. Resolution: **pre-compute the
baseline 40-day reconstructions offline**, play them back, and trigger a genuine **live retrain
only after a Kill Cluster or blast event**. The judges then watch a real retrain happen at
exactly the moment it matters, and the rest of the timeline costs nothing.

### 12.3 Flow C — joining it to the screen

```
   ┌──────────────────┐        ┌──────────────────┐       ┌──────────────────┐
   │  C8 DETECTOR     │        │  C9 PINN         │       │  C7 EPOCH        │
   │  alarm level     │        │  64×64 surface   │       │  31 node states  │
   │  + reason        │        │  + LOO residuals │       │  + sigmas        │
   │  every 10 min    │        │  every 30 min    │       │  every 10 min    │
   └────────┬─────────┘        └────────┬─────────┘       └────────┬─────────┘
            │                           │                          │
            └───────────────┬───────────┴──────────────────────────┘
                            ▼
                 ┌─────────────────────┐
                 │  C10 THE EXPLAINER  │   turns the decision path into
                 │  one English        │   ONE SENTENCE — no LLM, a
                 │  sentence           │   template filled from C8's
                 │  on alarm change    │   own numbers
                 └──────────┬──────────┘
                            ▼
                 ┌─────────────────────┐
                 │  C11 THE API        │   WebSocket push
                 │  JSON payload       │   ~40 KB per update
                 └──────────┬──────────┘
                            ▼
        ┌───────────────────┴───────────────────┐
        ▼                                       ▼
┌─────────────────────┐              ┌─────────────────────┐
│  WEBSITE 1          │              │  WEBSITE 2          │
│  THE SIMULATOR      │              │  THE DASHBOARD      │
│  ─────────────────  │              │  ─────────────────  │
│  raw 60 s ticker    │              │  3-D surface, 64×64 │  ← from C9
│  node map, alive/   │              │  node pins + status │  ← from C7
│    dead             │              │  alarm banner       │  ← from C8
│  KILL CLUSTER btn   │              │  the one sentence   │  ← from C10
│  BLAST NOW btn      │              │  days-to-threshold  │  ← from C8
│  speed slider       │              │  live accuracy %    │  ← from LOO
│                     │              │                     │
│  ► reads truth/     │              │  ► NEVER reads      │
│    (allowed)        │              │    truth/           │
└─────────────────────┘              └─────────────────────┘
      the film set                        the cockpit
```

**Why two websites and not one.** Website 1 is allowed to see everything, including `truth/`,
because it is the simulator's own control panel — it is honest about being a simulator. Website
2 is the product, and it only ever sees what a real deployment would see. Putting them on one
screen would blur exactly the line you are trying to prove exists.

### 12.4 All the clocks in one table

| Thing | Sim-time cadence | Real time it takes | Where |
|---|---|---|---|
| Node reads its sensors | 60 s | — | node RAM only, never leaves |
| Node transmits 21 bytes | 10 min | — | becomes a `nodes.csv` row |
| Epoch assembled (C7) | 10 min | ~10 ms | `backend/` |
| Detector runs (C8) | 10 min | ~50 ms | `backend/` |
| PINN retrains (C9) | 30 min | 1–3 s | `backend/`, warm-started |
| PINN draws 64×64 grid | 30 min | ~5 ms | one forward pass |
| Truth frame recorded | 30 min | — | offline only, scoring |
| Dashboard update pushed | 10 min | ~5 ms | WebSocket |
| **Whole 40-day dataset generated** | — | **< 30 s, once** | `sim/` |

---

## 13. What the PINN actually needs — the Part 2 handoff

Everything below is written to be handed to whoever builds the network. It is a contract: if
Part 1 delivers these fields and Part 2 consumes exactly these fields, the two halves meet
without a meeting.

### 13.1 What goes IN — conceptually

Four groups. Nothing else.

| Group | What it is | Where it comes from | Changes over time? |
|---|---|---|---|
| **A. Geometry** | where every node is, and where its extensometer peg is | `nodes.json`, loaded once | never |
| **B. Observations** | what each node measured, corrected to SI, with an uncertainty | the epoch object from C7 | every 10 min |
| **C. Anchors** | the two nodes outside the angle of draw where `S = 0` | `nodes.json` + epoch | never (the constraint), yes (the reading) |
| **D. Physics parameters** | the panel rectangle, depth, and the two **learnable** shape constants | `nodes.json`, but see §13.5 | the learnable two are updated by training |

### 13.2 What goes IN — the exact arrays

Give Part 2 this table and nothing else is needed.

Let `N = 31` (nodes), `M` = number of collocation points (2 000), `G = 64` (grid side).

| Name | Shape | dtype | Units | Meaning | Source |
|---|---|---|---|---|---|
| `xy` | `(N, 2)` | f32 | metres | node positions | `nodes.json`, static |
| `ext_to` | `(N, 2)` | f32 | metres | far peg of the extensometer wire; NaN if none | `nodes.json`, static |
| `t` | scalar | f32 | days since `start_iso` | the epoch's timestamp | epoch |
| `obs_tilt_x` | `(N,)` | f32 | **radians** | measured slope in x, corrected | epoch, step 5 of C7 |
| `obs_tilt_y` | `(N,)` | f32 | **radians** | measured slope in y, corrected | epoch |
| `obs_strain` | `(N,)` | f32 | **dimensionless** | measured strain, corrected | epoch |
| `obs_ext` | `(N,)` | f32 | **metres** | measured wire-length change | epoch |
| `sigma_tilt_x` | `(N,)` | f32 | radians | uncertainty on that reading | epoch, step 6 |
| `sigma_tilt_y` | `(N,)` | f32 | radians | uncertainty | epoch, step 6 |
| `sigma_strain` | `(N,)` | f32 | — | uncertainty | epoch, step 6 |
| `sigma_ext` | `(N,)` | f32 | metres | uncertainty | epoch, step 6 |
| `valid` | `(N, 4)` | bool | — | is this node/channel usable this epoch? | epoch, step 8 |
| `is_anchor` | `(N,)` | bool | — | true for the 2 anchors | `nodes.json` |
| `panel` | 4 floats | f32 | metres | `x1, y1, x2, y2` | `nodes.json` |
| `H`, `tan_beta` | scalars | f32 | m, — | depth, influence flare | `nodes.json` |
| `m_seam` | scalar | f32 | metres | seam thickness extracted | `nodes.json` |
| `grid_x`, `grid_y` | `(G,)` each | f32 | metres | where to draw the output | `nodes.json` |

**`valid` is the field people forget.** It is `(N, 4)`, not `(N,)`, because a node can deliver a
good tilt reading and a garbage strain reading in the same packet. Masking per node instead of
per channel throws away good data.

### 13.3 What must NEVER go in

| Channel | Why it is withheld |
|---|---|
| **`truth.npz`, any part of it** | it is the answer key. One import and the system becomes a playback device that still looks like it works. |
| Vibration (rms, peak, f_dom) | a transient. It does not constrain a surface that moves over days. Goes to C8 instead. |
| Crack flags | derived from strain. Feeding it in double-counts the same evidence. |
| Temperature | already consumed in C7 step 3. Passing it again lets the network re-learn a correction that has already been applied. |
| Battery voltage | already consumed in C7 step 4. |
| `rssi`, `snr`, `hops` | link quality, not ground physics. It belongs in the sigma calculation, not the network. |
| Raw uncorrected values | if C7 has not corrected it, the network will fit thermal drift and call it subsidence. |

Vibration, crack, temperature and battery all go to the **classical detector**, where they
belong. That split is deliberate — write it down.

### 13.4 The network itself

| Property | Value | Why |
|---|---|---|
| Input | `(x, y, t)`, normalised to roughly `[-1, 1]` | coordinate MLP; normalisation is not optional for PINNs |
| Output | `S`, a single scalar, in metres, **down positive** | one surface |
| Shape | 4 hidden layers × 64 units | ~13 000 parameters; tiny, runs on CPU |
| Activation | `tanh` | must be smooth to second order — ReLU has zero second derivative and your strain loss dies |
| Derivatives | autograd on the network's own output | `∂S/∂x`, `∂S/∂y`, `∂²S/∂y²` — exact, not finite-differenced |
| Optimiser | Adam, ~400 steps per epoch | warm-started from the previous epoch's weights |
| Warm start | **yes, always** | the surface barely moved in 30 min; starting cold every time wastes 90% of the compute |

**The activation choice is the trap.** You need `∂²S/∂y²` for the strain loss. ReLU's second
derivative is zero everywhere, so a ReLU network has no curvature to compare against your strain
measurement, and loss 2 silently contributes nothing. Use `tanh`. Say it twice.

### 13.5 The five loss terms

| # | Loss | Compares | Weight | Evaluated at |
|---|---|---|---|---|
| 1 | **Tilt** | network `∂S/∂x`, `∂S/∂y` vs `obs_tilt_x`, `obs_tilt_y` | `1/σ²` | the 31 node positions |
| 2 | **Strain** | network `B·∂²S/∂y²` vs `obs_strain` | `1/σ²` | node positions |
| 3 | **Extensometer** | network's implied length change along the peg-to-peg line vs `obs_ext` | `1/σ²` | node → `ext_to` lines |
| 4 | **Anchor** | network `S` vs `0` | high, fixed | the 2 anchor positions |
| 5 | **Physics** | network `S` vs the Knothe form | moderate | **2 000 random points**, resampled every epoch |

**Loss 4 is doing enormous work for one line of code.** Losses 1–3 all constrain *shape* and
none constrain *height*. Without the anchors you get a perfectly-shaped bowl floating at an
arbitrary depth — the maths genuinely cannot tell 5 mm from 5 metres. The anchors convert
relative shape into absolute millimetres.

**Loss 5 is what fills the dead zone.** It samples 2 000 random points regardless of where nodes
are. Over a region where six nodes were killed, losses 1–3 contribute nothing — there is no data
there. Loss 4 is far away. Loss 5 is still fully present, and it says: *whatever is here must be
a smooth Knothe bowl consistent with the edges around it.* That is a defensible reconstruction,
not a guess.

### 13.6 The circularity trap — read this one carefully

Loss 5 says "S must obey the Knothe form." If you hand the network the **true** `a` (subsidence
factor) and `c` (time constant) from `nodes.json`, then loss 5 alone fully determines the answer.
The network will reconstruct the correct surface **without looking at a single sensor**, and your
demo will be a very elaborate way of re-drawing a formula you already typed in.

**The fix:** make `a` and `c` **learnable scalar parameters**, initialised to plausible-but-wrong
values and optimised alongside the network weights.

| Parameter | Fixed or learned | Initialise to | Why |
|---|---|---|---|
| `x1, y1, x2, y2` (panel rect) | **fixed** | true value | the mine plan is a real known input |
| `H` (depth) | **fixed** | true value | also known from the mine plan |
| `tan_beta` | **fixed** | true value | a regional geology constant |
| `a` (subsidence factor) | **LEARNED** | 0.5 (true is 0.65) | this is what the sensors are for |
| `c` (time constant) | **LEARNED** | 0.008 (true is 0.01414) | ditto |

Now loss 5 constrains only the *family* of shapes, and the sensors have to pick which member of
that family is real. The network genuinely needs its data. And you get a bonus deliverable:
**the converged `a` and `c` are themselves a result**, printable on the dashboard as
*"estimated subsidence factor: 0.63."*

This is the single most important paragraph in the handoff. If Part 2 gets this wrong, the whole
system is a magic trick and it will still look like it works.

### 13.7 What comes OUT

| Name | Shape | Units | Goes to | Cadence |
|---|---|---|---|---|
| `S_grid` | `(64, 64)` | metres, down positive | the 3-D dashboard surface | 30 min |
| `tilt_x_grid`, `tilt_y_grid` | `(64, 64)` each | radians | contour overlay, optional | 30 min |
| `strain_grid` | `(64, 64)` | dimensionless | the tension heat-map overlay | 30 min |
| `a_hat`, `c_hat` | scalars | —, per day | the "estimated parameters" panel | 30 min |
| `loo_residual` | `(N,)` | per-channel σ | **the live accuracy number** | 30 min |
| `weights` | — | — | saved, to warm-start the next epoch | 30 min |

`loo_residual` is the leave-one-out check from §11.6. It is the only output that tells you the
system is working **without** an answer key, so it is the one that survives into a real
deployment. Make sure it appears on the dashboard.

### 13.8 The scoring path — simulation only, quarantined

This is the part that uses `truth.npz`, and it lives entirely outside `backend/`.

```
   backend/  ──→  S_grid (64,64)  ──┐
                                    ├──→  scripts/score.py  ──→  RMSE, bias, max error
   truth/    ──→  truth.S[frame] ───┘         (lives in NEITHER folder)
```

`scripts/score.py` may import both. `backend/` may import neither. It runs **after** a demo, not
during one, and it produces the sentence you want:

> *"Reconstructed the surface to 4.2 mm RMSE from 31 noisy points with 8% packet loss and six
> nodes killed."*

That sentence is why `truth.npz` exists at all.

### 13.9 The one-page summary for the Part 2 owner

> You get a 4 KB epoch object every 30 simulated minutes. It contains 31 node positions, up to
> four corrected sensor readings per node in SI units, an uncertainty for each, a validity mask,
> two anchor points where `S = 0`, and the panel geometry. You fit a small `tanh` MLP mapping
> `(x, y, t) → S`. Five losses: three matching autodiff derivatives against sensors, one pinning
> the anchors to zero, one enforcing the Knothe shape at 2 000 random points with **learnable**
> `a` and `c`. Warm-start from last epoch, ~400 Adam steps, 1–3 seconds. Output a 64×64 surface,
> the two learned parameters, and a leave-one-out residual. You never see the ground truth, you
> never raise an alarm, and you never touch vibration, crack, temperature or battery.

---

## 14. Say it in six lines

> We author two files: a registry of where the sensors are, and a register of what else was
> happening. We generate two: the true ground surface every thirty minutes, and the telemetry
> the nodes actually managed to transmit every ten. The generator never loops over time — the
> subsidence model is closed-form, so every channel is one numpy call on a 31 × 57,600 array,
> and forty days of a whole minefield takes under thirty seconds. Only the telemetry file
> crosses into the product. The true surface is locked in a folder the backend cannot import,
> and we only open it afterwards, to mark our own exam.
