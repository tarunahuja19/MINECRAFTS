"""Core Knothe subsidence physics implementation.

This module contains the ONLY implementation of S(x,y,t) in the repository.
All kinematic derivatives (tilt, curvature, strain, displacement) are derived
numerically from S(x,y,t) to preserve Gate G01.

Units:
- x, y, baseline_m: metres (m)
- t_days: days
- subsidence: millimetres (mm), positive downward
- tilt: microradians (urad)
- curvature: 1/km
- strain: microstrain (ustrain)
- displacement: millimetres (mm)
"""

import dataclasses
from typing import Tuple, Union
import numpy as np
from scipy.special import erf, erfc, erfcx

from minesim.config import PanelGeometry, KnotheParams


def face_position(t_days: Union[float, np.ndarray], params: KnotheParams) -> Union[float, np.ndarray]:
    """Face x-coordinate in metres at time t_days."""
    return params.advance_m_per_day * np.maximum(0.0, t_days)


def _exp_erfc(u: np.ndarray, a: float, beta: float, c: float, v: float) -> np.ndarray:
    """exp(c u / v + c^2 / (4 v^2 a^2)) * erfc(a (u + beta)) without overflow.

    For z = a (u + beta) >= 0 the exponent collapses: exp(...) erfc(z) = erfcx(z) exp(-a^2 u^2).
    For z < 0 the exponent is already negative, so the direct product is safe.
    """
    z = a * (u + beta)
    pos = z >= 0.0
    out = np.empty(np.broadcast(u, z).shape, dtype=np.float64)
    out[pos] = erfcx(z[pos]) * np.exp(-(a * u[pos]) ** 2)
    exponent = c * u[~pos] / v + (c / (2.0 * v * a)) ** 2
    out[~pos] = np.exp(exponent) * erfc(z[~pos])
    return out


def as_single_panel(panel: PanelGeometry) -> PanelGeometry:
    """The same panel with any district stripped: one panel on the axis, starting at t = 0.

    Use this wherever the calculation is anchored to the published LW1 field data (fitting, the
    real-anchored dataset, the closed-form Knothe identities). Those measurements are of one panel;
    running them against a superposed district would move every fitted number off the field data
    without failing anything.
    """
    return dataclasses.replace(panel, y_offsets_m=(0.0,), start_day_offsets_d=(0.0,))


def subsidence(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
) -> Union[float, np.ndarray]:
    """Vertical subsidence S(x,y,t) in millimetres, positive downward.

    Vectorised over x and y.

    A mine district is the linear superposition of its panels' troughs (the standard NCB treatment:
    the influence function is additive, so overlapping troughs add). Panel k is the same trough shifted
    to y - panel.y_offsets_m[k] and delayed by panel.start_day_offsets_d[k]. With the default single
    panel on the axis starting at t = 0 this is one call and the result is bit-identical to before.

    The formula appears once, in the loop below, and nowhere else in the repository (invariant 4, gate
    G01). tilt, curvature, strain and displacement differentiate *this* function numerically, so they
    follow the district too.

    Inflection-point offset d (panel.inflection_offset_m): the trough edges sit d inside every
    panel edge, because the strata over the ribs cantilever instead of caving. The Knothe
    influence function then acts on an effective panel of width W - 2d and length L - 2d whose
    effective face trails the real face by 2d (so it reaches L - d when the real face stops at L).
    d = 0 is classical Knothe.
    """
    d = panel.inflection_offset_m
    v = params.advance_m_per_day

    # Influence radius r = depth / tan_beta
    r = panel.depth_m / params.tan_beta
    w = panel.width_m
    m_mm = panel.seam_thickness_m * 1000.0
    s_full_mm = params.subsidence_factor * m_mm

    sqrt_pi = np.sqrt(np.pi)
    factor = sqrt_pi / r
    a = factor
    c = params.time_coefficient
    length = panel.length_m - 2.0 * d
    t_stop = length / v
    beta = c / (2.0 * v * a * a)
    w_half = w / 2.0 - d                      # effective half width

    scalar = not (isinstance(x, np.ndarray) or isinstance(y, np.ndarray))
    x_base = np.asarray(x, dtype=np.float64) - d   # effective-panel x
    y_base = np.asarray(y, dtype=np.float64)
    total = np.zeros(np.broadcast(x_base, y_base).shape, dtype=np.float64)

    for y_centre, start_day in zip(panel.y_offsets_m, panel.start_day_offsets_d):
        # effective-panel time for this panel: the goaf edge starts at x = d
        t_k = t_days - start_day - 2.0 * d / v
        if t_k <= 0.0:
            continue                          # this face has not started; it adds exactly zero
        x_arr = x_base
        y_arr = y_base - y_centre

        # Transverse profile across the effective width [-(W/2 - d), +(W/2 - d)]
        f_y = 0.5 * (erf(factor * (y_arr + w_half)) - erf(factor * (y_arr - w_half)))

        # Longitudinal profile with the Knothe time lag.
        # Static profile for a face at X:  f_static(x, X) = 0.5 * (erf(a x) - erf(a (x - X))).
        # Knothe: dS/dt = c (S_static(t) - S), so S(t) = integral_0^t c e^{-c(t - tau)} S_static(tau) dtau.
        # The face moves at v until it stops at the panel end (t_stop = L / v); nothing is
        # extracted beyond panel.length_m. The integral is solved in closed form below, so the
        # surface is continuous at the face and every point sinks monotonically in time.
        t_mined = min(t_k, t_stop)            # how long the face has been moving
        t_after = max(0.0, t_k - t_stop)      # how long since the face stopped

        # integral_0^T c e^{-c(T - tau)} erf(a (x - v tau)) dtau, with T = t_mined.
        # = erf(a(x-vT)) - e^{-cT} erf(ax) + e^{c(x-vT)/v + g} erfc(a(x-vT+beta)) - e^{-cT} e^{cx/v + g} erfc(a(x+beta)),
        # with g = c^2 / (4 v^2 a^2). Each exponential-times-erfc is evaluated by _exp_erfc so it cannot
        # overflow when c/v is large (slow face, fast settling): e^{cu/v + g} erfc(a(u+beta)) = erfcx(.) e^{-a^2 u^2}.
        u_face = x_arr - v * t_mined
        lag_moving = (
            erf(a * u_face)
            - np.exp(-c * t_mined) * erf(a * x_arr)
            + _exp_erfc(u_face, a, beta, c, v)
            - np.exp(-c * t_mined) * _exp_erfc(x_arr, a, beta, c, v)
        )
        decay = np.exp(-c * t_after)
        lag_face = lag_moving * decay + erf(a * (x_arr - length)) * (1.0 - decay)
        f_x = 0.5 * (erf(a * x_arr) * (1.0 - np.exp(-c * t_k)) - lag_face)
        f_x = np.clip(f_x, 0.0, 1.0)

        total = total + np.maximum(0.0, s_full_mm * f_y * f_x)

    if scalar:
        return float(total)
    return total


def tilt(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """(dS/dx, dS/dy) in microradians (numerical central difference)."""
    step = 0.1  # 10 cm differentiation step in metres
    s_x_plus = subsidence(x + step, y, t_days, panel, params)
    s_x_minus = subsidence(x - step, y, t_days, panel, params)
    # (mm / m) * 1000 = microradians
    tilt_x = ((s_x_plus - s_x_minus) / (2.0 * step)) * 1000.0

    s_y_plus = subsidence(x, y + step, t_days, panel, params)
    s_y_minus = subsidence(x, y - step, t_days, panel, params)
    tilt_y = ((s_y_plus - s_y_minus) / (2.0 * step)) * 1000.0

    return tilt_x, tilt_y


def curvature(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """(d2S/dx2, d2S/dy2) in 1/km (numerical central second difference)."""
    step = 0.1  # 10 cm step in metres
    s_center = subsidence(x, y, t_days, panel, params)
    s_x_plus = subsidence(x + step, y, t_days, panel, params)
    s_x_minus = subsidence(x - step, y, t_days, panel, params)
    # (mm / m^2) = 1/km
    curv_x = (s_x_plus - 2.0 * s_center + s_x_minus) / (step ** 2)

    s_y_plus = subsidence(x, y + step, t_days, panel, params)
    s_y_minus = subsidence(x, y - step, t_days, panel, params)
    curv_y = (s_y_plus - 2.0 * s_center + s_y_minus) / (step ** 2)

    return curv_x, curv_y


def strain(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
    baseline_m: float,
    axis: str,
) -> Union[float, np.ndarray]:
    """Horizontal strain in microstrain over baseline_m along axis in {'x', 'y'}.

    Computed as a finite difference of horizontal displacement across the baseline,
    NOT a point derivative. Positive = tension (stretch), negative = compression.
    """
    half_b = baseline_m / 2.0
    if axis == "x":
        u_plus, _ = displacement(x + half_b, y, t_days, panel, params)
        u_minus, _ = displacement(x - half_b, y, t_days, panel, params)
    elif axis == "y":
        _, u_plus = displacement(x, y + half_b, t_days, panel, params)
        _, u_minus = displacement(x, y - half_b, t_days, panel, params)
    else:
        raise ValueError(f"Invalid axis '{axis}', must be 'x' or 'y'")

    # (mm / m) * 1000 = microstrain
    return ((u_plus - u_minus) / baseline_m) * 1000.0


def displacement(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """(ux, uy) horizontal displacement in mm. Ground moves toward the trough centre."""
    # One definition of B, shared with principal_strain, so the two cannot drift apart.
    b_factor = horizontal_displacement_factor(panel, params)
    tilt_x_urad, tilt_y_urad = tilt(x, y, t_days, panel, params)
    # tilt = dS/dx with S positive down, so tilt points toward deeper ground (the trough).
    # tilt is in microradians = 10^-6 rad. B is in m = 1000 mm.
    # displacement in mm = + B * (tilt * 10^-6) * 1000 = + B * tilt * 10^-3
    ux = b_factor * tilt_x_urad * 1e-3
    uy = b_factor * tilt_y_urad * 1e-3
    return ux, uy


def curvature_xy(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
) -> Union[float, np.ndarray]:
    """d2S/dxdy in 1/km (mixed central difference, same 0.1 m step as curvature()).

    Without this component there is no strain tensor, only its diagonal, and therefore no principal
    strain and no crack direction. On the panel centre-line it is ~0 and costs nothing; at the panel
    corners the trough is doubly curved and this term is what rotates the principal axes.
    """
    h = 0.1  # metres, matching curvature() so all three components share one discretisation
    s_pp = subsidence(x + h, y + h, t_days, panel, params)
    s_pm = subsidence(x + h, y - h, t_days, panel, params)
    s_mp = subsidence(x - h, y + h, t_days, panel, params)
    s_mm = subsidence(x - h, y - h, t_days, panel, params)
    # (mm / m^2) = 1/km
    return (s_pp - s_pm - s_mp + s_mm) / (4.0 * h * h)


def horizontal_displacement_factor(panel: PanelGeometry, params: KnotheParams) -> float:
    """B in metres, the Awershin/Knothe proportionality U = B * grad(S).

    Defined once here so displacement() and principal_strain() cannot drift apart.

    B is the ONLY constant in the deformation chain that is not fitted to the Adriyala field data,
    and it cannot be: fitting it needs measured horizontal movement between survey pegs, while
    10.18311/jmmf/2022/32099 reports vertical subsidence only. The literature spread is roughly
    0.3 r to 0.4 r; r / sqrt(2 pi) = 0.3989 r sits at the top of it, and the old sandbox used 0.35 r.
    Horizontal strain — and therefore every crack width downstream — is LINEAR in B, so that spread
    is a ~14 % systematic on all of it. cracks.width_sensitivity() exists to report that band rather
    than let a single crack width look more certain than it is.
    """
    r = panel.depth_m / params.tan_beta
    return r / np.sqrt(2.0 * np.pi)


def principal_strain(
    x: Union[float, np.ndarray],
    y: Union[float, np.ndarray],
    t_days: float,
    panel: PanelGeometry,
    params: KnotheParams,
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray], Union[float, np.ndarray]]:
    """(e1, e2, theta_deg): principal horizontal strains in microstrain and the direction of e1.

    With U = B grad(S), the horizontal strain tensor is eps_ij = B * d2S/dx_i dx_j, i.e. B times the
    curvature tensor. So the principal strains are B times the principal curvatures and no separate
    differentiation of the displacement field is needed.

    e1 is the MAJOR principal strain (most tensile), e2 the minor, and theta_deg the direction of e1
    measured counter-clockwise from +x. Positive = tension, matching strain(). A surface crack opens
    perpendicular to e1, so theta_deg + 90 is the crack's own bearing.

    Units: curvature() returns 1/km = mm/m^2. B is in metres. B [m] * curv [mm/m^2] = mm/m = 1e3
    microstrain, hence the 1e3 factor, which matches strain()'s (mm/m) * 1000 convention.
    """
    b = horizontal_displacement_factor(panel, params)
    cxx, cyy = curvature(x, y, t_days, panel, params)
    cxy = curvature_xy(x, y, t_days, panel, params)

    exx = b * cxx * 1.0e3
    eyy = b * cyy * 1.0e3
    exy = b * cxy * 1.0e3

    mean = 0.5 * (exx + eyy)
    diff = 0.5 * (exx - eyy)
    radius = np.sqrt(diff * diff + exy * exy)
    e1 = mean + radius
    e2 = mean - radius
    # Mohr's circle: tan(2 theta) = 2 exy / (exx - eyy); arctan2 picks the branch giving the MAJOR axis.
    theta_deg = np.degrees(0.5 * np.arctan2(2.0 * exy, exx - eyy))
    return e1, e2, theta_deg
