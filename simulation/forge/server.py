"""FORGE private math server on :8020.

Stateless FastAPI service computing continuous Knothe ground-truth subsidence,
additive discontinuous collapse deltas, node sampling, and alert radii using the
exact physics and layout helpers of the simulation sandbox session.
"""

import json
import math
from typing import Any
import urllib.error
import urllib.request

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel, Field

from sandbox import collapse, constants, surface
from sandbox.collapse import PillarFailure
from sandbox.mqtt_bridge import _node_topic_id
from sandbox.sensors import SensorArray, SensorNoiseConfig
from sandbox.session import active_collapses, assign_node_states

app = FastAPI(title="FORGE Math Server", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Build read-only grid and sensor layout once at startup.
# Stateless: no state is mutated or preserved across requests.
_X, _Y = surface.grid()
_noise_cfg = SensorNoiseConfig(enable_noise=False)
_sensor_array = SensorArray(_noise_cfg)


class ForgeFrameRequest(BaseModel):
    day: float = 0.0
    events: list[dict[str, Any]] = Field(default_factory=list)


class ForgeRangeRequest(BaseModel):
    events: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/health")
async def health():
    """Liveness probe."""
    return {"status": "ok"}


@app.post("/forge/frame")
async def forge_frame(req: ForgeFrameRequest):
    """Compute ground truth deformation, perturbations, and node states for a given day and events."""
    failures: list[PillarFailure] = []
    for ev in req.events:
        ev_type = ev.get("type")
        if ev_type != "cave_in":
            raise HTTPException(
                status_code=422,
                detail=f"Unknown event type '{ev_type}'; only 'cave_in' supported",
            )
        ev_day = float(ev.get("day", req.day))
        warning_hours = float(ev.get("warning_hours", 8.0))
        duration_hours = float(ev.get("duration_h", 4.8))
        failures.append(
            PillarFailure(
                cx=float(ev["x"]),
                cy=float(ev["y"]),
                radius_m=float(ev.get("radius_m", 60.0)),
                t_init_days=ev_day,
                t_collapse_days=ev_day + (warning_hours / 24.0),
                duration_days=duration_hours / 24.0,
                magnitude_m=float(ev.get("depth_m", 0.75)),
            )
        )

    # 1. Base Knothe ground truth
    base_ch = surface.channels(_X, _Y, req.day)

    # 2. Additive discontinuous collapse deltas
    deltas = collapse.collapse_deltas(_X, _Y, req.day, failures)

    # 3. Combine total ground truth fields
    total_channels = {
        "s": base_ch["s"] + deltas["delta_s"],
        "tilt_x": base_ch["tilt_x"] + deltas["delta_tilt_x"],
        "tilt_y": base_ch["tilt_y"] + deltas["delta_tilt_y"],
        "curvature_x": base_ch["curvature_x"] + deltas["delta_curvature_x"],
        "curvature_y": base_ch["curvature_y"] + deltas["delta_curvature_y"],
        "displacement_x": base_ch["displacement_x"] + deltas["delta_displacement_x"],
        "displacement_y": base_ch["displacement_y"] + deltas["delta_displacement_y"],
        "strain_x": base_ch["strain_x"] + deltas["delta_strain_x"],
        "strain_y": base_ch["strain_y"] + deltas["delta_strain_y"],
    }

    # 4. Active collapses & authoritative node health states
    active_colls = active_collapses(failures, req.day)
    node_states = assign_node_states(_sensor_array.nodes, active_colls)

    # 5. Perturbations for 3D viewport renderer
    perturbations = []
    for pf in failures:
        step_frac, yield_frac, _ = collapse._time_evolution(
            req.day, pf.t_init_days, pf.t_collapse_days, pf.duration_days
        )
        if req.day >= pf.t_init_days:
            perturbations.append(
                {
                    "cx": pf.cx,
                    "cy": pf.cy,
                    "radius_m": pf.radius_m,
                    "amp": float(pf.magnitude_m * step_frac),
                    "yield": float(yield_frac),
                }
            )

    # 6. Sample truth telemetry across sensor array
    nodes_data = []
    for node in _sensor_array.nodes:
        ix, iy = node.grid_ix, node.grid_iy
        nid_topic = _node_topic_id(node.node_id)
        st = node_states.get(nid_topic, "ACTIVE")

        tx = float(total_channels["tilt_x"][iy, ix])
        ty = float(total_channels["tilt_y"][iy, ix])
        sx = float(total_channels["strain_x"][iy, ix])
        disp = float(total_channels["displacement_x"][iy, ix])

        tilt_x_urad = int(np.clip(round(tx * 1e6), -32768, 32767)) if node.carries("tilt_x_urad") else None
        tilt_y_urad = int(np.clip(round(ty * 1e6), -32768, 32767)) if node.carries("tilt_x_urad") else None
        strain_ue = int(np.clip(round(sx * 1e6), -32768, 32767)) if node.carries("strain_ue") else None
        disp_mm = round(disp * 1000.0, 3)

        # Latch / strain overrides matching Session behavior on carve alarm
        if st == "CRITICAL" and strain_ue is not None:
            strain_ue = max(strain_ue, 6500)
        elif st == "WARNING" and strain_ue is not None:
            strain_ue = max(strain_ue, 4200)

        tilt_mag = round(math.hypot(float(tilt_x_urad or 0), float(tilt_y_urad or 0)), 2)

        nodes_data.append(
            {
                "id": node.node_id,
                "node_id": node.node_id,
                "tier": node.tier,
                "tilt_x": tilt_x_urad,
                "tilt_y": tilt_y_urad,
                "strain": strain_ue,
                "displacement": disp_mm,
                "vib_rms": 0,
                "vib_peak": 0,
                "vib_fdom": 0.0,
                "rssi": -90.0,
                "snr": 20.0,
                "alive": 1,
                "node_state": st,
                "aggregates": {
                    "max_strain": strain_ue,
                    "max_tilt_x": tilt_x_urad,
                    "max_tilt_y": tilt_y_urad,
                    "max_tilt_magnitude": tilt_mag,
                    "max_displacement": disp_mm,
                    "max_temperature": 28.0,
                    "min_battery": 3600,
                    "max_vib_peak": 0,
                    "max_vib_rms": 0,
                    "last_alive": 1,
                    "last_seq": 1,
                    "node_state": st,
                },
            }
        )

    s_peak = float(np.max(total_channels["s"]))
    time_scalar = float(1.0 - np.exp(-constants.C_KNOTHE * req.day)) if req.day > 0 else 0.0

    return {
        "t_sim": int(req.day * 86400.0),
        "t_days": round(float(req.day), 4),
        "time_scalar": round(time_scalar, 5),
        "speed_multiplier": 1.0,
        "perturbations": perturbations,
        "terrain": {
            "changed": bool(perturbations or s_peak > 0.01),
            "max_subsidence_m": round(s_peak, 4),
            "changes": list(perturbations),
        },
        "nodes": nodes_data,
        "node_states": node_states,
        "channels": {k: v.tolist() for k, v in total_channels.items()},
        "deltas": {k: v.tolist() for k, v in deltas.items()},
    }


@app.post("/forge/range")
async def forge_range(req: ForgeRangeRequest):
    """Compute maximum simulation end-day based on latest event end time."""
    if not req.events:
        return {"end_day": 120}

    latest_end = 0.0
    for ev in req.events:
        ev_type = ev.get("type")
        if ev_type != "cave_in":
            raise HTTPException(
                status_code=422,
                detail=f"Unknown event type '{ev_type}'; only 'cave_in' supported",
            )
        ev_day = float(ev.get("day", 0.0))
        warning_hours = float(ev.get("warning_hours", 8.0))
        duration_hours = float(ev.get("duration_h", 4.8))
        t_collapse_days = ev_day + (warning_hours / 24.0)
        duration_days = duration_hours / 24.0
        event_end = t_collapse_days + duration_days + 5.0
        if event_end > latest_end:
            latest_end = event_end

    end_day = max(120, int(math.ceil(latest_end)))
    return {"end_day": end_day}


@app.get("/forge/seed")
async def forge_seed():
    """Read live state from :8000/interventions and return seed day and events."""
    live_url = "http://127.0.0.1:8000/interventions"
    try:
        req = urllib.request.Request(live_url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status != 200:
                raise HTTPException(
                    status_code=503,
                    detail=f"Live engine on :8000 returned status {resp.status}",
                )
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Live engine on :8000 is unavailable: {e}",
        )

    t_sim_seconds = float(data.get("t_sim_seconds", 0.0))
    day = round(t_sim_seconds / 86400.0, 2)
    events = [
        {
            "type": "cave_in",
            "x": pf["cx"],
            "y": pf["cy"],
            "radius_m": pf["radius_m"],
            "depth_m": pf["magnitude_m"],
            "day": pf["t_init_days"],
            "duration_h": round(pf["duration_days"] * 24.0, 2),
            "source": "live",
        }
        for pf in data.get("pillar_failures", [])
    ]
    return {"day": day, "events": events}
