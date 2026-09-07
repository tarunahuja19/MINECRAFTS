"""
FastAPI application and WebSocket server for the mine sandbox (§5 Session C).

Wire Protocol (§3.2):
- On connect: sends initial static geometry and base bowl once (~5 KB).
- Per tick: broadcasts compact state delta (~2 KB/tick) containing:
    {t_sim, time_scalar, perturbations, nodes, segments}
- Client-to-server commands (both bare and apply_-prefixed names accepted):
    {"action": "collapse" | "apply_collapse", "cx": 50, "cy": 50,
     "magnitude_m": 0.75, "radius_m": 60, "duration_hours": 4.8}
    {"action": "vibration" | "apply_vibration", "magnitude_ppv": 15.0}
    {"action": "set_speed", "multiplier": 10}
    {"action": "start"} | {"action": "pause"} | {"action": "resume"}
    {"action": "stop"} | {"action": "reset"}
  Unknown actions receive {"type": "error", "message": ...} rather than being
  silently ignored.
"""

import asyncio
from contextlib import asynccontextmanager
import json
import sys
from typing import Any

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from sandbox import constants, dem, geo, hypsometry, layout, mesh, segments, surface
from sandbox.constants import DEFAULT_SPEED_MULTIPLIER
from sandbox.db import db_manager
from sandbox.session import SessionConfig, SimulationSession


# Global session instance
_session: SimulationSession | None = None
_connected_clients: set[WebSocket] = set()
_sim_task: asyncio.Task | None = None

# DEM metadata is static (the tile and panel resample never change at
# runtime), so compute it once at module import rather than per-connection
# or per-request — matching how surface.py precomputes `_BASE_S` once.
_DEM_STATS = dem.elevation_stats(dem.panel_dem())
_DEM_CONTOURS = hypsometry.contour_levels(_DEM_STATS["min_m"], _DEM_STATS["max_m"])


def get_session() -> SimulationSession:
    """Return the global session singleton, initializing if needed."""
    global _session
    if _session is None:
        _session = SimulationSession()
    return _session


def ensure_simulation_task() -> asyncio.Task:
    """Ensure the background simulation tick loop task is running."""
    global _sim_task
    if _sim_task is None or _sim_task.done() or _sim_task.cancelled():
        _sim_task = asyncio.create_task(simulation_loop())
        print("[SERVER] Background simulation_loop worker task started/re-armed")
    return _sim_task


async def broadcast_simulation_status(session: SimulationSession) -> dict[str, Any]:
    """Broadcast simulation run state across MQTT, WebSockets, and backend."""
    status_state = "RUNNING" if session.is_running and not session.is_paused else ("PAUSED" if session.is_paused else "STOPPED")
    session.mqtt_bridge.publish_simulation_status(session.is_running, session.is_paused)

    # Inform backend of status transition (non-blocking in thread)
    def _notify_backend():
        try:
            import urllib.request
            req = urllib.request.Request(
                "http://127.0.0.1:8080/api/simulation/status",
                data=json.dumps({
                    "is_running": session.is_running,
                    "is_paused": session.is_paused,
                    "state": status_state,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=0.5)
        except Exception:
            pass

    asyncio.create_task(asyncio.to_thread(_notify_backend))
    return {"state": status_state, "is_running": session.is_running, "is_paused": session.is_paused}


async def simulation_loop():
    """Background asyncio worker running the simulation tick loop."""
    session = get_session()
    while True:
        try:
            if session.is_running and not session.is_paused:
                payload = session.tick()
                # Broadcast payload to all connected clients
                if _connected_clients:
                    dead_clients = set()
                    for ws in _connected_clients:
                        try:
                            await ws.send_json(payload)
                        except Exception:
                            dead_clients.add(ws)
                    for dead in dead_clients:
                        _connected_clients.discard(dead)

                # If a 60-sim-second packet was finalized: save to DB and notify clients (§Phase 5)
                if payload.get("packet_available") and session.last_finalized_packet:
                    pkt = session.last_finalized_packet
                    # Asynchronously save to PostgreSQL in background without blocking
                    asyncio.create_task(db_manager.save_packet(pkt))

                    # Send lightweight standalone notification frame
                    notify_msg = payload["packet_available"]
                    dead_notify = set()
                    for ws in _connected_clients:
                        try:
                            await ws.send_json(notify_msg)
                        except Exception:
                            dead_notify.add(ws)
                    for dead in dead_notify:
                        _connected_clients.discard(dead)
                    print(f"[WS] packet {notify_msg['packet_id']} available notification sent")

                # Calculate wall-clock sleep duration based on speed multiplier
                # speed = (sim_seconds / wall_second) -> wall_dt = tick_sim_seconds / speed
                wall_dt = max(0.005, session.config.tick_duration_sim_s / max(1.0, session.speed_multiplier))
                await asyncio.sleep(wall_dt)
            else:
                await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            break
        except Exception as e:
            import traceback
            print(f"[ERROR in simulation loop]: {e}\n{traceback.format_exc()}")
            await asyncio.sleep(0.1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager to initialize simulation and background loop."""
    session = get_session()
    print(f"[*] Mine Sandbox Server initialized. SNR Margin: {session.snr_margin:.2f}")
    # Initialize PostgreSQL connection pool
    await db_manager.connect()
    # Start publishing ticks to the MQTT broker the dashboard subscribes to.
    session.mqtt_bridge.connect()
    # Note: session starts idle (is_running = False) until user explicitly clicks Start
    ensure_simulation_task()
    yield
    global _sim_task
    if _sim_task:
        _sim_task.cancel()
    if _session:
        _session.stop()
        _session.mqtt_bridge.close()
    await db_manager.close()


app = FastAPI(title="Mine Sandbox Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _node_defs() -> list[dict[str, Any]]:
    """The static node table sent to the client on connect.

    Carries tier and the commissioned mesh DAG alongside position, because
    the client cannot derive either: tier decides what a node draws as and
    which channels it may show, and the DAG is planned at commissioning
    rather than discovered from proximity. The client used to infer mesh
    links by joining every node within 160 m, which drew links the radio
    network does not have and omitted the long backbone hops it does.

    Shared by `/config` and the WebSocket init frame so the two cannot
    drift apart in what they claim the network is.
    """
    positions = layout.node_positions()
    ids = layout.node_ids()
    tiers = layout.node_tiers()
    mesh_by_id = {l.node_id: l for l in mesh.build_mesh()}

    out: list[dict[str, Any]] = []
    for i, (x, y), tier in zip(ids, positions, tiers):
        link = mesh_by_id[int(i)]
        out.append(
            {
                "id": int(i),
                "x": float(x),
                "y": float(y),
                "tier": tier,
                "role": layout.TIER_ROLE[tier],
                "parent_id": link.parent_id,
                "backup_parent_id": link.backup_parent_id,
                "cluster_id": link.cluster_id,
                "hop_count": link.hop_count,
                "dist_to_parent_m": link.dist_to_parent_m,
                "tx_dbm": link.tx_power_dbm_nominal,
            }
        )
    return out


@app.get("/health")
async def health():
    """Health check endpoint exposing boot SNR margin and current sim-time."""
    session = get_session()
    if session.is_running and not session.is_paused:
        ensure_simulation_task()
    return {
        "status": "healthy",
        "snr_margin": session.snr_margin,
        "t_sim_seconds": session.t_sim_seconds,
        "tick_index": session.tick_index,
        "speed_multiplier": session.speed_multiplier,
        "is_running": session.is_running,
    }


@app.get("/config")
async def get_config():
    """Return static environment geometry, node definitions, baseline terrain, and base bowl."""
    session = get_session()
    positions = layout.node_positions()
    ids = layout.node_ids()
    zones = segments.generate_zones()

    # Step=2 downsamples 241x241 to 121x121 for high-fidelity 3D mesh reconstruction.
    # z0 is now the real Adriyala DEM panel (sandbox/dem.py), not the
    # synthetic terrain.baseline_grid() hill — see dem.py's module docstring
    # for why the two are kept separate.
    z0_full = dem.panel_dem()
    z0_sub = np.round(z0_full[::2, ::2], 4).tolist()
    bowl_sub = np.round(surface._BASE_S[::2, ::2], 4).tolist()

    return {
        "window_size_m": constants.WINDOW_SIZE_M,
        "grid_n": constants.GRID_N,
        "mesh_n": 121,
        "s_max_full": constants.S_MAX_FULL,
        "r_infl": constants.R_INFL,
        "c_knothe": constants.C_KNOTHE,
        "z0_mesh": z0_sub,
        "base_bowl_mesh": bowl_sub,
        "dem_source": "adriyala_regional_z12",
        "dem_lat": geo.ORIGIN_LAT,
        "dem_lon": geo.ORIGIN_LON,
        "panel_bearing_deg": geo.PANEL_BEARING_DEG,
        "elev_min_m": round(_DEM_STATS["min_m"], 2),
        "elev_max_m": round(_DEM_STATS["max_m"], 2),
        "elev_relief_m": round(_DEM_STATS["relief_m"], 2),
        "contour_interval_m": _DEM_CONTOURS["interval_m"],
        "contour_index_m": _DEM_CONTOURS["index_m"],
        "nodes": _node_defs(),
        "zones": [
            {
                "id": z.zone_id,
                "x_min": z.x_min,
                "x_max": z.x_max,
                "y_min": z.y_min,
                "y_max": z.y_max,
                "cx": z.cx,
                "cy": z.cy,
            }
            for z in zones
        ],
    }


from fastapi.responses import FileResponse, PlainTextResponse


@app.api_route("/data/nodes.csv", methods=["GET", "HEAD"])
async def download_nodes_csv():
    """Download live nodes.csv file directly."""
    session = get_session()
    if session.nodes_csv_path.exists():
        return FileResponse(
            str(session.nodes_csv_path),
            media_type="text/csv",
            filename="nodes.csv",
        )
    return PlainTextResponse("nodes.csv not yet created. Start simulation first.", status_code=404)


@app.api_route("/data/events.csv", methods=["GET", "HEAD"])
async def download_events_csv():
    """Download live events.csv file directly."""
    session = get_session()
    if session.events_csv_path.exists():
        return FileResponse(
            str(session.events_csv_path),
            media_type="text/csv",
            filename="events.csv",
        )
    return PlainTextResponse("events.csv not yet created. Start simulation first.", status_code=404)


# ---------------------------------------------------------------------------
# 60-Second Simulation Packet Endpoints (§Phase 6)
# ---------------------------------------------------------------------------


@app.get("/simulation/packets/latest")
async def get_latest_simulation_packet():
    """Retrieve the latest finalized 60-second simulation packet."""
    session = get_session()
    packet = session.packet_aggregator.get_latest_packet()
    if packet is not None:
        return packet

    packet = await db_manager.get_latest_packet()
    if packet is not None:
        return packet

    return PlainTextResponse("No finalized packets yet. Start simulation first.", status_code=404)


@app.get("/simulation/packets/{packet_id}")
async def get_simulation_packet(packet_id: int):
    """Retrieve full 60-second simulation packet by packet_id (§Phase 6)."""
    # 1. Check PostgreSQL or DB memory fallback
    packet = await db_manager.get_packet(packet_id)
    if packet is not None:
        return packet

    # 2. Check session aggregator in-memory ring buffer
    session = get_session()
    packet = session.packet_aggregator.get_packet_by_id(packet_id)
    if packet is not None:
        return packet

    # 3. Check optional debug JSON file on disk
    debug_path = session.out_dir / "simulation_packets" / f"packet_{packet_id:06d}.json"
    if debug_path.exists():
        import json
        try:
            with open(debug_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    return PlainTextResponse(f"Packet {packet_id} not found", status_code=404)


@app.get("/simulation/packets")
async def list_simulation_packets(limit: int = 50):
    """List recent simulation packet summaries."""
    packets = await db_manager.list_packets(limit=limit)
    if packets:
        return {"count": len(packets), "packets": packets}

    session = get_session()
    summaries = [
        {
            "packet_id": p["packet_id"],
            "session_id": p["session_id"],
            "grid_id": p["grid_id"],
            "start_sim_time": p["start_sim_time"],
            "end_sim_time": p["end_sim_time"],
            "node_count": len(p["nodes"]),
            "event_count": len(p["events"]),
        }
        for p in reversed(session.packet_aggregator.completed_packets[-limit:])
    ]
    return {"count": len(summaries), "packets": summaries}


@app.get("/nodes/{node_id}")
async def get_node_details(node_id: int):
    """Return full 17-channel observation telemetry and physical coordinates for a single node."""
    session = get_session()
    positions = layout.node_positions()
    ids = layout.node_ids()

    ids_list = list(ids)
    if node_id not in ids_list:
        return PlainTextResponse(f"Node {node_id} not found", status_code=404)

    idx = ids_list.index(node_id)
    x, y = positions[idx]
    tel = session.get_node_telemetry(node_id)

    # If simulation hasn't ticked yet, construct datum reading
    if tel is None:
        tel = {
            "node_id": node_id,
            "t_iso": session.get_iso_time(session.t_sim_seconds),
            "seq": 0,
            "tilt_x_urad": 0,
            "tilt_y_urad": 0,
            "strain_ue": 0,
            "ext_delta_10um": 0,
            "ext_delta_mm": 0.0,
            "vib_rms_x100": 3,
            "vib_peak_x100": 6,
            "vib_fdom_hz": 18,
            "temp_c": 28.5,
            "vbat_mv": 3600,
            "crack_flags": 0,
            "rssi_dbm": -85,
            "snr_db": 12.0,
            "hops": 1,
            "alive": 1,
        }

    return {
        "id": node_id,
        "x": float(x),
        "y": float(y),
        "telemetry": tel,
    }


class CommandRequest(BaseModel):
    action: str
    source: str | None = None
    multiplier: float | None = None
    cx: float | None = None
    cy: float | None = None
    magnitude: float | None = None
    magnitude_m: float | None = None
    radius_m: float | None = None
    duration_hours: float | None = None


@app.post("/control")
async def control(cmd: CommandRequest):
    """HTTP REST command control endpoint."""
    session = get_session()
    action = cmd.action.lower()

    if action == "start":
        ensure_simulation_task()
        session.start()
    elif action == "pause":
        session.is_paused = True
    elif action == "resume":
        ensure_simulation_task()
        session.is_paused = False
    elif action in ("stop", "reset"):
        if action == "reset":
            session.reset()
            if (cmd.source or "").lower() != "backend":
                await db_manager.reset_database()
        else:
            session.stop()
    elif action == "set_speed" and cmd.multiplier is not None:
        session.set_speed(cmd.multiplier)
    elif action in ("collapse", "apply_collapse") and cmd.cx is not None and cmd.cy is not None:
        mag = cmd.magnitude_m if cmd.magnitude_m is not None else (
            cmd.magnitude if cmd.magnitude is not None else 0.75
        )
        rad = cmd.radius_m if cmd.radius_m is not None else 60.0
        dur = cmd.duration_hours if cmd.duration_hours is not None else 4.8
        session.apply_collapse(cmd.cx, cmd.cy, radius_m=rad, magnitude_m=mag, duration_hours=dur)
    elif action in ("vibration", "apply_vibration"):
        mag = cmd.magnitude if cmd.magnitude is not None else 15.0
        session.apply_vibration(magnitude_ppv=mag)
    else:
        return {"status": "error", "message": f"Unknown action {cmd.action}"}

    status_info = await broadcast_simulation_status(session)
    return {"status": "success", "action": action, "speed": session.speed_multiplier, "state": status_info["state"]}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Interactive WebSocket endpoint for browser 3D client (§3.2)."""
    await websocket.accept()
    _connected_clients.add(websocket)
    session = get_session()

    try:
        # Send initial static geometry and base mesh payload once on connect
        positions = layout.node_positions()
        ids = layout.node_ids()
        zones = segments.generate_zones()

        z0_full = dem.panel_dem()
        z0_sub = np.round(z0_full[::2, ::2], 4).tolist()
        bowl_sub = np.round(surface._BASE_S[::2, ::2], 4).tolist()

        init_payload = {
            "type": "init",
            "window_size_m": constants.WINDOW_SIZE_M,
            "grid_n": constants.GRID_N,
            "mesh_n": 121,
            "base_peak_subsidence": 1.9971,
            "speed_multiplier": session.speed_multiplier,
            "z0_mesh": z0_sub,
            "base_bowl_mesh": bowl_sub,
            "dem_source": "adriyala_regional_z12",
            # Read from `sandbox.geo`, never re-typed. These literals used to be
            # written out here and in `_static_init()`, so the two payloads and
            # geo.py could drift apart silently; the whole point of geo.py is
            # that there is exactly one place the site origin is defined.
            "dem_lat": geo.ORIGIN_LAT,
            "dem_lon": geo.ORIGIN_LON,
            # The panel bearing travels with the origin so the 3D view can
            # project its own metres the same way the map does (Step 1b: 0.0
            # until real SCCL data gives the true bearing).
            "panel_bearing_deg": geo.PANEL_BEARING_DEG,
            "elev_min_m": round(_DEM_STATS["min_m"], 2),
            "elev_max_m": round(_DEM_STATS["max_m"], 2),
            "elev_relief_m": round(_DEM_STATS["relief_m"], 2),
            "contour_interval_m": _DEM_CONTOURS["interval_m"],
            "contour_index_m": _DEM_CONTOURS["index_m"],
            "nodes": _node_defs(),
            "zones": [
                {
                    "id": z.zone_id,
                    "x_min": z.x_min,
                    "x_max": z.x_max,
                    "y_min": z.y_min,
                    "y_max": z.y_max,
                    "cx": z.cx,
                    "cy": z.cy,
                }
                for z in zones
            ],
        }
        await websocket.send_json(init_payload)

        # Handle client incoming action messages.
        #
        # A single bad frame must not end the session. `receive_json` raises on
        # anything that is not valid JSON, and `data.get` raises if the frame
        # parsed to a non-dict (a bare list or string). Both used to propagate
        # to the outer handler below, which discards the client and closes the
        # socket — so one malformed message dropped the connection, and the
        # browser's reconnect then came back to a UI that had already disarmed
        # the run. Only a real disconnect should leave this loop; anything else
        # is logged and skipped.
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                raise
            except Exception as e:
                print(f"[WebSocket] discarding unreadable frame: {e}")
                continue

            if not isinstance(data, dict):
                await websocket.send_json({
                    "type": "error",
                    "message": "Expected a JSON object with an 'action' field",
                })
                continue

            action = str(data.get("action", "")).lower()

            # A bad *value* inside a well-formed frame (a non-numeric `cx`, say)
            # must not end the session either — the `float()` calls below raise
            # on one. Report it to the client and keep the socket open.
            try:
                if action == "start":
                    ensure_simulation_task()
                    session.start()
                    await broadcast_simulation_status(session)
                elif action == "pause":
                    session.is_paused = True
                    await broadcast_simulation_status(session)
                elif action == "resume":
                    ensure_simulation_task()
                    session.is_paused = False
                    await broadcast_simulation_status(session)
                elif action in ("stop", "reset"):
                    if action == "reset":
                        session.reset()
                        if str(data.get("source", "")).lower() != "backend":
                            await db_manager.reset_database()
                    else:
                        session.stop()
                    await broadcast_simulation_status(session)
                elif action == "set_speed":
                    # Falls back to the configured default, not a hardcoded
                    # 2000.0: a set_speed message that arrived without a
                    # multiplier used to slam the session to 2000x and
                    # reintroduce the runaway telemetry rate the default
                    # exists to prevent.
                    mult = float(data.get("multiplier", DEFAULT_SPEED_MULTIPLIER))
                    session.set_speed(mult)
                    await broadcast_simulation_status(session)
                elif action in ("collapse", "apply_collapse"):
                    cx = float(data.get("cx", 0.0))
                    cy = float(data.get("cy", 0.0))
                    mag = float(data.get("magnitude_m", data.get("magnitude", 0.75)))
                    rad = float(data.get("radius_m", 60.0))
                    dur = float(data.get("duration_hours", 4.8))
                    warn = float(data.get("warning_hours", 8.0))
                    session.apply_collapse(
                        cx=cx, cy=cy, radius_m=rad, magnitude_m=mag,
                        duration_hours=dur, warning_hours=warn,
                    )
                elif action in ("vibration", "apply_vibration"):
                    mag = float(data.get("magnitude_ppv", data.get("magnitude", 15.0)))
                    dur_s = float(data.get("duration_s", 60.0))
                    session.apply_vibration(magnitude_ppv=mag, duration_s=dur_s)
                else:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Unknown action {action!r}",
                    })
            except WebSocketDisconnect:
                raise
            except Exception as e:
                print(f"[WebSocket] action {action!r} failed: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": f"Action {action!r} failed: {e}",
                })

    except WebSocketDisconnect:
        _connected_clients.discard(websocket)
    except Exception as e:
        print(f"[WebSocket error]: {e}")
        _connected_clients.discard(websocket)


# Mount compiled frontend if available
from pathlib import Path
from fastapi.staticfiles import StaticFiles

_dist_path = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _dist_path.exists():
    app.mount("/", StaticFiles(directory=str(_dist_path), html=True), name="frontend")

