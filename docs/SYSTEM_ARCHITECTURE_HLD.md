# 🏛️ R4 System High-Level Design (HLD) — The 6-Box Architecture
## Executive Architecture Overview, Block Diagram, & System Flow

**Document Purpose:** A clean, simplified, high-level design (HLD) reference for the **R4 Real-Time Mine Subsidence Monitoring & Early Warning System**. It distills the complex geomechanical and distributed systems architecture into **6 core functional boxes** that anyone can understand in 60 seconds.

---

## 1. The Master 6-Box Architecture Diagram

```mermaid
flowchart TD
    classDef hardware fill:#1E293B,stroke:#38BDF8,stroke-width:2px,color:#FFFFFF;
    classDef sim fill:#312E81,stroke:#818CF8,stroke-width:2px,color:#FFFFFF;
    classDef broker fill:#064E3B,stroke:#34D399,stroke-width:2px,color:#FFFFFF;
    classDef db fill:#4C1D95,stroke:#C084FC,stroke-width:2px,color:#FFFFFF;
    classDef backend fill:#78350F,stroke:#FBBF24,stroke-width:2px,color:#FFFFFF;
    classDef frontend fill:#831843,stroke:#F472B6,stroke-width:2px,color:#FFFFFF;

    subgraph B1["BOX 1: Field Hardware & IoT Fleet (Adriyala Mine)"]
        N_FIELD["31 Rugged IoT Sensor Nodes<br/>• 25 Scouts (Tilt, Strain, Extensometer, Fissure)<br/>• 5 Anchors (ADXL355 Bedrock Ref, Piezometers)<br/>• 1 Gateway (SX1262 LoRa, 4G, RTK GNSS, Siren)"]
    end
    class B1 hardware;

    subgraph B2["BOX 2: Geomechanical Simulation Engine (:8000)"]
        PY_ENG["Python Physics Engine & Digital Twin<br/>• Knothe Closed-Form Ground Surface (S, T, ε, K)<br/>• 6-Stage Sensor Corruption (Drift, Sag, Noise)<br/>• C7 Corrector & C8 Deterministic Alarm Engine"]
    end
    class B2 sim;

    subgraph B3["BOX 3: Telemetry Message Broker (:1883)"]
        MQTT["Aedes MQTT Pub/Sub Broker<br/>• Topics: mine/&lt;panel&gt;/node/+/telemetry<br/>• Topics: mine/&lt;panel&gt;/alarm<br/>• Sub-100ms Fire-and-Forget Streaming"]
    end
    class B3 broker;

    subgraph B4["BOX 4: Authoritative Database (:5432)"]
        PG[("PostgreSQL Database (mine_subsidence)<br/>• nodes (31 canonical hardware profiles)<br/>• readings (raw time-series, Tier Nullability)<br/>• simulation_packets (60s master JSONB)<br/>• alarms (auditable legal ledger)")]
    end
    class B4 db;

    subgraph B5["BOX 5: Central Backend & API Server (:8080)"]
        EXPRESS["Node.js / Express & Native WebSockets<br/>• REST API (/api/nodes, /simulation/packets/:id)<br/>• WS Broadcaster (:8080/ws → packet_available)<br/>• Immediate Database Reset (/api/system/reset)"]
    end
    class B5 backend;

    subgraph B6["BOX 6: Operator Mission Control HMI & 3D Sandbox"]
        UI["Electron Operator Station (:8085) & 3D WebGL (:5173)<br/>• 2D Leaflet Aerial Map & 8x8 Sector Subsidence Heatmap<br/>• Real-time Strain & Tilt Canvas Sparklines (<100ms)<br/>• Interactive 3D Terrain Elevation Mesh (Three.js/MapLibre)<br/>• Audible Sirens, Evacuation Banners, & 90-Day Replay"]
    end
    class B6 frontend;

    %% Data Flow Connections
    N_FIELD -.->|LoRa 23-byte TDMA Packets| B2
    
    %% PATH B: Fast Transient Lane (<100ms)
    B2 -->|Publish Telemetry QoS 0| B3
    B3 -->|TCP MQTT Subscribe| B6

    %% PATH A: Audited Persisted Lane (60s Batch)
    B2 -->|Direct asyncpg INSERT / UPSERT| B4
    B2 -->|HTTP POST Finalized 60s Packet| B5
    B4 <-->|pg Connection Pool Queries| B5
    B5 -->|WebSocket Broadcast: packet_available| B6
    B6 -->|HTTP GET /simulation/packets/:id| B5

    %% 3D Geometry Channel
    B2 <-->|WebSocket :8000/ws (Mesh Vertex Deltas)| B6
```

---

## 2. High-Level ASCII System Architecture

```
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │               BOX 1: FIELD HARDWARE & IOT SENSOR FLEET (ALP MINE)                │
 │  31 Smart Nodes: 25 Scouts (Tension/Fault) + 5 Bedrock Anchors + 1 Mast Gateway   │
 └────────────────────────────────────────┬─────────────────────────────────────────┘
                                          │ LoRa SF7/SF8 TDMA (23-byte packets)
                                          ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │            BOX 2: GEOMECHANICAL PHYSICS SIMULATION ENGINE (PORT 8000)            │
 │  FastAPI • Analytical Knothe S(x,y,t) • 6-Stage Corruption • C7/C8 Alarm Engine   │
 └───────────────────┬──────────────────────────────────────────────┬───────────────┘
                     │                                              │
    [PATH A: The 60s Persisted Lane]               [PATH B: The <100ms Live Lane]
    (PostgreSQL Backed - Legal Proof)              (MQTT Stream - Zero Latency)
                     │                                              │
                     ▼                                              ▼
 ┌────────────────────────────────────────┐       ┌─────────────────────────────────┐
 │       BOX 4: AUTHORITATIVE DB          │       │      BOX 3: MQTT BROKER         │
 │           (PORT 5432)                  │       │          (PORT 1883)            │
 │  PostgreSQL: mine_subsidence           │       │  Aedes Pub/Sub Telemetry Broker │
 │  • readings (time-series)              │       │  Topics: mine/<panel>/node/...  │
 │  • simulation_packets (60s JSONB)      │       │  Non-blocking fire-and-forget   │
 │  • alarms (auditable ledger)           │       └────────────────┬────────────────┘
 └───────────────────┬────────────────────┘                        │
                     │                                             │
                     ▼                                             │
 ┌────────────────────────────────────────┐                        │
 │     BOX 5: CENTRAL BACKEND API         │                        │
 │           (PORT 8080)                  │                        │
 │  Node.js / Express Server              │                        │
 │  • REST: /api/nodes, /simulation/...   │                        │
 │  • WS Broadcaster: packet_available    │                        │
 └───────────────────┬────────────────────┘                        │
                     │                                             │
                     └──────────────────────┬──────────────────────┘
                                            │
                                            ▼
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │        BOX 6: OPERATOR MISSION CONTROL STATION & 3D SANDBOX (:8085 / :5173)      │
 │  Electron HMI + Three.js WebGL: 2D Leaflet Map, 8x8 Grid, Live Charts, 3D Mesh   │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The 6 Core Boxes — Deep Dive & Component Breakdown

### 📦 Box 1: Field Hardware & IoT Fleet (Adriyala Longwall Mine)
* **What it is:** 31 rugged, solar-battery IoT sensor stations anchored across the coal mine subsidence zone.
* **Technology:** ESP32-S3 microcontroller, SX1262 LoRa transceiver (865–867 MHz, 125 kHz BW under GSR 564(E)), IP67 polycarbonate enclosures.
* **The 6 Functional Tiers:**
  1. **Tier 1A (9 Baseline Scouts):** Flat bowl center; measures tilt and vibration.
  2. **Tier 1B (10 Tension Scouts):** $57\text{ m}$-wide perimeter inflection band; measures strain ($\mu\varepsilon$) and surface fissure cracking.
  3. **Tier 1C (6 Fault Scouts):** Diagonal geological fault corridor; measures invar wire extensometer displacement and soil moisture.
  4. **Tier 2A (3 Router Anchors):** Stable bedrock perimeter; carries ultra-low-noise ADXL355 inclinometers ($3\text{ }\mu\text{rad}$) for common-mode reference.
  5. **Tier 2B (2 Borehole Stations):** Over active panel; deep piezometers and 4-depth borehole inclinometers.
  6. **Tier 3 (1 Master Gateway):** $650\text{ m}$ outside angle of draw; 10m antenna mast, dual-frequency RTK GNSS, cellular 4G modem, and siren.
* **Output:** 23-byte binary LoRa packets transmitted in synchronized TDMA time slots.

---

### 📦 Box 2: Geomechanical Physics Simulation Engine
* **What it is:** The digital twin and physical truth engine of the mine. Computes analytical ground movement and replicates realistic environmental corruptions.
* **Technology:** Python 3.11+, FastAPI, Uvicorn, NumPy, SciPy, AsyncPG, Paho MQTT.
* **Port / Protocol:** Port `8000` (HTTP REST & WebSocket at `ws://localhost:8000/ws`).
* **Source Location:** `simulation/sandbox/` (`server.py`, `session.py`, `surface.py`, `sensors.py`, `db.py`).
* **Key Functions:**
  1. **Knothe Closed-Form Ground Surface:** Computes surface sinking $S(x,y,t)$, tilt $T$, curvature $K$, and horizontal strain $\varepsilon$.
  2. **6-Stage Physical Corruption Chain:** Injects diurnal thermal drift, battery voltage sag, white noise, and quantization before outputting values.
  3. **C7 Reversible Corrector:** Undoes hardware corruptions in reverse order (undo sag $\to$ undo thermal $\to$ convert to SI $\to$ common-mode rejection).
  4. **C8 Classical Alarm Engine:** Deterministic decision tree evaluating $Z$-scores, 3-node spatial quorums, $f_{dom}$ vibration filtering, and DGMS blast registers.
  5. **Aggregator:** Builds 60-second aggregated master packets and commits them directly to PostgreSQL.

---

### 📦 Box 3: Telemetry Message Broker
* **What it is:** High-speed, non-blocking real-time pub/sub messaging hub for live field telemetry.
* **Technology:** Node.js, Aedes MQTT Broker.
* **Port / Protocol:** Port `1883` (TCP / MQTT 3.1.1).
* **Source Location:** `scripts/broker.js`.
* **Topics:**
  * `mine/<panel_id>/node/<node_id>/telemetry`: Instantaneous per-tick readings.
  * `mine/<panel_id>/node/<node_id>/status`: Battery, RSSI, and node heartbeat flags.
  * `mine/<panel_id>/alarm`: High-priority geomechanical alarm alerts.
* **Role:** Powers **Path B (The Fast Lane)**. Non-blocking fire-and-forget architecture ensures broker disconnects never stall the simulation loop.

---

### 📦 Box 4: Authoritative Database
* **What it is:** The single authoritative source of truth for the entire mining project. Provides permanent legal and statutory auditability.
* **Technology:** PostgreSQL 14+, SQL DDL schema (`backend/db/schema.sql`).
* **Port / Protocol:** Port `5432` (PostgreSQL wire protocol).
* **Core Tables:**
  1. `nodes`: 31 canonical rows (`N01`–`N31`) with tier, metric $(x,y,z)$ coordinates, and projected WGS84 $(\text{lat}, \text{lon})$.
  2. `readings`: High-volume time-series telemetry with strict **Tier Nullability** (unsupported hardware channels are stored as `NULL`, never `0.0`).
  3. `simulation_packets`: 60-second finalized master JSONB payloads indexed by monotonic packet IDs.
  4. `alarms`: Legal history of all raised state transitions, affected node arrays, peak strains, and blast veto flags.

---

### 📦 Box 5: Central Backend & Real-Time API Server
* **What it is:** Application server that coordinates historical data queries, database resets, and WebSocket fan-out to connected operator stations.
* **Technology:** Node.js, Express.js, native `ws` WebSocket library, `pg` connection pool.
* **Port / Protocol:** Port `8080` (HTTP REST & WebSocket at `ws://localhost:8080/ws`).
* **Source Location:** `backend/server.js`, `backend/routes/`.
* **Key Endpoints:**
  * `GET /api/nodes`: Canonical node metadata and coordinates.
  * `GET /simulation/packets/:packetId`: Full 60-second aggregated packet payload.
  * `POST /simulation/packets`: Ingests finalized packet from Python engine and immediately broadcasts `{ type: "packet_available", packet_id }` over WebSocket.
  * `POST /api/alarms`: Persists raised alarm and broadcasts `{ type: "alarm", ... }`.
  * `POST /api/system/reset`: Instantly truncates runtime telemetry (`readings`, `packets`, `alarms`) and resets nodes to active in $< 1\text{ second}$.

---

### 📦 Box 6: Operator Mission Control HMI & 3D Terrain Sandbox
* **What it is:** The dual-interface presentation layer for mine safety engineers and control room operators.
* **Technology:** 
  * **Primary HMI:** Electron 28+, HTML5/Vanilla JS, CSS3 Dark Glassmorphism, Leaflet.js, MapLibre GL JS, SVG/Canvas Sparklines (Port `8085` / Desktop App).
  * **3D Sandbox:** React 18, Vite, Three.js, React Three Fiber (Port `5173`).
* **Source Location:** `dashboard_electron/`, `simulation/frontend/`.
* **Key Capabilities:**
  1. **2D Geospatial Map:** Offline satellite orthophoto with contour overlays, 8x8 sector subsidence heatmap (A1 to H8), and dynamic color-coded node markers.
  2. **Sub-100ms Live Telemetry Drawer:** Canvas sparklines showing rolling 30-minute strain, tilt, vibration, and temperature against DGMS limit thresholds.
  3. **Real DEM 3D Hypsometry:** Satellite Digital Elevation Model (194–228m MSL) deforming downward in real time as coal extraction advances.
  4. **90-Day Replay Controller:** Scrub back through historical longwall advances at $1\times$, $10\times$, or $60\times$ speed.
  5. **Emergency Early Warning System:** Flashing visual alarm banners, audible sirens, and automated SMS modem dispatches.

---

## 4. The Two Data Highways: Path A vs Path B

| Feature | Path A: The Persisted "Proof" Lane | Path B: The Live "Fast" Lane |
|---|---|---|
| **Primary Route** | Box 2 $\to$ Box 4 (Postgres) $\to$ Box 5 (Express WS) $\to$ Box 6 | Box 2 $\to$ Box 3 (MQTT) $\to$ Box 6 (Electron IPC) |
| **Transport Medium** | TCP / AsyncPG $\to$ HTTP POST $\to$ WebSocket $\to$ REST GET | TCP MQTT (1883) $\to$ Electron `mqtt:telemetry` IPC |
| **Update Latency** | 60 Seconds (Batched mathematical window) | **$< 100\text{ Milliseconds}$ (Instantaneous live stream)** |
| **Primary Job** | Historical auditability, 3D hypsometry mesh, legal alarms | Real-time sparklines, blinking node markers, transient vibrations |
| **Failure Tolerance** | If DB is busy, packets queue in memory | If broker drops, tick continues unimpeded |
| **Legal Status** | DGMS statutory compliance record | Transient operational visual feedback |

---

## 5. The 60-Second Elevator Pitch (For Judges & Viva Defense)

> *"Our system solves ground collapse in deep coal mines using a clean 6-box architecture:*
> 
> * **Box 1 & 2** form the physical and digital twins: 31 smart IoT nodes placed by rock mechanics principles beam 23-byte LoRa packets, while our Python engine evaluates closed-form Knothe geomechanical equations.
> * We solve the classic IoT trade-off between speed and durability using two simultaneous data pipelines:
>   * **Path B (The Fast Lane)** streams instantaneous sensor vibrations through our **MQTT Broker (Box 3)** directly into our **Electron Mission Control Dashboard (Box 6)** in under 100 milliseconds.
>   * **Path A (The Proof Lane)** seals every 60-second window into our authoritative **PostgreSQL Database (Box 4)**, which notifies our **Express API Server (Box 5)** to update the 8x8 sector subsidence heatmap and 3D terrain elevation model.
> * Alarms are governed by an auditable, deterministic rock mechanics decision tree (C8) that filters out dump trucks, conveyors, and legal blasting using a 1-byte dominant frequency discriminator ($f_{dom}$).
> * The entire stack is self-contained and 100% offline-first—requiring zero cloud dependency to save human lives."*
