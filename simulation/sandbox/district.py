"""The real-anchored ground: a 3-panel district on the Adriyala LW1 fit (plan step G1).

This is a second, independent implementation of S(x, y, t) inside `simulation/sandbox/` --
`surface.py` already carries invariant I1 ("the only S(x,y,t)" is scoped to that module's own
docstring, not to the whole sandbox) for the ASSUMED parameter set (a 0.75, tanβ 1.9, m 3.0, face
5 m/d). This module is the team's own fit to 283 digitised Adriyala LW1 survey points
(constants.ADRIYALA_FIT block; DOI 10.18311/jmmf/2022/32099), superposed across three panels so that
all 30 sensing nodes see ground movement over the year: all reach ADVISORY tilt, 27 WARNING (see
docs/plans/2026-09-27-data-365.md Context §3). Wiring it into session.py / forge / the frontend is
step G2, not this one: this module is pure maths with no I/O.

------------------------------------------------------------------------
Vendored from sih-26-finale/mine-sim/src/minesim/physics.py
------------------------------------------------------------------------
The closed-form Knothe subsidence with time lag and inflection-point offset (`_exp_erfc`, the
per-panel loop inside `subsidence()`, lines ~30-145) is copied here near verbatim -- the maths is
unchanged, credited at each function -- because this sandbox is deliberately isolated from the
finale tree (constants.py's module docstring) and does not import it at runtime. Only
`tests/test_district.py` imports finale, and only to cross-check this vendored copy against the
original, skipping if the finale tree is absent.

------------------------------------------------------------------------
Coordinate convention: two mines, two axis conventions
------------------------------------------------------------------------
finale (physics.py): x is ALONG the panel, measured from the starting face (the face advances +x);
y is ACROSS strike (panel.y_offsets_m shifts panels across).

sandbox (surface.py, layout.py): x is ACROSS strike (the panel's width lies along x, centred at
x=0); y is ALONG strike (the face advances +y). This module follows the sandbox convention, so its
public functions accept sandbox (X, Y) exactly like `surface.channels`/`layout.node_positions`.

The two conventions are related by:
    finale_x = sandbox_y - FIT_FACE_START_Y_M
    finale_y = sandbox_x
FIT_FACE_START_Y_M is the fitted-geometry analogue of constants.FACE_START_Y_M: one radius of
influence (of the FITTED r, not the ASSUMED one) south of the window's southern edge, so that at
t=0 nothing inside the window has been undermined.

------------------------------------------------------------------------
Units (matching surface.Channels' docstring)
------------------------------------------------------------------------
s: metres, positive down. tilt_*: dimensionless (m/m). curvature_*: 1/m. displacement_*: metres.
strain_*: dimensionless (m/m), positive = tensile.
"""

import math

import numpy as np
from scipy.special import erf, erfc, erfcx

from sandbox import surface
from sandbox.constants import (
    DISTRICT_PANEL_X_M,
    DISTRICT_START_DAY,
    FIT_A_SUBS,
    FIT_C_KNOTHE,
    FIT_FACE_ADVANCE_M_PER_DAY,
    FIT_FACE_START_Y_M,
    FIT_INFLECTION_OFFSET_M,
    FIT_M_SEAM_M,
    FIT_R_INFL,
    GRID_N,
    L_PANEL_M,
    W_PANEL_M,
    WINDOW_SIZE_M,
)

# ---------------------------------------------------------------------------
# Fitted-geometry constants, derived once (never hand-typed -- same rule as constants.py's own
# derived block). Names mirror physics.subsidence's local variables so the vendored maths below
# reads the same as the source.
# ---------------------------------------------------------------------------

_D = FIT_INFLECTION_OFFSET_M
_V = FIT_FACE_ADVANCE_M_PER_DAY
_C = FIT_C_KNOTHE
_ERF_A = math.sqrt(math.pi) / FIT_R_INFL             # erf profile scale, physics.py's `factor`/`a`
_S_FULL_MM = FIT_A_SUBS * FIT_M_SEAM_M * 1000.0      # fully-settled peak of one panel, mm
_LENGTH_EFF_M = L_PANEL_M - 2.0 * _D                 # effective panel length (Knothe d trims both ends)
_T_STOP_D = _LENGTH_EFF_M / _V                        # days until the effective face stops
_BETA = _C / (2.0 * _V * _ERF_A * _ERF_A)
_W_HALF_M = W_PANEL_M / 2.0 - _D                      # effective half-width
_START_LAG_D = 2.0 * _D / _V                          # the effective face trails the real face by 2d

# Finite-difference step for tilt/curvature: the sandbox grid spacing (2.5 m). Applied as a literal
# step (never np.gradient on a precomputed array) so channels() also works at off-grid points --
# e.g. layout.node_positions(), which do not sit on the 2.5 m grid.
_FD_STEP_M = WINDOW_SIZE_M / (GRID_N - 1)

# Shared 1-D axis (-300..+300 m at 2.5 m spacing): surface.grid()'s own axis, so bowl_terms_px/py
# downsample exactly like surface.bowl_px_wire/bowl_py_wire. Square window, so the same axis serves
# both the across-strike (x) and along-strike (y) samples.
_AXIS_M = surface.grid()[0][0, :]


def _exp_erfc(u: np.ndarray, a: float, beta: float, c: float, v: float) -> np.ndarray:
    """exp(c u / v + c^2 / (4 v^2 a^2)) * erfc(a (u + beta)) without overflow.

    Vendored verbatim from physics.py's `_exp_erfc` (lines ~30-43): for z = a(u+beta) >= 0 the
    exponent collapses so exp(...)*erfc(z) == erfcx(z)*exp(-(a u)^2); for z < 0 the exponent is
    already negative and the direct product is safe.
    """
    z = a * (u + beta)
    pos = z >= 0.0
    out = np.empty(np.broadcast(u, z).shape, dtype=np.float64)
    out[pos] = erfcx(z[pos]) * np.exp(-(a * u[pos]) ** 2)
    exponent = c * u[~pos] / v + (c / (2.0 * v * a)) ** 2
    out[~pos] = np.exp(exponent) * erfc(z[~pos])
    return out


def _f_y(y_arr: np.ndarray, y_centre: float) -> np.ndarray:
    """Transverse (across-strike, finale y) profile factor for one panel centred at y_centre,
    dimensionless. Vendored from physics.subsidence's `f_y` (line ~114)."""
    y_arr = np.asarray(y_arr, dtype=np.float64) - y_centre
    return 0.5 * (erf(_ERF_A * (y_arr + _W_HALF_M)) - erf(_ERF_A * (y_arr - _W_HALF_M)))


def _f_x(x_arr: np.ndarray, t_k: float) -> np.ndarray:
    """Longitudinal (along-panel, finale x) profile factor with the Knothe time lag, dimensionless
    in [0, 1]. Vendored from physics.subsidence's per-panel loop (lines ~122-139): the face moves at
    FIT_FACE_ADVANCE_M_PER_DAY until it stops at the effective panel's far end, settling
    exponentially (FIT_C_KNOTHE) everywhere behind it. `t_k` is this panel's own effective-panel
    time (t_days - start_day - the 2d lag); t_k <= 0 means the face has not started and contributes
    exactly zero.
    """
    x_arr = np.asarray(x_arr, dtype=np.float64)
    if t_k <= 0.0:
        return np.zeros(x_arr.shape, dtype=np.float64)
    t_mined = min(t_k, _T_STOP_D)          # how long the face has been moving
    t_after = max(0.0, t_k - _T_STOP_D)    # how long since the face stopped

    u_face = x_arr - _V * t_mined
    lag_moving = (
        erf(_ERF_A * u_face)
        - np.exp(-_C * t_mined) * erf(_ERF_A * x_arr)
        + _exp_erfc(u_face, _ERF_A, _BETA, _C, _V)
        - np.exp(-_C * t_mined) * _exp_erfc(x_arr, _ERF_A, _BETA, _C, _V)
    )
    decay = np.exp(-_C * t_after)
    lag_face = lag_moving * decay + erf(_ERF_A * (x_arr - _LENGTH_EFF_M)) * (1.0 - decay)
    f_x = 0.5 * (erf(_ERF_A * x_arr) * (1.0 - np.exp(-_C * t_k)) - lag_face)
    return np.clip(f_x, 0.0, 1.0)


def subsidence_mm(
    X: np.ndarray,
    Y: np.ndarray,
    t_days: float,
    y_offsets_m: tuple[float, ...] = DISTRICT_PANEL_X_M,
    start_day_offsets_d: tuple[float, ...] = DISTRICT_START_DAY,
) -> np.ndarray:
    """Total subsidence in millimetres, positive down, at sandbox (X, Y) and day t_days.

    Defaults to the 3-panel district (DISTRICT_PANEL_X_M / DISTRICT_START_DAY). Passing
    `y_offsets_m=(0.0,), start_day_offsets_d=(0.0,)` evaluates LW1 alone, on the panel axis,
    starting at t=0 -- the same convention as finale's `physics.as_single_panel`, and what
    `tests/test_district.py` cross-checks bit-for-bit against finale `physics.subsidence`.

    A district is the linear superposition of its panels' troughs (the standard NCB treatment,
    same as physics.subsidence): panel k is the same trough shifted to its own across-strike centre
    and delayed to its own start day.
    """
    X = np.asarray(X, dtype=np.float64)
    Y = np.asarray(Y, dtype=np.float64)
    x_finale = Y - FIT_FACE_START_Y_M
    y_finale = X
    x_eff = x_finale - _D  # effective-panel x, shared by every panel (physics.py's x_base)

    total_mm = np.zeros(np.broadcast(x_eff, y_finale).shape, dtype=np.float64)
    for y_centre, start_day in zip(y_offsets_m, start_day_offsets_d):
        t_k = t_days - start_day - _START_LAG_D
        if t_k <= 0.0:
            continue  # this face has not started; it adds exactly zero
        f_y = _f_y(y_finale, y_centre)
        f_x = _f_x(x_eff, t_k)
        total_mm = total_mm + np.maximum(0.0, _S_FULL_MM * f_y * f_x)
    return total_mm


def subsidence_m(X: np.ndarray, Y: np.ndarray, t_days: float) -> np.ndarray:
    """Total subsidence in metres, positive down, of the 3-panel district at sandbox (X, Y, t_days)."""
    return subsidence_mm(X, Y, t_days) / 1000.0


def horizontal_displacement_factor() -> float:
    """B in metres, U = B * grad(S) (Awershin/Knothe) -- physics.py's
    `horizontal_displacement_factor`, with the fitted radius of influence: B = FIT_R_INFL / sqrt(2 pi)."""
    return FIT_R_INFL / math.sqrt(2.0 * math.pi)


def channels(X: np.ndarray, Y: np.ndarray, t_days: float) -> dict:
    """S and its Aviershin-relation derivative channels at (X, Y, t_days).

    Same 9 keys as surface.channels: 's' in metres; 'tilt_*' dimensionless (m/m); 'curvature_*' in
    1/m; 'displacement_*' in metres; 'strain_*' dimensionless (m/m, positive = tensile). tilt and
    curvature are central differences of S at +/- _FD_STEP_M (the 2.5 m grid spacing): unlike
    surface.py's convolution kernels, this module's S is already a closed form, so a finite
    difference of it is not approximating a discretised mask -- it is exact to O(h^2).

    This does NOT call subsidence_m five times (once per shifted point): `_f_y` depends only on
    `y_finale` (== sandbox X) and `_f_x` only on `x_eff` (built from sandbox Y), so shifting sandbox
    X by h changes only `_f_y` and shifting sandbox Y by h changes only `_f_x` -- the unshifted
    factor is reused. That halves the special-function calls (erf/erfc/erfcx are the cost here)
    against the naive five-independent-evaluations approach, which is what keeps a 241x241 grid
    under the plan's 50 ms budget.
    """
    h = _FD_STEP_M
    X = np.asarray(X, dtype=np.float64)
    Y = np.asarray(Y, dtype=np.float64)
    y_finale = X              # _f_y's argument
    x_eff = (Y - FIT_FACE_START_Y_M) - _D  # _f_x's argument (physics.py's x_base, shared by all panels)

    shape = np.broadcast(x_eff, y_finale).shape
    zeros = lambda: np.zeros(shape, dtype=np.float64)  # noqa: E731 -- five short-lived accumulators
    s0, s_xp, s_xm, s_yp, s_ym = zeros(), zeros(), zeros(), zeros(), zeros()

    for y_centre, start_day in zip(DISTRICT_PANEL_X_M, DISTRICT_START_DAY):
        t_k = t_days - start_day - _START_LAG_D
        if t_k <= 0.0:
            continue
        fy0 = _f_y(y_finale, y_centre)
        fy_p = _f_y(y_finale + h, y_centre)
        fy_m = _f_y(y_finale - h, y_centre)
        fx0 = _f_x(x_eff, t_k)
        fx_p = _f_x(x_eff + h, t_k)
        fx_m = _f_x(x_eff - h, t_k)

        s0 = s0 + np.maximum(0.0, _S_FULL_MM * fy0 * fx0)
        s_xp = s_xp + np.maximum(0.0, _S_FULL_MM * fy_p * fx0)
        s_xm = s_xm + np.maximum(0.0, _S_FULL_MM * fy_m * fx0)
        s_yp = s_yp + np.maximum(0.0, _S_FULL_MM * fy0 * fx_p)
        s_ym = s_ym + np.maximum(0.0, _S_FULL_MM * fy0 * fx_m)

    s, s_xp, s_xm, s_yp, s_ym = (a / 1000.0 for a in (s0, s_xp, s_xm, s_yp, s_ym))

    tilt_x = (s_xp - s_xm) / (2.0 * h)
    tilt_y = (s_yp - s_ym) / (2.0 * h)
    curvature_x = (s_xp - 2.0 * s + s_xm) / (h * h)
    curvature_y = (s_yp - 2.0 * s + s_ym) / (h * h)

    b = horizontal_displacement_factor()
    return dict(
        s=s,
        tilt_x=tilt_x,
        tilt_y=tilt_y,
        curvature_x=curvature_x,
        curvature_y=curvature_y,
        displacement_x=b * tilt_x,
        displacement_y=b * tilt_y,
        strain_x=b * curvature_x,
        strain_y=b * curvature_y,
    )


def face_positions(t_days: float) -> list[float]:
    """Sandbox y (along strike) of each district panel's real mining face at day t_days, in
    DISTRICT_PANEL_X_M order.

    This is the REAL face (not the 2d-lagged effective face `_f_x` integrates against): it starts at
    finale x=0 on the panel's own start day, advances FIT_FACE_ADVANCE_M_PER_DAY, and is clipped at
    the panel's own far end (L_PANEL_M past its start). NaN before that panel's own start day.
    """
    out = []
    for start_day in DISTRICT_START_DAY:
        dt = t_days - start_day
        if dt <= 0.0:
            out.append(float("nan"))
            continue
        x_face_finale = min(_V * dt, L_PANEL_M)
        out.append(x_face_finale + FIT_FACE_START_Y_M)
    return out


def bowl_terms_px() -> list[list[float]]:
    """Static across-strike profile per district panel, metres (the fully-settled peak `_S_FULL_MM`
    folded in), downsampled x2 to 121 points like surface.bowl_px_wire.

    `bowl_terms_px()[k][ix] * bowl_terms_py(t)[k][iy]`, summed over k, equals
    `channels(...)['s'][::2, ::2][iy, ix]` (tests/test_district.py, check c) -- the same separation
    surface.py's own bowl_profiles()/bowl_px_wire()/bowl_py_wire() use.
    """
    x_axis = _AXIS_M[::2]
    return [
        np.round((_S_FULL_MM / 1000.0) * _f_y(x_axis, y_centre), 5).tolist()
        for y_centre in DISTRICT_PANEL_X_M
    ]


def bowl_terms_py(t_days: float) -> list[list[float]]:
    """Moving along-strike factor per district panel at day t_days, dimensionless, downsampled x2 to
    121 points like surface.bowl_py_wire."""
    y_axis = _AXIS_M[::2]
    x_eff = (y_axis - FIT_FACE_START_Y_M) - _D
    out = []
    for start_day in DISTRICT_START_DAY:
        t_k = t_days - start_day - _START_LAG_D
        out.append(np.round(_f_x(x_eff, t_k), 4).tolist())
    return out
