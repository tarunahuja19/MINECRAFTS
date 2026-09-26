"""
The single subsidence field S(x, y, t) for this sandbox, and its derivative
channels, via the Knothe influence method.

INVARIANT I1 (scoped): within `simulation_making/`, this is the *only*
implementation of S(x, y, t). The parent `sih26` tree has its own, separate
S(x, y, t) at `../ground/surface.py`, used by seven of its own modules
(`pinn/losses.py`, `sim/sensors.py`, `sim/producer.py`, `truth/truth.py`,
`viz/app.py`, `tests/test_ground.py`, `tests/test_sim.py`). That module is
untouched and this one does not import it, call it, or feed it. The two
trees model two different mines (H=150/r=75 there, H=375/r=197.4 here) and
must never be blended — see `constants.py`'s module docstring. Do not delete
`../ground/surface.py` on the grounds that "there can only be one S" — the
single-implementation rule is scoped to this subtree, and this comment is
that scoping stated in code, not left implicit (source plan defect #1).

SIGN CONVENTION: S is subsidence in metres, POSITIVE DOWNWARD (S >= 0),
matching `../ground/surface.py`'s convention. Session D (not built here)
renders ground elevation as `z = terrain.baseline_grid(...)[2] - S`, i.e.
it SUBTRACTS S from the baseline, equivalently rendering
`z = -S * exaggeration` for the subsidence contribution alone.

------------------------------------------------------------------------
Why convolution, not the closed-form erf product
------------------------------------------------------------------------
For an axis-aligned rectangular panel, convolving a 0/1 rectangle mask with
this Gaussian-shaped influence kernel has an exact closed form: a product
of two `erf` profile factors (one per axis) — that is what
`../ground/surface.py` uses, and it is what step 4's target numbers were
independently computed from, as a check.

This module deliberately does NOT take that shortcut. It builds the
extraction footprint as a real 2-D array `A` and convolves it with the
kernel numerically. The reason is that this sandbox's later sessions need:
  - a TRAVELLING extraction face (the mined area grows along the panel
    over simulated time — implemented below), which has no rectangle at
    all, let alone an axis-aligned one;
  - arbitrary / non-rectangular footprints in general.
The erf product cannot represent either. Convolving a mask is the only
form that generalises. Where this module currently builds a fixed
rectangular `A`, that is a *choice of mask*, not a change of method —
swapping in a time-varying or irregular mask later requires no change to
the convolution machinery itself.

------------------------------------------------------------------------
Why derivatives are analytic-kernel convolutions, never finite differences
------------------------------------------------------------------------
`tilt`, `curvature`, `displacement` and `strain` are all built by convolving
the SAME mask `A` with the analytic derivative of the kernel (closed form,
since the kernel is a Gaussian), never by calling `np.gradient` / `np.diff`
on the S grid. Finite-differencing the output would inject truncation error
that looks exactly like a small strain signal — and small strain signals
are the entire thing the downstream detector exists to find. Corrupting
them with numerical artifacts would be silent and would not show up as a
crash; it would show up as a wrong answer sessions later. So the derivative
kernels below are written out symbolically and convolved directly.

------------------------------------------------------------------------
Discretization note: fractional-coverage mask, not a hard 0/1 mask
------------------------------------------------------------------------
A naive `A = 1.0 where inside rectangle else 0.0`, sampled only at cell
centres, has a systematic O(dx) bias versus the continuous integral: at
this grid's dx = 2.5 m it overstates peak subsidence by about 0.4% (2.0051 m
instead of 1.9971 m), because the sharp rectangle edge aliases against the
sampling grid. Halving dx repeatedly (measured: 2.5, 1.25, 0.625, 0.3125 m
gave 2.0051, 2.0011, 1.9991, 1.9981 m) confirms this is an ordinary
discretization artifact converging to the analytic answer, not a modelling
error — but refining the whole simulation grid just to chase it would be
wasteful. Instead each mask cell is given its exact fractional overlap with
the rectangle (1.0 for cells fully inside, 0.0 fully outside, a fraction
for boundary cells the edge cuts through) — i.e. the mask is
antialiased against its own sharp edge before convolving. This reproduces
the continuous convolution to within 0.01% at native dx = 2.5 m (measured),
which is what step 4's gate needs, without any change to the physics.

------------------------------------------------------------------------
Padding and the travelling face
------------------------------------------------------------------------
The mask is separable, A(x, y) = mask_x(x) * mask_y(y), and the panel is
not mined all at once: the longwall face starts at `FACE_START_Y_M` (one
radius of influence south of the window) and advances north at
`FACE_ADVANCE_M_PER_DAY`. `mask_y` is therefore split into one strip per
along-strike grid cell; strip j is mined on day tau_j and settles as
1 - exp(-c*(t - tau_j)). Each strip's 1-D y-profile is convolved with k, dk
and d2k once at import; `channels(t)` is a time-weighted sum of those
profiles times the static x-profile. At t -> infinity this reproduces the
fully-settled bowl (`_BASE_S`).

The kernel is truncated at `_TRUNC_R = 4 * R_INFL` (~789 m) since its tail
is negligible beyond that. The strips live on a grid padded by at least
`_TRUNC_R` on every side and are convolved with an explicit zero
('constant') boundary, so that nothing wraps around or clamps into the
600x600 m window — wrap-around would contaminate the panel edges, which is
exactly where the tensile strain band lives (the part of the field this
sandbox cares about most).

Along y the mined interval runs to the panel's TRUE far end (+L_PANEL_M/2,
well past the window) so the along-strike profile saturates at 1.0 and peak
subsidence is not understated.
"""

from typing import NamedTuple

import numpy as np
from scipy.ndimage import convolve1d

from sandbox.constants import (
    A_SUBS,
    B_HORIZ,
    C_KNOTHE,
    FACE_ADVANCE_M_PER_DAY,
    FACE_START_Y_M,
    GRID_N,
    L_PANEL_M,
    M_SEAM_M,
    R_INFL,
    S_MAX_FULL,
    W_PANEL_M,
    WINDOW_SIZE_M,
)

# Grid spacing, metres per cell, on the WINDOW_SIZE_M x GRID_N simulation
# grid (not the padded working grid used internally for convolution).
_DX_M = WINDOW_SIZE_M / (GRID_N - 1)

# Kernel truncation radius: the source plan requires >= 4r (789 m). Beyond
# this the Gaussian kernel's value is negligible (exp(-16*pi) ~ 1e-22).
_TRUNC_R_M = 4.0 * R_INFL

# Padding, in whole grid cells, applied on every side of the window before
# convolving. Also used to size the along-strike (y) mask extent, since the
# panel already reaches past the window and the mask must reach further
# still to avoid truncating its own tail at the panel's real ends.
_PAD_CELLS = int(np.ceil(_TRUNC_R_M / _DX_M))
_PAD_M = _PAD_CELLS * _DX_M

# The padded working axis: WINDOW_SIZE_M wide plus _PAD_M of margin on each
# side, at the same _DX_M spacing as the public grid, so that convolving on
# this axis and then cropping back to the centre exactly reproduces what
# convolving on an infinite grid would give within the window.
_HALF_WINDOW_M = WINDOW_SIZE_M / 2.0
_N_PADDED = GRID_N + 2 * _PAD_CELLS
_AXIS_PADDED = np.linspace(
    -_HALF_WINDOW_M - _PAD_M, _HALF_WINDOW_M + _PAD_M, _N_PADDED
)

# Slice that crops the padded working grid back down to the public
# GRID_N x GRID_N window.
_CROP = slice(_PAD_CELLS, _PAD_CELLS + GRID_N)


def _fractional_mask_1d(axis: np.ndarray, dx: float, half_width_m: float) -> np.ndarray:
    """Fractional coverage of each grid cell by [-half_width_m, +half_width_m].

    Cell `i` is centred at `axis[i]` with width `dx`. Returns, per cell, the
    fraction of that cell's width lying inside the interval: 1.0 for a cell
    fully inside, 0.0 fully outside, and the exact overlap fraction for a
    cell the boundary cuts through. This antialiases the mask's sharp edge
    against the sampling grid — see the module docstring's discretization
    note for why a hard 0/1 mask is not used.
    """
    cell_lo = axis - dx / 2.0
    cell_hi = axis + dx / 2.0
    overlap = np.minimum(cell_hi, half_width_m) - np.maximum(cell_lo, -half_width_m)
    return np.clip(overlap, 0.0, None) / dx


# Extraction footprint mask, on the padded working grid. Separable in x and
# y: the x factor (W_PANEL_M across strike, centred on the origin) is static;
# the y factor is split into one strip per padded-grid cell, because each
# strip is mined at a different day as the face travels north.
_MASK_X = _fractional_mask_1d(_AXIS_PADDED, _DX_M, W_PANEL_M / 2.0)

# Mined interval along strike: [FACE_START_Y_M, +L_PANEL_M/2]. Per-cell
# fractional coverage (same antialiasing as the x mask) so the start edge is
# not aliased against the grid either. Only cells with coverage > 0 become
# strips.
_Y_MINED_LO_M = FACE_START_Y_M
_Y_MINED_HI_M = L_PANEL_M / 2.0
_STRIP_COVERAGE = np.clip(
    np.minimum(_AXIS_PADDED + _DX_M / 2.0, _Y_MINED_HI_M)
    - np.maximum(_AXIS_PADDED - _DX_M / 2.0, _Y_MINED_LO_M),
    0.0,
    None,
) / _DX_M
_STRIP_IDX = np.flatnonzero(_STRIP_COVERAGE > 0.0)
_STRIP_Y_M = _AXIS_PADDED[_STRIP_IDX]

# Day on which each strip is mined: the face reaches y_j at tau_j. A strip
# whose centre lies just south of FACE_START_Y_M (partial start-edge cell) is
# clamped to day 0 so that nothing has subsided at t = 0.
_STRIP_TAU_DAYS = np.maximum((_STRIP_Y_M - FACE_START_Y_M) / FACE_ADVANCE_M_PER_DAY, 0.0)


def _kernel_1d(dx: float, r: float, trunc_r: float) -> np.ndarray:
    """Discrete, dx-normalised influence kernel k(x) = (1/r)*exp(-pi*x^2/r^2).

    Sampled at cell centres out to +/- `trunc_r`, then rescaled so that
    `sum(k) * dx == 1` (the discrete analogue of `integral(k) dx == 1`).
    Kernel truncation and normalisation are kept in this one function so
    every derivative kernel below shares the same dx convention.
    """
    n = int(np.ceil(trunc_r / dx))
    x = np.arange(-n, n + 1) * dx
    k = (1.0 / r) * np.exp(-np.pi * x**2 / r**2)
    k *= 1.0 / (k.sum() * dx)
    return k, x


_K, _KX = _kernel_1d(_DX_M, R_INFL, _TRUNC_R_M)

# Derivative kernels: analytic d/dx and d^2/dx^2 of the (unnormalised)
# Gaussian influence function, sampled on the same _KX points and then
# divided by the SAME normalisation constant used for _K (not renormalised
# on their own — a derivative kernel sums to ~0, so normalising it to sum
# to 1 is meaningless; it must instead carry the same dx-consistent scale
# as _K so that d(_K)/dx and _K stay a matched pair under convolution).
_K_UNNORM = (1.0 / R_INFL) * np.exp(-np.pi * _KX**2 / R_INFL**2)
_NORM = 1.0 / (_K_UNNORM.sum() * _DX_M)
_DK = (-2.0 * np.pi * _KX / R_INFL**3) * np.exp(-np.pi * _KX**2 / R_INFL**2) * _NORM
_D2K = (
    (2.0 * np.pi / R_INFL**3)
    * (2.0 * np.pi * _KX**2 / R_INFL**2 - 1.0)
    * np.exp(-np.pi * _KX**2 / R_INFL**2)
    * _NORM
)

# convolve1d wants weights pre-multiplied by the quadrature weight dx (a
# discrete convolution sum approximates the continuous integral
# integral(A(x')*k(x-x')) dx' as dx * sum(A[j]*k[i-j])).
_K_WEIGHTS = _K * _DX_M
_DK_WEIGHTS = _DK * _DX_M
_D2K_WEIGHTS = _D2K * _DX_M


def _strip_profiles(weights: np.ndarray) -> np.ndarray:
    """Each strip's 1-D y-profile: the strip (a one-cell-wide slice of the
    y mask, scaled by its fractional coverage) convolved along y with the
    1-D kernel `weights`, cropped to the public window. Shape
    (n_strips, GRID_N). 'constant' boundary with cval=0 is exact here (mined
    area outside the padded domain is genuinely zero) and is what makes the
    >= 4r padding meaningful rather than silently wrapping or clamping.
    """
    strips = np.zeros((_STRIP_IDX.size, _N_PADDED))
    strips[np.arange(_STRIP_IDX.size), _STRIP_IDX] = _STRIP_COVERAGE[_STRIP_IDX]
    return convolve1d(strips, weights, axis=1, mode="constant", cval=0.0)[:, _CROP]


def _x_profile(weights: np.ndarray) -> np.ndarray:
    """The static across-strike profile: `_MASK_X` convolved along x with
    `weights`, cropped to the public window. Shape (GRID_N,)."""
    return convolve1d(_MASK_X, weights, mode="constant", cval=0.0)[_CROP]


# Precomputed once at import: every convolution the model ever needs. The
# per-strip y-profiles convolve each strip with k, dk and d2k; the x profiles
# do the same for the static x mask. channels(t) is then only a
# time-weighted sum of strip profiles and a handful of outer products — no
# convolution at run time — and every derivative is still the SAME mask
# convolved with the analytic derivative kernel, never a finite difference.
_A_M = A_SUBS * M_SEAM_M
_MY_K = _strip_profiles(_K_WEIGHTS)
_MY_DK = _strip_profiles(_DK_WEIGHTS)
_MY_D2K = _strip_profiles(_D2K_WEIGHTS)
_PX_K = _x_profile(_K_WEIGHTS)
_PX_DK = _x_profile(_DK_WEIGHTS)
_PX_D2K = _x_profile(_D2K_WEIGHTS)

# The fully-settled (t -> infinity) subsidence field: every strip mined and
# fully settled. Still used by server.py's /config and hypsometry.
_BASE_S = _A_M * np.outer(_MY_K.sum(axis=0), _PX_K)


def grid() -> tuple[np.ndarray, np.ndarray]:
    """Return (X, Y) meshgrid arrays, shape (GRID_N, GRID_N), metres.

    Centred on the panel centre: both x and y range over
    [-WINDOW_SIZE_M/2, +WINDOW_SIZE_M/2].
    """
    axis = _AXIS_PADDED[_CROP]
    X, Y = np.meshgrid(axis, axis)
    return X, Y


def face_y(t: float) -> float:
    """Along-strike position of the longwall face in metres at day `t`:
    FACE_START_Y_M at t <= 0, advancing FACE_ADVANCE_M_PER_DAY, stopping at
    the panel's far end (+L_PANEL_M/2)."""
    return float(
        min(FACE_START_Y_M + FACE_ADVANCE_M_PER_DAY * max(t, 0.0), _Y_MINED_HI_M)
    )


def _strip_weights(t: float) -> np.ndarray:
    """Settlement factor of every strip at day `t`: 1 - exp(-c*(t - tau_j))
    once the face has passed strip j, 0 before (and everywhere for t <= 0)."""
    dt = np.maximum(float(t) - _STRIP_TAU_DAYS, 0.0)
    return 1.0 - np.exp(-C_KNOTHE * dt)


def S(X: np.ndarray, Y: np.ndarray, t: float) -> np.ndarray:
    """Subsidence S(x, y, t) in metres, positive downward.

    `X`, `Y` must be exactly the arrays returned by `grid()`: this is a
    mask-convolution model, evaluated once over the whole fixed simulation
    window, not a pointwise closed form that can be sampled at arbitrary
    coordinates. `X` and `Y` are accepted (rather than just `t`) to keep
    the call signature `S(x, y, t)` matching the parent project's
    `../ground/surface.py` convention and this module's own `channels()`;
    their values are not otherwise used. A caller wanting subsidence at
    off-grid points is out of scope for this sandbox session.

    `t` is elapsed time in days since the face started; `t <= 0` gives
    S == 0 everywhere; large `t` (t >> panel length / face speed + 1/C_KNOTHE,
    e.g. 1e6) approaches `_BASE_S`, the fully-settled bowl, subcritical
    because W_PANEL_M is narrower than a few R_INFL (see constants.py).
    """
    return channels(X, Y, t)["s"]


def bowl_profiles(t: float) -> tuple[np.ndarray, np.ndarray]:
    """The separable bowl at day `t`, downsampled x2 to (GRID_N+1)//2 = 121
    points: `(px, py)` with `outer(py, px) * A_SUBS * M_SEAM_M ==
    channels(...)['s'][::2, ::2]` (indexed [y, x]). `px` is static; `py`
    carries all the time dependence, so a client can hold `px` once and
    redraw the moving bowl from `py` alone.
    """
    return _PX_K[::2].copy(), (_strip_weights(t) @ _MY_K)[::2]


def bowl_px_wire() -> list[float]:
    """Static x profile of the bowl for the 3D views, metres (A_SUBS * M_SEAM_M
    folded in), so `bowl_px[ix] * bowl_py[iy]` is the subsidence at [iy, ix] of
    the x2-downsampled grid."""
    return np.round(_PX_K[::2] * _A_M, 5).tolist()


def bowl_py_wire(t: float) -> list[float]:
    """Moving y factor of the bowl at day `t`, rounded to 1e-4 (0.1 mm once
    multiplied by the ~2 m bowl scale)."""
    return np.round(bowl_profiles(t)[1], 4).tolist()


class Channels(NamedTuple):
    """The subsidence field and its Aviershin-relation derivative channels,
    all evaluated at the same (X, Y, t). Units: `s` in metres; `tilt_*`
    dimensionless (m/m); `curvature_*` in 1/m; `displacement_*` in metres;
    `strain_*` dimensionless (m/m, positive = tensile, negative =
    compressive, matching the sign of curvature since B_HORIZ > 0).
    """

    s: np.ndarray
    tilt_x: np.ndarray
    tilt_y: np.ndarray
    curvature_x: np.ndarray
    curvature_y: np.ndarray
    displacement_x: np.ndarray
    displacement_y: np.ndarray
    strain_x: np.ndarray
    strain_y: np.ndarray


def channels(X: np.ndarray, Y: np.ndarray, t: float) -> dict:
    """Compute S and all derivative channels at once. Returns a dict (also
    accessible as a `Channels` namedtuple's fields) with keys: 's', 'tilt_x', 'tilt_y', 'curvature_x',
    'curvature_y', 'displacement_x', 'displacement_y', 'strain_x',
    'strain_y'.

    Every derivative is a convolution of the SAME mask with the analytic
    derivative of the kernel — never a finite difference of `s`. The kernel
    is separable (k(x,y) = k(x)*k(y)), so e.g. dS/dx is the mask convolved
    with dk/dx along x and with plain k along y. The convolutions were done
    once at import (per along-strike strip); here each field is the outer
    product of the y-profile (time-weighted sum of strip profiles) and the
    static x-profile.
    """
    w = _strip_weights(t)
    sy_k = w @ _MY_K
    sy_dk = w @ _MY_DK
    sy_d2k = w @ _MY_D2K

    s = _A_M * np.outer(sy_k, _PX_K)
    tilt_x = _A_M * np.outer(sy_k, _PX_DK)
    tilt_y = _A_M * np.outer(sy_dk, _PX_K)
    curvature_x = _A_M * np.outer(sy_k, _PX_D2K)
    curvature_y = _A_M * np.outer(sy_d2k, _PX_K)

    return dict(
        s=s,
        tilt_x=tilt_x,
        tilt_y=tilt_y,
        curvature_x=curvature_x,
        curvature_y=curvature_y,
        displacement_x=B_HORIZ * tilt_x,
        displacement_y=B_HORIZ * tilt_y,
        strain_x=B_HORIZ * curvature_x,
        strain_y=B_HORIZ * curvature_y,
    )

