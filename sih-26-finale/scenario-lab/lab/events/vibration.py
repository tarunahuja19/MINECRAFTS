"""Dynamic caving vibration event (thin registered event returning ds_mm=zeros).

The server already attaches the caving ppv layer + DGMS verdict for every scenario (server.py).
Vibration does not sink the ground.
"""

from __future__ import annotations

import numpy as np

from lab.config import load_event_spec, resolve_inputs, used
from lab.events.base import EventResult, register

NAME = "vibration"


@register(NAME)
def vibration(snap, x0_m: float, y0_m: float, params: dict) -> EventResult:
    spec = load_event_spec(NAME)
    values = resolve_inputs(spec, params or {})
    params_used = {k: used(spec, k, v) for k, v in values.items()}
    ds = np.zeros(snap.grid.shape, dtype=np.float32)
    return EventResult(
        True,
        "evaluating roof caving vibration and DGMS compliance limits across the zone (no ground movement)",
        ds_mm=ds,
        params_used=params_used,
    )
