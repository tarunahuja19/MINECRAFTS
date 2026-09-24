"""Gate L5 (WP9 §8) — derive_fields agrees with minesim.physics, and refuses an int array.

This is the gate that stops the lab quietly inventing its own ground mechanics: the fields it draws must
be the same fields the simulator computes, to within the difference between np.gradient on a 5 m grid
and physics' own 10 cm central differences.
"""

import numpy as np
import pytest

from minesim import physics

from lab.fields import derive_fields
from lab.snapshot import load_snapshot

MM_PER_M_TO_MICRO = 1000        # physics.tilt is microradians, physics.strain microstrain; lab uses mm/m
TOLERANCE_FRACTION = 0.03       # WP9 §8: within 3 % where the signal is meaningful
TILT_FLOOR_MM_PER_M = 0.5        # mm/m — below this the tilt signal is not worth comparing
CURVATURE_FLOOR_FRACTION = 0.1   # compare curvature only above a tenth of its peak (zero crossings)


def test_int_array_raises_type_error(run_dir, mid_day):
    snap = load_snapshot(run_dir, mid_day)
    with pytest.raises(TypeError):
        derive_fields(snap.s_mm, snap.grid.cell_m, snap.cfg)
    with pytest.raises(TypeError):
        derive_fields(np.zeros(snap.grid.shape, dtype=np.int32), snap.grid.cell_m, snap.cfg)


def test_tilt_matches_minus_physics_tilt(run_dir, mid_day):
    snap = load_snapshot(run_dir, mid_day)
    f = derive_fields(snap.s_model_mm, snap.grid.cell_m, snap.cfg)
    X, Y = snap.grid.centres()
    px, py = physics.tilt(X, Y, snap.day, snap.cfg.panel, snap.cfg.knothe)
    # physics.tilt is dS/dx in microradians; lab tilt is -dS/dx in mm/m.
    want_x, want_y = -np.asarray(px) / MM_PER_M_TO_MICRO, -np.asarray(py) / MM_PER_M_TO_MICRO
    for got, want, name in ((f.tilt_x_mm_per_m, want_x, "tilt_x"), (f.tilt_y_mm_per_m, want_y, "tilt_y")):
        big = np.abs(want) > TILT_FLOOR_MM_PER_M        # only where the signal means anything
        assert big.any(), f"{name}: no cell above the {TILT_FLOOR_MM_PER_M} mm/m floor to compare"
        rel = np.abs(got[big] - want[big]) / np.abs(want[big])
        assert np.max(rel) < TOLERANCE_FRACTION, f"{name}: worst {100 * np.max(rel):.2f}% over {big.sum()} cells"
        print(f"\n{name}: worst {100 * np.max(rel):.2f}% over {big.sum()} cells above {TILT_FLOOR_MM_PER_M} mm/m")


def test_curvature_matches_minus_physics_curvature(run_dir, mid_day):
    snap = load_snapshot(run_dir, mid_day)
    f = derive_fields(snap.s_model_mm, snap.grid.cell_m, snap.cfg)
    X, Y = snap.grid.centres()
    cx, cy = physics.curvature(X, Y, snap.day, snap.cfg.panel, snap.cfg.knothe)
    for got, want, name in ((f.curv_x_per_km, -np.asarray(cx), "curv_x"), (f.curv_y_per_km, -np.asarray(cy), "curv_y")):
        # Compare only where curvature is a tenth of its peak or more. A RELATIVE tolerance is meaningless
        # near a zero crossing (the trough has two), where |want| -> 0 and any absolute difference blows the
        # ratio up. Measured 17 Sep: above this mask worst 2.0 %, median 0.5 %; over the whole grid the
        # worst is 13 % and every one of those cells sits on a zero crossing.
        big = np.abs(want) > CURVATURE_FLOOR_FRACTION * np.abs(want).max()
        rel = np.abs(got[big] - want[big]) / np.abs(want[big])
        assert np.max(rel) < TOLERANCE_FRACTION, f"{name}: worst {100 * np.max(rel):.2f}%"
        print(f"\n{name}: worst {100 * np.max(rel):.2f}%, median {100 * np.median(rel):.2f}% "
              f"over {big.sum()} cells above a tenth of peak curvature")


def test_strain_signs_match_the_physics_convention(run_dir, mid_day):
    """+ = tension outside the rib, - = compression over the trough floor (WP9 §8)."""
    snap = load_snapshot(run_dir, mid_day)
    f = derive_fields(snap.s_model_mm, snap.grid.cell_m, snap.cfg)
    _, Y = snap.grid.centres()
    half_w = snap.cfg.panel.width_m / 2
    # a column of cells in x where the trough is well developed
    i = int(np.argmax(snap.s_model_mm.max(axis=1)))
    y_line, strain_line = Y[i], f.strain_y_mm_per_m[i]
    floor = np.abs(y_line) < half_w / 2
    outside = np.abs(y_line) > half_w + snap.cfg.r / 2
    assert strain_line[floor].mean() < 0, "trough floor must be in compression"
    assert strain_line[outside].max() > 0, "ground beyond the rib must be in tension"
    print(f"\nstrain_y on the deepest section: floor mean {strain_line[floor].mean():.3f} mm/m, "
          f"outside max {strain_line[outside].max():.3f} mm/m")
