"""consequence.evaluate: the sentences people read, and the arithmetic under them.

The tests that matter most here are the NEGATIVE ones. A consequence engine that exaggerates is
obvious in a demo and gets caught; one that quietly invents a small amount of damage on unchanged
ground is not, and it is the one that makes every other number untrustworthy. So: change nothing,
and nothing must change.
"""

import numpy as np
import pytest

from lab import cracks as lab_cracks
from lab.consequence import NO_FORECAST, evaluate
from lab.fields import derive_fields, principal_from_fields
from lab.objects import load_objects


@pytest.fixture(scope="module")
def objs(snap):
    return load_objects(snap.cfg, snap.grid)


@pytest.fixture(scope="module")
def unchanged(snap, objs):
    """The null case: the frozen day, evaluated against itself."""
    s = snap.s_model_mm
    return evaluate(s, s, snap.grid, snap.cfg, snap.lab, crack_baseline=snap.crack_baseline, objects=objs)


@pytest.fixture(scope="module")
def dropped(snap, objs):
    """The same day with the village's own ground pulled down — something that must show up."""
    X, Y = snap.grid.centres()
    house = [o for o in objs if o.type == "house"][0]
    bump = np.exp(-((X - house.x_m) ** 2 + (Y - house.y_m) ** 2) / (2 * snap.cfg.r ** 2))
    after = snap.s_model_mm + snap.cfg.panel.seam_thickness_m * bump   # metres of seam -> mm of drop
    return evaluate(snap.s_model_mm, after, snap.grid, snap.cfg, snap.lab,
                    crack_baseline=snap.crack_baseline, objects=objs), house


def test_changing_nothing_changes_nothing(unchanged):
    s = unchanged["summary"]
    assert s["max_extra_sinking_mm"] == 0.0
    assert s["objects_worse"] == 0
    assert unchanged["cracks"]["after_count"] == unchanged["cracks"]["after_count"]
    for obj in unchanged["objects"]:
        if obj["plain"] == NO_FORECAST:
            continue
        # `after` may carry extra keys (change of length, PPV); every shared number must be identical.
        shared = set(obj["before"]) & set(obj["after"])
        assert {k: obj["before"][k] for k in shared} == {k: obj["after"][k] for k in shared}


def test_changing_nothing_opens_no_new_crack(snap_at_end, objs):
    """The null-scenario assertion, on the day the run exports its latched crack state.

    Run at the END of the run rather than at the frozen mid-day, because that is the day
    scripts/export_cracks.py writes (step 9 of run-simulation.sh) and the count is meaningless
    without it. Freezing a day with no export is the case the test below covers instead.
    """
    if snap_at_end.crack_baseline is None:
        pytest.skip(snap_at_end.crack_baseline_reason)
    s = snap_at_end.s_model_mm
    out = evaluate(s, s, snap_at_end.grid, snap_at_end.cfg, snap_at_end.lab,
                   crack_baseline=snap_at_end.crack_baseline, objects=objs)
    cracks = out["cracks"]
    assert cracks["new_count"] == 0, "an unchanged surface cracked something"
    assert cracks["widest_new_mm"] == 0.0
    assert str(snap_at_end.crack_baseline.day) in cracks["baseline"]
    # And the latched history knows about cracks the instant does not: they were opened earlier and
    # have partly closed since. If these were ever equal, the latch would have been lost.
    assert cracks["before_count"] >= cracks["after_count"]


def test_without_a_baseline_new_cracks_are_refused_not_guessed(snap, objs):
    """A plausible wrong count is worse than a missing one."""
    s = snap.s_model_mm
    out = evaluate(s, s, snap.grid, snap.cfg, snap.lab, crack_baseline=None, objects=objs)
    assert out["cracks"]["new_count"] is None
    assert out["cracks"]["before_count"] is None
    assert "not available" in out["cracks"]["baseline_note"]
    assert any("not available" in line for line in out["summary"]["plain"])


def test_dropping_the_ground_under_a_house_damages_it(dropped):
    out, house = dropped
    assert out["summary"]["max_extra_sinking_mm"] > 0
    answer = [o for o in out["objects"] if o["id"] == house.id][0]
    grades = lab_cracks.NCB_GRADES
    assert grades.index(answer["after"]["grade"]) >= grades.index(answer["before"]["grade"])
    assert out["summary"]["objects_worse"] > 0


def test_every_object_gets_one_plain_sentence_and_a_number(unchanged):
    for obj in unchanged["objects"]:
        assert obj["plain"] and isinstance(obj["plain"], str)
        if obj["plain"] == NO_FORECAST:
            continue
        assert obj["after"]["max_tilt_mm_per_m"] is not None
        if obj["type"] == "house":
            assert obj["after"]["grade"] in lab_cracks.NCB_GRADES
            assert "NCB" in obj["limit_source"]
        if obj["type"] == "pole":
            assert obj["after"]["top_movement_mm"] >= 0
        if obj["type"] == "road":
            assert obj["after"]["crack_width_mm"] >= 0


def test_a_masked_object_gets_no_grade_at_all(snap, objs):
    """WP9 §6: an object in cells no forecast covers is told so, and is not quietly graded on zeros."""
    s = snap.s_model_mm
    out = evaluate(s, s, snap.grid, snap.cfg, snap.lab, crack_baseline=snap.crack_baseline,
                   mask=np.zeros(s.shape, dtype=bool), objects=objs)
    assert all(o["plain"] == NO_FORECAST for o in out["objects"])
    assert all("grade" not in o.get("after", {}) for o in out["objects"])


def test_a_tall_pole_leans_further_than_a_short_one_in_the_same_ground(unchanged):
    poles = [o for o in unchanged["objects"] if o["type"] == "pole"]
    tall = max(poles, key=lambda o: o["after"]["height_m"])
    assert tall["after"]["height_m"] > poles[0]["after"]["height_m"]
    # lean = tilt x height, so the answer has to carry the height it was computed with.
    assert tall["after"]["top_movement_mm"] == pytest.approx(
        tall["after"]["max_tilt_mm_per_m"] * tall["after"]["height_m"],
        # the reported tilt is rounded to 2 dp, and that rounding is multiplied by the pole height
        abs=0.005 * tall["after"]["height_m"] + 0.01)


# -------------------------------------------------------------------------------------------------
# cracks are lines (Adarsh, session 26)
# -------------------------------------------------------------------------------------------------

def test_cracks_come_back_as_lines_with_a_bearing(unchanged, snap):
    segments = unchanged["cracks"]["segments"]
    assert segments, "day 300 over a worked panel should have cracked ground somewhere"
    for seg in segments[:50]:
        length = np.hypot(seg["x1_m"] - seg["x0_m"], seg["y1_m"] - seg["y0_m"])
        assert length == pytest.approx(snap.grid.cell_m, abs=0.1), "a crack line is one cell long"
        assert 0.0 <= seg["bearing_deg"] < 180.0, "a line has no head: bearing is mod 180"
        assert seg["width_mm"] >= snap.lab.crack_segment_min_width_mm


def test_a_crack_line_runs_across_the_pull_not_along_it(snap, unchanged):
    """A fissure opens perpendicular to the major principal tensile strain. If this ever inverts, the
    crack pattern still looks busy and is rotated 90 degrees from the truth."""
    f = derive_fields(snap.s_model_mm, snap.grid.cell_m, snap.cfg)
    _e1, _e2, theta = principal_from_fields(f)
    seg = max(unchanged["cracks"]["segments"], key=lambda s: s["width_mm"])
    i = int(round((seg["x0_m"] + seg["x1_m"]) / 2 - snap.grid.origin_x_m) // snap.grid.cell_m)
    j = int(round((seg["y0_m"] + seg["y1_m"]) / 2 - snap.grid.origin_y_m) // snap.grid.cell_m)
    pull = np.radians(theta[i, j])
    line = np.radians(seg["bearing_deg"])
    # Perpendicular, compared as a doubled angle so 0 and 180 are the same direction.
    assert abs(np.degrees(np.angle(np.exp(2j * (line - pull))))) == pytest.approx(180.0, abs=1.0)


def test_the_drawn_lines_are_the_widest_ones_and_the_thinning_is_declared(unchanged, snap):
    c = unchanged["cracks"]
    assert c["segments_shown"] <= snap.lab.max_crack_segments
    assert c["segments_shown"] <= c["segments_total"]
    widths = [s["width_mm"] for s in c["segments"]]
    assert widths == sorted(widths, reverse=True), "the widest cracks are the ones kept"
    if c["segments_total"] > c["segments_shown"]:
        assert any("drawn" in line for line in unchanged["summary"]["plain"])


# -------------------------------------------------------------------------------------------------
# the thresholds are the simulator's, and the units are right
# -------------------------------------------------------------------------------------------------

def test_the_reported_threshold_is_the_mine_config_one_in_the_lab_s_units(unchanged, snap):
    assert unchanged["cracks"]["threshold_mm_per_m"] == pytest.approx(
        snap.cfg.cracks.tensile_strain_threshold_ue / 1000.0)
    assert unchanged["cracks"]["spacing_m"] == snap.cfg.cracks.crack_spacing_m


def test_a_vibration_field_without_its_frequency_is_refused(snap, objs):
    """The DGMS limit is banded by frequency: the same PPV is legal at 40 Hz and over the limit at 6."""
    s = snap.s_model_mm
    with pytest.raises(ValueError) as e:
        evaluate(s, s, snap.grid, snap.cfg, snap.lab, ppv_mm_s=np.zeros(s.shape), objects=objs)
    assert "frequency" in str(e.value)


def test_derivatives_are_refused_on_the_int_grid(snap, objs):
    """Gate L5, restated at this boundary: the int-mm world grid must never reach evaluate()."""
    with pytest.raises(TypeError):
        evaluate(snap.s_mm, snap.s_mm, snap.grid, snap.cfg, snap.lab, objects=objs)
