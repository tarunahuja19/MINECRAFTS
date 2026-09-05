# Toolchain Orchestration Plan — Mine Subsidence Early-Warning System

**Purpose of this document:** not a menu of tools. A *decided* toolset, the exact data that flows between each tool, the order things get built in, who owns what, and what breaks if it goes wrong.

Every tool below has been kept because removing it would break a chain. Everything else from the research document is cut, and each cut has a one-line answer ready for a judge.

---

## 0. The framing that makes the whole thing click

The single biggest mistake available here is treating all tools as the same kind of thing. They are not. There are **two categories**, and confusing them is how teams end up with twelve half-running services and no working demo.

### Category A — RUNTIME tools
These are *part of the delivered system*. They must be running, at the same time, during the demo. If one is down, the demo is down.

### Category B — BENCH tools
These produce **one artifact** — a CSV file, a GeoJSON layer, a verified binary, a number for a slide — and then **get out of the way**. They are never running during the demo. Nobody needs to install them to run the system.

| Tool | Category | Produces / does |
|---|---|---|
| Python ground model (Knothe) | Bench | `groundtruth.parquet` |
| Python sensor model | Bench | `rawsensor_node<N>.csv` |
| PlatformIO native tests | Bench | Verified firmware logic + pass/fail |
| Wokwi | Bench | Working I2C/ADC sensor-read code before parts arrive |
| Meshtasticator | Bench **and** Runtime | Network stats (bench) / live packet source (runtime) |
| QGIS | Bench | `risk_zones.geojson`, `panel_outline.geojson`, basemap |
| SPLAT! | Bench | One terrain link-coverage figure |
| **Mosquitto (MQTT)** | **Runtime** | The spine — everything talks through it |
| **SQLite** | **Runtime** | Offline buffer + timeseries store |
| **Python ingest/detect service** | **Runtime** | The actual brain |
| **Leaflet dashboard** | **Runtime** | The map judges look at |
| **Alert dispatcher (Python)** | **Runtime** | Siren → GSM SMS → email/app |
| **Docker Compose** | **Runtime harness** | One command starts all five above |

**Runtime is five things.** That is the whole delivered system. Five. If a teammate can't name all five from memory, the architecture is not yet understood.

Everything else is a bench tool that fires once, hands over a file, and is never thought about again.

---

## 1. The locked toolset — and why each one cannot be removed

### RUNTIME (5 components — non-negotiable)

**R1. Mosquitto (MQTT broker)**
- *Why it cannot be removed:* this is the seam that lets simulation and real hardware be interchangeable. Meshtastic firmware natively publishes to MQTT. So on demo day, swapping "simulated mine" for "real nodes on the table" is **changing which process is publishing to a topic** — not rewriting anything. Every other architecture makes that swap a rewrite.
- *ELI5:* it's a noticeboard in a corridor. Anyone can pin a note up under a heading; anyone can stand and watch a heading for new notes. Nobody needs to know who else is in the building.
- *How used:* one topic tree, frozen day 1 (see §3, C4). Runs in Docker, port 1883.

**R2. SQLite**
- *Why it cannot be removed:* it *is* the answer to the problem statement's "offline capability with periodic cloud sync" clause. Not a proxy for it — literally it. Gateway writes every reading to a local file; a sync worker pushes unsent rows whenever internet appears and marks them sent.
- *Why not Postgres/InfluxDB:* they need a server process. The gateway is a Raspberry Pi that might lose power. SQLite is a file. Zero admin, survives reboots, one dependency less in the Docker stack.
- *How used:* two tables — `readings` (with a `synced` flag) and `alarms`. WAL mode on. One writer process only.

**R3. Python ingest + detection service**
- *Why it cannot be removed:* this is the project's actual intellectual contribution. Bowl-shape correlation across neighbours, blast-log cross-check, Knothe forward projection ("reaches alarm in ~6 days"), tilt demoted to a secondary vote.
- *Keep it classical.* Deterministic geometry + curve fitting + a thin scikit-learn anomaly layer *at most*. A deep model trained on your own simulator learns your simulator, and a judge who knows ML will ask exactly that.

**R4. Leaflet dashboard**
- *Why it cannot be removed:* the PS asks for GIS-based deformation maps and risk zones, and this is the thing on the screen when judges are watching. Nodes as coloured dots, live-changing, trough contour overlaid, dead nodes greyed with a "last gasp" marker.
- *Why not ThingsBoard/Grafana:* both are configuration, not engineering. A judge who recognises a stock Grafana panel discounts the whole build. Grafana stays as an *internal* debugging view only, never on the demo screen.

**R5. Alert dispatcher (Python, ~120 lines)**
- *Why it cannot be removed:* the PS asks for delivered alerts. The three-layer fallback (siren → GSM SMS → internet email/app) is a differentiator only if it actually runs.
- *Why not Node-RED:* **cut.** It's a second runtime, a second language of thought, and it splits alert logic across two places. The chain is a for-loop over three handlers with try/except. Forty lines. Node-RED costs more than it saves here.

**Harness: Docker Compose** — one `docker compose up` starts broker, database, detection, dashboard, dispatcher, and (optionally) the simulated mine publisher. This is what makes the demo survivable. It also makes onboarding a teammate a one-line instruction instead of a two-hour setup call.

---

### BENCH (6 tools — each fires, hands over a file, exits)

**B1. Python Knothe / influence-function ground model** *(NumPy + SciPy, ~250 lines)*
- *Job:* generate the ground truth. Panel geometry in, `subsidence / tilt / strain` at every (x, y, t) out, over 90 simulated days.
- *Why nothing else:* SDPS is the industry standard but inaccessible; FLAC3D is correct for caving but costs money and weeks; OpenSees/FEniCS are general PDE solvers where you'd have to build the geomechanics yourself. Influence-function *is* the accepted empirical method for trough subsidence, and owning every parameter is what lets you generate a hundred scenarios instead of one.
- *Critical:* this file is the answer to "how do you know your detection works?" Detection is scored against it.

**B2. Python sensor model** *(~200 lines)*
- *Job:* turn physics into what the chips would actually report. Takes ground truth + node coordinates → per-node raw timeseries including MPU9250 thermal drift, ADC noise, blast spikes at logged blast times, truck passes, battery sag.
- *Why it cannot be removed:* this is what *proves* the tilt-demotion argument numerically instead of asserting it. "We measured that thermal drift (0.76°) exceeds the subsidence signal (0.17–1.0°) across a diurnal cycle" is a claim; this model is the evidence.

**B3. PlatformIO native builds + unit tests**
- *Job:* compile the **real firmware C++** for the laptop instead of the ESP32, feed it the B2 CSV, and check that the sampling, filtering, and packet-packing logic is correct — before any hardware exists.
- *ELI5:* you're testing the recipe by cooking it in your own kitchen before you've been given access to the restaurant.
- *Why this beats emulation:* QEMU and Renode emulate the *chip*. You don't need the chip — you need to know your maths is right. Native tests run in under a second and can go in CI.

**B4. Wokwi**
- *Job:* the hardware team writes and debugs I2C sensor-reading and ADC code in a browser while the parts are still in transit. Nothing more.
- *Explicit limitation to accept up front:* no real LoRa, no MPU9250 model, no ADC realism. It buys you a head start on I2C plumbing and nothing else. Do not try to make it do more.

**B5. Meshtasticator**
- *Job:* the entire Layer-4 answer. Runs actual Meshtastic firmware as native Linux binaries across N simulated nodes.
- *Why nothing else:* FLoRa and ns-3 model LoRaWAN **star** topology. Yours is a flooding mesh. They would simulate the wrong protocol with great rigour. This is the single sharpest tool-selection point in the project and worth saying out loud to judges.
- *Two modes, used at different stages:* discrete-event mode first (fast, statistical — run 500 scenarios, get PDR/latency/hop-count distributions). Interactive mode later (real firmware, real packets → can publish into your MQTT broker, becoming a **runtime** component for the demo).
- *The money demo:* kill the six nodes nearest the trough centre mid-run and show the mesh reroute and the alarm still landing.

**B6. QGIS**
- *Job:* produce **static GeoJSON layers** consumed by the Leaflet dashboard — panel outline, predicted trough contours, and the confidence-zoning map (where the system claims good warning vs. where brittle rock means low confidence).
- *Reframe that matters:* QGIS is **not a runtime component.** It is an asset factory that runs a few times and exports files into the repo. Once the GeoJSON exists, QGIS is irrelevant to the running system.

**B7 (Tier 3). SPLAT! + SRTM terrain** — one-off. Produces a single link-viability map over a *named real Indian coalfield*. One figure, high credibility, half a day.

---

### Explicitly cut, with the answer ready

| Cut | The one-line reason |
|---|---|
| ns-3 / FLoRa | Model LoRaWAN star topology; ours is a flooding mesh — they'd simulate the wrong protocol |
| Renode | Right idea, but ESP32 support is partial and there is no LoRa radio model |
| OpenSees / FEniCS / Code_Aster | General PDE solvers, not subsidence tools; influence-function is the accepted industry method |
| FLAC3D / UDEC | Correct for caving mechanics, out of budget — so we scope claims to trough subsidence and mark brittle zones low-confidence |
| ThingsBoard | Free and capable, but it makes the project look configured rather than engineered |
| Node-RED | The alert chain is forty lines of Python; a second runtime costs more than it saves |
| Grafana (on demo screen) | Analyst-facing, not operator-facing — internal debugging only |
| MATLAB `imuSensor` | Only if a campus licence with the toolbox already exists; otherwise it splits the stack for no gain |

---

## 2. The development flow — five phases

```
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 0 — FREEZE THE CONTRACTS            (2 days, ALL SIX PEOPLE)  │
│ Five interface files agreed and committed. Nothing else happens     │
│ until these exist. This is what lets six people work in parallel    │
│ without blocking each other.                                        │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        v                      v                      v
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ PHASE 1a      │    │ PHASE 1b         │    │ PHASE 1c         │
│ SOFTWARE      │    │ FIRMWARE         │    │ HARDWARE         │
│               │    │                  │    │                  │
│ B1 ground     │    │ B3 PlatformIO    │    │ B4 Wokwi I2C     │
│ B2 sensor     │    │    native tests  │    │ Bench circuit    │
│ R1 broker up  │    │ Packet codec     │    │ Wheatstone bridge│
│ R2 sqlite     │    │ (C++ AND Python  │    │ Parts ordered    │
│               │    │  from one file)  │    │                  │
│ NO HARDWARE   │    │                  │    │ Parts arriving   │
│ NEEDED        │    │                  │    │                  │
└───────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
        │                     │                       │
        └─────────────────────┼───────────────────────┘
                              v
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 2 — THE VERTICAL SLICE            ← THE MOST IMPORTANT GATE   │
│                                                                     │
│ ONE fake node → MQTT → SQLite → dashboard shows ONE moving dot.     │
│ Ugly. Hardcoded. Single node. Doesn't detect anything.              │
│ But end-to-end, running under docker compose, in one command.       │
│                                                                     │
│ Do NOT go deep on any layer before this exists.                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        v                      v                      v
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ PHASE 3a      │    │ PHASE 3b         │    │ PHASE 3c         │
│ DETECTION     │    │ NETWORK          │    │ REAL NODES       │
│               │    │                  │    │                  │
│ Bowl-shape    │    │ B5 Meshtasticator│    │ 3 nodes soldered │
│ correlation   │    │  discrete-event  │    │ Thermal cal      │
│ Blast cross-  │    │  → 500 runs      │    │ Extensometer     │
│ check         │    │  → PDR/latency   │    │ Gateway + SIM800L│
│ Knothe        │    │  then interactive│    │ + siren          │
│ projection    │    │  → real firmware │    │                  │
│ 30 virt nodes │    │  → MQTT          │    │                  │
└───────┬───────┘    └────────┬─────────┘    └────────┬─────────┘
        │                     │                       │
        └─────────────────────┼───────────────────────┘
                              v
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 4 — THE SWAP                                                  │
│ Real gateway publishes to the SAME MQTT topics the simulator used.  │
│ Detection, storage, dashboard, alerts change by ZERO lines.         │
│ If this takes more than an afternoon, a contract was violated.      │
└──────────────────────────────┬──────────────────────────────────────┘
                               v
┌─────────────────────────────────────────────────────────────────────┐
│ PHASE 5 — ADVERSARIAL HARDENING + DEMO                              │
│ Node-kill runs · 90-day false-positive sweep · blast injection ·    │
│ offline-sync pull-the-ethernet test · venue RF check · fallbacks    │
└─────────────────────────────────────────────────────────────────────┘
```

**The one non-obvious thing on that chart:** Phase 2. Most teams build each layer deeply and integrate at the end — and integration is where they die, because five components that were each "done" turn out to disagree about timestamps, units, and node IDs. Building an ugly single-node vertical slice early forces every disagreement to surface on day 5 instead of day 25.

---

## 3. The contracts — this is what "connecting the tools" actually means

Connecting tools is not about them being compatible. It's about **five files, agreed on day one, that nobody is allowed to change unilaterally.** Everything else is downstream of these.

### C1 — `groundtruth.parquet`
Written by: B1 ground model · Read by: B2 sensor model, detection validation

| Column | Unit |
|---|---|
| `t_days` | float, simulated days from panel start |
| `node_id` | int |
| `x_m`, `y_m` | metres, local grid |
| `subsidence_mm` | mm, positive = down |
| `tilt_x_urad`, `tilt_y_urad` | microradians |
| `strain_ustrain` | microstrain, positive = tension |

### C2 — `rawsensor_node<N>.csv`
Written by: B2 sensor model · Read by: B3 PlatformIO native tests, firmware development

| Column | Note |
|---|---|
| `t_ms` | node-local milliseconds |
| `ax, ay, az, gx, gy, gz` | raw MPU9250 register counts, *not* converted units |
| `temp_c` | from the MPU9250's own onboard thermometer |
| `adc_counts_strain` | raw ADS1115 counts, 16-bit signed |
| `vbat_mv` | battery millivolts |

> Deliberate choice: **raw counts, not engineering units.** The conversion maths is firmware's job, so firmware must be tested on the raw thing. If the CSV hands over pre-converted values, the most bug-prone code in the project never gets tested.

### C3 — the packet — **the highest-risk contract in the project**
Written by: firmware (C++) · Carried by: Meshtastic · Decoded by: backend (Python)

≤60 bytes. Defined **once**, in one file, from which both the C++ header and the Python `struct` format are generated by a small script.

```
uint8   version
uint16  node_id
uint32  t_epoch_s
int16   tilt_x_mdeg       // millidegrees, thermally corrected
int16   tilt_y_mdeg
int16   strain_ustrain
int16   temp_c_x10
uint16  vbat_mv
uint8   vib_rms_summary   // NOT raw waveform — bandwidth forbids it
uint8   flags             // bit0 last-gasp, bit1 self-test fail,
                          // bit2 blast-window, bit3 low battery
uint8   crc8
```

**Why this is the highest-risk item:** it is the only artifact that hardware, firmware, and software *all* depend on simultaneously. If it drifts, the split is silent — packets decode into plausible garbage. Freeze it in Phase 0, version it with `version` byte 1, and treat any change as requiring both sides to be updated in the same commit.

### C4 — MQTT topic tree + JSON payload
Written by: gateway (real) **or** the simulator (fake) · Read by: ingest service

```
mine/<panel_id>/node/<node_id>/telemetry     ← decoded C3, as JSON
mine/<panel_id>/node/<node_id>/status        ← online/offline/last-gasp
mine/<panel_id>/gateway/health               ← uptime, queue depth, sync backlog
mine/<panel_id>/alarm                        ← C5
```

**This is the seam that makes the whole architecture work.** The simulator and the real gateway publish to *identical* topics with *identical* payloads. Downstream cannot tell them apart, and does not need to. That is the entire reason the Phase 4 swap is an afternoon and not a week.

### C5 — the alarm event JSON
Written by: detection · Read by: dashboard, alert dispatcher, SQLite

```json
{
  "alarm_id": "uuid",
  "t_utc": "2026-08-29T11:20:00Z",
  "panel_id": "P3",
  "level": 2,
  "centroid": {"x_m": 340, "y_m": 110},
  "affected_nodes": [5, 6, 7, 11, 12],
  "trough_fit_r2": 0.94,
  "projection": {"days_to_level_3": 6.2, "confidence": "medium"},
  "blast_correlated": false,
  "explanation": "7 adjacent nodes show a bowl-shaped strain increase over 38h; no blast logged in window; tilt agrees as secondary vote.",
  "confidence_zone": "high_warning"
}
```

The `explanation` field is not decoration. It is the difference between an alarm a safety officer trusts and one they switch off — and false-alarm fatigue is the documented primary failure mode for deployed systems of this class.

---

## 4. Worked example — one number's full journey

This is the answer to "how does one tool's data get to another." Follow node 7, at (x=340 m, y=110 m):

1. **B1 ground model** — at t = 45 days, the influence function summed over the mined panel gives node 7: subsidence 63 mm, tilt 310 µrad, strain +1.4 mm/m. → written to `groundtruth.parquet`.

2. **B2 sensor model** — reads that row. Converts 310 µrad to the accelerometer counts an MPU9250 would report at that inclination. Then adds the diurnal temperature curve for a surface node in direct Indian sun, applies the datasheet thermal-drift coefficient (which contributes a *larger* apparent tilt than the real signal — this is the tilt-demotion proof), adds ADC noise, adds a 40 ms blast spike at the timestamp taken from the DGMS-mandated blast log, adds a truck pass. → `rawsensor_node07.csv`.

3. **B3 PlatformIO native** — the **exact same `process_sample()` C++ function** that will run on the ESP32 is compiled for x86 and fed that CSV. It median-filters, applies the temperature correction using the onboard thermometer reading, computes the vibration RMS summary, and packs a 24-byte C3 packet. Unit test asserts: thermally-corrected tilt is within tolerance of ground truth, and the blast spike sets the blast-window flag rather than triggering an alarm.

4. **B5 Meshtasticator** — that packet enters a 30-node simulated mesh at IN865/SF9. It travels 3 hops to the gateway. Some runs it's lost. Statistics over 500 runs give delivery ratio and latency distributions — including under alarm cascade, when every node in the trough wants to transmit at once and IN865 duty-cycle limits bite.

5. **Gateway** — decodes C3 → C4 JSON, writes it to **SQLite immediately** (`synced=0`), and publishes to `mine/P3/node/7/telemetry`. If the internet is down, step 6 still happens locally and the row waits.

6. **R3 detection service** — subscribes. Pulls node 7's neighbours from the last 48 h. Fits the neighbourhood against a Knothe trough shape: R² = 0.94. Cross-checks the blast log: no blast in window. Tilt agrees as a secondary vote. Extrapolates the Knothe time function forward: level 3 in ~6.2 days. → emits C5.

7. **R5 dispatcher** — siren fires off the gateway battery (needs nothing). SIM800L texts the safety officer over bare 2G (needs no internet). Email and app push queue for whenever internet returns.

8. **R4 dashboard** — nodes 5, 6, 7, 11, 12 turn amber, the fitted trough contour is drawn over the QGIS-exported panel outline, and the `explanation` string appears in plain words next to it.

9. **Internet returns** — sync worker pushes every `synced=0` row from SQLite to the cloud and flips the flag.

**That chain, spoken in one sentence to a judge, is the pitch:** *"We simulated 90 days of ground movement, injected datasheet-accurate sensor noise, ran it through our real firmware across a 30-node simulated mesh, killed the six nodes nearest the trough centre, and the system still raised the alarm in 4.2 minutes with zero false positives across 90 simulated days."* Every tool above exists only so that sentence can be true.

---

## 5. Seat ownership — six people, 3 software / 3 hardware

Assigned by tool, not by person. One rule throughout: **one owner per contract boundary.**

| Seat | Owns (tools) | Owns (contracts) | Phase 1 deliverable |
|---|---|---|---|
| **S1 — Physics & detection** | B1 ground model, R3 detection | C1, C5 | Ground truth parquet for a 300×200 m panel over 90 days, plotted |
| **S2 — Spine & integration** | R1 Mosquitto, R2 SQLite, Docker Compose, B2 sensor model | C4 | `docker compose up` brings up broker + DB + a stub publisher |
| **S3 — Surface & alerts** | R4 Leaflet dashboard, R5 dispatcher, B6 QGIS | — | Map renders with static nodes and QGIS-exported panel outline |
| **H1 — Node hardware** | B4 Wokwi, node board, ADS1115, regulator, enclosure | — | I2C read of MPU9250 working in Wokwi; BOM ordered |
| **H2 — Sensing & calibration** | Strain bridge, wire extensometer, thermal calibration rig | — | Wheatstone bridge validated in a circuit sim; drift rig planned |
| **H3 — Gateway & firmware** | B3 PlatformIO, B5 Meshtasticator, gateway, SIM800L, siren | **C2, C3** | Packet codec generating both `packet.h` and `packet.py` from one source |

**H3 is the load-bearing seat.** It owns the packet contract, the firmware toolchain, and Meshtasticator — the three items where a mistake propagates silently to everyone else. If your team has a hybrid hardware/software member, this is their seat. If it is a strict 3/3 split, H3 goes to the strongest hardware person, **but the Python half of the packet codec is co-reviewed by S2** — because C3 is the one contract with two languages on either side of it.

**Integration owner:** S2. Whoever owns Docker Compose owns "does the whole thing come up." That must be one named person or it becomes nobody.

*Thermal calibration rig, in plain terms:* a styrofoam cooler, a cheap hair dryer, an ice pack, and a thermometer. Put a node inside, swing it from ~10 °C to ~50 °C over an hour while it logs, and plot reported tilt against reported temperature. The slope of that line is your correction coefficient. That's the whole apparatus — no lab needed.

---

## 6. Stage gates — decide by these dates or take the fallback

| Gate | Test | If it fails |
|---|---|---|
| End of Phase 0 | All five contract files committed and readable by everyone | Nothing else starts. Blocking. |
| End of Phase 1 | Ground truth plots look like a subsidence trough; native tests pass on synthetic CSV | Simplify the ground model to a pure analytic Gaussian trough — accuracy loss is acceptable, blocking downstream is not |
| **Phase 2 (hard gate)** | `docker compose up` → one moving dot on a map | Stop all deep work. Everyone on integration until it passes. |
| Meshtasticator go/no-go | Discrete-event mode runs 50 nodes without crashing | Fall back to discrete-event only, plus a hand-computed IN865 duty-cycle table. Do **not** attempt interactive mode late. |
| Parts arrival | 3 nodes' worth of components in hand | Tier 1 is unaffected by design — that's the entire reason for simulation-first. Demo runs fully simulated if needed. |
| Phase 4 swap | Real gateway publishes; downstream unchanged | A contract was violated. Find which one — do not patch downstream to compensate. |
| Venue check (demo morning) | Live RF works in the hall | Run entirely in Docker on a laptop; hardware becomes a prop on the table. Say so honestly rather than passing a recording off as live. |

---

## 7. Failure modes, pre-decided

| Risk | Pre-decided response |
|---|---|
| Meshtasticator firmware-version mismatch | Pin the Meshtastic firmware version in the repo README on day 1. Discrete-event mode is documented against 2.1 — verify before depending on it. |
| Wokwi has no MPU9250 model | Use a generic I2C device stub. Wokwi's job is I2C plumbing only; register-level correctness is verified on the real bench. |
| ESP32 ADC nonlinearity bites | Already mitigated by the external ADS1115 — but verify against a known reference voltage on the bench, not on the datasheet's word. |
| IN865 duty cycle blocks an alarm cascade | Adaptive duty-cycle sampling: nodes drop to a minimal heartbeat once an alarm is confirmed and one aggregated bulletin carries the panel state. Test this explicitly in Meshtasticator — it is a *finding*, not just a fix. |
| Detection overfits the simulator | Hold out entire scenario *types* (different panel geometries, different rock parameters) from tuning. Validate the trough shape against published Indian coalfield subsidence curves. |
| SQLite write contention | WAL mode; exactly one writer process. Enforce it in code, not by convention. |
| Clock skew (sim vs. real nodes) | Node time is relative milliseconds. The gateway stamps UTC on decode. C3 carries `t_epoch_s` only where the node actually has a synced clock; otherwise the gateway is authoritative. |
| Nobody owns integration | S2 owns Docker Compose and therefore owns "does it come up." Named, not implied. |
| Two people edit C3 independently | Generated from a single source file by a script. If the script isn't run, the build fails. Make it structurally impossible, not a rule people remember. |
| Judge asks about brittle/sudden failure | Answer prepared: the influence-function method models trough subsidence, not caving. Those zones are marked low-confidence on the map. Modelling them properly needs FLAC3D-class tooling, which is named as out of scope rather than quietly ignored. |

---

## 8. Compressed answer

**Runtime, five things:** Mosquitto · SQLite · Python detection · Leaflet · Python alert dispatcher. Wrapped in Docker Compose.

**Bench, six things:** Python Knothe model · Python sensor model · PlatformIO native tests · Wokwi · Meshtasticator · QGIS. (Plus SPLAT! if time allows.)

**The glue is not a tool — it's five frozen contracts:** ground-truth parquet, raw-sensor CSV, the ≤60-byte packet, the MQTT topic tree, and the alarm JSON.

**The build order is:** freeze contracts → parallel Phase 1 with zero hardware dependency → ugly end-to-end vertical slice → depth → swap simulator for hardware → adversarial hardening.

**The one thing that would most likely sink this:** skipping Phase 2 and going deep on each layer first. Integration failure at day 25 is not recoverable; integration failure at day 5 is a morning's work.
