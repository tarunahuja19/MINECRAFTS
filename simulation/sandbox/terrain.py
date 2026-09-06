"""
Static baseline ground elevation Z0(x,y) for the subsidence sandbox.

This is the shape of the hill BEFORE any mining subsidence: a gentle planar
slope plus low-amplitude, spatially-smooth noise, evaluated over the
600x600 m window centred on the panel centre (see `constants.WINDOW_SIZE_M`).
Units are metres throughout, both for the (x, y) coordinates and for the
elevation Z0.

Z0 is completely independent of subsidence. It must never import
`surface.py` and must not know anything about the extraction footprint or
the Knothe bowl — subsidence is subtracted from this baseline later, by a
different module. Keeping the two separate means the "before" terrain can
be regenerated (different seed, different slope) without touching the
physics of "after".

Determinism: `baseline_grid` draws all of its randomness from a single
`numpy.random.default_rng(seed)` instance, never the global `np.random`
state, so the same seed reproduces a bit-identical Z0 in any process and a
different seed reproduces a different one. The full noise field is drawn in
one call (`rng.standard_normal(size=(n, n))`), matching the parent project's
Rule 5 (`../filess/01-sensors-and-formulas.md:296`): generate the whole
field in one draw, then use it whole, so that a run assembled from pieces
is byte-identical to a run computed in one go.
"""

import numpy as np
from scipy.ndimage import gaussian_filter

from sandbox.constants import GRID_N, WINDOW_SIZE_M

# Default seed for a reproducible baseline terrain when the caller does not
# care which one they get.
DEFAULT_SEED = 0

# Smoothing: convolve the raw per-pixel Gaussian noise field with an
# isotropic Gaussian filter (scipy.ndimage.gaussian_filter), chosen over a
# low-order Fourier synthesis because it is a single, well-understood knob
# (correlation length in metres) and needs no explicit choice of which
# modes to keep. Grid spacing is WINDOW_SIZE_M / (GRID_N - 1) = 2.5 m, so a
# correlation length of ~75 m (mid-range of the requested 50-100 m) is
# sigma = 75 / 2.5 = 30 grid cells.
_CORRELATION_LENGTH_M = 75.0
_CELL_SIZE_M = WINDOW_SIZE_M / (GRID_N - 1)
_SIGMA_CELLS = _CORRELATION_LENGTH_M / _CELL_SIZE_M

# Target peak-to-peak amplitude for the noise component alone, in metres.
# gaussian_filter substantially shrinks the standard deviation of a random
# field (smoothing averages out variance), so the filtered field is
# measured and rescaled to this target explicitly rather than trusting the
# pre-filter sigma to survive. Combined with the slope's rise, this keeps
# total Z0 relief comfortably under the 2 m budget (peak subsidence is
# 1.9971 m) while staying clear of zero.
_NOISE_PTP_TARGET_M = 0.9

# Total rise of the planar slope across the full window, in metres — a
# fraction of a percent grade over 600 m.
_SLOPE_RISE_M = 1.0


def baseline_grid(
    seed: int = DEFAULT_SEED, n: int = GRID_N
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (X, Y, Z0), each of shape (n, n).

    X, Y are meshgrid coordinate arrays in metres over the window centred
    on the panel centre, i.e. each spans [-WINDOW_SIZE_M/2, WINDOW_SIZE_M/2].
    Z0 is the static baseline elevation in metres: a gentle planar slope
    plus smoothed, low-amplitude noise. Deterministic given `seed` — equal
    seeds give bit-identical Z0, different seeds give different Z0.
    """
    half = WINDOW_SIZE_M / 2.0
    axis = np.linspace(-half, half, n)
    X, Y = np.meshgrid(axis, axis)

    # Gentle planar slope: total rise of _SLOPE_RISE_M across the window,
    # oriented along x. sqrt(2)/2 factor spreads the same total rise across
    # the diagonal so the gradient is shared between x and y rather than
    # doubled up.
    slope_grad = _SLOPE_RISE_M / WINDOW_SIZE_M
    slope = slope_grad * (X + Y) / np.sqrt(2.0)

    # Smooth noise: one full-field draw from a seeded Generator (never the
    # global np.random state), then Gaussian-smoothed for spatial
    # correlation, then rescaled to the target amplitude.
    rng = np.random.default_rng(seed)
    raw_noise = rng.standard_normal(size=(n, n))
    smoothed = gaussian_filter(raw_noise, sigma=_SIGMA_CELLS, mode="reflect")
    smoothed -= smoothed.mean()
    current_ptp = np.ptp(smoothed)
    noise = smoothed * (_NOISE_PTP_TARGET_M / current_ptp)

    Z0 = slope + noise
    return X, Y, Z0
