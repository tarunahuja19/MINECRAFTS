"""Tilt, curvature and strain from a FLOAT surface (WP9 §3, §4, gate L5).

Never derive these from the int-mm world grid. The 14 Sep stress test measured it: rounding S to whole
millimetres on 5 m cells produces strain errors up to 4.9 mm/m, larger than the true peak of 4.5 mm/m —
the noise is bigger than the signal. derive_fields therefore REFUSES an integer array (TypeError)
rather than quietly returning a plausible-looking wrong answer. The int grid is for display and for the
before/after surface numbers only.

Units and signs (WP9 §3), with s in mm and cell_m in metres:
  tilt      mm/m,  tilt_x = -ds/dx      (+ = surface rises toward +x)
  curvature 1/km,  curv_x = -d2s/dx2    (1/km and mm/m^2 are the same number)
  strain    mm/m,  eps_x  = B*d2s/dx2   (+ = TENSION), B = r/sqrt(2*pi), r = depth/tan_beta
The same B as physics.displacement, so the lab and the simulator stretch the ground identically.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Fields:
    tilt_x_mm_per_m: np.ndarray
    tilt_y_mm_per_m: np.ndarray
    tilt_mag_mm_per_m: np.ndarray
    curv_x_per_km: np.ndarray
    curv_y_per_km: np.ndarray
    strain_x_mm_per_m: np.ndarray
    strain_y_mm_per_m: np.ndarray
    strain_xy_mm_per_m: np.ndarray    # the shear term; without it there is no principal strain


def horizontal_displacement_factor(cfg) -> float:
    """B in u = B * ds/dx. One definition, shared with physics.displacement."""
    return cfg.r / np.sqrt(2 * np.pi)


def derive_fields(s_float_mm: np.ndarray, cell_m: float, cfg) -> Fields:
    """Fields of a float subsidence surface (mm, positive down) on a regular `cell_m` grid.

    Raises TypeError on an integer array — see the module docstring; that is gate L5, not a style rule.
    """
    arr = np.asarray(s_float_mm)
    if not np.issubdtype(arr.dtype, np.floating):
        raise TypeError(
            f"derive_fields needs a float surface, got {arr.dtype}. Deriving tilt/curvature/strain from "
            "the int-mm grid gives strain errors larger than the signal (WP9 §3); pass s_model_mm + ds.")

    ds_dx, ds_dy = np.gradient(arr, cell_m, edge_order=2)
    d2s_dx2 = np.gradient(ds_dx, cell_m, axis=0, edge_order=2)
    d2s_dy2 = np.gradient(ds_dy, cell_m, axis=1, edge_order=2)
    # The cross derivative. physics.curvature() returned only d2S/dx2 and d2S/dy2 until F10, which is
    # why cracks had no direction: with U = B grad(S) the strain tensor is eps_ij = B d2S/dx_i dx_j,
    # so without this term there is no principal strain and therefore no crack bearing. On the panel
    # centre-line it is ~0 and costs nothing; at the panel corners the trough is doubly curved, the
    # principal axes rotate by tens of degrees, and the corners are where the worst cracking is.
    d2s_dxdy = np.gradient(ds_dx, cell_m, axis=1, edge_order=2)

    tilt_x = -ds_dx
    tilt_y = -ds_dy
    b = horizontal_displacement_factor(cfg)
    return Fields(
        tilt_x_mm_per_m=tilt_x,
        tilt_y_mm_per_m=tilt_y,
        tilt_mag_mm_per_m=np.hypot(tilt_x, tilt_y),
        curv_x_per_km=-d2s_dx2,
        curv_y_per_km=-d2s_dy2,
        strain_x_mm_per_m=b * d2s_dx2,
        strain_y_mm_per_m=b * d2s_dy2,
        strain_xy_mm_per_m=b * d2s_dxdy,
    )


def principal_from_fields(fields: Fields):
    """(e1, e2, theta_deg) from a Fields, in mm/m and degrees — the gridded twin of
    physics.principal_strain.

    Same Mohr's circle, same convention: e1 is the MAJOR (most tensile) principal strain, positive =
    tension, and theta_deg is the direction of e1 counter-clockwise from +x. A surface crack opens
    perpendicular to e1, so the crack's own bearing is theta_deg + 90.

    The difference from physics.principal_strain is only where the second derivatives come from: this
    one differentiates a SURFACE (so it works on a scenario surface, which no analytic t produces),
    the other differentiates the analytic model at (x, y, t). Gate L8-1 asserts the two agree on a
    surface sampled from physics.subsidence, which is what stops them drifting into two models.

    Returned in mm/m to match the rest of Fields. lab.cracks.to_microstrain converts for minesim.
    """
    exx = fields.strain_x_mm_per_m
    eyy = fields.strain_y_mm_per_m
    exy = fields.strain_xy_mm_per_m

    mean = 0.5 * (exx + eyy)
    diff = 0.5 * (exx - eyy)
    radius = np.hypot(diff, exy)
    e1 = mean + radius
    e2 = mean - radius
    theta_deg = np.degrees(0.5 * np.arctan2(2 * exy, exx - eyy))
    return e1, e2, theta_deg
