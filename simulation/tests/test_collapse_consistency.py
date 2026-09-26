"""
P1: the collapse tilt/curvature boost applies only while the pillar is yielding.

After the step completes, delta tilt must be the true slope of delta_s, so a
0.5 m / 100 m Gaussian pit peaks at 0.5 * exp(-0.5) / 100 = 3.03 mm/m.
"""

import numpy as np

from sandbox import surface
from sandbox.collapse import PillarFailure, collapse_deltas

T_INIT, T_COLLAPSE, DURATION = 10.0, 10.5, 0.2


def _event() -> PillarFailure:
    return PillarFailure(
        cx=0.0,
        cy=0.0,
        radius_m=100.0,
        magnitude_m=0.5,
        t_init_days=T_INIT,
        t_collapse_days=T_COLLAPSE,
        duration_days=DURATION,
    )


def _centre_row(t: float):
    X, Y = surface.grid()
    d = collapse_deltas(X, Y, t, [_event()])
    iy = int(np.argmin(np.abs(Y[:, 0])))
    grad = np.gradient(d["delta_s"], 2.5, axis=1)[iy]
    return d, d["delta_tilt_x"][iy], grad


def test_settled_tilt_matches_gradient():
    _, tilt, grad = _centre_row(T_COLLAPSE + DURATION + 1.0)
    mask = np.abs(tilt) > 0.1 * np.abs(tilt).max()
    rel = np.abs(tilt[mask] - grad[mask]) / np.abs(grad[mask])
    assert rel.max() < 0.02


def test_settled_peak_slope():
    d, _, _ = _centre_row(T_COLLAPSE + DURATION + 1.0)
    peak = np.hypot(d["delta_tilt_x"], d["delta_tilt_y"]).max() * 1000.0
    assert abs(peak - 0.5 * np.exp(-0.5) / 100.0 * 1000.0) < 0.05
    assert abs(peak - 3.03) < 0.05


def test_yielding_tilt_still_boosted():
    _, tilt, grad = _centre_row(0.5 * (T_INIT + T_COLLAPSE))
    i = int(np.argmax(np.abs(grad)))
    assert abs(tilt[i]) > 1.5 * abs(grad[i])
