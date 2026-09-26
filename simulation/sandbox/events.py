"""
Operator events as PillarFailures: the one place where a FORGE event turns
into ground movement.

Every event is a plain dict (a pydantic ``model_dump``) and becomes a list of
``collapse.PillarFailure``. ``collapse_deltas`` is linear in ``magnitude_m``
and translation-invariant, so the tilt and crack events solve their magnitude
once with ``magnitude_m = 1`` on the settled state and divide, instead of
iterating.

- cave_in: one failure, as the live engine builds it.
- tilt: one failure a radius off the target along the bearing, so the target
  sits on the flank of the bowl, with the depth solved so the developed tilt at
  the target equals the requested rate.
- crack: a chain of narrow failures along a segment, one common magnitude
  chosen so the settled drop at the segment midpoint equals the throw.
"""

import math
from functools import lru_cache
from typing import Any

import numpy as np

from sandbox import collapse
from sandbox.collapse import PillarFailure

TILT_WARNING_H = 1.0
CRACK_WARNING_H = 1.0
LEGACY_TILT_OVER_DAYS = 3.0

# Long after any duration used here, so every failure is fully settled.
_SETTLED_DAY = 1.0e3


def normalise(ev: dict[str, Any]) -> dict[str, Any]:
    """Map the legacy ``cave_in`` with ``kind: "tilt"`` onto a ``tilt`` event.

    The old shape only described a tilt for the UI while the maths was a plain
    cave-in centred one radius off the target, with a depth of rate * R / 1000
    that did not deliver the rate. Anything else is returned unchanged.
    """
    if ev.get("type") == "cave_in" and ev.get("kind") == "tilt":
        needed = ("target_x", "target_y", "rate_mm_per_m", "direction_deg")
        if all(ev.get(k) is not None for k in needed):
            return {
                "type": "tilt",
                "x": ev["target_x"],
                "y": ev["target_y"],
                "radius_m": ev["radius_m"],
                "rate_mm_per_m": ev["rate_mm_per_m"],
                "direction_deg": ev["direction_deg"],
                "over_days": LEGACY_TILT_OVER_DAYS,
                "day": ev["day"],
                "source": ev.get("source"),
            }
    return ev


def _unit(cx: float, cy: float, radius_m: float, warning_h: float, duration_days: float,
          day: float, magnitude_m: float, ring: bool = True) -> PillarFailure:
    return PillarFailure(
        cx=cx,
        cy=cy,
        radius_m=radius_m,
        t_init_days=day,
        t_collapse_days=day + warning_h / 24.0,
        duration_days=duration_days,
        magnitude_m=magnitude_m,
        ring=ring,
    )


@lru_cache(maxsize=256)
def _tilt_per_metre_of_depth(radius_m: float) -> float:
    """Settled |tilt| (m/m) at a point one radius from the centre, per metre of depth."""
    pf = _unit(0.0, 0.0, radius_m, 1.0, 1.0, 0.0, 1.0)
    d = collapse.collapse_deltas(
        np.array([[radius_m]]), np.array([[0.0]]), _SETTLED_DAY, [pf]
    )
    return float(math.hypot(d["delta_tilt_x"][0, 0], d["delta_tilt_y"][0, 0]))


def _crack_points(length_m: float, width_m: float) -> np.ndarray:
    """Positions along a segment of the given length, at most width_m / 2 apart, ends included."""
    n = max(2, int(math.ceil(length_m / (width_m / 2.0))) + 1)
    return np.linspace(0.0, length_m, n)


@lru_cache(maxsize=256)
def _throw_per_unit_magnitude(length_m: float, width_m: float) -> float:
    """Settled delta_s at the segment midpoint for magnitude_m = 1 on every failure."""
    fails = [
        _unit(s, 0.0, width_m, CRACK_WARNING_H, 1.0, 0.0, 1.0)
        for s in _crack_points(length_m, width_m)
    ]
    d = collapse.collapse_deltas(
        np.array([[length_m / 2.0]]), np.array([[0.0]]), _SETTLED_DAY, fails
    )
    return float(d["delta_s"][0, 0])


def to_failures(ev: dict[str, Any]) -> list[PillarFailure]:
    """PillarFailures for one event dict. Vibration and unknown types move no ground."""
    ev = normalise(ev)
    kind = ev.get("type")

    if kind == "cave_in":
        return [
            _unit(
                ev["x"], ev["y"], ev["radius_m"],
                ev.get("warning_hours", 8.0), ev["duration_h"] / 24.0,
                ev["day"], ev["depth_m"],
            )
        ]

    if kind == "tilt":
        r = ev["radius_m"]
        b = math.radians(ev["direction_deg"])
        cx = ev["x"] + r * math.sin(b)
        cy = ev["y"] + r * math.cos(b)
        depth = (ev["rate_mm_per_m"] / 1000.0) / _tilt_per_metre_of_depth(r)
        return [_unit(cx, cy, r, TILT_WARNING_H, ev["over_days"], ev["day"], depth, ring=False)]

    if kind == "crack":
        x0, y0, x1, y1 = ev["x0"], ev["y0"], ev["x1"], ev["y1"]
        w = ev["width_m"]
        length = math.hypot(x1 - x0, y1 - y0)
        ux, uy = ((x1 - x0) / length, (y1 - y0) / length) if length > 0 else (0.0, 0.0)
        magnitude = ev["throw_m"] / _throw_per_unit_magnitude(round(length, 6), w)
        return [
            _unit(x0 + s * ux, y0 + s * uy, w, CRACK_WARNING_H, ev["open_days"], ev["day"], magnitude)
            for s in _crack_points(length, w)
        ]

    return []


def event_end_day(ev: dict[str, Any]) -> float | None:
    """Day the event stops mattering to the timeline (settling plus 5 days), or None."""
    ev = normalise(ev)
    kind = ev.get("type")
    if kind == "cave_in":
        return ev["day"] + ev.get("warning_hours", 8.0) / 24.0 + ev["duration_h"] / 24.0 + 5.0
    if kind == "tilt":
        return ev["day"] + ev["over_days"] + 5.0
    if kind == "crack":
        return ev["day"] + ev["open_days"] + 5.0
    return None
