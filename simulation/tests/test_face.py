"""Travelling longwall face in the Knothe surface (step P2)."""

import time

import numpy as np

from sandbox import surface
from sandbox.constants import A_SUBS, FACE_START_Y_M, L_PANEL_M, M_SEAM_M

X, Y = surface.grid()
A_M = A_SUBS * M_SEAM_M


def test_day_zero_is_all_zero():
    for name, field in surface.channels(X, Y, 0.0).items():
        assert not np.any(field), name
    assert not np.any(surface.S(X, Y, 0.0))


def test_peak_grows_monotonically():
    peaks = [surface.S(X, Y, float(d)).max() for d in range(0, 366)]
    assert all(b >= a for a, b in zip(peaks, peaks[1:]))
    assert peaks[-1] > peaks[0]


def test_face_travels_south_to_north():
    s = surface.S(X, Y, 60.0)
    assert s[Y < 0].mean() > s[Y > 0].mean()


def test_settled_peak_matches_t47():
    peak = surface.S(X, Y, 1e6).max()
    assert abs(peak - 1.9971) / 1.9971 < 0.005


def test_bowl_profiles_reproduce_downsampled_s():
    for t in (0.0, 30.0, 60.0, 200.0, 1e6):
        px, py = surface.bowl_profiles(t)
        assert px.shape == py.shape == (121,)
        np.testing.assert_allclose(
            np.outer(py, px) * A_M, surface.channels(X, Y, t)["s"][::2, ::2], atol=1e-9
        )


def test_face_y():
    assert surface.face_y(-5.0) == FACE_START_Y_M
    assert surface.face_y(0.0) == FACE_START_Y_M
    assert surface.face_y(10.0) == FACE_START_Y_M + 50.0
    assert surface.face_y(1e6) == L_PANEL_M / 2.0


def test_channels_30_is_fast():
    surface.channels(X, Y, 30.0)
    t0 = time.perf_counter()
    for _ in range(50):
        surface.channels(X, Y, 30.0)
    assert (time.perf_counter() - t0) / 50 < 5e-3
