"""The crack event: "what if this ground keeps moving for N more days" (S0 §S2).

The two things that must never break are the cap and the refusal. Without the cap, a large days_ahead
invents subsidence the extracted coal cannot produce. Without the refusal, a click on ground that is
not moving returns a near-zero surface that reads as "it happened, barely" when the truth is "not
here".
"""

import numpy as np
import pytest

from lab.events import EVENTS
from lab.events.base import remaining_capacity
from lab.events.crack import extra_sinking_mm, sinking_rate_mm_per_day

WINDOW_D = 7.0          # config/events/crack.yaml constants.rate_window_days


@pytest.fixture(scope="module")
def near_face(snap):
    """A spot just behind the face at the frozen day — ground that is genuinely moving now."""
    return float(snap.face_x_m) - snap.cfg.r, 0.0


def test_zero_days_ahead_moves_the_ground_exactly_zero(snap, near_face):
    ds = extra_sinking_mm(snap, *near_face, days_ahead=0.0, nearby_radius_m=150.0,
                          window_days=WINDOW_D)
    assert np.count_nonzero(ds) == 0, "no days, no movement — and exactly zero, not nearly"


def test_zero_days_ahead_is_refused_in_plain_words(snap, near_face):
    out = EVENTS["crack"](snap, *near_face, {"days_ahead": 0.0})
    assert not out.possible and "0 days ahead" in out.reason
    assert out.ds_mm is None


def test_the_ground_cannot_sink_past_what_is_left_in_it(snap, near_face):
    """The cap. 3000 days of sinking is not 3000 days of sinking if the trough is nearly finished."""
    capacity, _s_pot = remaining_capacity(snap)
    huge = extra_sinking_mm(snap, *near_face, days_ahead=1e4, nearby_radius_m=snap.cfg.panel.length_m,
                            window_days=WINDOW_D)
    # ds is float32 on the wire, so the cap holds to float32 precision, not float64: compare with a
    # relative tolerance rather than an absolute one, or a 1e-18 cell fails on its last bit.
    assert np.all(np.asarray(huge, dtype=np.float64) <= capacity * (1 + 1e-6) + 1e-6)
    assert float(np.max(huge)) == pytest.approx(float(np.max(capacity)), rel=0.05)


def test_more_days_never_means_less_sinking(snap, near_face):
    small = extra_sinking_mm(snap, *near_face, days_ahead=10.0, nearby_radius_m=150.0, window_days=WINDOW_D)
    large = extra_sinking_mm(snap, *near_face, days_ahead=60.0, nearby_radius_m=150.0, window_days=WINDOW_D)
    assert np.all(np.asarray(large, dtype=np.float64) >= np.asarray(small, dtype=np.float64) - 1e-6)


def test_ground_that_is_not_moving_is_refused_with_its_own_numbers(snap):
    """Far ahead of the face nothing is sinking yet, so there is no rate to carry forward."""
    ahead = snap.cfg.panel.length_m + 2 * snap.cfg.r
    out = EVENTS["crack"](snap, ahead, 0.0, {"days_ahead": 30.0})
    assert not out.possible
    assert "not moving now" in out.reason
    assert "mm/day" in out.reason, "a refusal has to carry the number it refused on"


def test_a_spot_behind_the_face_can_carry_on_sinking(snap, near_face):
    out = EVENTS["crack"](snap, *near_face, {"days_ahead": 30.0})
    assert out.possible, out.reason
    assert float(np.max(out.ds_mm)) >= snap.lab.min_effect_mm
    assert "mm/day" in out.reason and "30 more days" in out.reason


def test_the_same_request_twice_gives_the_same_ground(snap, near_face):
    """Gate L2 in miniature: a scenario that is not reproducible cannot be quoted."""
    a = EVENTS["crack"](snap, *near_face, {"days_ahead": 30.0})
    b = EVENTS["crack"](snap, *near_face, {"days_ahead": 30.0})
    assert np.array_equal(a.ds_mm, b.ds_mm) and a.reason == b.reason


def test_the_rate_is_measured_over_a_window_not_an_instant(snap):
    """A one-day difference on a grid that rounds to whole millimetres is mostly rounding."""
    rate, window = sinking_rate_mm_per_day(snap, WINDOW_D)
    assert window == pytest.approx(min(WINDOW_D, snap.day))
    assert float(np.max(rate)) > 0, "somewhere on a live panel the ground is sinking"
    # Sinking is positive down, and the trough only deepens, so no cell can have a negative rate.
    assert float(np.min(rate)) >= -1e-9


def test_at_day_zero_there_is_nothing_to_carry_forward(run_dir):
    from lab.snapshot import load_snapshot
    start = load_snapshot(run_dir, 0.0)
    out = EVENTS["crack"](start, start.cfg.panel.length_m / 2, 0.0, {"days_ahead": 30.0})
    assert not out.possible and "start of the run" in out.reason


def test_an_out_of_range_parameter_is_refused_not_clamped(snap, near_face):
    with pytest.raises(ValueError) as e:
        EVENTS["crack"](snap, *near_face, {"days_ahead": 10_000.0})
    assert "days_ahead" in str(e.value)


def test_the_event_is_confined_to_its_zone_with_a_soft_edge(snap, near_face):
    """P1's finding, restated for the new event: a zone must not add a cliff of its own."""
    from lab.zones import confine_to_zone, zone_by_id, zones_for
    zone = min((z for z in zones_for(snap.cfg, snap.grid) if z.index is not None),
               key=lambda z: abs(z.centre_m[0] - near_face[0]))
    out = confine_to_zone(EVENTS["crack"](snap, *zone.centre_m, {"days_ahead": 30.0}), zone, snap)
    if not out.possible:
        pytest.skip(out.reason)
    ds = np.asarray(out.ds_mm, dtype=np.float64)
    X, _Y = snap.grid.centres()
    far = np.abs(X - zone.centre_m[0]) > (zone.x1_m - zone.x0_m) / 2 + 2 * snap.cfg.r
    assert out.zone_id == zone.id
    assert np.all(ds[far] == 0.0), "the event leaks past the zone and its fade"
