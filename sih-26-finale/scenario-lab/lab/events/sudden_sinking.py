"""Sudden sinking at a point (WP9 §5 row 1).

Ground over coal that has already been extracted drops NOW by as much as it still had left to sink.
The one trough formula stays physics.subsidence (Invariant 4, gate G01): this event does not write a
second subsidence model, it calls the same one with a settled time coefficient and takes the difference.
That is also why it cannot invent subsidence — the cap U is the ground's own remaining capacity.
"""

from __future__ import annotations

import numpy as np

from lab.config import load_event_spec, resolve_inputs, used
from lab.events.base import EventResult, register, remaining_capacity, taper

NAME = "sudden_sinking"


@register(NAME)
def sudden_sinking(snap, x0_m: float, y0_m: float, params: dict) -> EventResult:
    spec = load_event_spec(NAME)
    values = resolve_inputs(spec, params or {})
    radius_m = values["collapse_radius_m"]
    params_used = {k: used(spec, k, v) for k, v in values.items()}

    u, s_pot = remaining_capacity(snap)
    X, Y = snap.grid.centres()
    d = np.hypot(X - x0_m, Y - y0_m)
    here = np.unravel_index(int(np.argmin(d)), d.shape)
    min_effect = snap.lab.min_effect_mm

    if float(s_pot[here]) < min_effect:
        return EventResult(False, "no extracted coal under this spot, nothing to collapse into",
                           params_used=params_used)
    if float(u[here]) < min_effect:
        return EventResult(
            False,
            f"ground here has already settled ({float(u[here]):.1f} mm left, "
            f"below the {min_effect:.0f} mm we can call a change)",
            params_used=params_used)

    ds = (u * taper(d, radius_m, snap.cfg.r)).astype(np.float32)
    return EventResult(
        True,
        f"ground within {radius_m:.0f} m drops by up to {float(np.max(ds)):.0f} mm now, which is the "
        f"sinking this spot still had left; it fades to nothing over the next {snap.cfg.r:.0f} m",
        ds_mm=ds, params_used=params_used)
