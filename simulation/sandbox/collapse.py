"""
Discontinuous events: sudden pillar failure and localized surface collapse.

Knothe subsidence (surface.py) models the smooth, long-term regional trough
that develops over weeks/months (C_KNOTHE = 0.04/day). However, sudden pillar
crushing and rapid roof caving operate on an hourly timescale (hours, not
weeks) and produce localized step-like drops and curvature spikes.

This module models localized pillar failure as an ADDITIVE ground-truth delta:
    S_total(x, y, t) = S_knothe(x, y, t) + Delta_S_collapse(x, y, t)
    curvature_total  = curvature_knothe  + Delta_curvature_collapse
    strain_total     = strain_knothe     + Delta_strain_collapse

Invariant:
- Additive to the Knothe bowl, never a replacement.
- Pillar failure progression includes a pre-collapse yielding phase that
  elevates strain/curvature before the sudden vertical step drop, guaranteeing
  a warning window where the zone transitions through CRITICAL before FAILED
  (Gate T50 / source plan T37).
- Operates on truth fields only.
"""

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from sandbox.constants import B_HORIZ


@dataclass(frozen=True)
class PillarFailure:
    """A localized pillar failure event.

    Parameters
    ----------
    cx, cy : float
        Centre of the failing pillar zone in metres (relative to panel centre).
    radius_m : float
        Characteristic spatial radius of the failure zone in metres.
    t_init_days : float
        Sim-time (days) when pillar yield initiates (FoS drops below 1.2).
    t_collapse_days : float
        Sim-time (days) when dynamic void breach / roof collapse occurs (FoS < 1.0).
        Must be > t_init_days to represent the physical pre-collapse yielding phase.
    duration_days : float
        Timescale of the rapid roof collapse in days (e.g. 0.15 days = ~3.6 hours).
    magnitude_m : float
        Maximum vertical step displacement at the centre in metres (positive downward).
    """

    cx: float
    cy: float
    radius_m: float = 60.0
    t_init_days: float = 100.0
    t_collapse_days: float = 100.5
    duration_days: float = 0.2  # ~4.8 hours
    magnitude_m: float = 0.75

    def __post_init__(self) -> None:
        if self.t_collapse_days <= self.t_init_days:
            raise ValueError("t_collapse_days must be strictly greater than t_init_days to preserve warning window.")
        if self.radius_m <= 0:
            raise ValueError("radius_m must be positive.")
        if self.duration_days <= 0:
            raise ValueError("duration_days must be positive.")


def _spatial_profile(
    X: np.ndarray, Y: np.ndarray, cx: float, cy: float, radius: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Compute normalized spatial bell profile G(x, y) and its analytic derivatives.

    G(x, y) = exp( - ((x - cx)^2 + (y - cy)^2) / (2 * radius^2) )
    dG/dx   = - (x - cx) / radius^2 * G
    dG/dy   = - (y - cy) / radius^2 * G
    d2G/dx2 = ( (x - cx)^2 / radius^4 - 1 / radius^2 ) * G
    d2G/dy2 = ( (y - cy)^2 / radius^4 - 1 / radius^2 ) * G
    """
    dx = X - cx
    dy = Y - cy
    r2 = radius * radius
    r4 = r2 * r2

    g = np.exp(-(dx * dx + dy * dy) / (2.0 * r2))
    dg_dx = -(dx / r2) * g
    dg_dy = -(dy / r2) * g
    d2g_dx2 = ((dx * dx) / r4 - (1.0 / r2)) * g
    d2g_dy2 = ((dy * dy) / r4 - (1.0 / r2)) * g

    return g, dg_dx, dg_dy, d2g_dx2, d2g_dy2


def _time_evolution(
    t: float, t_init: float, t_collapse: float, duration: float
) -> tuple[float, float, float]:
    """Compute time evolution factors for yielding, collapse step, and curvature amplifier.

    Returns:
    --------
    step_frac : float
        Fraction of full vertical step displacement (0.0 to 1.0).
    yield_frac : float
        Pre-collapse yielding strain/curvature factor.
    is_collapsed : bool
        True if dynamic collapse has reached advanced stage (step_frac > 0.5).
    """
    if t < t_init:
        return 0.0, 0.0, 0.0

    # Phase 1: Pre-collapse yielding (t_init <= t < t_collapse)
    # Strains build up rapidly around the failing pillar perimeter
    if t < t_collapse:
        progress = (t - t_init) / (t_collapse - t_init)
        # Yielding factor ramps from 0 to 1 smoothly
        yield_frac = float(0.5 * (1.0 - np.cos(np.pi * progress)))
        # Minor precursory subsidence (~5% of total step)
        step_frac = 0.05 * yield_frac
        return step_frac, yield_frac, 0.0

    # Phase 2: Dynamic collapse (t >= t_collapse)
    # Rapid vertical displacement occurs over ~duration_days (hours)
    dt = t - t_collapse
    # Smooth sinusoidal sigmoid over duration
    if dt >= duration:
        step_frac = 1.0
    else:
        step_frac = float(0.05 + 0.95 * (0.5 * (1.0 - np.cos(np.pi * dt / duration))))

    yield_frac = 1.0
    return step_frac, yield_frac, step_frac


def collapse_deltas(
    X: np.ndarray, Y: np.ndarray, t: float, events: Sequence[PillarFailure]
) -> dict[str, np.ndarray]:
    """Compute additive ground delta fields (S, tilt, curvature, displacement, strain)
    caused by discontinuous pillar failure events at sim-time t.

    Parameters
    ----------
    X, Y : np.ndarray
        Simulation meshgrid coordinate arrays in metres.
    t : float
        Sim-time in days.
    events : Sequence[PillarFailure]
        Active or scheduled pillar failure events.

    Returns
    -------
    dict with keys: 'delta_s', 'delta_tilt_x', 'delta_tilt_y', 'delta_curvature_x',
    'delta_curvature_y', 'delta_displacement_x', 'delta_displacement_y',
    'delta_strain_x', 'delta_strain_y'.
    """
    shape = X.shape
    delta_s = np.zeros(shape, dtype=float)
    delta_tilt_x = np.zeros(shape, dtype=float)
    delta_tilt_y = np.zeros(shape, dtype=float)
    delta_curv_x = np.zeros(shape, dtype=float)
    delta_curv_y = np.zeros(shape, dtype=float)

    for ev in events:
        step_frac, yield_frac, collapsed_frac = _time_evolution(
            t, ev.t_init_days, ev.t_collapse_days, ev.duration_days
        )
        if step_frac == 0.0 and yield_frac == 0.0:
            continue

        g, dg_dx, dg_dy, d2g_dx2, d2g_dy2 = _spatial_profile(
            X, Y, ev.cx, ev.cy, ev.radius_m
        )

        # Pre-collapse yield boosts curvature/strain at the perimeter even before full step drop
        yield_boost = 1.0 + 1.8 * yield_frac
        effective_amp = ev.magnitude_m * step_frac

        delta_s += ev.magnitude_m * step_frac * g
        delta_tilt_x += effective_amp * yield_boost * dg_dx
        delta_tilt_y += effective_amp * yield_boost * dg_dy
        delta_curv_x += effective_amp * yield_boost * d2g_dx2
        delta_curv_y += effective_amp * yield_boost * d2g_dy2

        # Additional pre-yield strain precursor around perimeter if before full step
        if step_frac < 0.2 and yield_frac > 0:
            precursor_amp = ev.magnitude_m * 0.25 * yield_frac
            delta_curv_x += precursor_amp * d2g_dx2
            delta_curv_y += precursor_amp * d2g_dy2

    delta_disp_x = B_HORIZ * delta_tilt_x
    delta_disp_y = B_HORIZ * delta_tilt_y
    delta_strain_x = B_HORIZ * delta_curv_x
    delta_strain_y = B_HORIZ * delta_curv_y

    return dict(
        delta_s=delta_s,
        delta_tilt_x=delta_tilt_x,
        delta_tilt_y=delta_tilt_y,
        delta_curvature_x=delta_curv_x,
        delta_curvature_y=delta_curv_y,
        delta_displacement_x=delta_disp_x,
        delta_displacement_y=delta_disp_y,
        delta_strain_x=delta_strain_x,
        delta_strain_y=delta_strain_y,
    )
