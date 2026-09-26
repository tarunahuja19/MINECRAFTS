"""Ground tilt event.

Imposes a directional surface tilt over an area to test pole leaning and slope thresholds.
"""

from __future__ import annotations

import numpy as np

from lab.config import load_event_spec, resolve_inputs, used
from lab.events.base import EventResult, register, taper

NAME = "tilt"


@register(NAME)
def tilt(snap, x0_m: float, y0_m: float, params: dict) -> EventResult:
    spec = load_event_spec(NAME)
    values = resolve_inputs(spec, params or {})
    tilt_mm_per_m = float(values["tilt_mm_per_m"])
    direction_deg = float(values["direction_deg"])
    radius_m = float(values["radius_m"])
    params_used = {k: used(spec, k, v) for k, v in values.items()}
    min_effect = snap.lab.min_effect_mm

    if tilt_mm_per_m <= 0:
        return EventResult(False, "0 mm/m tilt moves nothing: pick a positive tilt rate",
                           params_used=params_used)
    if radius_m <= 0:
        return EventResult(False, "0 m radius affects nothing: pick a positive radius",
                           params_used=params_used)

    X, Y = snap.grid.centres()
    dx = X - x0_m
    dy = Y - y0_m
    d = np.hypot(dx, dy)
    theta_rad = np.radians(direction_deg)
    p = dx * np.cos(theta_rad) + dy * np.sin(theta_rad)
    plane = tilt_mm_per_m * np.maximum(0.0, p + radius_m)
    ds = (plane * taper(d, radius_m, snap.cfg.r)).astype(np.float32)

    peak = float(np.max(ds)) if ds.size else 0.0
    if peak < min_effect:
        return EventResult(
            False,
            f"tilt of {tilt_mm_per_m:.1f} mm/m over {radius_m:.0f} m produces at most {peak:.1f} mm of "
            f"extra sinking, under the {min_effect:.0f} mm we can call a change",
            params_used=params_used)

    return EventResult(
        True,
        f"imposed tilt of {tilt_mm_per_m:.1f} mm/m along {direction_deg:.0f}° within {radius_m:.0f} m "
        f"sinks the ground by up to {peak:.0f} mm",
        ds_mm=ds, params_used=params_used)
