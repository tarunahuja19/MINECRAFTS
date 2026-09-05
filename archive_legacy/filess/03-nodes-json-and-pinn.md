# 03 — `nodes.json` in Full, and the PINN That Reads It

> **This file owns:** the complete `nodes.json` schema — every block, every field, type, unit, range and consumer — and the exact contract for the PINN: what it receives, what it must never receive, how it trains, and how it turns 31 numbers into a 64×64 terrain.
>
> **This file does NOT own:** ground physics derivations (→ 01), radio behaviour (→ 02, which owns the `mesh` block), telemetry files (→ 04), truth storage (→ 05), the alarm (→ 06).

---

## PART A — `nodes.json`

## 1. What this file is, in one sentence

**`nodes.json` is the only hand-authored description of the world.** Everything else is either generated from it or measured against it. If you can read this file, you know the entire scenario.

### 1.1 Who reads it

```mermaid
flowchart LR
  NJ["nodes.json"] --> SIM["sim/ Layers 0-4<br/>generates the data"]
  NJ --> GW["gateway<br/>slot map, dedup, roles"]
  NJ --> C7["backend/C7<br/>geometry, correction keys"]
  NJ --> C8["backend/C8<br/>positions, anchors, panel"]
  NJ --> C9["backend/C9 PINN<br/>geometry ONLY - see PART B"]
  NJ --> TR["truth/<br/>panel + grid"]
```

### 1.2 The three golden rules

| # | Rule | Why |
|---|---|---|
| 1 | **Nothing time-varying lives here.** | If it changes with `t`, it is telemetry, not registry. |
| 2 | **Random draws are frozen into the file, never re-drawn at runtime.** | Two people on two laptops must get byte-identical data. A bug is then reproducible by emailing a 40 KB JSON, not a 200 MB dataset. |
| 3 | **`a` and `c` are in this file but the PINN must never read them.** | They are the answer key for the physics loss. See §11. |

---

## 2. Top-level structure

```jsonc
{
  "meta":   { ... },   // provenance and version
  "site":   { ... },   // ground physics constants
  "panel":  { ... },   // the extracted rectangle
  "grid":   { ... },   // where output surfaces are drawn
  "mesh":   { ... },   // radio config — OWNED BY FILE 02
  "sim":    { ... },   // cadence, seeds, determinism
  "nodes":  [ ... ]    // exactly 31 entries
}
```

---

## 3. `meta` — provenance

| Field | Type | Example | Meaning | Required |
|---|---|---|---|---|
| `schema_version` | string | `"1.4.0"` | bump on **any** field addition, removal or rename | ✅ |
| `scenario_id` | string | `"sih-demo-40d"` | human name for this scenario | ✅ |
| `author` | string | `"part1"` | who wrote it | ✅ |
| `created_iso` | string | `"2026-09-01T00:00:00Z"` | authoring timestamp | ✅ |
| `start_iso` | string | `"2026-03-01T00:00:00Z"` | UTC instant of `t = 0` | ✅ |
| `duration_days` | float | `40.0` | scenario length | ✅ |
| `generator_sha256` | string | filled at generation | hash of the generator source, so a dataset can be traced to code | ✅ |
| `notes` | string | free text | never parsed | ❌ |

---

## 4. `site` — ground physics

| Field | Type | Units | Value | Read by | PINN sees it? |
|---|---|---|---|---|---|
| `H` | float | m | 150.0 | surface, PINN | ✅ **fixed** — real mine plan input |
| `tan_beta` | float | — | 2.0 | surface, PINN | ✅ **fixed** — regional geology constant |
| `m_seam` | float | m | 3.0 | surface, PINN | ✅ **fixed** — known from the mine plan |
| `a` | float | — | 0.65 | **surface only** | ❌ **LEARNED** — this is what the sensors are for |
| `c` | float | /day | 0.01414 | **surface only** | ❌ **LEARNED** |
| `B` | float | m | 24.0 | surface, PINN | ✅ **fixed, must match exactly** |
| `datum_z` | float | m | 0.0 | surface | reference elevation |

**Derived at load, never stored:**

```
r     = H / tan_beta = 75.0 m
S_max = a · m_seam   = 1.95 m       ← sim only; the PINN builds its own from â
```

> ⚠️ **If the simulator and the PINN hold different values of `B`, loss 2 will never converge and it will look like a training bug for a full day.** Import both from `sim/constants.py`.

---

## 5. `panel` and `grid`

### 5.1 `panel`

| Field | Type | Units | Value | Meaning |
|---|---|---|---|---|
| `x1`, `y1`, `x2`, `y2` | float | m | 100, 100, 700, 300 | extracted rectangle corners |
| `t0_day` | float | day | 0.0 | day extraction completed |
| `panel_id` | int | — | 0 | reserved for multi-panel |

**Today `panel` is a single object.** Making it an array and adding `panel_id` to each node is a **data change, not a code change** — the truth basis already carries a `K` axis (file 05). Leave the door open; do not walk through it.

### 5.2 `grid`

| Field | Type | Units | Value | Meaning |
|---|---|---|---|---|
| `x_min`, `x_max` | float | m | 25, 775 | = panel ± `r` |
| `y_min`, `y_max` | float | m | 25, 375 | = panel ± `r` |
| `nx`, `ny` | int | — | 64, 64 | output resolution |

**The grid is not arbitrary.** It is `panel + r` on all four sides, because subsidence extends exactly `r` beyond the panel edge and nothing outside that can move. Derivation is in file 02 §2.1.

---

## 6. `mesh`

**Owned entirely by file 02 §10.** Not repeated here. It contains band, presets, router, slot timings, escalation caps, path-loss constants, and the parent/relay selection weights.

---

## 7. `sim` — cadence, seeds, determinism

| Field | Type | Value | Meaning |
|---|---|---|---|
| `sample_s` | int | 60 | how often a node reads its sensors |
| `transmit_s` | int | 60 | baseline transmission cadence |
| `hot_window_s` | int | 60 | cadence inside an event window (same today; the hook exists) |
| `hot_window_pad_h` | float | 3.0 | hours either side of a scripted event that count as "hot" |
| `truth_eval_s` | int | 1800 | how often the PINN epoch fires (30 sim-min) |
| `master_seed` | int | 20260901 | **one** seed; every stream derives from it |
| `rng_streams` | array | see below | named, never shared |
| `chunk_days` | int | 40 | time-axis chunk size for memory management |

```jsonc
"rng_streams": ["weather","cloud","ou_bias","white","shadow","pdr","ack","event_jitter"]
```

> **Rule 5, and chunking depends on it.** Noise arrays are generated for the **full time span** from the master seed and then sliced. A chunked run must be byte-identical to a single run. Chunking without this rule silently corrupts the second half and you will not notice.

---

## 8. `nodes[]` — every field, grouped by purpose

Exactly 31 entries. Grouped below by **what the field is for**, which is also the order to author them in.

### 8.1 Identity

| Field | Type | Example | Meaning | Required |
|---|---|---|---|---|
| `id` | int | 17 | stable, 0–30, never reused | ✅ |
| `name` | string | `"T-400-175"` | human label: group-x-y | ✅ |
| `role` | enum | `field` \| `anchor` \| `gateway` | what the node **is for** | ✅ |
| `group` | enum | `transverse` \| `longitudinal` \| `offaxis` \| `anchor` \| `gateway` | which survey construct it belongs to | ✅ |

> `role` and `radio_role` are **different fields**. `role` = purpose. `radio_role` = on-air behaviour. **An anchor can be a relay.**

### 8.2 Geometry

| Field | Type | Units | Range | Meaning | Required |
|---|---|---|---|---|---|
| `x`, `y` | float | m | inside `grid` | position | ✅ |
| `z0` | float | m | 0.0 | initial surface elevation | ✅ |
| `has_ext` | bool | — | — | extensometer fitted? | ✅ |
| `ext_to` | [float,float] \| null | m | — | far peg position; `null` if `has_ext` false | ✅ |
| `ext_len_m` | float | m | 10.0 | nominal wire span | if `has_ext` |
| `antenna_h_m` | float | m | 1.5 field, **10.0 gateway** | antenna height | ✅ |

**Validation rule:** `has_ext == (ext_to != null)`. If they disagree the loader must raise, not warn.

### 8.3 Radio — owned by file 02

| Field | Type | Meaning |
|---|---|---|
| `radio_role` | enum | `leaf` \| `relay` \| `direct` \| `gateway` \| `wired` |
| `parent` | int \| null | primary next hop |
| `backup_parent` | int \| null | failover next hop |
| `cluster` | int \| null | 1–5, or null |
| `hop_depth` | int | 1 nominal, 2 in failover |
| `slot` | int | static slot index — the safety net |
| `backup_slot` | int | contention-window direct slot |

### 8.4 Personality — the frozen random draws

**This is why the 31 nodes are not clones.** Drawn once at authoring time, written into the file, never re-drawn.

| Field | Type | Units | Range | Feeds | Why it exists |
|---|---|---|---|---|---|
| `shade_s` | float | — | 0.30–1.00 | insolation → `T_chip`, `vbat` | a node under a tree runs cooler and charges worse |
| `temp_offset_c` | float | °C | −2.0…+2.0 | `T_chip` | enclosure and mounting differences |
| `k_solar` | float | °C per unit I | 6.0–12.0 | `T_chip` | how much sun heats *this* box |
| `crack_theta_c_ue` | float | µε | 1350–1650 | crack latch | soil differs from spot to spot |
| `bias0_tilt_x` | float | µrad | −10…+10 | OU stage 2 initial value | factory offset |
| `bias0_tilt_y` | float | µrad | −10…+10 | OU stage 2 | |
| `bias0_strain` | float | µε | −2…+2 | OU stage 2 | |
| `bias0_ext` | float | µm | −20…+20 | OU stage 2 | |
| `sigma_scale` | float | — | 0.80–1.30 | multiplies `σ_w` for this node | some units are just noisier |
| `battery_wh` | float | Wh | 8.0–12.0 | SOC integration | cell tolerance and age |
| `panel_w` | float | W | 1.5–2.5 | SOC integration | solar panel rating |
| `shadow_seed` | int | — | any | per-link shadowing draw | freezes this node's RF luck |

### 8.5 Health and schedule

| Field | Type | Meaning |
|---|---|---|
| `install_day` | float | day this node came online (0.0 for all today) |
| `firmware_version` | string | `"1.4.0"` |
| `enabled` | bool | **authored** kill switch. Distinct from runtime `alive`, which lives in telemetry |

### 8.6 A complete node entry, for copy-paste

```jsonc
{
  "id": 17,
  "name": "T-400-175",
  "role": "field",
  "group": "transverse",

  "x": 400.0, "y": 175.0, "z0": 0.0,
  "has_ext": true,
  "ext_to": [400.0, 165.0],
  "ext_len_m": 10.0,
  "antenna_h_m": 1.5,

  "radio_role": "leaf",
  "parent": 9,
  "backup_parent": 21,
  "cluster": 2,
  "hop_depth": 1,
  "slot": 5,
  "backup_slot": 37,

  "shade_s": 0.82,
  "temp_offset_c": -0.41,
  "k_solar": 9.3,
  "crack_theta_c_ue": 1487.0,
  "bias0_tilt_x": 3.1,
  "bias0_tilt_y": -6.4,
  "bias0_strain": 0.7,
  "bias0_ext": -11.2,
  "sigma_scale": 1.06,
  "battery_wh": 10.4,
  "panel_w": 2.1,
  "shadow_seed": 918273,

  "install_day": 0.0,
  "firmware_version": "1.4.0",
  "enabled": true
}
```

---

## 9. What `nodes.json` must NOT contain

| Excluded | Why | Where it lives instead |
|---|---|---|
| Any time-varying value | it is telemetry, not registry | `nodes.csv` |
| Runtime `alive` | changes every cycle | `nodes.csv` |
| `alert_sent`, siren state | alerts are **actions**, not measurements; adding them breaks the sim/backend seam | nowhere in the four files |
| Any truth field | quarantine | `truth.npz`, and only there |
| Event schedules | events are their own file so the detector can open them separately | `events.csv` |

---

## 10. Load-time validation — 12 assertions

Run these before anything else. Every one of them has caught a real bug in a comparable system.

| # | Assertion |
|---|---|
| V1 | Exactly 31 entries; `id` values are 0–30 with no gaps or repeats |
| V2 | Exactly 2 nodes with `role == "anchor"`, exactly 1 with `role == "gateway"` |
| V3 | Every anchor is more than `r` metres outside the panel rectangle |
| V4 | Every `x, y` lies inside `grid` |
| V5 | `has_ext == (ext_to != null)` for every node |
| V6 | No two nodes share a `slot`; no two share a `backup_slot` |
| V7 | Every `parent` and `backup_parent` refers to an existing `id` with `radio_role == "relay"` or `"gateway"` |
| V8 | No parent cycles (following `parent` always terminates at the gateway) |
| V9 | Every leaf→parent distance ≤ `reliable_range_m`; every relay→next-hop distance ≤ `reliable_range_masted_m` |
| V10 | Every personality value lies inside its declared range |
| V11 | `schema_version` matches what the loader expects |
| V12 | `sum(cluster sizes) + directs + wired + gateway == 31` |

---

## PART B — The PINN

## 11. What the PINN is, in one paragraph

A **tiny neural network** — 13 000 parameters, four hidden layers of 64 units — that takes a position and a time `(x, y, t)` and returns one number: how far the ground has sunk there, in metres. It is trained fresh every 30 simulated minutes on the 31 readings that arrived. What makes it *physics-informed* is that it is scored not only against the sensors but also against the Knothe formula, so it is **not free to draw any surface it likes** — only surfaces the geology permits.

> **ELI5.** Give a child 31 dots on a page and say "draw the dish these dots sit on." They could draw anything. Now add: "it must be a smooth bowl, deepest in the middle, flat at the edges." Suddenly 31 dots is plenty. That extra sentence is the physics loss, and it is worth 800 sensors.

---

## 12. What the PINN receives

### 12.1 Static, loaded once from `nodes.json`

| Name | Shape | dtype | Units | Source field |
|---|---|---|---|---|
| `xy` | (31, 2) | f32 | m | `nodes[].x`, `nodes[].y` |
| `ext_to` | (31, 2) | f32 | m | `nodes[].ext_to`, NaN where absent |
| `has_ext` | (31,) | bool | — | `nodes[].has_ext` |
| `is_anchor` | (31,) | bool | — | `nodes[].role == "anchor"` |
| `panel` | (4,) | f32 | m | `panel.x1, y1, x2, y2` |
| `H` | scalar | f32 | m | `site.H` |
| `tan_beta` | scalar | f32 | — | `site.tan_beta` |
| `m_seam` | scalar | f32 | m | `site.m_seam` |
| `B` | scalar | f32 | m | `site.B` |
| `grid_x`, `grid_y` | (64,) each | f32 | m | `grid.*` |

### 12.2 Per epoch, every 30 simulated minutes, from C7

| Name | Shape | Units | Produced by |
|---|---|---|---|
| `t` | scalar | days since `start_iso` | epoch counter |
| `obs_tilt_x`, `obs_tilt_y` | (31,) | **radians** | C7 step 5 |
| `obs_strain` | (31,) | **dimensionless** | C7 step 5 |
| `obs_ext` | (31,) | **metres** | C7 step 5 |
| `sigma_tilt_x`, `sigma_tilt_y` | (31,) | rad | C7 step 6 |
| `sigma_strain` | (31,) | — | C7 step 6 |
| `sigma_ext` | (31,) | m | C7 step 6 |
| `valid` | (31, 4) | bool | C7 step 8 |

Total payload ≈ **4 KB per epoch**.

**Unit conversions C7 performs. The ML owner never does these:**

| Wire | → SI | Factor |
|---|---|---|
| `tilt_x`, `tilt_y` (2 µrad LSB) | radians | `× 2e-6` |
| `strain_ue` | dimensionless | `× 1e-6` |
| `ext_delta_10um` | metres | `× 1e-5` |
| `temp_dc` | °C | `× 0.1` — **consumed by C7, not forwarded** |

> **`valid` is (31, 4), not (31,).** A node can send a good tilt and a garbage strain in the same packet. Masking per node throws away good data. Channel order is `[tilt_x, tilt_y, strain, ext]` and it never changes.

---

## 13. What the PINN must NEVER receive

| Withheld | Why |
|---|---|
| `truth.npz` / `truth_at()`, any part | it is the answer key. One import and the system becomes a playback device that still looks like it works |
| `site.a`, `site.c` | **the circularity trap — §16.** These are what the sensors are for |
| `vib_rms`, `vib_peak`, `vib_fdom` | transients do not constrain a surface that moves over days → these go to C8 |
| `status_flags` / crack bits | derived from strain; feeding them double-counts the same evidence → C8 |
| `temp_dc` | already consumed at C7 step 3; pass it again and the net re-learns a correction already applied |
| `vbat_mv` | already consumed at C7 step 4 |
| `rssi`, `snr`, `hops`, `parent_id` | link quality is not ground physics. It belongs in **σ**, not in the network |
| Raw uncorrected values | the net will fit thermal drift and confidently call it subsidence |

> **The one-line rule:** the PINN sees **geometry, corrected physics, and honesty about uncertainty**. Nothing else.

---

## 14. The network

| Property | Value | Why this and not something else |
|---|---|---|
| Input | `(x, y, t)`, each normalised to ≈ [−1, 1] | it is a coordinate MLP; normalisation is not optional for PINNs |
| Output | `S`, scalar, metres, **down positive** | one surface, one number |
| Shape | 4 hidden layers × 64 units ≈ 13 k params | tiny, trains on a CPU in seconds |
| Activation | **`tanh`** | you need `∂²S/∂y²`. **ReLU's second derivative is zero everywhere and the strain loss silently dies** — no error, just a loss that never moves |
| Derivatives | autograd on the net's own output | exact, not finite-differenced |
| Optimiser | Adam, ~400 steps per epoch | |
| Warm start | **always**, from the previous epoch's weights | the surface barely moved in 30 minutes; cold-starting wastes 90% of the compute |
| Learnable extras | `â` (init 0.5), `ĉ` (init 0.008) | §16 |

---

## 15. The five losses

| # | Loss | Compares | Weight | Evaluated at | What it constrains |
|---|---|---|---|---|---|
| 1 | **Tilt** | net `∂S/∂x`, `∂S/∂y` vs `obs_tilt_x/y` | `1/σ²` | 31 node positions | local slope |
| 2 | **Strain** | net `B·∂²S/∂y²` vs `obs_strain` | `1/σ²` | node positions | local curvature |
| 3 | **Extensometer** | net's implied peg-to-peg length change vs `obs_ext` | `1/σ²` | node → `ext_to` lines | integrated movement |
| 4 | **Anchor** | net `S` vs `0` | high, fixed | the 2 anchors | **absolute height** |
| 5 | **Physics** | net `S` vs the Knothe form built from `â`, `ĉ` | moderate | **2000 random points, resampled every epoch** | global shape |

### 15.1 Loss 4 does enormous work for one line

Losses 1–3 constrain **shape only**. None of them constrains **height**. Without anchors you get a perfectly-shaped bowl floating at an arbitrary depth — the mathematics genuinely cannot distinguish 5 mm from 5 m, because tilt and strain are derivatives and derivatives lose the constant.

**Anchors convert relative shape into absolute millimetres.** One loss term, two nodes, and the entire output becomes meaningful.

### 15.2 Loss 5 fills the dead zone

Where a Kill Cluster removed six nodes, losses 1–3 contribute **nothing** in that region and loss 4 is far away. Loss 5 is still fully present, and it says: *whatever is here must be a smooth Knothe bowl consistent with the edges.*

**That is a defensible reconstruction, not a guess** — and it is the answer to the question the judges will ask the moment you press the button.

---

## 16. The circularity trap — the single most important section

Loss 5 says "S must obey the Knothe form."

**If you hand the network the true `a` and `c` from `nodes.json`, loss 5 alone fully determines the answer.** The network reconstructs a perfect surface **without reading a single sensor**, and your demo becomes an elaborate way of re-plotting a formula you typed in yourself.

**It will look like it works.** That is what makes it dangerous.

| Parameter | Fixed or learned | Init | True value | Why |
|---|---|---|---|---|
| `x1, y1, x2, y2` | **fixed** | true | — | the mine plan is a genuinely known input |
| `H` | **fixed** | true | 150 m | known from the mine plan |
| `tan_beta` | **fixed** | true | 2.0 | regional geology constant |
| `B` | **fixed** | true | 24.0 m | derived from `r`, must match the simulator |
| `a` subsidence factor | **LEARNED** | 0.5 | 0.65 | **this is what the sensors are for** |
| `c` time constant | **LEARNED** | 0.008 | 0.01414 | ditto |

Now loss 5 constrains only the **family** of shapes, and the sensors must pick which member is real.

> **Bonus deliverable:** the converged values are themselves a result. Put *"estimated subsidence factor: 0.63"* on the dashboard next to the true 0.65. That single line proves the network learned something rather than replaying it.

---

## 17. How the terrain is actually built — step by step

This is the loop, in the order to write it.

```
ONCE, at startup
 1. Load nodes.json. Run the 12 validations in §10.
 2. Build the static tensors: xy, ext_to, is_anchor, panel, H, tan_beta, m_seam, B, grid_x, grid_y.
 3. Initialise the MLP. Initialise â = 0.5, ĉ = 0.008 as learnable scalars.
 4. Precompute normalisation ranges from `grid` and `duration_days`.

EVERY EPOCH (30 simulated minutes)
 5. Receive the C7 dict: t, obs_*, sigma_*, valid.
 6. Warm-start: keep last epoch's weights, â, ĉ. Do NOT reinitialise.
 7. Sample 2000 fresh collocation points uniformly inside `grid`.
 8. For ~400 Adam steps:
      a. forward pass at the 31 node positions → S_nodes
      b. autograd → ∂S/∂x, ∂S/∂y, ∂²S/∂y² at those positions
      c. loss 1 = Σ valid[:,0:2] · (net_tilt − obs_tilt)² / σ_tilt²
      d. loss 2 = Σ valid[:,2]   · (B·net_curv − obs_strain)² / σ_strain²
      e. loss 3 = Σ valid[:,3]   · (net_extΔ − obs_ext)²      / σ_ext²
      f. loss 4 = Σ_anchors net_S²                        × high weight
      g. loss 5 = Σ_2000 ( net_S − Knothe(x,y,t; â, ĉ) )² × moderate weight
      h. backprop through weights AND â, ĉ
 9. Evaluate the trained net on the 64×64 grid → S_grid.
10. Autograd on the grid → tilt_x_grid, tilt_y_grid, strain_grid.
11. Leave-one-out: for each node i, retrain briefly with node i masked,
    predict node i, record |predicted − observed| → loo_residual[i].
12. Emit outputs. Store weights for the next warm start.
```

### 17.1 Cost control for step 11

Full LOO is 31 retrains and is too slow at demo speed. **Use a cheap approximation:** train once with all nodes, then for each node compute the residual it would have had under a single-step influence-function correction. Full LOO runs **only** on the frames you show — after a Kill Cluster and at the final frame. Say which you did.

---

## 18. What the PINN produces

| Name | Shape | Units | Goes to | Cadence |
|---|---|---|---|---|
| `S_grid` | (64, 64) | m, down positive | 3-D dashboard surface | 30 min |
| `tilt_x_grid`, `tilt_y_grid` | (64, 64) | rad | contour overlay | 30 min |
| `strain_grid` | (64, 64) | — | tension heat-map | 30 min |
| `a_hat`, `c_hat` | scalars | —, /day | "estimated parameters" panel | 30 min |
| `loo_residual` | (31,) | per-channel σ | **the live accuracy number** | 30 min |
| `confidence_grid` | (64, 64) | — | coverage zoning overlay | 30 min |
| `weights` | — | — | warm start for the next epoch | 30 min |

### 18.1 Why `loo_residual` is the most valuable output

Hide node 17, reconstruct from the other 30, predict what 17 *should* read, compare to what it did.

**It needs no ground truth.** Which means it is the **only accuracy metric that survives into a real deployment**, where there is no `truth.npz` and never will be. Every other team's accuracy number dies the moment they leave the simulator.

Put it on the dashboard, live, as a number that visibly widens when you press Kill Cluster. That honesty is more persuasive than a smaller error bar.

### 18.2 `confidence_grid`

Per grid cell, interpolate `loo_residual` weighted by distance to each contributing node. Cells far from any live node get a wide band. Render as transparency or hatching on the 3-D surface, so the judge can literally see where the model is guessing.

---

## 19. The rule that makes an AI component acceptable in a safety system

> ## **The PINN draws. It never decides.**

Alarms are owned entirely by C8 — classical bowl fit plus blast-log cross-check (file 06). **C8 never reads C9's output.** Routing a learned surface into a safety decision, even indirectly, would launder a neural network into the alarm path through the back door.

No language model anywhere in the safety loop.

---

## 20. The handoff flowchart

```mermaid
flowchart LR
  subgraph IN["INPUT — every 30 sim-min, ~4 KB"]
    G["GEOMETRY static<br/>xy · ext_to · is_anchor<br/>panel · H · tan_beta · m_seam · B"]
    O["OBSERVATIONS SI units<br/>obs_tilt_x · obs_tilt_y<br/>obs_strain · obs_ext"]
    S["UNCERTAINTY<br/>sigma per channel<br/>+ valid (31,4) mask"]
    T["t · days since start"]
  end

  IN --> NET["tanh MLP 4x64<br/>(x,y,t) → S<br/><b>learnable â, ĉ</b>"]

  NET --> L1["L1 tilt vs autodiff ∂S/∂x, ∂S/∂y"]
  NET --> L2["L2 strain vs B·∂²S/∂y²"]
  NET --> L3["L3 extensometer along peg lines"]
  NET --> L4["L4 anchors pinned to S=0<br/><b>gives absolute height</b>"]
  NET --> L5["L5 Knothe physics · 2000 points<br/><b>FILLS THE DEAD ZONE</b>"]

  NET --> OUT["OUTPUT<br/>S_grid 64×64 · strain_grid<br/>â · ĉ · loo_residual · confidence_grid"]

  OUT --> DASH["Dashboard 3-D surface"]
  OUT -.->|"<b>NEVER an alarm</b>"| C8["C8 classical detector<br/>OWNS THE ALARM"]

  BLOCK["truth.npz / truth_at()"] -.->|"<b>BLOCKED — no import path</b>"| NET
  AC["site.a, site.c"] -.->|"<b>BLOCKED — circularity</b>"| NET
  VIB["vib · crack · temp · vbat<br/>rssi · snr · hops"] -.->|"NOT to the PINN"| C8
```

---

## 21. Gates this file owns

| Test | Asserts |
|---|---|
| **V1–V12** | the `nodes.json` load-time validations in §10 |
| **T18** | grepping `backend/C9/` finds no reference to `site.a`, `site.c`, `S_MAX`, `C_KNOTHE`, or anything under `truth/` |
| **T19** | after 40 simulated days, `a_hat` lands within 15% of 0.65 and `c_hat` within 25% of 0.01414 |
| **T20** | with the anchor loss disabled, `S_grid` mean offset drifts by more than 10 cm — proving loss 4 is doing the work claimed for it |
| **T21** | switching the activation to ReLU makes the strain loss constant — proving the `tanh` requirement is real, not folklore |

T20 and T21 are worth writing because they turn two design claims into **demonstrated** facts, and a judge can watch you run them.
