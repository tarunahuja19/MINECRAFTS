# Repository State & User Requirements Report (Handoff for Claude)

**Document Purpose:** This report documents the exact initial state of the repository prior to intervention, the structural defects and discrepancies that existed, and the exact requirements and goals specified by the user. It is written as a direct handoff document for Claude or any subsequent engineering agent to understand the problem space without ambiguity.

---

## 1. Project Background & Context

* **Project:** SIH 2026 — R4 Real-Time Mine Subsidence Monitoring & Early Warning System.
* **Geomechanics Benchmark:** Adriyala Longwall Project (ALP), Singareni Collieries Company Limited (SCCL), Godavari Valley Coalfield, Telangana, India.
* **Core Physics:** Closed-form Knothe time-dependent subsidence theory ($S(x,y,t)$), horizontal displacement, strain ($\varepsilon$), tilt, curvature, and explosive vibration PPV transients.
* **Technology Stack:**
  * **Database:** Single authoritative PostgreSQL database (`mine_subsidence`) on port `5432` with tables `nodes`, `readings`, and `simulation_packets`.
  * **Backend:** Node.js / Express REST API and native WebSocket broadcaster (`:8080`).
  * **Simulation Engine:** Python 3 (NumPy, SciPy, AsyncPG) executing a physics tick loop and 60-sim-second packet aggregator.
  * **Frontend 1 (Operator Station):** `r4-dashboard` — Leaflet 2D spatial map, live SVG/Canvas charts (strain, tilt, vibration, temperature), alarm inspection drawer, and 3D sub-window.
  * **Frontend 2 (3D Sandbox):** Three.js / React-three-fiber 3D interactive terrain mesh with real Adriyala DEM hypsometry.

---

## 2. What the Repository Looked Like BEFORE (Initial State & Defects)

Prior to any fixes, the codebase suffered from three severe categories of problems: folder fragmentation, node count discrepancy, and silent database operations.

### 2.1 Fragmented, Misspelled, and Disorganized Folders
The root repository had 16+ scattered directories with conflicting, redundant, or prototype files:
1. **`sih-usersite/`**: Contained `backend/` (Express API) and `r4-dashboard/` (Electron / HTML frontend).
2. **`simulation_making/`**: Contained `sandbox/` (Python physics engine), `frontend/` (React 3D app), `scripts/`, and `tests/`.
3. **`similation-data-making/`**: Misspelled directory containing older duplicate dataset generation scripts, neural net training attempts, and stale documentation.
4. **`filess/`**: Misspelled directory containing 28 unorganized scratch markdown documents, conflicting drafts (`part1-data-and-files.md`, `v2`, `v3`), and obsolete notes.
5. **`final/`**: Contained 8 numbered specification documents (`00` to `06`).
6. **Root Prototype Packages (`sim/`, `ground/`, `pinn/`, `scoring/`, `truth/`, `viz/`, `tests/`)**: Disconnected legacy prototype packages created in early hackathon stages that duplicated the physics models now inside `simulation_making/sandbox/`.

### 2.2 The Node Count Ambiguity (31 vs 60 Nodes)
There was a direct architectural mismatch between the simulation and the frontend:
* **The Legacy Frontend Mock (`sih-usersite/r4-dashboard`):**
  * Hardcoded around **60 synthetic nodes** (`N01` to `N60`).
  * Arranged in 3 artificial concentric circular rings (`inner`, `mid`, `outer`) over generic coordinates in Jharia coalfield (`lat 23.74, lng 86.42`).
  * Arbitrarily assigned 10 gateways, 20 anchors, and 30 scouts — completely decoupled from radio hardware constraints and rock mechanics.
* **The Real Physics Simulation (`simulation_making`):**
  * Engineered per `MESH_UPGRADE_BRIEF.md` around the **Adriyala Longwall Panel**.
  * Grounded in strict physical constraints: LoRa packet payload is capped at 138 bytes, while each Scout reading is 23 bytes ($138 / 23 = 6$ max, $5:1$ nominal fan-out).
  * Has **exactly 31 nodes**:
    * **25 Scouts:** 9 in flat bowl (Tier 1A), 10 in high-strain tensile band (Tier 1B), 6 along fault corridor (Tier 1C).
    * **5 Anchors:** 3 mesh routers (Tier 2A) + 2 borehole extensometer/piezometer stations (Tier 2B).
    * **1 Master Gateway (Tier 3):** Fixed on immovable bedrock outside the angle of draw.
* **Database Collision in PostgreSQL (`mine_subsidence`):**
  * Because both systems had previously touched the database, the `nodes` table contained **91 rows** (the 60 old synthetic nodes `N01`..`N60` *plus* 31 numeric simulation nodes `1`..`31`).
  * When the frontend queried `GET /api/nodes`, it either received 91 nodes or failed to map the simulation's metric positions to the Leaflet map.

### 2.3 Silent Database Persistence & Buried Timestamps
* When `runner.py` or the backend inserted records into PostgreSQL, it was either silent or emitted a single uninformative log (`[DB] Simulation packet 1 successfully saved`).
* The simulation hardcoded its base timestamp to `2026-03-14`, whereas seed scripts had used `2026-09-05`. When the user inspected pgAdmin with `SELECT * FROM readings ORDER BY ts DESC`, the simulated readings were buried under old seed rows.
* The user had **pgAdmin** open side-by-side with the terminal and could not visually correlate what the simulation was outputting with what landed in the tables.

### 2.4 Frontend Disconnection from Real-Time Stream
* `r4-dashboard/renderer/js/data/mode-switch.js` defaulted to `fixture` mode and immediately called `liveProvider.stop()`, which closed the WebSocket client (`ws://localhost:8080/ws`).
* As a result, even when the backend emitted `packet_available` WebSocket events, the dashboard was disconnected and never updated in real time.

---

## 3. What the User Explicitly Wanted Done

The user's core requests (derived directly from the user prompt):

1. **Terminal Visibility on Database Writes:**
   > *"do one thing: whatever is being written in the postgres is shown to us in terminal as well"*
   * The terminal must print explicit, formatted banners showing every single database write to `nodes`, `readings`, and `simulation_packets`.
   * Banners must show table names, timestamps, packet IDs, node IDs, and representative channel values (tilt, strain, acceleration, temperature, GPS).

2. **Clarify and Resolve the Node Count Ambiguity:**
   > *"then you can see in simulation the number of nodes are different to the frontend that means there is ambiguity in task so what we can do about it let me know"*
   * Diagnose why the node counts differed (60 mock ring nodes vs 31 physics nodes).
   * Unify the entire system onto a single authoritative node fleet (the 31 canonical Adriyala nodes `N01` through `N31`).
   * Clean PostgreSQL so pgAdmin displays cleanly with exactly 31 active nodes.

3. **Consolidate Under "One Hood" & Remove Dead Code:**
   > *"and also the thing is want to put this thing together under one hood like different folders but improve the name of the folders and make sure you refine the code to remove the dead codes and also fix the ui part"*
   * Reorganize the messy, misspelled folders (`filess/`, `similation-data-making/`, `sih-usersite/`, etc.) into clean, intuitive root directories (`backend/`, `simulation/`, `frontend_dashboard/`, `docs/`, `scripts/`).
   * Quarantine legacy/dead code into `archive_legacy/` so active development is uncluttered.

4. **Strict Phased Plan with User Checkpoints (Zero Blind Coding):**
   > *"and also i have pg admin so i can see data coming to it so one by one make simulation first run and then write data in postgres confirm it with me, then connect it frontend receiving it somewhere, and then move on to display, make it a step by step plan with me without writing a single line of code, could be wrong in some places by me so let me know by implementation plan"*
   * Do NOT rush into code changes without an approved implementation plan.
   * Step 1: Run simulation → write to PostgreSQL with terminal logs → confirm in pgAdmin with user.
   * Step 2: Connect backend API & WebSocket broadcaster → confirm data reception.
   * Step 3: Connect frontend → verify live packet receipt.
   * Step 4: Fix UI display (dynamic node markers, charts, Adriyala coordinate mapping).
   * Step 5: Clean repository folders under one hood.

5. **Single Authoritative Database Invariant:**
   * No secondary PostgreSQL databases or duplicate tables.
   * Reuse the existing `mine_subsidence` database, tables (`nodes`, `readings`, `simulation_packets`), and backend connections.

---

## 4. Key Contracts & Invariants for Claude

When working on this codebase, adhere to the following invariants:

1. **Authoritative Database:**
   * Host/Port: `localhost:5432` | DB: `mine_subsidence` | User: `postgres`
   * Tables:
     * `nodes` (PK: `node_id VARCHAR(64)`): Exactly 31 canonical rows (`N01` to `N31`).
     * `readings` (PK: `(node_id, ts)`): Appended per tick/60s per node. Tier nullability rules strictly enforced (channels absent from a tier are `NULL`, never `0`).
     * `simulation_packets` (PK: `packet_id BIGINT`): Stores aggregated 60-second window JSON payloads.
2. **Canonical 31 Nodes (`N01`..`N31`):**
   * Scouts (25): `N01`–`N09` (Tier 1A), `N10`–`N19` (Tier 1B), `N20`–`N25` (Tier 1C).
   * Anchors (5): `N26`–`N28` (Tier 2A), `N29`–`N30` (Tier 2B).
   * Gateway (1): `N31` (Tier 3).
3. **Ports & Service Architecture:**
   * Backend REST & WebSocket API: Port `8080` (`backend/server.js`).
   * Operator Dashboard Web Server: Port `8085` (`frontend_dashboard/serve.js`).
   * Python Simulation Engine: `simulation/.venv/bin/python simulation/sandbox/runner.py`.
   * One-click Launcher: `bash scripts/start_all.sh` (or `npm start`).
