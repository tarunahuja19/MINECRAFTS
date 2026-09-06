# Node Placement & Mesh Network — Handoff Brief

**Purpose:** hand this file, whole, to the simulation chat so it can place nodes
and read the data correctly. It is self-contained — no other file needs to be
opened to act on it.

**Status:** ✅ Everything described in §1–§5 is **already implemented and
regenerated** in `similation-data-making/`. §7 is deferred future work.

**Valid sources (the only three):** the WhatsApp sensor-table image,
`mesh-communication-mechanics.md`, `mine_collapse_data_spec.md`. Do **not**
consult `sih26/final/`, `sih26/filess/`, or any Obsidian vault — they describe a
superseded design (7-sensor node, geophone, PINN) and will actively mislead you.

**Architecture reminder:** the model is a Mamba-style **SSM + spatiotemporal
GNN** producing per-node, per-timestep **hazard** (time-to-event / survival).
There is **no PINN**. So the `truth_*` columns are validation/debug only — never
a training target, never a model input.

---

## 1. The six node tiers

Every node is exactly one tier. Tier determines **what sensors it carries** and
**where it is placed**.

| Tier | Role | Placement zone | Channels emitted |
|---|---|---|---|
| **1A** Scout | Baseline / flat | Flat interior of the subsidence bowl | `tilt_x/y`, `accel_x/y/z`, `gyro_x/y/z`, `vib_rms/peak/fdom`, `die_temp` |
| **1B** Scout | Tension / shear | High-curvature panel **edges** | 1A's set **+** `fissure_mm`, `strain_ue` |
| **1C** Scout | Fault / water | Along a per-mine **fault corridor** | 1A's set **+** `moisture_pct`, `ext_delta_mm` |
| **2A** Anchor | Mesh router | Spread over the monitoring rectangle | `tilt_x/y`, `die_temp` |
| **2B** Anchor | Geotech borehole | Sparse, over the panel | `pore_pressure_kpa`, `borehole_tilt_d1..d4`, `die_temp` |
| **3** Gateway | Master sink | 500–1000 m **outside** the angle of draw | `gps_dx/dy/dz`, `die_temp` |

**Critical read rule:** a channel a tier does not carry is **NULL, never 0**.
Do not `fillna(0)` — a null means "this hardware does not exist on this node",
which is categorically different from "this sensor read zero".

**2A is a separate tier for one reason:** it carries an ADXL355 instead of the
MPU-6050, ~40× quieter in tilt (3.0 vs 120.0 µrad white sigma). The data
reproduces that gap; if you collapse 2A into the other tiers the tier is
pointless.

**There is no geophone.** Vibration comes from the MPU-6050 sampled as a 400 Hz
/ 256-sample burst once per superframe, reduced on-node to `vib_rms`,
`vib_peak`, `vib_fdom`. Discriminate by `vib_fdom`: truck 8–20 Hz, conveyor
50±0.5 Hz, blast 40–80 Hz, **microseismic 100–250 Hz ← the one that matters**.

---

## 2. Placement rules — geology, not radio

Spacing is dictated by **rock mechanics**, not by radio range.

- **Scouts 15–25 m apart.** Ground failure is highly localised; a 2 m crack can
  open and a sensor 50 m away feels nothing.
- **Anchors 100–150 m apart.** They reconstruct the macro-shape of the bowl,
  where high spatial density is redundant.
- **Gateway 500–1000 m outside the angle of draw**, on immovable bedrock. **By
  construction it cannot move** — that is what makes it the network's stable
  reference. Any movement it reports is instrument drift, not ground movement.

**Positions are NOT on a grid.** Placement is dart-thrown Poisson-disc with
role-based spatial weighting. A GNN trained on a grid memorises the grid.

---

## 3. Cluster fan-out — 5 nominal, 6 hard maximum ⭐

**This is the rule that drives node counts. It is arithmetic, not preference.**

`mesh-communication-mechanics.md` §3: an Anchor "listens to its 5 or 6 Scout
children, bundles their packets into a single **138-byte** payload".
§4: a Scout packet is exactly **23 bytes**.

```
138 bytes / 23 bytes = exactly 6 scout packets per bundle
```

A 7th child needs 161 B and **overflows the bundle the Anchor is specified to
transmit**. So:

- **6 = hard physical ceiling.** Never exceed it.
- **5 = design point.** Chosen deliberately, leaving one slot of bundle headroom
  so an orphan failing over from a dead neighbouring Anchor still fits.

**The TDMA window is *not* the constraint.** t=2.0–11.5 s at 250 ms slots gives
38 slots; a Scout needs 90.4 ms TX + 20 ms ACK = 110.4 ms. Timing alone would
allow ~38 children. **The payload caps it at 6.**

### What was wrong before (do not reintroduce)

Anchor counts were drawn independently of scout counts. Measured across the old
101-mine dataset:

| | old | now |
|---|---|---|
| scouts per anchor, median | 6.5 | **4.8** |
| scouts per anchor, max | **13.8** ❌ | **6** ✅ |
| mines breaching the bundle limit | most | **none** |

The old dataset described a network that **cannot physically exist** — anchors
with 13 children bundling 322 bytes into a 138-byte payload.

### How it is fixed

Anchors are **derived** from scouts, not drawn:
```python
n_anchors_needed = ceil(n_scouts_placed / CLUSTER_FANOUT_NOMINAL)   # /5
n_2a = max(ANCHOR_2A_COUNT_MIN, n_anchors_needed - n_2b)
```
2B keeps its own small draw (1–3) because boreholes are sited for **geology**,
not radio fan-out; 2A makes up the remaining capacity.

**Second-order fix.** 70 scouts need 14 anchors, but anchors need 100–150 m
separation and a small site cannot physically hold 14 (a 340×160 m rectangle at
139 m spacing fits ~3). So scouts are capped by real anchor capacity:
```python
_max_anchors = max(2, int(0.87 * rect_area / anchor_spacing**2))
n_scouts     = min(n_scouts, _max_anchors * CLUSTER_FANOUT_NOMINAL)
```
Smaller mines simply carry fewer scouts — the physically honest outcome.

---

## 4. The mesh DAG (`minegen/mesh.py`)

Built from node positions alone, after placement. Three hops:

```
Scout (hop 2) ──> Anchor (hop 1) ──> Gateway (hop 0)
      └── backup: 2nd-nearest Anchor, pre-calculated (mesh doc §6)
```

**Assignment is CAPACITATED — this is the subtle part.** Assigning each scout to
its nearest anchor is *unbalanced*: it hands one anchor 9 children while a
neighbour sits at 2, silently breaking the bundle limit. Instead:

> Sort all (scout, anchor) pairs by ascending distance. Take greedily, skipping
> any anchor already at 6. A scout whose nearest anchor is full falls to its
> next-nearest.

That is real behaviour — cluster membership in a pre-planned DAG is decided by
the network planner, not proximity alone. The code asserts no cluster exceeds 6
and raises rather than emitting an impossible network.

**Backup parent** = nearest anchor that is not the primary. Per mesh doc §6 this
is written into `nodes.json` at commissioning, not discovered at runtime.
**Anchor backup** = nearest peer anchor.

**TX power** (mesh doc §3.2): ≤150 m → +5 dBm, ≤500 m → +10, else +14. The
+22 dBm maximum is reserved for the emergency blast, so it is not a nominal
value. Scouts run minimum PA to survive on one 18650 + a 1 W panel.

**⚠️ The mesh DAG is NOT the GNN's edge list.** Spec §6 forbids shipping edges —
they are built downstream by kNN/radius so different strategies can be tried.
`mesh.parquet` is the **communication** graph; the **physics** graph is
something you construct yourself from `(x, y)` in `nodes.parquet`. Do not feed
`parent_id` in as adjacency.

---

## 5. Files per mine — what to read

```
dataset/mine_00001/
  metadata.json            every drawn parameter + seed (spec 7.2)
  nodes.parquet            node_id, tier, node_type, x, y, z
  mesh.parquet             ← NEW: static topology, one row per node
  readings.parquet         every channel, every node, every timestep
  labels.parquet           time_to_collapse_s, censored_flag, spatial_weight
  collapse_events.parquet  mine-level event list
```

**`mesh.parquet` columns:** `node_id`, `parent_id`, `backup_parent_id`,
`cluster_id` (= head anchor's node_id), `hop_count` (0/1/2),
`dist_to_parent_m`, `dist_to_backup_m`, `tx_power_dbm_nominal`.
Gateway row has null parent/backup.

**`readings.parquet` is dense and long-format** — exactly `n_nodes × n_steps`
rows, one row per node per timestep, one column per channel, nulls where a tier
lacks a channel. Every node reports every 60 s. No gaps. This is *deliberately
simple* right now (see §7).

**Cadence:** one synchronised global 60 s TDMA timestep grid, all tiers aligned.
`t_s` is seconds since that mine's t0.

**`metadata.json` → `mesh` block** carries `n_clusters`, `cluster_sizes`,
`max_cluster_size`, `mean_cluster_size`, link-distance ranges, and the
assignment strategy. `metadata.json` → `placement` carries
`cluster_fanout_nominal`, `cluster_fanout_max`, `n_scouts_placed`,
`n_anchors_needed`, spacings actually drawn, and the fault-corridor geometry.

---

## 6. Verified properties — regenerated 100-mine dataset

**100 mines, 5,161 nodes, 58,493,201 rows, 2.04 GB.** 96/100 mines pass every
gate (29/29 with events, 24/24 fully censored); the other 4 fail one of two
pre-existing over-strict gates unrelated to the mesh (documented in
`GENERATION_NOTES.md` §11). **No mesh gate fails in any mine.**

- Scouts per anchor across all 100 mines: **mean 4.80, max 6, zero breaches**.
- Longest link anywhere: **1,787 m = 60% of the SX1262's 3 km budget** (that is
  an anchor→gateway backbone hop; scout→parent links are far shorter). Every
  link is in radio range, so the layout is physically buildable.
- Every scout has a parent, and a **distinct** backup.
- Every anchor relays to the gateway; the graph is a DAG with no cycles.
- Placement is irregular (nearest-neighbour distance CV ≈ 2.8; a grid is ~0).
- Tier→channel sets match the sensor image exactly.
- ADXL355 measurably quieter than MPU-6050 (4.2 vs 186 µrad).
- Gateway reads ~zero movement (max |gps| ≈ 19 mm) — it is outside the draw.

Gates `G11`–`G11e` in `tests/validate.py` enforce the mesh rules. Run:
`.venv/bin/python -m tests.validate`

---

## 7. Deliberately deferred — DO NOT assume these exist

Kept out to keep the dataset simple and easy to work with. Both are recorded in
each mine's `metadata.json` under `deferred`.

1. **Packet loss.** Every node reports every superframe. No dropped rows.
2. **Node death at collapse.** Nodes report straight through a collapse; none
   are destroyed or orphaned.

**Known modelling limitation, stated honestly:** because of (2), the sensor
nearest a collapse keeps transmitting clean data through the event. In reality
that node is destroyed and its **sudden silence is one of the strongest
precursor signals available**. The current dataset teaches the model that
silence never happens. That is an acceptable simplification for a first
training run, but it is the single most valuable realism upgrade available
later.

### If loss/death is added later, the design is:

- Bursty loss via a two-state Gilbert–Elliott chain (LoRa loss is
  time-correlated; IID coin flips are dishonest), `p_loss ~ Beta(1.5, 60)`.
- Orphan failover: child survives with ~0.9 probability via its backup parent
  at +22 dBm — the self-healing of mesh doc §6, made visible in the data.
- Permanent death: kill probability `s * exp(-0.5 (d / 0.4r)^2)` for event
  severity `s`. A dead anchor orphans its whole cluster.
- **Loss = delete the row**, never null-fill it (`SCHEMA.md` already ruled on
  this). `readings.parquet` becomes ragged.
- **`labels.parquet` must stay dense** — labels are truth about the *ground*,
  not the radio. A silent node does not mean the earth stopped. The join
  becomes a left join from labels to readings. This is the single most likely
  thing for a training script to get wrong.
- Put deaths in `metadata.json` only, **never** in a parquet the training loader
  reads — a `died_at_s` column is a truth leak the model would learn to read
  instead of the sensors.
