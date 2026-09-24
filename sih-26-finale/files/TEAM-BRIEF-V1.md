# TEAM BRIEF — v1 (demo Tue 15 Sep, 20:00) and what comes after

**For:** the ML teammate, backend pair, hardware pair, and whoever takes the frontend.
**Owner of this brief:** Adarsh. Questions go to Adarsh, not to the code.

## The idea in one picture

```
 real mine survey (Adriyala, JMMF 2022, 283 measured points)
            │ fitted parameters
            ▼
 SIMULATOR (mine-sim) ── ground sinks over 690 days as the coal face advances
            │            a sensor mesh "reads" the ground every simulated hour
            │            every value tagged real / pinned / synthetic
            ▼
 nodes.csv  +  terrain files  +  WebSocket stream
     │                 │                     │
     ▼                 ▼                     ▼
 ML: forecast      BACKEND: ingest,      RENDERER: 3D ground,
 +24h / +72h       store, alarm,         labelled SIMULATED /
 with a range      send one alert        FORECAST
```

**Two safety rules everyone follows:**
1. **ML never raises an alarm.** Only the backend's classical rule-based detector does. ML output is advisory.
2. **Simulated is never shown or described as measured.** Keep the `_prov` tag with every value, all the way to the screen.

## v1 vs v2 at a glance

| Team | v1 — by Tue 20:00 | v2 — Wed 16 onward |
|---|---|---|
| Simulator (Adarsh) | 690-day run, `nodes.csv`, terrain files, WebSocket replay, 3D view (Window 1) | **By Wed night:** Window 2 "freeze + create subsidence" (sinking, crack, tilt, blast, sinkhole → effect on houses/roads/poles) and the forecast view that shows what the ML prediction means on the ground. Scenarios stay inside the simulator and are never sent to backend or ML |
| ML | Loader + baseline + one model forecasting subsidence at +24h / +72h with p10/p50/p90, error in mm | Anomaly flags, early-warning lead time, validation on the 283 real points, forecast file to renderer |
| Backend | Ingest → store → one threshold alarm with logged reason → one real alert sent | Knothe-fit detector, DGMS blast filter, SMS/push/email routing, offline sync, API for frontend |
| Hardware | One node on the table sending a reading; sensor spec sheet; packet format | Mesh multi-hop, power, enclosure, drift curve |
| Frontend | — | Dashboard on backend API: map, 3 roles, mobile |

---

## The data — `nodes.csv` (frozen format)

Arrives in `handoff/v1-sample/` (git pull). One row per sensor node per simulated hour. **Column order and names are fixed. Don't rename them.**

```
epoch,t_s,node_id,tier,x_m,y_m,z0_mm,subsidence_mm,subsidence_prov,tilt_x_urad,tilt_y_urad,tilt_prov,strain_ustrain,strain_prov,disp_mm,disp_prov,battery_mv,rssi_dbm,parent_used,delivered,via_emergency
```

| Column | Meaning | Unit |
|---|---|---|
| `epoch` | Simulated hour number, 0, 1, 2… | — |
| `t_s` | Seconds since mining start | s |
| `node_id` | Gateway 0, Anchors 1–99, Scouts 100+. **Never infer behaviour from the number** | — |
| `tier` | `1A` tilt node · `1B` strain + displacement · `1C` long-baseline strain | — |
| `x_m`, `y_m` | Position. x = along the panel (face advance direction), y = across it | m |
| `z0_mm` | Ground height at the start. Fixed reference only | mm |
| `subsidence_mm` | Vertical movement since start. **Negative = ground went down** | mm |
| `tilt_x_urad`, `tilt_y_urad` | Surface tilt (1A only; empty otherwise) | µrad (1000 µrad = 1 mm per m) |
| `strain_ustrain` | Ground stretch (+) or squeeze (−) (1B, 1C; empty otherwise) | µε |
| `disp_mm` | Horizontal displacement (1B only; empty otherwise) | mm |
| `battery_mv` | Simulated battery voltage | mV |
| `rssi_dbm` | Radio signal strength | dBm |
| `parent_used` | Which relay node carried the packet | node_id |
| `delivered` | `true`/`false`. **False rows are kept on purpose**: in the real system that reading would be missing | — |
| `via_emergency` | v2; always `false` in v1 | — |
| `*_prov` | `real` = measured in the field · `pinned` = from the fitted model at a place/time where real data exists · `synthetic` = everything else | — |

Also in the folder:
- `terrain_state.npz`: full ground grid at the start
- `terrain_changes.jsonl`: per-hour changes to that grid
- `run_summary.json`: node counts, % real/pinned/synthetic, fit error

**Honest limits to repeat when asked:**
- Almost all values are `synthetic`.
- The fitted model is ~27% low at the deepest point compared with the real mine.
- Tilt, strain and displacement have no real field series behind them at all.

---

## ML teammate — v1

**Goal Tuesday:** for each node, predict `subsidence_mm` at **+24 h and +72 h**, as a range (p10 / p50 / p90).

1. **Today (before data arrives):** write the loader against the header above. Handle empty cells and `delivered=false` rows: treat undelivered as missing input, never as zero.
2. **Baseline first:** "no change" (value at +24 h = value now). Every model result is shown next to it.
3. **One model:** anything simple you can train by Tuesday (quantile gradient boosting, or a small sequence model) giving p10/p50/p90.
4. **Split by time**, never randomly: train on early days, test on later days.
5. **Report in mm:** MAE and the p10–p90 coverage (% of true values inside the range), per horizon, vs baseline. One plot: predicted range vs actual for 3 nodes.
6. **Output file:** exactly `sih-26-finale-brain/docs/interface-ml-to-renderer.md` §2b (per node, +24 h / +72 h, p10/p50/p90, cumulative mm, negative = down). One real file to Adarsh by **Wed 15:00**; the simulator's forecast view reads it.

**Not in v1:** anomaly detection, lead-time scoring, the real-data validation (v2 — it uses `mine-sim/data/real/adriyala_lw1_profiles.csv`, never simulator output). **Never:** anything that triggers an alarm.

## Backend pair — v1

**Goal Tuesday:** a reading goes in, gets stored, trips an alarm, and an alert reaches a real phone.

1. **Ingest:** tonight from `handoff/v1-sample/nodes.csv` (replay rows in time order); tomorrow from the WebSocket (`/ws/run`, command in `handoff/DEMO-SCRIPT-V1.md`).
2. **Dedup on `(node_id, epoch)`.** Never on a sequence number (it resets on reboot).
3. **Store** each value **with its `_prov` column**. Keep undelivered rows as "missing".
4. **Node health table:** last seen, battery, RSSI, delivery rate.
5. **One alarm rule, written down before coding:** e.g. "subsidence at a node fell by more than X mm in 24 h". State X and why. Log every firing with the rows that caused it.
6. **One alert actually delivered** (email or Telegram is fine for v1), with a rate limit so one node can't send 400.
7. **Minimal API:** latest reading per node + history for one node. Write the endpoints in a short README for the frontend later.

**Not in v1:** the Knothe-fit detector, DGMS blast filter, SMS/push routing per role, offline sync, auth. All v2, **and all owned by the backend** (SMS, app alerts, offline mode included). The simulator never sends alerts.

## Hardware pair — v1

1. One node on the table, powered, sending a reading the backend can receive.
2. **Sensor spec sheet to Adarsh by Tue midday:** per sensor: range, resolution, noise (node still), drift, sample rate. The simulator currently uses datasheet guesses.
3. **Radio packet format to Adarsh + backend by Tue midday**, so it can be checked against the simulator's packet.
4. Start the tilt day/night drift test (needed to justify tilt as a secondary signal).

## Frontend — v2

Nothing needed for v1. From Wednesday, build on the backend API. Owners get assigned at the Tuesday demo.

---

## Tuesday 20:00 demo — what the team will see

1. Simulator run: node layout, provenance %, the run finishing.
2. 3D view: the ground trough growing as the face advances, nodes coloured by data type, **SIMULATED** banner.
3. ML: forecast range vs actual at 3 nodes, error in mm vs baseline.
4. Backend: rows ingesting, one alarm fired with its reason, the alert arriving on a phone.
5. One slide: the v2 list above, with owners.
