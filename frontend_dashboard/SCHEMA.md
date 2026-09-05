# Mine Sensor Network — Live Backend Schema

For the backend that stores data **while the sensor network / simulation is
running** — i.e. what a real deployment's mesh gateway would push to a
server. This is deliberately **not** the offline training dataset
(`dataset/mine_XXXXX/*.parquet`, see `mine_collapse_data_spec.md`). No
labels, no collapse events, no `truth_*` debug columns, no train/val/test
splits — a live system never has ground truth, only node identity and
incoming sensor readings.

Two things only:

1. **Node profiles** — who exists and where, changes rarely.
2. **Readings** — what each node reports, once per 60 s TDMA superframe,
   appended forever.

---

## 1. `nodes` — node profile table

One row per physical node. Written once at deployment/commissioning time;
updated only if a node is physically moved or replaced.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `node_id` | string/int (PK) | no | Unique per mine site. Use a string like `"mine01-1A-003"` if this backend will ever host more than one mine site — a bare int isn't safe as a global key. |
| `site_id` | string | no | Which mine/site this node belongs to. Required as soon as there's more than one deployment. |
| `tier` | string | no | One of `1A`, `1B`, `1C`, `2A`, `2B`, `3`. |
| `node_type` | string | no | `scout` (1A/1B/1C), `anchor` (2A/2B), `gateway` (3). Derivable from `tier` but convenient to store. |
| `x` | float | no | Meters, site-local coordinate system. |
| `y` | float | no | Meters. |
| `z` | float | no | Meters. |
| `installed_at` | timestamp | no | When the node was commissioned. |
| `status` | string | no | e.g. `active`, `dead`, `removed`. A node going silent in `readings` doesn't delete its row — it stops appending. |

Primary key: `node_id` (or `(site_id, node_id)` if `node_id` isn't globally unique).

---

## 2. `readings` — live sensor stream

One row per `(node_id, timestamp)`, appended every 60 s per node as reports
arrive off the mesh. Same channel set as the simulation, same tier-based
nullability: **a channel a tier doesn't carry is NULL, never 0.**

| Column | Type | Nullable | Carried by | Unit |
|---|---|---|---|---|
| `node_id` | string/int | no | all | FK → `nodes.node_id` |
| `ts` | timestamp | no | all | wall-clock time the reading was taken (or received — pick one and be consistent; see note below) |
| `tilt_x_urad` | float | tier-dependent | 1A,1B,1C,2A | µrad |
| `tilt_y_urad` | float | tier-dependent | 1A,1B,1C,2A | µrad |
| `accel_x_g` | float | tier-dependent | 1A,1B,1C | g |
| `accel_y_g` | float | tier-dependent | 1A,1B,1C | g |
| `accel_z_g` | float | tier-dependent | 1A,1B,1C | g |
| `gyro_x_dps` | float | tier-dependent | 1A,1B,1C | deg/s |
| `gyro_y_dps` | float | tier-dependent | 1A,1B,1C | deg/s |
| `gyro_z_dps` | float | tier-dependent | 1A,1B,1C | deg/s |
| `vib_rms_mm_s` | float | tier-dependent | 1A,1B,1C | mm/s |
| `vib_peak_mm_s` | float | tier-dependent | 1A,1B,1C | mm/s |
| `vib_fdom_hz` | float | tier-dependent | 1A,1B,1C | Hz |
| `die_temp_c` | float | tier-dependent | **all six tiers** | °C |
| `fissure_mm` | float | tier-dependent | 1B only | mm |
| `strain_ue` | float | tier-dependent | 1B only | µstrain |
| `moisture_pct` | float | tier-dependent | 1C only | % VWC |
| `ext_delta_mm` | float | tier-dependent | 1C only | mm |
| `pore_pressure_kpa` | float | tier-dependent | 2B only | kPa |
| `borehole_tilt_d1_urad` | float | tier-dependent | 2B only | µrad, depth 1 |
| `borehole_tilt_d2_urad` | float | tier-dependent | 2B only | µrad, depth 2 |
| `borehole_tilt_d3_urad` | float | tier-dependent | 2B only | µrad, depth 3 |
| `borehole_tilt_d4_urad` | float | tier-dependent | 2B only | µrad, depth 4 |
| `gps_dx_mm` | float | tier-dependent | 3 only | mm |
| `gps_dy_mm` | float | tier-dependent | 3 only | mm |
| `gps_dz_mm` | float | tier-dependent | 3 only | mm |

Primary key: `(node_id, ts)`.

Channel set per tier — same mapping as the simulation:

- **1A**: tilt_x/y, accel_x/y/z, gyro_x/y/z, vib_rms/peak/fdom, die_temp
- **1B**: 1A's set + fissure_mm, strain_ue
- **1C**: 1A's set + moisture_pct, ext_delta_mm
- **2A**: tilt_x/y, die_temp
- **2B**: pore_pressure_kpa, borehole_tilt_d1..d4, die_temp
- **3**: gps_dx/dy/dz, die_temp

---

## Notes for the backend implementation

- **Insert-only, no upserts.** Each superframe produces a new `readings` row
  per node; never overwrite a past reading.
- **Missed reports stay missing, not zero-filled.** `mesh-communication-mechanics.md`
  describes ACK/retry and backup routing — if a node's packet is lost, no row
  is written for that timestep at all (don't insert a row of nulls to mark
  absence; absence is just a gap in `ts` for that `node_id`).
- **Pick one clock semantic for `ts`** — either "when the sensor sampled it"
  (if nodes have synced clocks off the 60 s TDMA grid) or "when the gateway/
  server received it," and stay consistent. If both matter, store both
  (`sampled_at`, `received_at`).
- **No labels, no collapse events, no `truth_*` columns here.** Those only
  exist in the offline simulation dataset because the simulator knows ground
  truth. A live backend has no ground truth to store — hazard/risk scores are
  something the trained model computes downstream from this raw data, not
  something ingested.
- If this backend ever needs to feed the trained SSM+GNN model, it will read
  a rolling window of `readings` per node plus the static `nodes` table to
  build the graph — no schema change needed here for that, it's a query
  pattern on top of these two tables.
