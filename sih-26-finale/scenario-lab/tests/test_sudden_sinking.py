"""W1 — sudden sinking (WP9 §5 row 1). Acceptance cases (a)-(d), (g) from steps/W1."""

import numpy as np
import pytest

from lab.events import EVENTS
from lab.snapshot import load_snapshot

EVENT = "sudden_sinking"


@pytest.fixture(scope="module")
def snap300(run_dir, mid_day):
    return load_snapshot(run_dir, mid_day)


def test_behind_the_face_it_is_possible(snap300):
    """(a) 10 m behind the face: coal is out, the ground has not finished settling, so it can drop."""
    x0 = snap300.face_x_m - 10.0
    res = EVENTS[EVENT](snap300, x0, 0.0, {})
    assert res.possible, res.reason
    X, Y = snap300.grid.centres()
    here = np.unravel_index(int(np.argmin(np.hypot(X - x0, Y))), X.shape)
    assert res.ds_mm[here] > 0
    print(f"\n(a) day {snap300.day} at x={x0:.0f}: max ds {res.ds_mm.max():.1f} mm, "
          f"at the click {res.ds_mm[here]:.1f} mm — {res.reason}")


SETTLED_CASE_MIN_DAYS = 690      # the W1 step names day 690 at x = 100; settling needs that long


def test_settled_ground_is_refused(run_dir):
    """(b) far behind the face at the end of the run there is nothing left to give.

    Needs the real 690-day run: the Knothe time factor at c = 0.02358/day takes hundreds of days to
    finish, so on a short run x = 100 is still moving and the event is correctly possible. Skipped
    rather than weakened, because the assertion only means something once the ground has settled.
    """
    if _days(run_dir) < SETTLED_CASE_MIN_DAYS:
        pytest.skip(f"needs a run of at least {SETTLED_CASE_MIN_DAYS} days; this one is {_days(run_dir):.0f}")
    snap = load_snapshot(run_dir, _days(run_dir))
    res = EVENTS[EVENT](snap, 100.0, 0.0, {})
    assert not res.possible
    assert "already settled" in res.reason
    print(f"\n(b) {res.reason}")


def test_ground_ahead_of_the_face_is_refused(snap300):
    """(c) 300 m ahead of the face no coal has been taken, so there is nothing to collapse into."""
    x0 = snap300.face_x_m + 300.0
    res = EVENTS[EVENT](snap300, x0, 0.0, {})
    assert not res.possible
    assert "no extracted coal" in res.reason
    print(f"\n(c) x={x0:.0f}: {res.reason}")


def test_ds_is_non_negative_and_dies_out_beyond_the_taper(snap300):
    """(d) the event only ever sinks ground, and only within R + r of the click."""
    radius = 60.0
    x0 = snap300.face_x_m - 10.0
    res = EVENTS[EVENT](snap300, x0, 0.0, {"collapse_radius_m": radius})
    assert res.possible
    assert np.all(res.ds_mm >= 0), "a collapse never lifts the ground"
    X, Y = snap300.grid.centres()
    d = np.hypot(X - x0, Y)
    beyond = d > radius + snap300.cfg.r
    assert np.all(res.ds_mm[beyond] == 0), "ds must be exactly zero past the taper"


def test_never_exceeds_the_remaining_capacity(snap300):
    """The cap that stops the event inventing subsidence: ds <= U, so the final trough is never beaten."""
    from lab.events.base import remaining_capacity
    u, _ = remaining_capacity(snap300)
    res = EVENTS[EVENT](snap300, snap300.face_x_m - 10.0, 0.0, {"collapse_radius_m": 400.0})
    assert res.possible
    assert np.all(res.ds_mm <= u + 1e-3), "ds exceeded the ground's remaining capacity"


def test_deterministic(snap300):
    """(g) same inputs, same arrays — a scenario has to be reproducible to be worth saving."""
    a = EVENTS[EVENT](snap300, snap300.face_x_m - 10.0, 0.0, {"collapse_radius_m": 60.0})
    b = EVENTS[EVENT](snap300, snap300.face_x_m - 10.0, 0.0, {"collapse_radius_m": 60.0})
    assert np.array_equal(a.ds_mm, b.ds_mm) and a.reason == b.reason


def test_out_of_range_input_is_refused(snap300):
    with pytest.raises(ValueError, match="outside"):
        EVENTS[EVENT](snap300, snap300.face_x_m - 10.0, 0.0, {"collapse_radius_m": 10000.0})
    with pytest.raises(ValueError, match="unknown parameter"):
        EVENTS[EVENT](snap300, snap300.face_x_m - 10.0, 0.0, {"radius": 60.0})


def test_params_used_carries_a_source(snap300):
    res = EVENTS[EVENT](snap300, snap300.face_x_m - 10.0, 0.0, {})
    assert res.params_used["collapse_radius_m"]["source"]
    assert res.params_used["collapse_radius_m"]["unit"] == "m"


def _days(run_dir):
    import json
    from pathlib import Path
    return float(json.loads((Path(run_dir) / "run_summary.json").read_text())["days"])
