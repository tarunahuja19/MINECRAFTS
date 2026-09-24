"""T5 — derived fields (WP9 §4). The sign/accuracy gate is tests/gates/test_l5.py."""

import numpy as np
import pytest

from lab.fields import derive_fields
from lab.snapshot import load_snapshot


def test_integer_grid_is_refused(run_dir, mid_day):
    """The whole point of the rule: an int grid must raise, not return plausible-looking numbers."""
    snap = load_snapshot(run_dir, mid_day)
    with pytest.raises(TypeError, match="float surface"):
        derive_fields(snap.s_mm, snap.grid.cell_m, snap.cfg)


def test_shapes_and_magnitude(run_dir, mid_day):
    snap = load_snapshot(run_dir, mid_day)
    f = derive_fields(snap.s_model_mm, snap.grid.cell_m, snap.cfg)
    for a in (f.tilt_x_mm_per_m, f.tilt_y_mm_per_m, f.curv_x_per_km, f.strain_x_mm_per_m):
        assert a.shape == snap.grid.shape and np.all(np.isfinite(a))
    assert np.all(f.tilt_mag_mm_per_m >= 0)
    assert f.tilt_mag_mm_per_m.max() == pytest.approx(
        np.hypot(f.tilt_x_mm_per_m, f.tilt_y_mm_per_m).max())


def test_flat_ground_has_no_tilt_or_strain(run_dir):
    snap = load_snapshot(run_dir, 0.0)
    f = derive_fields(np.zeros(snap.grid.shape, dtype=float), snap.grid.cell_m, snap.cfg)
    assert np.allclose(f.tilt_x_mm_per_m, 0) and np.allclose(f.strain_y_mm_per_m, 0)


def test_a_constant_slope_is_pure_tilt(run_dir):
    """A plane sinking 1 mm per metre toward +x: tilt_x = -1 mm/m everywhere, no curvature, no strain."""
    snap = load_snapshot(run_dir, 0.0)
    X, _ = snap.grid.centres()
    f = derive_fields(X.astype(float), snap.grid.cell_m, snap.cfg)
    assert np.allclose(f.tilt_x_mm_per_m, -1.0)
    assert np.allclose(f.curv_x_per_km, 0.0, atol=1e-9)
    assert np.allclose(f.strain_x_mm_per_m, 0.0, atol=1e-9)
