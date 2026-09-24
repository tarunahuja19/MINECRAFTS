"""Panel edge collapse (WP9 §5 row 3).

The chain pillar along one rib crushes, so the ground behaves as if the extracted panel were wider on
that side. Built as the difference between two calls to the SAME physics.subsidence — one on a widened
panel shifted so the opposite rib stays put, one on the real settled panel — so Invariant 4 holds and
no second trough formula exists anywhere.
"""

from __future__ import annotations

import dataclasses

import numpy as np

from minesim import physics

from lab.config import load_event_spec, resolve_inputs, used
from lab.events.base import EventResult, register, settled_params, taper

NAME = "edge_collapse"


@register(NAME)
def edge_collapse(snap, x0_m: float, y0_m: float, params: dict) -> EventResult:
    spec = load_event_spec(NAME)
    values = resolve_inputs(spec, params or {})
    pillar_m, length_m = values["pillar_width_m"], values["length_m"]
    params_used = {k: used(spec, k, v) for k, v in values.items()}
    min_effect = snap.lab.min_effect_mm

    if y0_m == 0:
        return EventResult(False, "click nearer one panel edge: this event needs a side to fail on",
                           params_used=params_used)

    side = np.sign(y0_m)
    panel = snap.cfg.panel
    settled = settled_params(snap)
    # Widen the panel by the failed pillar and shift its centre by half that, so the FAR rib does not
    # move: only the side that was clicked opens up.
    wide = dataclasses.replace(panel, width_m=panel.width_m + pillar_m)
    X, Y = snap.grid.centres()
    s_wide = np.asarray(physics.subsidence(X, Y - side * pillar_m / 2, snap.day, wide, settled), dtype=np.float64)
    s_set = np.asarray(physics.subsidence(X, Y, snap.day, panel, settled), dtype=np.float64)

    extra = np.maximum(0.0, s_wide - s_set)
    ds = (extra * taper(np.abs(X - x0_m), length_m / 2, snap.cfg.r)).astype(np.float32)
    peak = float(np.max(ds)) if ds.size else 0.0
    if peak < min_effect:
        return EventResult(
            False,
            f"no extracted panel next to this spot: widening the rib by {pillar_m:.0f} m moves the "
            f"ground by {peak:.1f} mm, under the {min_effect:.0f} mm we can call a change",
            params_used=params_used)

    return EventResult(
        True,
        f"losing a {pillar_m:.0f} m pillar over {length_m:.0f} m of the "
        f"{'north' if side > 0 else 'south'} rib sinks the ground by up to {peak:.0f} mm more",
        ds_mm=ds, params_used=params_used)
