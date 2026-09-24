"""The ground keeps moving for N more days (WP9 §5 row 2, S0 §S2).

The question this answers is the one people actually ask in front of a subsidence map: *it has been
sinking all week — what if it keeps doing that for another month?* So the event takes the rate the
ground is moving at right now, in the run, and carries it forward.

THIS IS NOT A FORECAST. It is arithmetic on a rate the user chose to extend, labelled SCENARIO
(HYPOTHETICAL) like every other lab answer, and it must never be shown next to a model prediction
without that label (Invariants 6 and 7). The real forecast path is the ML input in WP9 §7.

TWO THINGS KEEP IT HONEST
-------------------------
1. THE CAP. `ds` can never exceed U, the ground's own remaining capacity — the difference between the
   settled trough for coal already extracted and where the surface is now. An event may bring future
   subsidence forward; it may not invent subsidence that the extracted coal cannot produce. So a
   days_ahead of 180 on ground with 40 mm left gives 40 mm, not 400.

2. THE REFUSAL. Ground that is not moving now has no rate to extend, and the event says so with the
   numbers in it rather than returning a near-zero surface that reads as "nothing much happened".

The rate itself is two calls to the ONE trough formula, physics.subsidence, a week apart (Invariant 4,
gate G01): nothing here is a second subsidence model.
"""

from __future__ import annotations

from typing import Tuple

import numpy as np

from minesim import physics

from lab.config import constant, load_event_spec, resolve_inputs, used
from lab.events.base import EventResult, register, remaining_capacity, taper

NAME = "crack"


def sinking_rate_mm_per_day(snap, window_days: float) -> Tuple[np.ndarray, float]:
    """How fast each cell is sinking now, in mm/day positive down, over the last `window_days`.

    Returns (rate, window_used). The window is shortened near the start of a run — at day 3 there is
    no previous week — and never becomes zero, because a rate over no time is not a number.
    """
    window = float(min(window_days, snap.day))
    if window <= 0:
        return np.zeros(snap.s_model_mm.shape, dtype=np.float64), 0.0
    X, Y = snap.grid.centres()
    then = np.asarray(physics.subsidence(X, Y, snap.day - window, snap.cfg.panel, snap.cfg.knothe),
                      dtype=np.float64)
    return (snap.s_model_mm - then) / window, window


def extra_sinking_mm(snap, x0_m: float, y0_m: float, days_ahead: float, nearby_radius_m: float,
                     window_days: float) -> np.ndarray:
    """The extra subsidence of carrying on at today's rate for `days_ahead` days, capped by capacity.

    Separate from the event so it can be tested on its own: days_ahead = 0 must give exactly zero,
    and no days_ahead may push the ground past its remaining capacity.
    """
    rate, _window = sinking_rate_mm_per_day(snap, window_days)
    X, Y = snap.grid.centres()
    d = np.hypot(X - x0_m, Y - y0_m)
    carried = days_ahead * np.maximum(0.0, rate) * taper(d, nearby_radius_m, snap.cfg.r)
    capacity, _s_pot = remaining_capacity(snap)
    return np.minimum(carried, capacity).astype(np.float32)


@register(NAME)
def crack(snap, x0_m: float, y0_m: float, params: dict) -> EventResult:
    spec = load_event_spec(NAME)
    values = resolve_inputs(spec, params or {})
    days_ahead, radius_m = values["days_ahead"], values["nearby_radius_m"]
    window_days = float(constant(spec, "rate_window_days"))
    min_rate = float(constant(spec, "min_rate_mm_per_day"))
    params_used = {k: used(spec, k, v) for k, v in values.items()}
    params_used.update({k: used(spec, k, float(constant(spec, k)))
                        for k in ("rate_window_days", "min_rate_mm_per_day")})
    min_effect = snap.lab.min_effect_mm

    rate, window = sinking_rate_mm_per_day(snap, window_days)
    if window <= 0:
        return EventResult(False, f"day {snap.day:.0f} is the start of the run: there is no movement "
                                  f"yet to carry forward", params_used=params_used)

    X, Y = snap.grid.centres()
    d = np.hypot(X - x0_m, Y - y0_m)
    here = np.unravel_index(int(np.argmin(d)), d.shape)
    rate_here = float(rate[here])
    if rate_here < min_rate:
        return EventResult(
            False,
            f"the ground near here is not moving now: {rate_here:.3f} mm/day over the last "
            f"{window:.0f} days, under the {min_rate:.2f} mm/day we can tell from rounding — there is "
            f"no rate to carry forward",
            params_used=params_used)

    ds = extra_sinking_mm(snap, x0_m, y0_m, days_ahead, radius_m, window_days)
    peak = float(np.max(ds)) if ds.size else 0.0
    if peak < min_effect:
        if days_ahead <= 0:
            return EventResult(False, "0 days ahead moves nothing: pick a number of days",
                               params_used=params_used)
        capacity, _s_pot = remaining_capacity(snap)
        return EventResult(
            False,
            f"carrying on for {days_ahead:.0f} more days moves this ground by at most {peak:.1f} mm, "
            f"under the {min_effect:.0f} mm we can call a change — it is sinking at "
            f"{rate_here:.2f} mm/day and has {float(capacity[here]):.0f} mm of sinking left in it",
            params_used=params_used)

    capped = float(np.max(np.asarray(ds, dtype=np.float64)
                          - days_ahead * np.maximum(0.0, rate) * taper(d, radius_m, snap.cfg.r)))
    tail = (" — less than the rate alone would give, because the ground cannot sink past what the "
            "coal already taken out can produce" if capped < -min_effect else "")
    return EventResult(
        True,
        f"sinking at {rate_here:.2f} mm/day now, so {days_ahead:.0f} more days drops the ground "
        f"within {radius_m:.0f} m by up to {peak:.0f} mm{tail}",
        ds_mm=ds, params_used=params_used)
