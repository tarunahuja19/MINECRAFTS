"""
PostgreSQL database integration and backend bridge for the simulation system (§Phase 2 & 3).

Connects to the single authoritative PostgreSQL database (`mine_subsidence`)
and forwards telemetry and 60-second packets into the existing backend (Folder A).
"""

import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from typing import Any
import urllib.error
import urllib.request

try:
    import asyncpg
except ImportError:
    asyncpg = None

# Automatically read connection details from backend .env if present
_candidate_envs = [
    Path(__file__).resolve().parent.parent.parent / "backend" / ".env",
    Path(__file__).resolve().parent.parent.parent / "sih-usersite" / "backend" / ".env",
    Path(__file__).resolve().parent.parent / "backend" / ".env",
    Path.cwd() / "backend" / ".env",
    Path.cwd() / ".env",
]
for env_path in _candidate_envs:
    if env_path.exists():
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k not in os.environ:
                            os.environ[k] = v
            break
        except Exception:
            pass

# Database connection parameters
DATABASE_URL = os.getenv("DATABASE_URL")
PGHOST = os.getenv("PGHOST", "localhost")
PGPORT = int(os.getenv("PGPORT", "5432"))
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "labpass123")
PGDATABASE = os.getenv("PGDATABASE", "mine_subsidence")
BACKEND_HTTP_URL = os.getenv("BACKEND_HTTP_URL", "http://localhost:8080")

CREATE_PACKETS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS simulation_packets (
    packet_id BIGINT PRIMARY KEY,
    session_id VARCHAR(64) NOT NULL,
    grid_id VARCHAR(64) NOT NULL,
    start_sim_time DOUBLE PRECISION NOT NULL,
    end_sim_time DOUBLE PRECISION NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sim_packets_session_id ON simulation_packets(session_id);
"""

# The `nodes` table predates the geo alignment work, so the display projection
# columns are added in place rather than assumed. x/y stay the physics truth;
# lat/lon are derived from them via `sandbox.geo` and exist only so map
# surfaces never hand-roll their own metres->degrees factor.
ALTER_NODES_GEO_SQL = """
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS lon DOUBLE PRECISION;
"""

UPSERT_NODE_SQL = """
INSERT INTO nodes (node_id, site_id, tier, node_type, x, y, z, installed_at, status, lat, lon)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (node_id) DO UPDATE
SET site_id = EXCLUDED.site_id,
    tier = EXCLUDED.tier,
    node_type = EXCLUDED.node_type,
    x = EXCLUDED.x,
    y = EXCLUDED.y,
    z = EXCLUDED.z,
    status = EXCLUDED.status,
    lat = EXCLUDED.lat,
    lon = EXCLUDED.lon;
"""

INSERT_READING_SQL = """
INSERT INTO readings (
    node_id, ts, tilt_x_urad, tilt_y_urad,
    accel_x_g, accel_y_g, accel_z_g, gyro_x_dps, gyro_y_dps, gyro_z_dps,
    vib_rms_mm_s, vib_peak_mm_s, vib_fdom_hz, die_temp_c,
    fissure_mm, strain_ue, moisture_pct, ext_delta_mm,
    pore_pressure_kpa, borehole_tilt_d1_urad, borehole_tilt_d2_urad,
    borehole_tilt_d3_urad, borehole_tilt_d4_urad,
    gps_dx_mm, gps_dy_mm, gps_dz_mm
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
    $21, $22, $23, $24, $25, $26
)
ON CONFLICT (node_id, ts) DO NOTHING;
"""

UPSERT_PACKET_SQL = """
INSERT INTO simulation_packets (
    packet_id, session_id, grid_id, start_sim_time, end_sim_time, payload
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (packet_id) DO UPDATE
SET session_id = EXCLUDED.session_id,
    grid_id = EXCLUDED.grid_id,
    start_sim_time = EXCLUDED.start_sim_time,
    end_sim_time = EXCLUDED.end_sim_time,
    payload = EXCLUDED.payload;
"""

SELECT_PACKET_SQL = """
SELECT payload FROM simulation_packets
WHERE packet_id = $1
LIMIT 1;
"""

SELECT_LATEST_SQL = """
SELECT payload FROM simulation_packets
ORDER BY packet_id DESC LIMIT 1;
"""

SELECT_LIST_SQL = """
SELECT packet_id, session_id, grid_id, start_sim_time, end_sim_time, created_at
FROM simulation_packets
ORDER BY packet_id DESC LIMIT $1;
"""


class DatabaseManager:
    """Manages PostgreSQL connection and packet persistence with offline fallback."""

    def __init__(self):
        self.pool: Any = None
        self.is_connected: bool = False
        self._warned_offline: bool = False
        self._last_fail_t: float = 0.0
        self._fallback_cache: dict[int, dict[str, Any]] = {}
        self._latest_cached_packet: dict[str, Any] | None = None
        self._synced_nodes: bool = False

    async def connect(self) -> bool:
        """Attempt to connect to PostgreSQL and verify schema."""
        if asyncpg is None:
            if not self._warned_offline:
                print("[DB] asyncpg driver not installed. Database persistence running in offline mode.")
                self._warned_offline = True
            return False

        if time.time() - self._last_fail_t < 15.0:
            return False

        try:
            if DATABASE_URL:
                self.pool = await asyncpg.create_pool(dsn=DATABASE_URL, min_size=1, max_size=5, timeout=2.0)
            else:
                self.pool = await asyncpg.create_pool(
                    host=PGHOST,
                    port=PGPORT,
                    user=PGUSER,
                    password=PGPASSWORD,
                    database=PGDATABASE,
                    min_size=1,
                    max_size=5,
                    timeout=2.0,
                )

            async with self.pool.acquire() as conn:
                await conn.execute(CREATE_PACKETS_TABLE_SQL)
                await conn.execute(ALTER_NODES_GEO_SQL)

            self.is_connected = True
            print(f"[DB] Connected to PostgreSQL ({PGHOST}:{PGPORT}/{PGDATABASE}). Table `simulation_packets` ready.")
            await self.sync_simulation_nodes()
            return True
        except Exception as e:
            self.is_connected = False
            self._last_fail_t = time.time()
            if not self._warned_offline:
                print(f"[DB] PostgreSQL connection notice ({e}). Running in resilient offline buffer mode.")
                self._warned_offline = True
            return False

    async def close(self) -> None:
        """Close connection pool."""
        if self.pool:
            await self.pool.close()
            self.pool = None
            self.is_connected = False

    async def sync_simulation_nodes(self) -> bool:
        """Ensure all simulation layout nodes exist in the `nodes` table."""
        if not self.is_connected or not self.pool or self._synced_nodes:
            return False

        try:
            from sandbox import dem, geo, layout
            ids = layout.node_ids()
            positions = layout.node_positions()
            tiers = layout.node_tiers()

            now = datetime.now(timezone.utc)
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    for nid, (x, y), tier in zip(ids, positions, tiers):
                        if tier in ("1A", "1B", "1C"):
                            role = "scout"
                        elif tier in ("2A", "2B"):
                            role = "anchor"
                        else:
                            role = "gateway"

                        # Canonical N-prefixed ID (N01..N31)
                        n_id = f"N{int(nid):02d}"
                        lat, lon = geo.xy_to_latlon(float(x), float(y))
                        # Real ground elevation from the regional DEM tile.
                        # dem.elevation_at (not panel_dem) because the Tier-3
                        # gateway sits ~1.1 km out, outside the 600 m panel
                        # window, and would otherwise clamp to the window edge.
                        z = dem.elevation_at(float(x), float(y))
                        await conn.execute(
                            UPSERT_NODE_SQL,
                            n_id,
                            "adriyala_panel_1",
                            tier,
                            role,
                            float(x),
                            float(y),
                            float(z),
                            now,
                            "active",
                            lat,
                            lon,
                        )
            self._synced_nodes = True
            print("\n" + "=" * 80)
            print(f"[POSTGRES WRITE] Table: nodes | Synchronized {len(ids)} Canonical Simulation Nodes")
            print("  • Scouts  (25): N01..N25 (9 baseline 1A, 10 tension-band 1B, 6 fault-line 1C)")
            print("  • Anchors (5) : N26..N30 (3 routers 2A, 2 geotech boreholes 2B)")
            print("  • Gateway (1) : N31 (Tier 3 master sink outside draw angle)")
            print("  => Upserted into public.nodes with Adriyala Longwall Panel coordinates")
            print(f"  => lat/lon projected from x,y via sandbox.geo (origin {geo.ORIGIN_LAT}, {geo.ORIGIN_LON}, bearing {geo.PANEL_BEARING_DEG})")
            print("  => z sampled from the real regional DEM via sandbox.dem.elevation_at")
            print("=" * 80 + "\n")
            return True
        except Exception as e:
            print(f"[DB] Warning: Node synchronization deferred: {e}")
            return False

    async def save_readings(self, readings: list[Any], iso_timestamp: str) -> int:
        """Save a batch of SensorReading objects to the `readings` table."""
        if not self.is_connected:
            await self.connect()
            if not self.is_connected:
                return 0

        inserted = 0
        try:
            ts = datetime.fromisoformat(iso_timestamp.replace("Z", "+00:00"))
            sample_logs = []
            async with self.pool.acquire() as conn:
                async with conn.transaction():
                    for r in readings:
                        # Use canonical N-prefix (e.g. N01..N31)
                        nid_raw = r.node_id
                        node_id = f"N{int(nid_raw):02d}" if (isinstance(nid_raw, int) or str(nid_raw).isdigit()) else str(nid_raw)
                        tier = getattr(r, "tier", "1A")
                        ch = getattr(r, "channels", {})

                        # Unit normalization matching SCHEMA.md
                        tilt_x = ch.get("tilt_x_urad")
                        tilt_y = ch.get("tilt_y_urad")
                        accel_x = ch.get("accel_x_mg") / 1000.0 if ch.get("accel_x_mg") is not None else None
                        accel_y = ch.get("accel_y_mg") / 1000.0 if ch.get("accel_y_mg") is not None else None
                        accel_z = ch.get("accel_z_mg") / 1000.0 if ch.get("accel_z_mg") is not None else None
                        gyro_x = ch.get("gyro_x_mdps") / 1000.0 if ch.get("gyro_x_mdps") is not None else None
                        gyro_y = ch.get("gyro_y_mdps") / 1000.0 if ch.get("gyro_y_mdps") is not None else None
                        gyro_z = ch.get("gyro_z_mdps") / 1000.0 if ch.get("gyro_z_mdps") is not None else None
                        vib_rms = ch.get("vib_rms_x100") / 100.0 if ch.get("vib_rms_x100") is not None else None
                        vib_peak = ch.get("vib_peak_x100") / 100.0 if ch.get("vib_peak_x100") is not None else None
                        vib_fdom = ch.get("vib_fdom_hz")
                        die_temp = ch.get("die_temp_dc") / 10.0 if ch.get("die_temp_dc") is not None else None

                        fissure = ch.get("fissure_mm") if tier == "1B" else None
                        strain = ch.get("strain_ue") if tier == "1B" else None

                        moisture = ch.get("moisture_pct") if tier == "1C" else None
                        ext_delta = ch.get("ext_delta_10um") * 0.01 if (tier == "1C" and ch.get("ext_delta_10um") is not None) else None

                        pore_press = ch.get("pore_pressure_kpa") if tier == "2B" else None
                        bh_t1 = ch.get("borehole_tilt_d1") if tier == "2B" else None
                        bh_t2 = ch.get("borehole_tilt_d2") if tier == "2B" else None
                        bh_t3 = ch.get("borehole_tilt_d3") if tier == "2B" else None
                        bh_t4 = ch.get("borehole_tilt_d4") if tier == "2B" else None

                        gps_x = ch.get("gps_dx_mm") if tier == "3" else None
                        gps_y = ch.get("gps_dy_mm") if tier == "3" else None
                        gps_z = ch.get("gps_dz_mm") if tier == "3" else None

                        await conn.execute(
                            INSERT_READING_SQL,
                            node_id, ts, tilt_x, tilt_y,
                            accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z,
                            vib_rms, vib_peak, vib_fdom, die_temp,
                            fissure, strain, moisture, ext_delta,
                            pore_press, bh_t1, bh_t2, bh_t3, bh_t4,
                            gps_x, gps_y, gps_z,
                        )
                        inserted += 1

                        # Capture representative sample for logging
                        if node_id in ("N01", "N10", "N26", "N31"):
                            if tier == "1A":
                                sample_logs.append(f"  • {node_id} [1A Baseline Scout]: tilt=({tilt_x}, {tilt_y}) urad | accel=({accel_x:.3f}, {accel_y:.3f}, {accel_z:.3f}) g | temp={die_temp:.1f}C")
                            elif tier == "1B":
                                sample_logs.append(f"  • {node_id} [1B Tension Scout ]: strain={strain or 0:.1f} ue | fissure={fissure or 0:.2f} mm | tilt=({tilt_x}, {tilt_y}) urad")
                            elif tier in ("2A", "2B"):
                                sample_logs.append(f"  • {node_id} [{tier} Router Anchor]: tilt=({tilt_x}, {tilt_y}) urad | temp={die_temp:.1f}C")
                            elif tier == "3":
                                sample_logs.append(f"  • {node_id} [3 Master Gateway ]: stable bedrock reference | GPS dx={gps_x or 0.0:.1f}mm dy={gps_y or 0.0:.1f}mm")

            if inserted > 0:
                print("-" * 80)
                print(f"[POSTGRES WRITE] Table: readings | Committed {inserted} node records @ {iso_timestamp}")
                for sl in sample_logs:
                    print(sl)
                print(f"  => Batch written into public.readings successfully ({inserted} rows)")
                print("-" * 80)

            return inserted
        except Exception as e:
            print(f"[DB] Warning: Failed to insert readings batch: {e}")
            return 0

    async def save_packet(self, packet: dict[str, Any]) -> bool:
        """Save simulation packet to PostgreSQL. Fallback to memory cache if DB is offline."""
        pid = packet["packet_id"]
        self._fallback_cache[pid] = packet
        self._latest_cached_packet = packet
        if len(self._fallback_cache) > 200:
            oldest_key = min(self._fallback_cache.keys())
            del self._fallback_cache[oldest_key]

        # Post to existing backend HTTP endpoint asynchronously
        asyncio.create_task(self.post_packet_to_backend(packet))

        if not self.is_connected:
            connected = await self.connect()
            if not connected:
                return False

        try:
            payload_json = json.dumps(packet)
            async with self.pool.acquire() as conn:
                await conn.execute(
                    UPSERT_PACKET_SQL,
                    packet["packet_id"],
                    packet["session_id"],
                    packet["grid_id"],
                    float(packet["start_sim_time"]),
                    float(packet["end_sim_time"]),
                    payload_json,
                )

            payload_kb = len(payload_json) / 1024.0
            nodes_cnt = len(packet.get("nodes", []))
            events_cnt = len(packet.get("events", []))
            sim_start = float(packet.get("start_sim_time", 0.0))
            sim_end = float(packet.get("end_sim_time", 0.0))

            print("\n" + "=" * 80)
            print(f"[POSTGRES WRITE] Table: simulation_packets | Packet #{pid} Finalized & Committed")
            print(f"  • Session: {packet.get('session_id', 'adriyala_sandbox')} | Grid: {packet.get('grid_id', 'G8')} | Sim Time: {sim_start:.1f}s -> {sim_end:.1f}s")
            print(f"  • Aggregation Summary: {nodes_cnt} nodes aggregated | {events_cnt} events recorded")
            print(f"  • Payload JSON: {payload_kb:.1f} KB written to public.simulation_packets")
            print("=" * 80 + "\n")
            return True
        except Exception as e:
            print(f"[DB] Warning: Failed to store packet {pid} in PostgreSQL: {e}")
            self.is_connected = False
            return False

    async def _post_to_backend(self, path: str, body: dict[str, Any]) -> bool:
        """POST a JSON body to the backend, off the event loop.

        urllib is blocking, so the call goes through a thread: the simulation
        tick must not stall on the backend's socket. A backend that is down is
        not an error here — the simulation is the source of truth and Postgres
        already has the row; the HTTP post exists only to trigger the
        WebSocket fan-out to connected dashboards.
        """
        url = f"{BACKEND_HTTP_URL}{path}"

        def _do_post():
            data = json.dumps(body).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=1.5) as resp:
                return resp.status in (200, 201)

        try:
            return await asyncio.to_thread(_do_post)
        except Exception:
            # Backend may not be up during standalone unit testing; fail silently
            return False

    async def post_packet_to_backend(self, packet: dict[str, Any]) -> bool:
        """Post finalized packet to Folder A backend (triggers WebSocket notification)."""
        return await self._post_to_backend("/simulation/packets", packet)

    async def post_alarm_to_backend(self, alarm: dict[str, Any]) -> bool:
        """Persist a raised alarm and push it to every connected dashboard.

        The MQTT bridge publishes the same alarm on `mine/<panel>/alarm` for the
        live banner. That path is transient: a dashboard that connects a minute
        later has missed it. This one gives the alarm a row in `alarms`, which
        is what the operator's history panel reads back.
        """
        return await self._post_to_backend("/api/alarms", alarm)

    async def get_packet(self, packet_id: int) -> dict[str, Any] | None:
        """Retrieve packet by packet_id from DB or memory fallback."""
        if self.is_connected and self.pool:
            try:
                async with self.pool.acquire() as conn:
                    row = await conn.fetchrow(SELECT_PACKET_SQL, packet_id)
                    if row:
                        val = row["payload"]
                        return json.loads(val) if isinstance(val, str) else val
            except Exception as e:
                print(f"[DB] Query packet {packet_id} failed: {e}")

        return self._fallback_cache.get(packet_id)

    async def get_latest_packet(self) -> dict[str, Any] | None:
        """Retrieve latest packet from DB or memory fallback."""
        if self.is_connected and self.pool:
            try:
                async with self.pool.acquire() as conn:
                    row = await conn.fetchrow(SELECT_LATEST_SQL)
                    if row:
                        val = row["payload"]
                        return json.loads(val) if isinstance(val, str) else val
            except Exception as e:
                print(f"[DB] Query latest packet failed: {e}")

        return self._latest_cached_packet

    async def list_packets(self, limit: int = 50) -> list[dict[str, Any]]:
        """Retrieve recent packet metadata list."""
        if self.is_connected and self.pool:
            try:
                async with self.pool.acquire() as conn:
                    rows = await conn.fetch(SELECT_LIST_SQL, limit)
                    return [
                        {
                            "packet_id": r["packet_id"],
                            "session_id": r["session_id"],
                            "grid_id": r["grid_id"],
                            "start_sim_time": r["start_sim_time"],
                            "end_sim_time": r["end_sim_time"],
                            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                        }
                        for r in rows
                    ]
            except Exception as e:
                print(f"[DB] List packets failed: {e}")

        summaries = []
        for pid in sorted(self._fallback_cache.keys(), reverse=True)[:limit]:
            p = self._fallback_cache[pid]
            summaries.append(
                {
                    "packet_id": p["packet_id"],
                    "session_id": p["session_id"],
                    "grid_id": p["grid_id"],
                    "start_sim_time": p["start_sim_time"],
                    "end_sim_time": p["end_sim_time"],
                    "created_at": None,
                }
            )
        return summaries

    async def reset_database(self) -> bool:
        """Reset PostgreSQL database tables and clear in-memory caches."""
        self._fallback_cache.clear()
        self._latest_cached_packet = None
        success = False
        if self.is_connected and self.pool:
            try:
                async with self.pool.acquire() as conn:
                    await conn.execute("""
                        TRUNCATE TABLE readings, simulation_packets, alarms CASCADE;
                        UPDATE nodes SET status = 'active';
                    """)
                    success = True
                    print("[DB] PostgreSQL runtime tables truncated; nodes reset to 'active'.")
            except Exception as e:
                print(f"[DB] Direct PostgreSQL reset failed: {e}")

        # Also notify backend service if available
        try:
            await self._post_to_backend("/api/system/reset", {})
        except Exception:
            pass

        return success


# Global singleton instance
db_manager = DatabaseManager()
