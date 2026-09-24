"""T5 — the frozen snapshot (WP9 §4)."""

import json
from pathlib import Path

import numpy as np
import pytest

from lab.snapshot import load_snapshot


def test_replay_matches_the_simulator_own_replay(run_dir):
    """lab re-implements the delta replay because gate L3 forbids importing minesim.stream.

    Two implementations of the same thing is a standing risk, so assert they agree cell for cell
    rather than assuming it. If this fails the lab is showing a different surface from the run.
    """
    from minesim.stream import replay_terrain          # test-only import; L3 scans lab/, not tests/
    snap = load_snapshot(run_dir, 0.0)
    for day in (0.0, snap_days(run_dir) / 2, snap_days(run_dir)):
        s = load_snapshot(run_dir, day)
        z_wp3 = replay_terrain(run_dir, s.epoch)
        assert np.array_equal(s.z0_mm - s.s_mm, z_wp3), f"day {day}: lab replay differs from WP3 replay"


def snap_days(run_dir) -> float:
    return float(json.loads((Path(run_dir) / "run_summary.json").read_text())["days"])


def test_model_surface_agrees_with_the_world_grid(run_dir, mid_day):
    """s_model_mm (float, used for every derivative) must describe the same ground as the int grid."""
    snap = load_snapshot(run_dir, mid_day)
    worst = float(np.max(np.abs(snap.s_model_mm - snap.s_mm.astype(float))))
    assert worst <= snap.lab.world_model_tolerance_mm, f"world vs model worst {worst:.3f} mm"
    print(f"\nday {mid_day}: worst |s_model - s_world| = {worst:.3f} mm "
          f"(tolerance {snap.lab.world_model_tolerance_mm})")


def test_day_beyond_the_run_is_refused(run_dir):
    with pytest.raises(ValueError, match="outside the run"):
        load_snapshot(run_dir, snap_days(run_dir) + 1)
    with pytest.raises(ValueError, match="outside the run"):
        load_snapshot(run_dir, -1)


def test_subsidence_is_positive_down_and_grows(run_dir, mid_day):
    early, late = load_snapshot(run_dir, mid_day / 2), load_snapshot(run_dir, mid_day)
    assert early.s_mm.min() >= 0 and late.s_mm.min() >= 0, "s_mm is positive DOWN; it never goes negative"
    assert late.s_mm.max() > early.s_mm.max(), "the trough must deepen as the face advances"


def test_grid_centres_match_the_world_convention(run_dir):
    snap = load_snapshot(run_dir, 0.0)
    X, Y = snap.grid.centres()
    assert X.shape == snap.grid.shape == snap.s_mm.shape
    assert X[0, 0] == pytest.approx(snap.grid.origin_x_m + snap.grid.cell_m / 2)
    assert Y[0, 0] == pytest.approx(snap.grid.origin_y_m + snap.grid.cell_m / 2)


def test_face_never_passes_the_end_of_the_panel(run_dir):
    snap = load_snapshot(run_dir, snap_days(run_dir))
    assert snap.face_x_m <= snap.cfg.panel.length_m


def test_nothing_is_written_to_the_run(run_dir, mid_day):
    """WP9 §1: the lab is read-only over the run. Cheap direct check (gate L1 is the full sha256 sweep)."""
    before = {p: p.stat().st_mtime_ns for p in Path(run_dir).iterdir() if p.is_file()}
    load_snapshot(run_dir, mid_day)
    after = {p: p.stat().st_mtime_ns for p in Path(run_dir).iterdir() if p.is_file()}
    assert before == after
