# Tech Work Flowchart — Mine Subsidence System (for PPT team)

Purpose: one end-to-end picture combining **hardware (field) + software (tech)** so the PPT team can place it next to the hardware slides. Mine-independent (Adriyala is just the example input). Two versions below: **compact (1 slide)** and **full-depth (2–3 slides or appendix)**.

---

## VERSION A — Compact (one PPT slide)

Covers the whole story in 6 boxes. Matches `mine_subsidence_hld.drawio`.

```mermaid
flowchart LR
    FIELD["FIELD NODES & ANCHORS<br/>(LoRa mesh, 37 Scouts + 6 Anchors)"] -->|"mesh data"| GW["MASTER GATEWAY<br/>& Ingestion Hub"]
    GW <-->|"telemetry ⇄ predictions"| AI["AI MODEL<br/>& Hazard Detection"]
    GW -->|"persisted ingestion lane"| DB["POSTGRESQL<br/>& Central Backend API"]
    GW <-->|"live stream (<100 ms)"| DASH["OPERATOR MISSION CONTROL<br/>Dashboard (HMI)"]
    AI <-->|"hazard risk scores"| DB
    DB <-->|"WebSockets & REST APIs"| DASH
```

**One-line subtitle for the slide:** Ground moves → sensors read → LoRa mesh carries → gateway ingests → backend stores → detector alarms + ML forecasts → 3D dashboard shows → early warning goes out.

---

## VERSION B — Full-depth (explanatory, 2–3 slides)

Each box below carries its key numbers so a viewer understands *why*, not just *what*.

```mermaid
flowchart TD
    subgraph FIELD["FIELD LAYER — hardware (37 Scouts + 6 Anchors + 1 Gateway)"]
        direction TB
        S1["Tier 1A Scouts ×17 — MPU-6050 tilt only<br/>Flat trough bottom & far edges (low gradient)<br/>Secondary vote signal, drift-prone"]
        S2["Tier 1B Scouts ×14 — foil strain gauge on 10 m rod<br/>+ slide potentiometer<br/>Mid-slope band (high subsidence gradient)"]
        S3["Tier 1C Scouts ×6 — wire extensometer, 30 m baseline<br/>Peak-strain band near inflection point"]
        AN["Anchors ×6 — ESP32 + SX1262<br/>1 W solar panel (battery alone fails: 62 d life)<br/>6/6/6/6/6/7 children, bitmap ACK, SF8 backbone"]
        GW["Gateway ×1 — 10 m mast, NB-IoT uplink<br/>Sends sync beacon + anchor ACKs<br/>TDMA master clock of the 60 s superframe"]
        S1 & S2 & S3 -->|"LoRa IN865 BW125, SF7 uplink<br/>23 B packet, 61.7 ms airtime, 0.10% duty"| AN
        AN -->|"98 B bundle @ SF8, 297.5 ms<br/>0.56% duty, primary+backup parent failover"| GW
    end

    subgraph LAYOUT["LAYOUT LOGIC — why these numbers (sizing algorithm)"]
        direction TB
        GEO["Mine geometry in → influence radius out<br/>r = H / tan β = 187.5 m; extent W+2r = 625 m<br/>Peak subsidence 1.63 m (subcritical panel)"]
        PROF["Travelling profile cross, 40 m spacing<br/>Transverse line 17 + longitudinal line 21 − 1 shared = 37<br/>40 m = knee of sampling-error curve (21 mm)"]
        EXCL["Placement constraints<br/>Exclude water, steep slopes, buildings, roads<br/>LoRa line-of-sight + Fresnel check per hop"]
        COST["Cost gate: ₹97,200 vs ₹1,00,000 cap<br/>Count is algorithm OUTPUT, never input"]
        GEO --> PROF --> EXCL --> COST
    end

    subgraph SIM["SIMULATOR — Part 1 (Adarsh): demo without a mine"]
        direction TB
        ING["1. INGEST real layers for the mine<br/>Elevation 30 m · land cover 10 m · soil · weather<br/>Sentinel-1 InSAR pinning points · panel geometry"]
        WS["2. WORLD-STATE ENGINE — single owner of<br/>terrain truth S(x,y,t). Sensors/ML only READ it.<br/>Driven by face advance (4 m/day), not clicks"]
        EMU["3. SENSOR EMULATION per node<br/>Noise + temp drift + dropouts + TDMA loss/latency<br/>Every value tagged: real / pinned / synthetic"]
        OUT1[("nodes.csv — 1 row/node/frame<br/>+ terrain_state + terrain_changes log<br/>(replayable to any time T)")]
        ING --> WS --> EMU --> OUT1
    end

    subgraph CORE["CORE SOFTWARE — backend + intelligence"]
        direction TB
        API["FastAPI + WebSocket ingestion hub<br/>Dedup key (node_id, epoch) · STALE ≠ QUIET<br/>Streams live rows to dashboard"]
        DB[("PostgreSQL — readings + terrain + change log<br/>Exactly reproducible runs → fair ML A/B tests")]
        DET["Classical Knothe-fit detector<br/>ONLY alarm raiser · NO neural net in safety path<br/>3 alert levels → dashboard"]
        ML["Part 2 ML forecasting (reference only)<br/>Predict t+Δ, score on delayed truth<br/>Loss weighted: real > pinned > synthetic"]
        API <--> DB
        DB --> DET & ML
    end

    subgraph OUT["OPERATOR END — see it + act on it"]
        direction TB
        DASH["React + TypeScript + three-fiber 3D dashboard<br/>Terrain replay scrub · node health/telemetry<br/>Alert radius rings (1.2R / 1.5R), alarm history"]
        EW["Early warning out<br/>Siren / SMS / mine control-room hookup<br/>Blast-log filter (DGMS Circular 7/1997) cuts false alarms"]
        DASH --> EW
    end

    GW -->|"packets over NB-IoT"| API
    OUT1 -->|"same nodes.csv format<br/>plug-in replacement for field data"| API
    COST -.->|"positions + roles + parents<br/>(nodes.json)"| S1
    DET -->|"alarm levels"| DASH
    ML -->|"risk scores + forecast bands"| DASH
    DB -->|"WebSocket + REST, <100 ms live"| DASH
```

### How to split Version B across slides

| Slide | Subgraphs to show | Caption |
|---|---|---|
| B1 — Sense & place | FIELD + LAYOUT | "37 smart nodes placed by algorithm, not by hand — travelling cross follows the mining face" |
| B2 — Simulate & ingest | SIM + CORE (API + DB) | "Real data builds the terrain; every value tagged real/pinned/synthetic; one backend owns truth" |
| B3 — Decide & act | CORE (DET + ML) + OUT | "Classical detector raises alarms, ML forecasts ahead, dashboard replays everything, warnings go out" |

---

## Box-by-box PPT mapping (both versions)

| PPT box | What it is | Key number to print on the slide | Owned by |
|---|---|---|---|
| Field nodes & anchors | 37 Scouts + 6 Anchors, travelling profile cross, 40 m spacing | 40 m = error knee (21 mm); 86 dB link margin | Hardware team |
| Master gateway & ingestion | 10 m mast, NB-IoT, TDMA master, bitmap ACKs | 60 s superframe; anchor duty 0.56% ≤ 1% | Tech + hardware |
| Layout logic | Sizing algorithm: geometry → extent → spacing → tiers → cost | ₹97,200 vs ₹1,00,000 cap | Adarsh (tech) |
| Simulator (Part 1) | Data-driven terrain that evolves itself; no click-to-subside | Face advance 4 m/day; peak 1.63 m | Adarsh (tech) |
| PostgreSQL + backend API | Readings + terrain snapshots + change log (fully replayable) | Dedup `(node_id, epoch)` | Tech |
| AI model + hazard detection | Classical detector alarms; ML only forecasts | No neural net in safety path | Tech (ML teammate) |
| Mission control dashboard | 3D replay, node health, 3 alert levels | <100 ms live stream | Tech (frontend) |
| Early warning out | Siren/SMS/control-room; blast-log false-alarm filter | DGMS Circular 7/1997 | Hardware + mine |

## Notes for whoever draws the PPT

- Version A is the opener slide; Version B (B1–B3) is the deep-dive or appendix.
- Keep hardware boxes (field, gateway) visually grouped — that half merges with the hardware slides.
- The simulator box is the "demo without a mine" story: identical `nodes.csv` format, so downstream works before deployment.
- Safety line for judges: **no neural network in the alarm path** — classical detector owns alarms; ML only predicts.
- Provenance tags (`real` / `pinned` / `synthetic`) stop the ML from "learning the simulator instead of the ground".
