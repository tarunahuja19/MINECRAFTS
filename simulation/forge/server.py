"""FORGE private math server on :8020.

Stateless FastAPI service computing continuous Knothe ground-truth subsidence,
additive discontinuous collapse deltas, node sampling, and alert radii using the
exact physics and layout helpers of the simulation sandbox session.
"""

import json
import math
from typing import Annotated, Any, Literal, Optional, Union
import urllib.error
import urllib.request

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from pydantic import BaseModel, Field

from forge import states
from sandbox import collapse, constants, events as event_maths, surface
from sandbox.collapse import PillarFailure
from sandbox.mqtt_bridge import _node_topic_id
from sandbox.sensors import SensorArray, SensorNoiseConfig

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


class CaveInEvent(BaseModel):
    type: Literal["cave_in"]
    x: float
    y: float
    radius_m: float = Field(..., gt=0)
    depth_m: float = Field(..., gt=0)
    day: float = Field(..., ge=0)
    duration_h: float = Field(..., gt=0)
    warning_hours: float = 8.0
    source: Optional[str] = None
    # Legacy TILT shape (App.tsx handleTriggerEvent): with all four tilt fields
    # set it is read as a TiltEvent over 3 days (sandbox.events.normalise).
    kind: Literal["cave_in", "tilt"] = "cave_in"
    target_x: Optional[float] = None
    target_y: Optional[float] = None
    rate_mm_per_m: Optional[float] = None
    direction_deg: Optional[float] = None


class VibrationEvent(BaseModel):
    """Blast vibration, as Session.apply_vibration: a site-wide PPV added to
    every node's vibration RMS for duration_s. It moves no ground and changes
    no node state."""

    type: Literal["vibration"]
    x: float = 0.0
    y: float = 0.0
    day: float = Field(..., ge=0)
    ppv_mm_s: float = Field(..., gt=0)
    duration_s: float = Field(60.0, gt=0)
    source: Optional[str] = None


class TiltEvent(BaseModel):
    """Ground tilting at a target: a bowl one radius away along direction_deg
    (0 = N, 90 = E), deep enough that the tilt there reaches rate_mm_per_m."""

    type: Literal["tilt"]
    x: float
    y: float
    radius_m: float = Field(..., gt=0)
    rate_mm_per_m: float = Field(..., gt=0)
    direction_deg: float
    over_days: float = Field(..., gt=0)
    day: float = Field(..., ge=0)
    source: Optional[str] = None


class CrackEvent(BaseModel):
    """A fissure along a segment with a vertical throw at its midpoint."""

    type: Literal["crack"]
    x0: float
    y0: float
    x1: float
    y1: float
    throw_m: float = Field(..., gt=0)
    width_m: float = Field(..., gt=0)
    open_days: float = Field(..., gt=0)
    day: float = Field(..., ge=0)
    source: Optional[str] = None


ForgeEvent = Annotated[
    Union[CaveInEvent, TiltEvent, CrackEvent, VibrationEvent], Field(discriminator="type")
]


class ForgeFrameRequest(BaseModel):
    day: float = 0.0
    events: list[ForgeEvent] = Field(default_factory=list)
    include_grids: bool = False


class ForgeRangeRequest(BaseModel):
    events: list[ForgeEvent] = Field(default_factory=list)


def _event_dicts(events: list) -> list[dict]:
    return [event_maths.normalise(ev.model_dump()) for ev in events]


@app.get("/health")
async def health():
    """Liveness probe."""
    return {"status": "ok"}


@app.post("/forge/frame")
async def forge_frame(req: ForgeFrameRequest):
    """Compute ground truth deformation, perturbations, and node states for a given day and events."""
    evs = _event_dicts(req.events)
    failures_by_event = [event_maths.to_failures(ev) for ev in evs]
    failures: list[PillarFailure] = [pf for fs in failures_by_event for pf in fs]
    # Vibration transient in force on this day (Session: base + transient).
    vib_mm_s = sum(
        ev.ppv_mm_s
        for ev in req.events
        if isinstance(ev, VibrationEvent) and ev.day <= req.day <= ev.day + ev.duration_s / 86400.0
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

    # 4. Authoritative node health states: started events keep their footprint.
    node_states = states.forge_node_states(
        _sensor_array.nodes, evs, failures_by_event, req.day, deltas
    )

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
                # Vertical ground drop at the node (bowl + cave-ins), for the FORGE node card.
                "subsidence_mm": round(float(total_channels["s"][iy, ix]) * 1000.0, 1),
                "vib_rms": round(vib_mm_s, 2),
                "vib_peak": round(vib_mm_s * 1.45, 2),
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
                    "max_vib_peak": round(vib_mm_s * 1.45, 2),
                    "max_vib_rms": round(vib_mm_s, 2),
                    "last_alive": 1,
                    "last_seq": 1,
                    "node_state": st,
                },
            }
        )

    s_peak = float(np.max(total_channels["s"]))
    time_scalar = float(1.0 - np.exp(-constants.C_KNOTHE * req.day)) if req.day > 0 else 0.0

    res = {
        "t_sim": int(req.day * 86400.0),
        "t_days": round(float(req.day), 4),
        "time_scalar": round(time_scalar, 5),
        "bowl_py": surface.bowl_py_wire(req.day),
        "face_y_m": round(surface.face_y(req.day), 1),
        "speed_multiplier": 1.0,
        "perturbations": perturbations,
        "terrain": {
            "changed": bool(perturbations or s_peak > 0.01),
            "max_subsidence_m": round(s_peak, 4),
            "changes": list(perturbations),
        },
        "nodes": nodes_data,
        "node_states": node_states,
        "zones": states.hazard_zones(evs, failures_by_event, req.day),
        "cracks": states.strain_cracks(
            _X, _Y, total_channels, deltas, evs, failures_by_event, req.day
        ),
        "vib_mm_s": round(vib_mm_s, 2),
    }
    if req.include_grids:
        res["channels"] = {k: v.tolist() for k, v in total_channels.items()}
        res["deltas"] = {k: v.tolist() for k, v in deltas.items()}

    return res


@app.post("/forge/range")
async def forge_range(req: ForgeRangeRequest):
    """Compute maximum simulation end-day based on latest event end time."""
    if not req.events:
        return {"end_day": 365}

    latest_end = 0.0
    for ev in _event_dicts(req.events):
        event_end = event_maths.event_end_day(ev)
        if event_end is not None and event_end > latest_end:
            latest_end = event_end

    end_day = max(365, int(math.ceil(latest_end)))
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
    # A failure that belongs to a scripted event stands for that event (a crack
    # is a chain of failures, a tilt an offset bowl), so it is seeded as the
    # event itself, once, instead of as cave-ins.
    script_events = data.get("script_events", {})
    events = []
    seeded: set[str] = set()
    for pf in data.get("pillar_failures", []):
        owner = pf.get("script_event")
        if owner is not None and str(owner) in script_events:
            if str(owner) not in seeded:
                seeded.add(str(owner))
                events.append({**script_events[str(owner)], "source": "live"})
            continue
        events.append(
            {
                "type": "cave_in",
                "x": float(pf["cx"]),
                "y": float(pf["cy"]),
                "radius_m": float(pf["radius_m"]),
                "depth_m": float(pf["magnitude_m"]),
                "day": float(pf["t_init_days"]),
                "duration_h": round(float(pf["duration_days"]) * 24.0, 4),
                "warning_hours": round(
                    (float(pf["t_collapse_days"]) - float(pf["t_init_days"])) * 24.0, 4
                ),
                "source": "live",
            }
        )
    return {"day": day, "events": events}
