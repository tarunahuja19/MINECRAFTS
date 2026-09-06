# The Data Loop — one command, proven end to end

**Goal in one sentence:** the simulation runs → its values land in Postgres → the
Electron dashboard displays them, live.

This document shows how every piece is wired, what `npm start` now does, and how
the loop is *proven* (not assumed) on every launch.

---

## 1. What `npm start` does now

`npm start` → `scripts/start_all.sh`. Three things changed in Step 3:

| # | Was | Now |
|---|-----|-----|
| 1 | Launcher **died** with "PostgreSQL is not accepting connections… start it" | `scripts/ensure_postgres.sh` **starts** Postgres — Homebrew service, then a LaunchDaemon (`/Library/LaunchDaemons/postgresql-*.plist`), then `pg_ctl` on a discovered data dir. Only for a *local* host; a remote DB that is down is still reported, not fixed. |
| 2 | Launcher **died** with "cannot query database… run migrate" | Launcher **runs** `npm --prefix backend run migrate` once (creates the DB if missing, applies `backend/db/schema.sql`), then re-checks. |
| 3 | "Stack is up" meant *the six processes started* | New step **[8] Verifying the data loop end to end** runs `scripts/verify_data_loop.js`: it drives one real simulation run and asserts a value the sim produced *this run* reached Postgres and then the dashboard. |

Boot order is unchanged: broker → backend → dashboard web server → **simulation**
→ 3D frontend → Electron → (verify).

```
npm start
 └─ scripts/start_all.sh
     [0] preflight ─ ensure_postgres.sh ─ auto-migrate if schema empty
     [1] MQTT broker            scripts/broker.js            :1883
     [2] backend API + WS       backend/server.js            :8080
     [3] dashboard web server   dashboard_electron/serve.js  :8085
     [4] simulation (physics)   simulation/sandbox/server.py :8000   ← THE SIM
     [5] 3D sandbox UI (Vite)   simulation/frontend          :5173
     [6] Electron operator UI   dashboard_electron
     [8] verify_data_loop.js  ── proves sim → Postgres → dashboard
```

---

## 2. The data loop, end to end

### 2.1 Components

| Component | Path | Role |
|-----------|------|------|
| **Simulation** | `simulation/sandbox/server.py`, `session.py` | FastAPI app. A background `simulation_loop()` ticks the physics **only while ≥1 WebSocket client is connected and the session `is_running`**. 1 tick = 60 simulated seconds. |
| **Sim DB layer** | `simulation/sandbox/db.py` | `DatabaseManager` — an `asyncpg` pool to `mine_subsidence`. Reads credentials from `backend/.env`. Writes **directly** to Postgres (`nodes`, `readings`, `simulation_packets`) and *additionally* POSTs finalized packets to the backend to trigger the dashboard fan-out. |
| **MQTT bridge** | `simulation/sandbox/mqtt_bridge.py` | Publishes the *same* tick on the real topic tree `mine/<panel>/node/<node>/telemetry`, `.../status`, `mine/<panel>/alarm`. Fire-and-forget on its own thread. |
| **Postgres** | schema in `backend/db/schema.sql` | Single source of truth. `nodes` (profile + `lat/lon`), `readings` (one row per node per tick), `simulation_packets` (60‑s aggregate, `payload JSONB`), `alarms`. |
| **Backend** | `backend/server.js`, `backend/routes/*` | REST over Postgres (`/api/nodes`, `/api/readings/latest`, `/simulation/packets/:id`, `/api/alarms`) **plus** a WebSocket server on `:8080/ws` that broadcasts `packet_available` / `alarm` frames. |
| **Electron dashboard** | `dashboard_electron/` | `main/mqtt-client.js` subscribes to the broker and forwards frames over IPC. `renderer/js/data/live-provider.js` connects to `ws://:8080/ws`, and on `packet_available` fetches `/simulation/packets/:id` and renders it (`applySimulationPacket` → node table, map, alarms). |

### 2.2 Two live paths into the dashboard

**Path A — persisted (Postgres-backed):**

```
sim.tick()
  → db.save_readings()   ──INSERT──▶  Postgres.readings
  → PacketAggregator (every 60 sim-s)
      → db.save_packet() ──UPSERT──▶  Postgres.simulation_packets
                         ──HTTP POST─▶ backend  /simulation/packets
                              → backend WS broadcast  {type:"packet_available", packet_id}
                                   → Electron live-provider  onmessage
                                        → GET /simulation/packets/:id  (backend → Postgres)
                                             → applySimulationPacket()  → node table / map / alarms
```

**Path B — transient (MQTT, for the live banner / per-tick feel):**

```
sim.tick()
  → mqtt_bridge.publish_tick()  ──▶  broker :1883  mine/<panel>/node/<node>/telemetry
       → Electron main/mqtt-client.js  (subscribe mine/+/node/+/telemetry)
            → IPC  webContents.send('r4:telemetry')
                 → live-provider  window.r4.onTelemetry()  → handleTelemetry()
```

Path A is what "stored in Postgres and then displayed" means and is what the
verifier proves. Path B is the same data arriving without a database round trip;
a dashboard that connects late has missed the MQTT frames but reads the history
back from Postgres via Path A.

### 2.3 Full flowchart

```mermaid
flowchart TD
    subgraph SIM["Simulation  (simulation/sandbox, :8000)"]
        LOOP["simulation_loop()\nticks while a WS client is connected"]
        TICK["session.tick()\n1 tick = 60 sim-seconds"]
        AGG["PacketAggregator\nfinalizes a packet every 60 sim-s"]
        LOOP --> TICK --> AGG
    end

    subgraph DBLAYER["Sim DB layer  (sandbox/db.py, asyncpg)"]
        SR["save_readings()"]
        SP["save_packet()"]
    end

    subgraph PG[("PostgreSQL  mine_subsidence")]
        TN["nodes\n(profile + lat/lon)"]
        TR["readings\n1 row / node / tick"]
        TP["simulation_packets\n60-s aggregate, JSONB"]
        TA["alarms"]
    end

    subgraph BE["Backend  (backend/server.js, :8080)"]
        REST["REST\n/api/readings/latest\n/simulation/packets/:id\n/api/alarms"]
        POST["POST /simulation/packets\nPOST /api/alarms"]
        WS8080["WebSocket :8080/ws\nbroadcast packet_available / alarm"]
        POST --> WS8080
    end

    subgraph BROKER["MQTT broker  (scripts/broker.js, :1883)"]
        TOP["mine/&lt;panel&gt;/node/&lt;node&gt;/telemetry\nmine/&lt;panel&gt;/alarm"]
    end

    subgraph EL["Electron dashboard  (dashboard_electron)"]
        MQC["main/mqtt-client.js\nsubscribe mine/+/…"]
        LP["renderer live-provider.js\nWS :8080/ws client"]
        FETCH["fetch /simulation/packets/:id"]
        RENDER["applySimulationPacket()\nnode table • map • alarms panel"]
        MQC -->|IPC r4:telemetry| LP
        LP -->|on packet_available| FETCH --> RENDER
        LP -->|handleTelemetry| RENDER
    end

    TICK --> SR
    AGG --> SP
    SIM -->|sync_simulation_nodes on connect| TN
    SR --> TR
    SP --> TP
    SP -->|HTTP POST| POST
    SP -.->|3D state deltas| VITE["3D sandbox UI\n:5173 (ws :8000/ws)"]
    TICK -->|per zone transition| POST
    TICK -->|publish_tick / publish_zone_alarms| TOP
    POST --> TA
    REST --> TR
    REST --> TP
    REST --> TA
    WS8080 -->|packet_available| LP
    TOP -->|telemetry / alarm| MQC
    FETCH --> REST
```

---

## 3. The verifier — `scripts/verify_data_loop.js`

Run standalone with `npm run verify` (stack must be up), or automatically as
launcher step [8]. It **is** the stand-in for the Electron window: it runs the
exact WebSocket-plus-fetch code path the renderer runs.

| Stage | Asserts |
|-------|---------|
| 0 | backend `/api/health` and sim `/health` reachable; direct `pg` connection to `mine_subsidence` |
| 1 | snapshot `readings` / `simulation_packets` counts and max ids **before** the run |
| 2 | open `ws://:8080/ws` — the dashboard's backend socket |
| 3 | open `ws://:8000/ws` (receives the `init` geometry frame, which is what makes the sim tick), send `{action:"start"}` + `{action:"set_speed",multiplier:120}`; confirm tick frames arrive |
| 4 | `readings` row count **rises** and ≥1 new row is timestamped within the last 5 min — a value the sim produced *this run* is in Postgres |
| 5 | a new `simulation_packets` row appears with `packet_id` greater than the pre-run max, `payload->'nodes'` populated |
| 6 | the backend broadcasts `{type:"packet_available", packet_id}` on `:8080/ws` — the dashboard is notified |
| 7 | `GET /simulation/packets/:id` returns that packet's body with 31 node aggregates — the backend→Postgres→dashboard round trip |
| 8 | `GET /api/readings/latest` carries a reading from this run |
| 9 | *(informational)* alarm frames seen this run + total `alarms` rows |

Exit 0 = loop proven. Exit 1 names the broken hop. The launcher prints a
red `WARN … data loop verification FAILED` but leaves the stack up so you can
inspect it.

### Sample passing run (launcher step [8])

```
[verify] 4. new sensor rows appear in Postgres.readings
  PASS  readings 74090 -> 74152 (+62), 28241 row(s) timestamped in the last 5 min
[verify] 5. a 60s packet is aggregated and written to Postgres.simulation_packets
  PASS  packet #1788644023631 stored (session adriyala_sandbox, 31 nodes aggregated)
[verify] 6. backend broadcasts "packet_available" to the dashboard WebSocket
  PASS  dashboard received: packet_available #1788644023631
[verify] 7. dashboard fetches the packet by id (backend -> Postgres -> dashboard)
  PASS  packet body served with 31 nodes
[verify] 8. backend /api/readings/latest reflects the fresh rows
  PASS  /api/readings/latest carries 31 node(s) with a reading from this run
  RESULT: data loop PROVEN end to end
```

---

## 4. Bugs found and fixed while proving it

The loop **looked** wired but nothing new was actually persisting. Two root causes:

### 4.1 Readings never persisted on a fresh run — fixed clock anchoring

`SessionConfig.base_iso_time` was a **fixed literal** `"2026-03-14T00:00:00Z"`.
Every run replayed identical `(node_id, ts)` pairs, so
`INSERT … ON CONFLICT (node_id, ts) DO NOTHING` made every write a silent no-op.
`/api/readings/latest` never advanced.

**Fix** (`simulation/sandbox/session.py`): `base_iso_time` now defaults to `""`,
which anchors the simulation clock to **wall-clock UTC at session start**. Set an
explicit ISO string only for deterministic offline replays.

### 4.2 Packets never persisted on a short run — fixed packet_id seeding

`PacketAggregator.current_packet_id` started at a fixed `1`, then later at
`int(time.time() // 60)`. Because packet ids **increment during a run** and the
machine clock barely moves between runs, a *short* run started at a lower id than
a previous *long* run's maximum. `INSERT … ON CONFLICT (packet_id) DO UPDATE`
then **updated a previous run's row** instead of inserting — count flat, and
`packet_id > previous_max` never matched.

**Fix** (`simulation/sandbox/packet.py`): seed `current_packet_id` from
`int(time.time() * 1000)` — a millisecond base that is strictly monotonic and
unique across runs, well within `BIGINT` and JS safe-integer range.

### 4.3 Sim logs were invisible — fixed buffering

The launcher ran `uvicorn` with block-buffered stdout, so `[POSTGRES WRITE]` /
`[DB]` lines never reached `.launcher.log` and failures looked like silence.

**Fix** (`scripts/start_all.sh`): `PYTHONUNBUFFERED=1` on the simulation process.

---

## 5. Files touched

| File | Change |
|------|--------|
| `scripts/ensure_postgres.sh` | **new** — start a local Postgres if it is down |
| `scripts/verify_data_loop.js` | **new** — prove the loop end to end |
| `scripts/start_all.sh` | call `ensure_postgres`; auto-run migrations on empty schema; `PYTHONUNBUFFERED=1` for the sim; new step [8] verify |
| `simulation/sandbox/session.py` | `base_iso_time` defaults to wall-clock now |
| `simulation/sandbox/packet.py` | `packet_id` seeded from epoch-milliseconds |
| `package.json` | `npm run verify` script |

---

## 6. Operating notes

- **The sim only ticks with a client connected.** The 3D UI (`:5173`), the
  Electron dashboard, or the verifier all count. With `--no-ui --no-chrome` and
  no browser, the sim is idle until something connects to `ws://:8000/ws`.
- **Sim timestamps race ahead of wall clock.** At the default 10× (up to 120×
  during verify) speed, `readings.ts` advances 10–120 simulated seconds per real
  second, so the newest `ts` is minutes-to-hours ahead of "now". That is expected
  — the verifier asserts *"a row written in the last 5 real minutes"*, not
  *"ts ≈ now"*.
- **`npm run verify`** re-runs the proof any time against a running stack.
- **Remote Postgres:** `ensure_postgres.sh` will not try to start a non-local
  host; bring that database up yourself.
```
