"""Unit tests for minesim.world (WP3)."""

from pathlib import Path

import numpy as np
import pytest

from minesim import physics
from minesim.config import load_config
from minesim.sizing import size_network
from minesim.world import WorldState


@pytest.fixture(scope="module")
def cfg():
    return load_config(Path("config/assumptions.yaml"))


@pytest.fixture(scope="module")
def layout(cfg):
    return size_network(cfg)


def _steps_for_days(cfg, days):
    return int(round(days * 86400.0 / cfg.sim.timestep_s))


def test_t0_flat_and_int32(cfg, layout):
    w = WorldState(cfg, layout)
    assert w.epoch == 0
    assert w.snapshot().dtype == np.int32
    assert not w.snapshot().any()
    assert np.array_equal(w.snapshot(), w.z0_mm)


def test_shape_axes_and_cell_centres(cfg, layout):
    w = WorldState(cfg, layout)
    nx, ny = w.shape
    assert w.snapshot().shape == (nx, ny)
    x_span = nx * w.cell_m
    y_span = ny * w.cell_m
    assert x_span > y_span  # i <-> x runs along the long panel axis
    assert w.origin_x_m + x_span >= cfg.panel.length_m + 2.0 * cfg.r
    assert w.origin_y_m <= -(cfg.panel.width_m / 2.0 + 2.0 * cfg.r)


def test_monotone_dense_epochs_and_matches_model(cfg, layout):
    """Every dz <= 0; epochs dense; grid equals round(physics S) at every checked step."""
    w = WorldState(cfg, layout)
    steps = _steps_for_days(cfg, 30)
    empty_seen = False
    for k in range(1, steps + 1):
        d = w.step()
        assert d.epoch == k
        assert d.t_s == k * cfg.sim.timestep_s
        assert all(dz < 0 for _, _, dz in d.cells)
        empty_seen |= len(d.cells) == 0
        if k % 97 == 0 or k == steps:
            target = np.rint(w.model_subsidence_mm(w.t_days)).astype(np.int32)
            assert np.array_equal(-w.snapshot(), target)
    assert empty_seen, "early steps with no whole-mm movement must still emit a Delta"


def test_no_drift_after_long_run(cfg, layout):
    """Integer targeting cannot drift: max |grid S - round(model S)| <= 1 mm after 120 days."""
    w = WorldState(cfg, layout)
    for _ in range(_steps_for_days(cfg, 120)):
        w.step()
    model = w.model_subsidence_mm(w.t_days)
    assert np.abs(-w.snapshot() - model).max() <= 1.0


def test_z_at_cell_centre_and_between(cfg, layout):
    w = WorldState(cfg, layout)
    for _ in range(_steps_for_days(cfg, 300)):
        w.step()
    z = w.snapshot()
    i, j = 250, 70
    xc = w.origin_x_m + (i + 0.5) * w.cell_m
    yc = w.origin_y_m + (j + 0.5) * w.cell_m
    assert w.z_at(xc, yc) == float(z[i, j])
    mid = w.z_at(xc + w.cell_m / 2.0, yc)
    assert min(z[i, j], z[i + 1, j]) <= mid <= max(z[i, j], z[i + 1, j])


def test_z_at_tracks_physics(cfg, layout):
    w = WorldState(cfg, layout)
    for _ in range(_steps_for_days(cfg, 300)):
        w.step()
    for x, y in ((1000.0, 0.0), (900.0, 150.0), (1250.0, -60.0)):
        s = physics.subsidence(x, y, w.t_days, cfg.panel, cfg.knothe)
        assert abs(-w.z_at(x, y) - s) < 5.0  # cell quantisation + bilinear over 5 m cells


def test_trough_follows_the_face(cfg, layout):
    """The leading edge of subsidence moves with physics.face_position."""
    w = WorldState(cfg, layout)
    x_centres = w.origin_x_m + (np.arange(w.shape[0]) + 0.5) * w.cell_m
    j0 = int((0.0 - w.origin_y_m) / w.cell_m)
    fronts = []
    for days in (100, 200, 300):
        while w.t_days < days:
            w.step()
        sinking = x_centres[-w.snapshot()[:, j0] >= cfg.sensing.detection_threshold_mm]
        fronts.append(sinking.max())
        assert abs(sinking.max() - physics.face_position(days, cfg.knothe)) < 2.0 * cfg.r
    assert fronts[0] < fronts[1] < fronts[2]


def test_no_operator_controls():
    forbidden = ("trigger", "collapse", "inject", "blast", "kill", "deform", "set_z")
    assert not [m for m in dir(WorldState) if any(f in m.lower() for f in forbidden)]
