"""W1 — panel edge collapse (WP9 §5 row 3). Acceptance cases (e)-(g) from steps/W1."""

import numpy as np
import pytest

from lab.events import EVENTS
from lab.fields import derive_fields
from lab.snapshot import load_snapshot

EVENT = "edge_collapse"


@pytest.fixture(scope="module")
def snap300(run_dir, mid_day):
    return load_snapshot(run_dir, mid_day)


@pytest.fixture(scope="module")
def x_behind(snap300):
    """Half way from the panel start to the face: well over extracted coal, so the rib can fail.

    On the 690-day run at day 300 the face is at 1200 m and this is exactly the 600 m the W1 step
    names, so the spec's case is the one that runs there. Derived rather than hard-coded so a shorter
    run still exercises the event instead of silently clicking ground with no coal under it.
    """
    return snap300.face_x_m / 2


def _at(snap, arr, x, y):
    X, Y = snap.grid.centres()
    return float(arr[np.unravel_index(int(np.argmin(np.hypot(X - x, Y - y))), X.shape)])


def test_collapse_on_the_clicked_side_only(snap300, x_behind):
    """(e) clicking the +y rib sinks the +y side and leaves the -y side alone."""
    res = EVENTS[EVENT](snap300, x_behind, 150.0, {"pillar_width_m": 20.0, "length_m": 300.0})
    assert res.possible, res.reason
    near = _at(snap300, res.ds_mm, x_behind, 150.0)
    far = _at(snap300, res.ds_mm, x_behind, -150.0)
    assert near > snap300.lab.min_effect_mm, f"clicked rib only moved {near:.1f} mm"
    assert far < snap300.lab.min_effect_mm, f"the far rib moved {far:.1f} mm and should not have"
    print(f"\n(e) x={x_behind:.0f}: ds at (x, +150) = {near:.1f} mm, at (x, -150) = {far:.1f} mm, "
          f"max {res.ds_mm.max():.1f} mm")


def test_tilt_near_the_failed_rib_increases(snap300, x_behind):
    """(e cont.) the consequence that matters: the ground gets steeper where the pillar went."""
    res = EVENTS[EVENT](snap300, x_behind, 150.0, {"pillar_width_m": 20.0, "length_m": 300.0})
    before = derive_fields(snap300.s_model_mm, snap300.grid.cell_m, snap300.cfg)
    after = derive_fields(snap300.s_model_mm + res.ds_mm, snap300.grid.cell_m, snap300.cfg)
    t0 = _at(snap300, before.tilt_mag_mm_per_m, x_behind, 150.0)
    t1 = _at(snap300, after.tilt_mag_mm_per_m, x_behind, 150.0)
    assert t1 > t0, f"tilt did not increase at the failed rib ({t0:.3f} -> {t1:.3f} mm/m)"
    print(f"\ntilt at ({x_behind:.0f}, +150): {t0:.3f} -> {t1:.3f} mm/m")


def test_click_on_the_centre_line_is_refused(snap300, x_behind):
    """(f) y0 = 0 gives no side to fail on."""
    res = EVENTS[EVENT](snap300, x_behind, 0.0, {})
    assert not res.possible and "nearer one panel edge" in res.reason


def test_ds_is_non_negative(snap300, x_behind):
    res = EVENTS[EVENT](snap300, x_behind, 150.0, {})
    assert np.all(res.ds_mm >= 0)


def test_a_wider_pillar_sinks_more(snap300, x_behind):
    """Monotonic in the input: losing more coal cannot move the ground less."""
    small = EVENTS[EVENT](snap300, x_behind, 150.0, {"pillar_width_m": 10.0, "length_m": 300.0})
    big = EVENTS[EVENT](snap300, x_behind, 150.0, {"pillar_width_m": 40.0, "length_m": 300.0})
    assert big.ds_mm.max() > small.ds_mm.max()
    print(f"\npillar 10 m -> {small.ds_mm.max():.1f} mm, 40 m -> {big.ds_mm.max():.1f} mm")


def test_deterministic(snap300, x_behind):
    """(g)"""
    a = EVENTS[EVENT](snap300, x_behind, 150.0, {"pillar_width_m": 20.0, "length_m": 300.0})
    b = EVENTS[EVENT](snap300, x_behind, 150.0, {"pillar_width_m": 20.0, "length_m": 300.0})
    assert np.array_equal(a.ds_mm, b.ds_mm) and a.reason == b.reason


def test_both_events_are_registered():
    assert set(EVENTS) >= {"sudden_sinking", "edge_collapse"}
