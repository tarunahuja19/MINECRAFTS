# Part 1 reference — sensors, files, transmission, and the PINN handoff

**Scope.** Everything between "a sensor sits in the mud" and "a neural network draws a map."
Written to be read top to bottom. No prior context needed.

**Companion file.** `subsidence-simulation.html` — open it in any browser. It runs the
maths in this document live.

---

## 0. The one-paragraph version

Thirty identical boxes sit on pegs in a field above a coal panel. Each box measures four
things about the ground under it, every 60 seconds. Every 10 minutes it puts 21 bytes on a
radio. Those bytes hop from box to box until one copy reaches a gateway. The gateway
appends a line to a single CSV file. Every 30 minutes a program reads the last slice of that
file, cleans it, and hands one JSON object to a neural network. The network turns 30 dots
into a continuous surface. A separate classical program decides whether to raise an alarm.

---

## 1. What one node physically is

```
                    ┌─────────────┐  solar panel
                    │             │
              ╔═════╧═════════════╧═════╗
              ║   sealed box            ║ ── radio antenna
              ║   MCU + radio + battery ║
              ║   IMU chip inside       ║
              ╚═══════════╤═════════════╝
  ─────────────────────── │ ────────────────────────  ground surface
      crack line ~~~~~~   │        ┌──────────────┐
                          │        │              │
    [peg B]═══strain rod══[peg A]  │ 10 m wire    │
                          │        └──────► [peg C]
                          │  anchor peg
```

Three pegs per node. A peg is a short concrete or steel post set into the ground so that it
moves exactly with the ground and cannot wobble independently.

- **Peg A** carries the node itself.
- **Peg B** is 1 m away; a rod spans A to B with a strain gauge on it.
- **Peg C** is 10 m away, across the panel width; the extensometer wire runs A to C.

Every node in the fleet is identical. The only things that vary per node are its position,
its extensometer direction, and its permanent random seed.

---

## 2. The sensors

### 2.1 The table

| Sensor | Why it is there | Physical input | Electrical output | Transmitted as | Real range | Noise model |
|---|---|---|---|---|---|---|
| Strain gauge + ADS1115 | primary detector; sees curvature, which is what a subsidence bowl uniquely has | stretch of a 1 m buried rod | bridge imbalance, µV; ADC counts at 7.8 µV/count | `strain` int16, µε | 0 to ±7 800 µε | thermal 100 µε + bias walk + white 5 µε + Vref sag |
| MPU9250 (slow read) | secondary vote; cheap, already present for vibration | angle of the ground | 3 acceleration axes, 16-bit | `tilt_x`, `tilt_y` int16, µrad | 0 to ±26 000 µrad | thermal up to 13 000 µrad + bias walk + white 200 µrad |
| MPU9250 (fast read) | separates blasts and trucks from ground movement | ground shaking | acceleration time series at 200 Hz | `vib_rms`, `vib_peak` uint16; `vib_fdom` uint8 | 0.02 to 40 mm/s | white 0.01 mm/s + baseline hum |
| Draw-wire extensometer | most direct reading you have; a real distance in mm | change in distance A→C | potentiometer voltage divider | `ext_delta` int16, units of 10 µm | 0 to ±78 mm | white 50 µm + wire thermal expansion |
| Conductive crack line | confirms a crack a human can walk out and see | ground splitting open | continuity, broken or intact | `crack_r` uint8, bucket 0–3 | 0, 1, 2, 3 | random per-node threshold, one-way only |
| On-chip thermometer | lets the backend undo the tilt lie | chip temperature | digital, direct | `temp` int16, 0.1 °C | 5 to 55 °C | white 0.2 °C |
| Battery monitor | every analogue reading is measured against the supply as its ruler | supply voltage | ADC divider | `vbat` uint16, mV | 3 300 to 4 200 mV | white 8 mV |
| GPS module | records where the node is, once | position | NMEA sentences | **never transmitted** | ±3 m horizontal | not simulated |

### 2.2 Why each one, in one line

- **Strain** — a bowl is defined by curvature. Curvature is the second derivative of the
  surface, and strain is the only sensor that measures it directly. Everything else is a
  supporting witness.
- **Tilt** — free, since the chip is already on board for vibration. Demoted because thermal
  drift can exceed the entire real signal.
- **Vibration** — not a subsidence sensor. Its job is to *rule out* blasts and trucks, which
  are the biggest source of false alarms.
- **Extensometer** — produces millimetres, which a mine manager understands without
  translation. Also the only reading whose magnitude grows if you lengthen the baseline.
- **Crack line** — the one reading a human can verify on foot. Trust value exceeds
  information value.
- **Temperature and battery** — not measurements of the world. They are the correction terms
  that make the other four usable.

### 2.3 How the noise is generated, in order

The order is not decorative. It mirrors what physically happens inside the hardware, and
changing it changes the answer.

```
true value from S(x,y,t)
  ↓  1. thermal drift      += k_thermal × (temp − temp_calibration)
  ↓  2. bias instability   += random walk, seeded per node, persists forever
  ↓  3. white noise        += gaussian at the datasheet figure
  ↓  4. reference sag      ×= (vbat / vbat_nominal)
  ↓  5. quantisation       = round to the ADC step
  ↓  6. event transients   += blast / truck / conveyor from events.csv
transmitted value
```

Per-sensor coefficients:

| Sensor | k_thermal | bias walk σ per step | white σ | quantisation step |
|---|---|---|---|---|
| tilt | 520 µrad/°C | 3 µrad | 200 µrad | 7.6 µrad |
| strain | 4 µε/°C | 0.05 µε | 5 µε | 0.5 µε |
| extensometer | 0.11 µm/°C/m of wire | 0.5 µm | 50 µm | 10 µm |
| vibration | negligible | none | 0.01 mm/s | 0.01 mm/s |

**Temperature model.** `temp = 22 + 13·sin(2π(hour − 9)/24) + 0.4·N(0,1)`. Range 9 to 35 °C
in air; the enclosure runs hotter in sun, so the chip sees up to about 48 °C. This single
curve drives every thermal term above, which is why tilt and strain drift *together* — and
why comparing a node against its neighbours cancels most of it.

### 2.4 How the sensors are related to each other

This is the part that must never be violated: **there is exactly one ground surface, and
every sensor is a different question asked of it.**

```
                       S(x, y, t)          the one surface
                            │
        ┌───────────┬───────┴────────┬──────────────┐
        │           │                │              │
      value      ∂S/∂x            ∂²S/∂x²      ∫ along a line
        │           │                │              │
   (unmeasured)   tilt            strain      extensometer
                    │                │              │
                    └────────┬───────┘              │
                             │                      │
                       crack threshold ◄────────────┘
                       (fires on accumulated strain)

   vibration ── independent; comes from events.csv, not from S
   temperature ── independent; drives noise in tilt, strain, ext
   battery ── independent; scales all analogue readings
```

Consequences you must respect in code:

1. **Never write a second generator.** If you compute tilt from `S` but extensometer from a
   separate formula, they will disagree, and the disagreement will look exactly like a real
   anomaly. One function, `S(x, y, t)`, and everything else is a derivative of it.
2. **Strain and extensometer are not independent evidence.** The extensometer is the integral
   of strain along its line. If both agree, that confirms the sensors are working; it does
   not double-confirm that the ground is moving.
3. **Crack is downstream of strain.** It carries one thing strain does not: irreversibility.
   Strain relaxes; a crack does not close.
4. **Vibration is the only genuinely independent channel.** That is precisely why it is
   useful for rejecting false alarms.

---

## 3. Files — what a node makes and what the system makes

### 3.1 The misconception to clear up first

**A node does not write a CSV file.** A node is a microcontroller with a few hundred
kilobytes of RAM and no filesystem worth the name. It never holds a table, never appends a
row, never keeps history.

What actually exists is four levels, and only the last one is a file:

| Level | Where it lives | Lifetime | Size |
|---|---|---|---|
| A. Reading struct | node RAM | overwritten every 60 s | ~30 bytes |
| B. Wire packet | radio air | milliseconds | 21 bytes |
| C. Gateway message | MQTT broker | seconds | ~400 bytes JSON |
| D. `nodes.csv` | backend disk | forever | grows one line per node per epoch |

**There is one `nodes.csv` for the whole network, not one per node.** The `node_id` column
is what separates them. In the simulator you write all 30 nodes into the same file for the
same reason a real gateway does: the gateway is the first place in the system where all
nodes exist at once.

### 3.2 Level A — the reading struct (node RAM)

Every 60 seconds the node overwrites this. Nothing is stored. Nothing is transmitted.

```
struct Reading {
  uint32 t_unix;
  int32  tilt_x_urad, tilt_y_urad;
  int32  strain_ue;
  int32  ext_delta_um;
  float  vib_rms, vib_peak;  uint8 vib_fdom;
  int16  temp_c10;
  uint16 vbat_mv;
  uint8  crack_bucket;
}
```

Between radio slots the node keeps a small running summary of these — mean of the slow
channels, max of `vib_peak`, highest `crack_bucket` seen. That summary is what gets sent.
This is why one packet every 10 minutes does not mean nine readings are wasted.

### 3.3 Level B — the 21-byte packet

| Offset | Bytes | Field | Type |
|---|---|---|---|
| 0 | 1 | `node_id` | uint8 |
| 1 | 2 | `seq` | uint16 |
| 3 | 2 | `tilt_x` | int16, µrad |
| 5 | 2 | `tilt_y` | int16, µrad |
| 7 | 2 | `strain` | int16, µε |
| 9 | 2 | `ext_delta` | int16, **units of 10 µm** |
| 11 | 2 | `vib_rms` | uint16, mm/s × 100 |
| 13 | 2 | `vib_peak` | uint16, mm/s × 100 |
| 15 | 1 | `vib_fdom` | uint8, Hz |
| 16 | 2 | `temp` | int16, 0.1 °C |
| 18 | 2 | `vbat` | uint16, mV |
| 20 | 1 | `crack_r` + `flags` | 2 bits crack, 6 bits flags |

Total 21 bytes. Two changes from the original spec are corrections, not preferences:

- `ext_delta` in units of 10 µm instead of 1 µm. At 1 µm an int16 wraps at ±32.8 mm, and
  real values reach 78 mm. It would have wrapped silently and produced nonsense.
- `temp` as int16 in 0.1 °C instead of int8 in whole degrees. At 520 µrad/°C, rounding
  temperature to the nearest degree leaves ±260 µrad of tilt error you can never remove.

**What is deliberately absent:** position, timestamp, and any corrected value. Position is a
constant held at the gateway. Time is reconstructed from `seq` plus arrival time. Correction
happens in the backend, because a node that corrects its own data has destroyed the evidence.

### 3.4 Level C — the gateway message

The gateway decodes the bytes, looks up the node in `nodes.json`, adds what only it knows,
and publishes to `mine/panel4/telemetry`:

```json
{
  "node_id": 17,
  "seq": 1152,
  "t_recv": "2026-03-14T14:30:04Z",
  "xy": [240.0, 180.0],
  "raw": {
    "tilt_x": 11842, "tilt_y": -3106, "strain": -388,
    "ext_delta": -361, "vib_rms": 31, "vib_peak": 44,
    "vib_fdom": 52, "temp": 478, "vbat": 3611, "crack_r": 0
  },
  "radio": { "rssi": -104, "snr": 4.5, "hops": 2 }
}
```

### 3.5 Level D — the four files on disk

**`nodes.json`** — the registry. Written once by hand. Read by the simulator, the gateway,
and the backend.

```json
{
  "scenario": "slow_sag_40d",
  "panel": { "x1": 100, "y1": 100, "x2": 700, "y2": 300,
             "depth_m": 150, "thickness_m": 3.0,
             "tan_beta": 2.0, "a": 0.65 },
  "gateway": { "id": 200, "xy": [860, 200] },
  "nodes": [
    { "id": 17, "xy": [400, 180], "ext_to": [400, 190],
      "seed": 917423, "crack_threshold_ue": 6200, "role": "field" },
    { "id": 31, "xy": [860, 60], "ext_to": [860, 70],
      "seed": 411902, "crack_threshold_ue": 6800, "role": "anchor" }
  ]
}
```

`seed` is what makes node 17 produce identical drift on every run. Without it your demo
behaves differently at every rehearsal and no bug is reproducible.

**`nodes.csv`** — the log. One file. One line per node per epoch.

```
t_iso,node_id,x_m,y_m,tilt_x_urad,tilt_y_urad,strain_ue,ext_um,vib_rms,vib_peak,f_dom,temp_c,vbat_mv,crack,rssi,snr,hops,alive
2026-03-14T14:30:00Z,17,400.0,180.0,11842,-3106,-388,-3610,0.31,0.44,52,47.8,3611,0,-104,4.5,2,1
2026-03-14T14:30:00Z,18,400.0,220.0,11515,-2984,-402,-3702,0.30,0.41,52,47.6,3598,0,-101,5.2,2,1
2026-03-14T14:30:00Z,22,,,,,,,,,,,,,,,,0
```

Read row 1 aloud: *at 14:30, node 17 at (400, 180) reported 11 842 µrad of tilt — almost all
of which is fake, because the chip is at 47.8 °C. Strain is −388 µε, meaning that ground is
being squeezed, which is what happens inside a trough. Its extensometer has shortened by
3.6 mm. It hears a faint 52 Hz hum, which is the conveyor. No crack. Battery 3.61 V. The
message arrived faintly after two relays. The node is alive.*

Row 3 is node 22: dead. Every column blank except `node_id` and `alive`. Not omitted —
present and blank, so downstream code knows the node exists and is silent.

**`events.csv`** — what happened in the world.

```
t_iso,type,node_id,charge_kg,x_m,y_m,ref
2026-03-14T14:30:00Z,blast,,120,310.0,95.0,DGMS-B-2211
2026-03-16T08:05:00Z,truck,,,250.0,60.0,haul road pass
2026-03-18T09:12:00Z,node_death,22,,,,cluster
```

Kept as a separate file on purpose. A real mine hands you the blast register as a file, not
as a variable in your program.

**`truth.npz`** — the answer key. `S` on a full grid at every timestep, the true parameters,
and every node's undamaged reading.

> Keep this in a `truth/` folder with no import path from the backend. If the detector can
> read it, it will score perfectly against its own answer key and you will not find out until
> a judge asks.

### 3.6 How writing actually occurs

Real deployment:

1. Node computes its summary. Nothing is written anywhere.
2. Node broadcasts 21 bytes.
3. Neighbours rebroadcast. No file involved.
4. Gateway receives, drops duplicates by `(node_id, seq)`, decodes, publishes to MQTT.
5. A subscriber process appends **one line** to `nodes.csv` and one row to SQLite.

Only step 5 touches a disk, and it happens once, in one place, for all 30 nodes.

Simulator:

1. Layer 1 computes `S` on a grid for all timesteps → `truth.npz`.
2. Layer 2 samples `S` at each node position and damages it.
3. Layer 3 injects blasts, trucks, deaths → `events.csv`.
4. Layer 4 applies radio effects: loss, delay, duplicates, hop counts.
5. Layer 5 writes `nodes.csv`, one line per node per epoch, in arrival order.

Same file, same columns, same order. That is the seam: swap layers 1–4 for real hardware and
nothing above them changes.

---

## 4. From rows to the PINN object

### 4.1 The cadence

| Stage | Interval | Why this number |
|---|---|---|
| Node samples | 60 s | cheap, no radio, keeps a summary |
| Node transmits | 10 min | duty cycle: IN865 allows 1% airtime, shared across the mesh |
| Row appended | on arrival | one line per node per epoch |
| **Epoch assembled** | **30 min** | enough time for late and multi-hop packets to land |
| **PINN retrains** | **30 min** | warm-started from the last run; a few hundred steps, seconds on CPU |
| Classical detector | 10 min | cheap, and it owns the alarm |

The PINN runs on every epoch, so the surface is redrawn 48 times a day and never goes stale.

### 4.2 Epoch assembly

An epoch is a photograph of the whole field at one moment. Assembling one:

1. Take every row in `nodes.csv` with `t_iso` inside the 30-minute slot.
2. If a node sent twice, keep the newest.
3. Undo the thermal drift using that row's own `temp` and the node's stored coefficient.
4. Undo the reference sag using that row's `vbat`.
5. Convert to SI: µrad → rad, µε → dimensionless, 10 µm → m.
6. Attach a `sigma` to each reading — larger when the temperature correction was large,
   larger when the node is old or the battery is low.
7. Look up each node's `xy` and `ext_to` from `nodes.json`.
8. Nodes that did not report at all: emit them with `null` values and `dead_since`.

Steps 3 and 4 are why `temp` and `vbat` ride on the packet. Step 6 is the one teams forget,
and it is the one that stops a single drifting sensor from bending the whole map.

### 4.3 The object handed over

```json
{
  "epoch_id": 1152,
  "t_iso": "2026-03-14T14:30:00Z",
  "t_days": 8.604,

  "panel": {
    "x1": 100.0, "y1": 100.0, "x2": 700.0, "y2": 300.0,
    "depth_m": 150.0, "seam_thickness_m": 3.0,
    "tan_beta": 2.0, "influence_radius_m": 75.0,
    "subsidence_factor": 0.65
  },

  "observations": [
    { "node_id": 17,
      "xy": [400.0, 180.0],
      "tilt": [0.002780, -0.000412],
      "strain": -0.000388,
      "ext_delta_m": -0.003610,
      "ext_line": [[400.0, 180.0], [400.0, 190.0]],
      "sigma": { "tilt": 2.1e-4, "strain": 5.2e-6, "ext": 5.0e-5 },
      "age_s": 47 },

    { "node_id": 22,
      "xy": [550.0, 140.0],
      "tilt": null, "strain": null, "ext_delta_m": null,
      "ext_line": [[550.0, 140.0], [550.0, 150.0]],
      "sigma": null, "age_s": null,
      "dead_since": "2026-03-18T09:12:00Z" }
  ],

  "anchors": [
    { "node_id": 31, "xy": [860.0, 60.0],  "S_m": 0.0 },
    { "node_id": 32, "xy": [860.0, 340.0], "S_m": 0.0 }
  ],

  "quality": { "nodes_expected": 30, "nodes_reporting": 28, "max_age_s": 312 }
}
```

### 4.4 What each block means

**`panel`** — the geometry of the hole being dug underground. Not measured by anything; it
comes from the mine's own plan. It gives the network its prior: *whatever surface you draw,
it must be consistent with a rectangle of this size at this depth.* Six numbers replace
thousands of training examples, which is why this works with 30 sensors instead of 30 000.

- `x1,y1,x2,y2` — the panel corners on the surface map, in metres.
- `depth_m` — how far down the seam is. Deeper means a wider, gentler bowl.
- `seam_thickness_m` — how much coal is removed. Sets the maximum possible sinking.
- `tan_beta` — a rock property from borehole logs. Hard rock spreads the bowl less.
- `influence_radius_m` — `depth / tan_beta` = 75 m. How far the sinking spreads past the
  panel edge, and the single number that governs everything.
- `subsidence_factor` — the fraction of the removed thickness that reaches the surface,
  typically 0.6 to 0.9. `depth × factor` is your ceiling: 1.95 m here.

**`observations`** — one entry per node, present whether it reported or not.

- `xy` — surveyed once at installation, from `nodes.json`. Never transmitted.
- `tilt` — two numbers, radians. The slope the node feels, after temperature correction.
- `strain` — dimensionless, after correction. Negative means squeezed, positive means pulled.
- `ext_delta_m` — metres. Change in distance between peg A and peg C.
- `ext_line` — both endpoints. Needed because the extensometer measures a total along a line,
  not a value at a point, so the network must integrate along it.
- `sigma` — how much to trust each reading. Bigger sigma, weaker pull on the answer.
- `age_s` — how stale this reading is within the epoch.
- `dead_since` — present only for silent nodes.

**`anchors`** — the reference nodes outside the angle of draw. They assert `S = 0` at a known
place. Without them the network can produce a correctly shaped bowl floating at an arbitrary
height, because **nothing on any node measures depth**. Everything is slope and curvature;
the anchors are what convert relative shape into absolute millimetres.

**`quality`** — how much of the field you actually heard from. Drives the confidence overlay
on the dashboard and gates whether the alarm is allowed to fire at all.

**Deliberately absent:** vibration, crack, temperature, battery. Vibration is a transient and
does not constrain a slow-moving surface. Crack is derived from strain. Temperature and
battery were already consumed during correction. All four go to the classical detector
instead.

---

## 5. What the PINN actually is

### 5.1 Shape

A small fully-connected network. Three inputs, one output.

```
   x ──┐
   y ──┼──► [64] ──► [64] ──► [64] ──► [64] ──► S
   t ──┘      tanh    tanh     tanh     tanh
```

About 13 000 parameters. It trains on a laptop CPU in seconds. It is not a picture and not a
grid — **it is a formula**, so you can ask it about any point at all, including points where
no node exists. That is how 30 dots become a continuous map.

### 5.2 The problem it solves

Nothing measures `S`. Every reading is a derivative of it. So how do you train a network on a
quantity you never observe?

Automatic differentiation. When the network produces `S` from `(x, y, t)`, you can also ask
the framework for `∂S/∂x`, which is a slope you *did* measure. You compare those instead.

### 5.3 The five loss terms

| Term | Statement | Source | Weight |
|---|---|---|---|
| Tilt | network slope should match measured tilt | `observations[].tilt` | 1 / σ²_tilt |
| Strain | network curvature × B should match measured strain | `observations[].strain` | 1 / σ²_strain |
| Extensometer | integral of stretch along `ext_line` should match | `observations[].ext_delta_m` | 1 / σ²_ext |
| Anchor | `S` must be 0 at anchor positions | `anchors` | high, fixed |
| Physics | at 2 000 random points, `S` must obey the Knothe integral | `panel` | tuned, ~0.1 |

The first four are evaluated at 30 locations. The fifth is evaluated at 2 000 random
locations that have nothing to do with where the nodes are.

### 5.4 Why it fills holes where nodes died

In a region where six nodes died, the first three terms contribute nothing — there is no
data. The anchor term is far away. But the physics term is still there, because it samples
random points regardless of where sensors are.

So over the dead zone, physics alone decides, and physics says: *whatever is here must be a
smooth Knothe bowl consistent with the edges around it.* That is a defensible reconstruction,
not a guess. It is also your answer when a judge asks how you know what happened where the
sensors died.

### 5.5 The loop

```
every 30 min:
    epoch = assemble()
    load weights from last epoch          ← warm start; this is why it is fast
    for step in 1..400:
        loss = tilt + strain + ext + anchor + physics
        backprop, adam step
    save weights
    S_grid = network(64 × 64 grid)        ← one forward pass, milliseconds
    publish S_grid to the dashboard
```

**The PINN never raises an alarm.** It draws. The classical Knothe fit, running every 10
minutes on the same epochs, owns every alarm decision. That separation is what makes the
system explainable to a safety officer, and it is the strongest single thing in your design.

---

## 6. Position

Surveyed once at installation with a handheld GPS, written into `nodes.json`, and never
transmitted again. Three reasons:

1. Two floats would be 8 bytes on a 21-byte packet — 38% of your airtime spent resending a
   constant.
2. Cheap GPS is accurate to metres. A live fix would jitter several metres every packet, and
   the network would see nodes wandering around the map.
3. Vertical position is what you care about, and GPS is worst at exactly that axis. Depth
   comes from the anchors and the reconstruction, never from a positioning module.

Horizontal ground displacement during subsidence is real — up to about a third of the
vertical movement. You do not measure it. It falls out of the reconstructed surface, because
once you know the shape you know how far each point has slid.

---

## 7. Open items

| # | Item | Status |
|---|---|---|
| 1 | `ext_delta` int16 overflow at ±32.8 mm | fixed above — 10 µm units |
| 2 | `temp` int8 resolution leaves ±260 µrad residual | fixed above — int16, 0.1 °C |
| 3 | `nodes.json` missing from both original specs | added in §3.5 |
| 4 | Anchor nodes outside the draw angle | added; two nodes, and nothing else provides absolute depth |
| 5 | Crack derived from strain, not independent | keep, state it plainly in the report |
| 6 | `sigma` per observation | new requirement; the epoch builder must produce it |
| 7 | Second gateway | one extra ESP32; removes the single point of failure the mesh demo exposes |
