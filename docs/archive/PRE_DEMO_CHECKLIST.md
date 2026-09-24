# 🛡️ Pre-Demo Master Checklist & Handoff Protocol

> **Target Event:** SIH 2026 / Project Demonstration  
> **System:** R4 Real-Time Mine Subsidence Monitoring & Early Warning System  
> **Scope:** Multi-service coordination (PostgreSQL, MQTT Broker, Node/Express Backend, Python Physics Simulation, Electron Dashboard, 3D Sandbox UI)

---

## ⏱️ Timeline Overview

```
[T - 3 hrs]                [T - 90 min]               [T - 30 min]          [T - 0 min]
Code Freeze & Contracts ──► The "Cold Boot" Test ──► Hardware & Network ──► The Golden Run
```

---

## 1. 🤝 Teammate Handoff & Code Freeze (T - 3 Hours)

The #1 cause of broken demos is last-minute merges breaking API contracts, database schemas, or environment variables.

- [ ] **Hard Code Freeze (T - 2 hours):**
  - Stop pushing feature additions or style tweaks. Only allow verified showstopper bugfixes.
  - Agree on a specific commit SHA that will be used for the demonstration.
- [ ] **Lock the Data Contract:**
  - Verify that your friend's segment has not changed key names, units, or JSON payload formats (node IDs, coordinate systems, timestamps, MQTT topics).
  - Verify port allocations have not been remapped (`5432` PostgreSQL, `8080` Backend API/WS, `8000` Python Simulation, `5173` 3D Vite UI, `1883` MQTT Broker).
- [ ] **Single Authoritative Demo Branch:**
  - Merge your friend's segment into `main` (or a designated `demo-stable` branch).
  - Never run a live demo off an unmerged feature branch or with uncommitted local modifications (`git status` must be clean).
- [ ] **Environment Variable Alignment:**
  - Diff `.env` and configuration files across both machines to confirm no missing API keys, database credentials, or endpoint URLs.

---

## 2. 🧊 The "Cold Boot" Infrastructure Test (T - 90 Minutes)

Simulate what happens if your laptop crashes or reboots 5 minutes before the demo.

- [ ] **Kill Rogue / Zombie Background Processes (Exclude DB port 5432):**
  *Clear application ports so services can bind without conflicts (never kill PostgreSQL 5432 with kill -9):*
  ```bash
  lsof -ti:1883,8080,8085,8000,5173 | xargs kill -9 2>/dev/null
  ```
- [ ] **Run Automated Pre-Demo Readiness Audit:**
  *Runs pre-flight checks for DB, 31 nodes, port availability, tile counts, syntax, and physics tests:*
  ```bash
  npm run checklist:audit
  ```
- [ ] **Verify PostgreSQL & Node Sanity:**
  ```bash
  bash scripts/ensure_postgres.sh
  ```
  - **Node Count Check:** Confirm database contains exactly the 31 active nodes per the Adriyala specification.
  - **Timestamp Sanity:** Confirm live queries show recent timestamps (`NOW()`), so live graphs do not render empty or flatline.
- [ ] **Clean Start via Master Runner (Includes Automated End-to-End Data Loop Test):**
  ```bash
  npm run start:all
  ```
  *The launcher starts all services and automatically executes `scripts/verify_data_loop.js` (Step [8]). Confirm all 5 services report healthy:*
  1. MQTT Broker (`:1883`)
  2. Node.js Express API & WebSocket Server (`:8080`)
  3. Dashboard Web Server & Tile Proxy (`:8085`)
  4. Python Physics / Simulation Engine (`:8000`)
  5. 3D Terrain / Hypsometry Vite UI (`:5173`)
  6. Electron Operator Dashboard
- [ ] **Pre-fetch / Warm Offline Map Tiles (Leaflet Cache):**
  *With the dashboard server running on port 8085, warm the on-disk tile cache so the 2D and 3D map render fully offline on venue networks:*
  ```bash
  npm run tiles:prefetch
  ```
- [ ] **Run Deep Stress & Chaos Batteries (High-Stress Resilience Verification):**
  *Subject the system to high-concurrency, burst floods, and geomechanical edge cases:*
  ```bash
  npm run stress:1000   # 1,000-trial geomechanical & mathematical physics suite
  npm run stress:geo    # Extreme hypersonic mining, multi-pillar collapse & blast transients
  npm run stress:chaos  # Full-stack DB hammer, 1,000 msg/s MQTT storm & WS chaos (run while stack is up)
  ```

---

## 3. 🔄 Data State & Instant Reset Mechanism (T - 60 Minutes)

Judges may ask you to run the scenario twice, or a dry-run may trigger terminal alarms prematurely.

- [ ] **Instant Demo Reset Command (Under 1 Second):**
  *Wipes accumulated test telemetry, packets, and alarms while preserving the 31 canonical Adriyala nodes:*
  ```bash
  npm run db:reset
  ```
- [ ] **Live vs. Fixture Fallback:**
  - Confirm dashboard behavior if the live stream disconnects. Ensure it fails gracefully rather than throwing an unhandled white-screen exception.
  - Keep fixture mode toggle accessible if live packet generation encounters issues.

---

## 4. ⚡ Hardware, Network & Display Safeguards (T - 30 Minutes)

- [ ] **Bypass Venue Wi-Fi:**
  - Never rely on public venue Wi-Fi for inter-process or peer-to-peer laptop communication (client isolation will block laptop-to-laptop traffic).
  - Use a dedicated mobile phone personal hotspot or keep all services running locally on a **single machine**.
- [ ] **Projector & Scaling Check:**
  - Connect to the projector early. Projectors often force 1080p (or 720p) scaling.
  - Verify that Leaflet maps, live telemetry charts, and the 3D viewport do not get pushed off-screen or clipped by inspection drawers.
- [ ] **Prevent OS Distractions & Throttling:**
  - Enable **Do Not Disturb** / Focus mode on macOS.
  - Disable screen lock / sleep (`caffeinate -d` or Amphetamine).
  - Keep the laptop connected to a **power adapter** (WebGL + Python simulation + Electron will rapidly deplete battery and induce thermal CPU throttling).

---

## 5. 🎯 The Demo Script: 3-Minute "Golden Path"

Stay strictly on the happy path. Do not navigate to experimental or unpolished tabs during the live judging.

| Step | Action on Screen | Speaker 1 | Speaker 2 (Teammate) |
| :--- | :--- | :--- | :--- |
| **1. Hook & Context (30s)** | Baseline 2D/3D map showing Adriyala mine panel | Define the core problem: Mine subsidence hazards, worker safety, and regulatory compliance. | Introduce sensor hardware deployment: 31 LoRa nodes positioned across high-strain zones. |
| **2. Live Trigger (60s)** | Trigger longwall shearer advance / physics tick | "Watch as the active longwall face advances..." | Show live MQTT packets arriving in real-time; highlight payload aggregation. |
| **3. Detection & Early Warning (60s)** | Real-time chart spikes (strain, tilt, PPV vibration) | Point out threshold breach on Leaflet map: node turns amber/red. | Explain Knothe time-dependent subsidence calculations and automated SMS/alarm dispatch. |
| **4. Deep Inspection (45s)** | Open 3D sandbox / node drawer | Show the 3D hypsometry subsidence bowl forming in real time. | Discuss fault tolerance (packet loss handling, offline resilience). |
| **5. Wrap-up (15s)** | System overview dashboard | "Fully integrated, physically grounded, and production-ready." | Invite judges for questions. |

---

## 6. 🚨 Plan B Contingency Kit (When Murphy's Law Strikes)

- [ ] **Pre-Recorded 60-Second Backup Video:**
  - Record a high-resolution video of the complete working loop right now while everything is functional.
  - Place it directly on your desktop. If hardware fails or a port fails to bind on stage:
    > *"While our live connection re-synchronizes, let me walk you through the end-to-end telemetry loop captured right before this session..."*
- [ ] **Architecture Diagram Ready:**
  - Have your system architecture diagram open in a tab ready to walk through technical questions if an unexpected pause occurs.
- [ ] **Stage Rule:**
  - **Never live-code, modify configurations, or run `git pull` in front of judges.** Pivot to discussion or backup footage smoothly.
