"""Running a real event inside a zone (P1).

The flow Adarsh asked for: pick a zone 1..10 or full, then do it. These tests exercise that path
end to end on a finished run, so the zone plumbing is proved before P3 puts a server in front of it
and P4 puts a page in front of that.
"""

import numpy as np
import pytest

from lab.events.base import EVENTS
from lab.zones import (
    boundary_fade_m,
    confine_to_zone,
    load_zone_config,
    resolve_click,
    zone_by_id,
)

import lab.events.sudden_sinking  # noqa: F401  registers the event


def run_in_zone(snap, zone_id, event="sudden_sinking", params=None):
    zcfg = load_zone_config()
    zone = zone_by_id(zone_id, snap.cfg, snap.grid, zcfg)
    x0, y0 = resolve_click(zone)
    result = EVENTS[event](snap, x0, y0, params or {})
    return zone, confine_to_zone(result, zone, snap, zcfg)


def test_a_zone_alone_is_enough_to_run_an_event(snap):
    """No click given: the zone centre is used, and the result says which zone it was."""
    zone, result = run_in_zone(snap, "5")
    assert result.zone_id == "5"
    assert result.reason, "a result must always explain itself, possible or not"
    if result.possible:
        assert result.ds_mm is not None
        assert result.ds_mm.dtype == np.float32
        assert result.ds_mm.shape == snap.grid.shape


def test_confining_to_a_zone_keeps_the_effect_inside_it(snap):
    """Extra sinking must be confined to the selected zone, fading over the boundary and no further."""
    zcfg = load_zone_config()
    zone, result = run_in_zone(snap, "5")
    if not result.possible:
        pytest.skip(f"zone 5 cannot sink further at this day: {result.reason}")

    from lab.zones import distance_to_zone_m
    X, Y = snap.grid.centres()
    d = distance_to_zone_m(zone, X, Y)
    fade = boundary_fade_m(snap.cfg, zcfg)

    ds = np.asarray(result.ds_mm, dtype=np.float64)
    assert np.all(ds[d > fade] == 0.0), "the event leaked past the zone's fade distance"
    assert float(ds.max()) > snap.lab.min_effect_mm


def test_confining_never_increases_the_effect(snap):
    """The zone weight is in [0, 1], so confining can only ever remove ground movement."""
    zcfg = load_zone_config()
    zone = zone_by_id("5", snap.cfg, snap.grid, zcfg)
    x0, y0 = resolve_click(zone)
    unconfined = EVENTS["sudden_sinking"](snap, x0, y0, {})
    if not unconfined.possible:
        pytest.skip(unconfined.reason)
    confined = confine_to_zone(unconfined, zone, snap, zcfg)
    if not confined.possible:
        return
    assert np.all(np.asarray(confined.ds_mm) <= np.asarray(unconfined.ds_mm) + 1)


def test_the_full_zone_leaves_an_event_untouched(snap):
    """'full' covers the whole grid, so its weight is all ones and confining is a no-op."""
    zcfg = load_zone_config()
    full = zone_by_id(zcfg.full_zone_id, snap.cfg, snap.grid, zcfg)
    x0, y0 = resolve_click(full)
    unconfined = EVENTS["sudden_sinking"](snap, x0, y0, {})
    confined = confine_to_zone(unconfined, full, snap, zcfg)
    assert confined.possible == unconfined.possible
    assert confined.zone_id == zcfg.full_zone_id
    if unconfined.possible:
        assert np.allclose(np.asarray(confined.ds_mm), np.asarray(unconfined.ds_mm))


def test_a_zone_with_nothing_left_to_give_says_so_in_plain_words(snap):
    """Ground the face has not reached, or ground that has finished settling, must refuse with a
    reason a person can read - never with a surface of near-zeros, which reads as 'it happened'."""
    zcfg = load_zone_config()
    last = str(zcfg.n_zones)
    _zone, result = run_in_zone(snap, last)
    if result.possible:
        pytest.skip(f"zone {last} still has capacity at day {snap.day:.0f}")
    assert result.ds_mm is None
    assert result.reason
    assert not result.reason.endswith("."), "reasons are phrases, matching the existing events"


def test_every_zone_either_works_or_explains_itself(snap):
    """No zone may return a silent nothing. This is the sweep a page will make when it lists zones."""
    zcfg = load_zone_config()
    for zid in [str(k) for k in range(1, zcfg.n_zones + 1)] + [zcfg.full_zone_id]:
        _zone, result = run_in_zone(snap, zid)
        assert result.reason, f"zone {zid} returned no reason"
        assert result.zone_id == zid
        if result.possible:
            assert float(np.max(result.ds_mm)) >= snap.lab.min_effect_mm
