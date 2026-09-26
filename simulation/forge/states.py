"""FORGE node health, hazard zones and cracks.

Unlike the live engine's ``session.assign_node_states``, which forgets a
failure shortly after it ends, damage here does not heal: once an event has
started its footprint stays CRITICAL or WARNING for the rest of the timeline.
"""

import math
import random
import zlib
from typing import Any, Iterable, Sequence

import numpy as np

from sandbox import collapse, constants
from sandbox.collapse import PillarFailure
from sandbox.mqtt_bridge import _node_topic_id
from sandbox.session import CRITICAL_RADIUS_FACTOR, WARNING_RADIUS_FACTOR

_SEVERITY = {"ACTIVE": 0, "WARNING": 1, "CRITICAL": 2}

CRACK_LATTICE_M = 10.0
CRACK_JITTER_M = 3.5
CRACK_CAP = 400


def _started(events: Sequence[dict], failures_by_event: Sequence[Sequence[PillarFailure]], day: float):
    """(index, event) of every event that moves ground and has begun by `day`."""
    return [
        (i, ev)
        for i, (ev, fails) in enumerate(zip(events, failures_by_event))
        if fails and ev["day"] <= day
    ]


def _dist_to_footprint(ev: dict, px: float, py: float) -> tuple[float, float] | None:
    """(distance, radius R) from a point to a cave-in point or a crack capsule, else None."""
    if ev["type"] == "cave_in":
        return math.hypot(px - ev["x"], py - ev["y"]), ev["radius_m"]
    if ev["type"] == "crack":
        x0, y0, x1, y1 = ev["x0"], ev["y0"], ev["x1"], ev["y1"]
        dx, dy = x1 - x0, y1 - y0
        len2 = dx * dx + dy * dy
        t = 0.0 if len2 == 0.0 else min(1.0, max(0.0, ((px - x0) * dx + (py - y0) * dy) / len2))
        return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)), ev["width_m"]
    return None


def _tilt_event_tilt(nodes, started, failures_by_event, day: float) -> np.ndarray:
    """|tilt| in mm/m at each node from the started TILT events alone."""
    own = [pf for i, ev in started if ev["type"] == "tilt" for pf in failures_by_event[i]]
    if not own:
        return np.zeros(len(nodes))
    xs = np.array([[n.x_m for n in nodes]])
    ys = np.array([[n.y_m for n in nodes]])
    d = collapse.collapse_deltas(xs, ys, day, own)
    return np.hypot(d["delta_tilt_x"][0], d["delta_tilt_y"][0]) * 1000.0


def forge_node_states(
    nodes: Iterable[Any],
    events: Sequence[dict],
    failures_by_event: Sequence[Sequence[PillarFailure]],
    day: float,
    delta: dict[str, np.ndarray],
) -> dict[str, str]:
    """Health state per node id (``N01``-style) on `day`.

    Only events that have started count, and they keep counting.

    - cave_in / crack: inside 1.2 R of the pit (crack: of the segment) is
      CRITICAL, inside 1.5 R WARNING.
    - Anywhere, from the movement the events themselves add at the node (never
      the Knothe bowl, which would redden the board with no operator input):
      WARNING when tensile strain reaches EPS_TENSILE_LIMIT, compressive strain
      EPS_COMPRESS_LIMIT, or |tilt| TILT_WARNING_MM_M.
    - CRITICAL from the maths only for a TILT event's own tilt reaching
      TILT_CRITICAL_MM_M at the node. A cave-in or crack reaches CRITICAL only
      through its white circle: a 10 m / 100 m pit still tilts 11 mm/m at
      250 m, and letting that turn the node red would put red nodes far
      outside the rings drawn on the map. Outside the red circle such an event
      is capped at WARNING.

    The most severe reading wins. Vibration changes no state.
    """
    nodes = list(nodes)
    states = {_node_topic_id(n.node_id): "ACTIVE" for n in nodes}
    started = _started(events, failures_by_event, day)
    if not started:
        return states

    ix = np.array([n.grid_ix for n in nodes])
    iy = np.array([n.grid_iy for n in nodes])
    sx = delta["delta_strain_x"][iy, ix] * 1000.0
    sy = delta["delta_strain_y"][iy, ix] * 1000.0
    tilt = np.hypot(delta["delta_tilt_x"][iy, ix], delta["delta_tilt_y"][iy, ix]) * 1000.0
    tilt_own = _tilt_event_tilt(nodes, started, failures_by_event, day)

    for k, n in enumerate(nodes):
        state = "ACTIVE"
        if tilt_own[k] >= constants.TILT_CRITICAL_MM_M:
            state = "CRITICAL"
        elif (
            max(sx[k], sy[k]) >= constants.EPS_TENSILE_LIMIT
            or min(sx[k], sy[k]) <= -constants.EPS_COMPRESS_LIMIT
            or tilt[k] >= constants.TILT_WARNING_MM_M
        ):
            state = "WARNING"
        for _, ev in started:
            hit = _dist_to_footprint(ev, n.x_m, n.y_m)
            if hit is None:
                continue
            dist, r = hit
            if dist <= CRITICAL_RADIUS_FACTOR * r:
                state = "CRITICAL"
                break
            if dist <= WARNING_RADIUS_FACTOR * r and _SEVERITY[state] < _SEVERITY["WARNING"]:
                state = "WARNING"
        states[_node_topic_id(n.node_id)] = state
    return states


def hazard_zones(
    events: Sequence[dict], failures_by_event: Sequence[Sequence[PillarFailure]], day: float
) -> list[dict]:
    """White (1.2 R) and red (1.5 R) circles for every started cave-in and crack."""
    zones = []
    for i, ev in _started(events, failures_by_event, day):
        if ev["type"] == "cave_in":
            r = ev["radius_m"]
            zones.append({"event_index": i, "kind": "cave_in", "cx": ev["x"], "cy": ev["y"],
                          "r_white": CRITICAL_RADIUS_FACTOR * r, "r_red": WARNING_RADIUS_FACTOR * r})
        elif ev["type"] == "crack":
            r = ev["width_m"]
            zones.append({"event_index": i, "kind": "crack",
                          "polyline": [[ev["x0"], ev["y0"]], [ev["x1"], ev["y1"]]],
                          "r_white": CRITICAL_RADIUS_FACTOR * r, "r_red": WARNING_RADIUS_FACTOR * r})
    return zones


def _cell_hash(i: int, j: int) -> int:
    return zlib.crc32(f"{i},{j}".encode())


def _drawn_crack(index: int, ev: dict) -> list[dict]:
    """A jagged 6-10 piece polyline along a user-drawn crack, the same every call."""
    rng = random.Random(index)
    x0, y0, x1, y1 = ev["x0"], ev["y0"], ev["x1"], ev["y1"]
    length = math.hypot(x1 - x0, y1 - y0)
    if length == 0.0:
        return []
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    amp = min(0.08 * length, ev["width_m"])
    n = rng.randint(6, 10)
    pts = []
    for k in range(n + 1):
        off = 0.0 if k in (0, n) else rng.uniform(-amp, amp)
        s = length * k / n
        pts.append((x0 + s * ux - off * uy, y0 + s * uy + off * ux))
    width_mm = round(ev["throw_m"] * 1000.0, 1)
    return [
        {"x0": round(a[0], 2), "y0": round(a[1], 2), "x1": round(b[0], 2), "y1": round(b[1], 2),
         "width_mm": width_mm, "isNew": True}
        for a, b in zip(pts, pts[1:])
    ]


def strain_cracks(
    X: np.ndarray,
    Y: np.ndarray,
    total: dict[str, np.ndarray],
    delta: dict[str, np.ndarray],
    events: Sequence[dict],
    failures_by_event: Sequence[Sequence[PillarFailure]],
    day: float,
) -> list[dict]:
    """Cracks where the ground is over its tensile limit, plus the user-drawn ones.

    A crack per cell of a fixed 10 m lattice where the larger horizontal strain
    of the total field reaches EPS_TENSILE_LIMIT: a segment across the cell
    (jittered by a hash of the cell index, so it never flickers), perpendicular
    to the total tilt and longer the further past the limit, opening
    ``eps * 1000`` mm. ``isNew`` marks cells where the events supply more than
    half the strain, as opposed to the Knothe bowl. The strongest 400 are kept;
    drawn cracks are added on top.
    """
    limit = constants.EPS_TENSILE_LIMIT / 1000.0
    axis = X[0]
    dx = float(axis[1] - axis[0])
    lattice = np.arange(float(axis[0]), float(axis[-1]) + 1e-9, CRACK_LATTICE_M)
    idx = np.rint((lattice - axis[0]) / dx).astype(int)

    eps = np.maximum(total["strain_x"], total["strain_y"])[np.ix_(idx, idx)]
    eps_ev = np.maximum(delta["delta_strain_x"], delta["delta_strain_y"])[np.ix_(idx, idx)]
    tx = total["tilt_x"][np.ix_(idx, idx)]
    ty = total["tilt_y"][np.ix_(idx, idx)]

    hits = np.argwhere(eps >= limit)
    order = sorted(
        ((float(eps[r, c]), int(r), int(c)) for r, c in hits),
        key=lambda h: (-h[0], h[1], h[2]),
    )[:CRACK_CAP]

    cracks = []
    for e, r, c in order:
        h = _cell_hash(r, c)
        cx = lattice[c] + ((h & 0xFF) / 255.0 * 2.0 - 1.0) * CRACK_JITTER_M
        cy = lattice[r] + (((h >> 8) & 0xFF) / 255.0 * 2.0 - 1.0) * CRACK_JITTER_M
        if tx[r, c] == 0.0 and ty[r, c] == 0.0:
            theta = ((h >> 16) & 0xFF) / 255.0 * math.pi
        else:
            theta = math.atan2(ty[r, c], tx[r, c]) + math.pi / 2.0
        half = min(12.0, 4.0 + 2.0 * (e / limit)) / 2.0
        ux, uy = math.cos(theta), math.sin(theta)
        cracks.append(
            {
                "x0": round(cx - half * ux, 2), "y0": round(cy - half * uy, 2),
                "x1": round(cx + half * ux, 2), "y1": round(cy + half * uy, 2),
                "width_mm": round(e * 1000.0, 2),
                "isNew": bool(eps_ev[r, c] > 0.5 * e),
            }
        )

    for i, ev in _started(events, failures_by_event, day):
        if ev["type"] == "crack":
            cracks.extend(_drawn_crack(i, ev))
    return cracks
