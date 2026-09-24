"""The shaking layer: caving vibration on the grid, drawn as contour lines.

The invariant that matters more than any number here: VIBRATION DOES NOT SINK THE GROUND. The old
sandbox got that right and said so; it is the easiest thing in this feature for a later change to get
wrong, so it is asserted rather than trusted.
"""

import numpy as np
import pytest

from lab import vibration as lab_vib
from lab.consequence import evaluate
from lab.sampling import iso_segments, sample


@pytest.fixture(scope="module")
def layer(snap):
    return lab_vib.caving_ppv_field(snap.grid, snap.cfg, snap.day)


def test_the_layer_comes_from_the_run_s_own_face_advance(layer, snap):
    """No user input, no unverified blast constant — roof falls follow the face we already simulate."""
    assert layer["n_events"] > 0, "by day 300 the face has advanced far past the first main fall"
    assert layer["ppv_mm_s"].shape == snap.s_model_mm.shape
    assert layer["first_event_day"] > 0


def test_shaking_falls_off_with_distance_from_the_nearest_fall(layer, snap):
    """Distance from the FACE is the wrong axis: the events are the whole train of roof falls behind
    it, so ground a kilometre back sits over one of them. Ground AHEAD of the face has none under it
    and is the honest comparison — and it is also the answer to "why is my village shaking?"."""
    ppv = layer["ppv_mm_s"]
    X, Y = snap.grid.centres()
    over_the_goaf = (np.abs(Y) < snap.cfg.panel.district_half_width_m) & (X > 0) & (X < snap.face_x_m)
    ahead_of_the_face = X > snap.face_x_m + 4 * snap.cfg.r
    assert float(ppv[over_the_goaf].max()) > float(ppv[ahead_of_the_face].max())


def test_a_caving_event_at_seam_depth_can_only_shake_the_surface_so_hard(layer, snap):
    """The source is 375 m down, so it is never closer than 375 m to anything on the surface. The
    numbers are small for a physical reason, not because something is switched off."""
    limit = layer["limits_mm_s"]["domestic"]
    assert 0 < float(layer["ppv_mm_s"].max()) < limit
    assert "roof falls" in layer["plain"]


def test_early_in_a_run_there_are_no_roof_falls_yet_and_it_says_so(run_dir):
    from lab.snapshot import load_snapshot
    start = load_snapshot(run_dir, 0.0)
    layer = lab_vib.caving_ppv_field(start.grid, start.cfg, start.day)
    assert layer["n_events"] == 0 and layer["ppv_mm_s"] is None
    assert "no roof fall yet" in layer["plain"]


def test_the_dgms_limit_is_banded_by_frequency(snap):
    """The same PPV is compliant at 40 Hz and over the limit at 6 Hz, so the frequency travels with
    the number everywhere it is reported."""
    low = lab_vib.dgms_limits(snap.cfg, 5.0)
    high = lab_vib.dgms_limits(snap.cfg, 50.0)
    assert low["domestic"] < high["domestic"]
    assert low["domestic"] < low["industrial"]


# -------------------------------------------------------------------------------------------------
# lines, not coloured cells (Adarsh, session 26)
# -------------------------------------------------------------------------------------------------

def test_a_contour_line_sits_where_the_field_is_at_that_level(layer, snap):
    ppv = layer["ppv_mm_s"]
    level = float(np.median(ppv[ppv > 0]))
    segments = iso_segments(ppv, snap.grid, level)
    assert segments, "a level inside the range of the field must be crossed somewhere"
    mids_x = np.array([(s[0] + s[2]) / 2 for s in segments])
    mids_y = np.array([(s[1] + s[3]) / 2 for s in segments])
    values = sample(ppv, snap.grid, mids_x, mids_y)
    # Linear interpolation on a curved field, so a small relative error at the midpoint is expected.
    assert np.nanmedian(np.abs(values - level)) < 0.05 * level


def test_a_level_above_the_whole_field_draws_nothing(layer, snap):
    ppv = layer["ppv_mm_s"]
    assert iso_segments(ppv, snap.grid, float(ppv.max()) * 2) == []


def test_every_level_asked_for_comes_back_even_when_it_is_nowhere(layer, snap):
    """A level with no crossings still returns, empty: the page shows "5 mm/s: nowhere" rather than
    silently dropping a line it was told to draw."""
    out = lab_vib.ppv_contours(layer["ppv_mm_s"], snap.grid, snap.lab)
    assert [c["level_mm_s"] for c in out] == list(snap.lab.ppv_contour_levels_mm_s)
    assert all(c["count"] == len(c["segments"]) for c in out)


def test_no_vibration_layer_means_no_contours(snap):
    assert lab_vib.ppv_contours(None, snap.grid, snap.lab) == []


# -------------------------------------------------------------------------------------------------
# the invariant
# -------------------------------------------------------------------------------------------------

def test_shaking_the_ground_does_not_sink_it(snap, layer):
    """minesim.vibration's own docstring: blasting does not cause subsidence and must never be wired
    up as though it does. Here that means a PPV field changes no consequence of the surface."""
    s = snap.s_model_mm
    quiet = evaluate(s, s, snap.grid, snap.cfg, snap.lab, crack_baseline=snap.crack_baseline)
    shaken = evaluate(s, s, snap.grid, snap.cfg, snap.lab, crack_baseline=snap.crack_baseline,
                      ppv_mm_s=layer["ppv_mm_s"], f_dom_hz=layer["f_dom_hz"])
    assert shaken["summary"]["max_extra_sinking_mm"] == quiet["summary"]["max_extra_sinking_mm"] == 0.0
    assert shaken["cracks"]["after_count"] == quiet["cracks"]["after_count"]
    assert shaken["vibration"]["max_ppv_mm_s"] > 0 and quiet["vibration"] is None
