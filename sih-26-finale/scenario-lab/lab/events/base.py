"""EventResult, the event registry, and the shared taper (WP9 §4, §5).

An event takes a frozen Snapshot and a click, and returns extra subsidence on a copy. It never mutates
the snapshot, never writes a file, and when it cannot happen it says so in plain words instead of
returning zeros — a silent zero looks exactly like "nothing much happened", which is a different claim.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional, Tuple

import numpy as np

from minesim import physics


@dataclass(frozen=True)
class EventResult:
    possible: bool
    reason: str                                   # plain words, ALWAYS filled, both when possible and not
    ds_mm: Optional[np.ndarray] = None            # extra subsidence, POSITIVE DOWN, float32, full grid
    ppv_mm_s: Optional[np.ndarray] = None         # blast only
    params_used: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    zone_id: Optional[str] = None                 # set by lab.zones.confine_to_zone, None = unconfined


EVENTS: Dict[str, Callable[..., EventResult]] = {}


def register(name: str):
    """Decorator putting an event in EVENTS under `name`. Re-registering the same name is an error."""
    def wrap(fn):
        if name in EVENTS:
            raise ValueError(f"event {name!r} is already registered")
        EVENTS[name] = fn
        return fn
    return wrap


def taper(d: np.ndarray, inner_m: float, fade_m: float) -> np.ndarray:
    """1 inside `inner_m`, raised cosine to 0 over the next `fade_m`, 0 beyond (WP9 §5).

    A raised cosine rather than a step so the ground does not gain a vertical cliff, which would give a
    fake infinite tilt and strain at the rim and light up every consequence downstream.
    """
    d = np.asarray(d, dtype=np.float64)
    if fade_m <= 0:
        return np.where(d <= inner_m, 1.0, 0.0)
    ramp = 0.5 * (1 + np.cos(np.pi * np.clip((d - inner_m) / fade_m, 0.0, 1.0)))
    return np.where(d <= inner_m, 1.0, np.where(d < inner_m + fade_m, ramp, 0.0))


def settled_params(snap):
    """cfg.knothe with the time coefficient replaced: "all settlement has already happened" (WP9 §5)."""
    return dataclasses.replace(snap.cfg.knothe, time_coefficient=snap.lab.settled_time_coefficient_per_day)


def remaining_capacity(snap) -> Tuple[np.ndarray, np.ndarray]:
    """U = max(0, S_final - S_now): how much sinking this ground still has left, in mm, positive down.

    S_final is the settled trough for coal already extracted at `snap.day` — so U is zero where the
    ground has finished moving and zero where no coal has been taken. Both scenario types that drop the
    surface are capped by it: an event may bring future subsidence forward, never invent new subsidence.

    Returns (U, S_final) — the caller needs S_final too, to tell "no coal here" from "already settled".
    """
    X, Y = snap.grid.centres()
    s_pot = np.asarray(physics.subsidence(X, Y, snap.day, snap.cfg.panel, settled_params(snap)), dtype=np.float64)
    return np.maximum(0.0, s_pot - snap.s_model_mm), s_pot
