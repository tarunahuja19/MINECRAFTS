"""Surface cracking and NCB damage grading (F10).

The load-bearing test in this file is `test_latch_survives_the_compression_zone`: a crack that
quietly closes when the face passes is strain, not a fissure, and the whole point of the model is
the difference.
"""

import dataclasses

import numpy as np
import pytest

from minesim import cracks, physics
from minesim.config import load_config


@pytest.fixture(scope="module")
def cfg():
    return load_config()


# --------------------------------------------------------------------------- opening


def test_no_opening_below_the_threshold(cfg):
    c = cfg.cracks
    for e1 in (0.0, 100.0, c.tensile_strain_threshold_ue - 1.0):
        assert cracks.opening_mm(e1, c.tensile_strain_threshold_ue, c.crack_spacing_m) == 0.0


def test_compression_never_opens_a_crack(cfg):
    c = cfg.cracks
    assert cracks.opening_mm(-8000.0, c.tensile_strain_threshold_ue, c.crack_spacing_m) == 0.0


def test_opening_is_linear_in_excess_strain_over_one_spacing(cfg):
    c = cfg.cracks
    thr, sp = c.tensile_strain_threshold_ue, c.crack_spacing_m
    # 1000 ue of excess over an 8 m spacing = 1000e-6 * 8 m = 8 mm
    assert cracks.opening_mm(thr + 1000.0, thr, sp) == pytest.approx(1000.0e-6 * sp * 1000.0)
    w1 = cracks.opening_mm(thr + 1000.0, thr, sp)
    w2 = cracks.opening_mm(thr + 2000.0, thr, sp)
    assert w2 == pytest.approx(2.0 * w1)


def test_spacing_is_what_sets_the_scale(cfg):
    """The old sandbox hid a 2 m spacing inside a bare `* 1000.0 * 2.0`. Widths must scale with it."""
    thr = cfg.cracks.tensile_strain_threshold_ue
    assert cracks.opening_mm(thr + 1000.0, thr, 16.0) == pytest.approx(
        2.0 * cracks.opening_mm(thr + 1000.0, thr, 8.0))


# --------------------------------------------------------------------------- the latch


def test_latch_holds_and_the_floor_is_never_broken(cfg):
    """Walk a rib-line point through the whole run and check the latch invariant at every step.

    The invariant is per-step: width_mm >= partial_closure_fraction * max_width_mm as they stand at
    that moment. Comparing against the FINAL maximum would be wrong, because the maximum is still
    growing early in the run.
    """
    x = np.array([600.0])
    y = np.array([cfg.panel.width_m / 2.0 - cfg.panel.inflection_offset_m + 40.0])
    fld = cracks.CrackField.empty(x.shape)

    opened_day = None
    for t in range(0, 700, 5):
        fld.update(x, y, float(t), cfg)
        if fld.cracked[0]:
            if opened_day is None:
                opened_day = float(fld.first_cracked_day[0])
            floor = cfg.cracks.partial_closure_fraction * float(fld.max_width_mm[0])
            assert float(fld.width_mm[0]) >= floor - 1e-9, f"floor broken at day {t}"
            assert float(fld.first_cracked_day[0]) == opened_day, "first_cracked_day was rewritten"

    assert opened_day is not None, "this point never cracked; pick one in the tensile band"
    assert fld.cracked[0], "the latch was lost"
    assert fld.max_width_mm[0] > 0.0


def test_partial_closure_when_the_face_passes_underneath(cfg):
    """A crack opened by the travelling tensile zone must narrow, but not vanish, once the face has
    passed and that ground goes into compression.

    On the panel centre-line the major principal strain rises to a peak as the face approaches and
    then falls back to ~0 behind it. With the shipped threshold of
    `cracks.tensile_strain_threshold_ue` that peak is too small to crack anything, so the threshold
    is lowered here to exercise the closure path. That is itself worth knowing: whether the face
    wave cracks the ground at all depends entirely on that OPEN - VERIFY value.
    """
    lowered = dataclasses.replace(cfg, cracks=dataclasses.replace(cfg.cracks, tensile_strain_threshold_ue=1000.0))
    x = np.array([1200.0])
    y = np.array([0.0])
    fld = cracks.CrackField.empty(x.shape)

    widths = []
    for t in range(0, 700, 5):
        fld.update(x, y, float(t), lowered)
        widths.append(float(fld.width_mm[0]))

    peak = max(widths)
    assert peak > 0.0, "the face wave never cracked even at the lowered threshold"
    assert widths[-1] < peak, "the crack never narrowed; the compression zone did nothing"
    assert fld.cracked[0], "the crack healed completely - it must latch"
    floor = lowered.cracks.partial_closure_fraction * float(fld.max_width_mm[0])
    assert widths[-1] == pytest.approx(floor), "final width should rest exactly on the latched floor"


def test_azimuth_is_perpendicular_to_the_major_principal_strain(cfg):
    x = np.array([1200.0])
    y = np.array([cfg.panel.width_m / 2.0 + 10.0])
    fld = cracks.CrackField.empty(x.shape).update(x, y, 690.0, cfg)
    if not fld.cracked[0]:
        pytest.skip("point did not crack at these parameters")
    _e1, _e2, theta = physics.principal_strain(x, y, 690.0, cfg.panel, cfg.knothe)
    assert float(fld.azimuth_deg[0]) == pytest.approx(float((theta[0] + 90.0) % 180.0), abs=1e-9)


def test_cracks_form_a_ring_not_a_filled_trough(cfg):
    """The trough floor is in compression. If it is covered in cracks, a sign is inverted."""
    y = np.linspace(-400.0, 400.0, 161)
    x = np.full_like(y, 1200.0)
    fld = cracks.CrackField.empty(x.shape).update(x, y, 690.0, cfg)
    centre = np.abs(y) < 40.0
    assert not fld.cracked[centre].any(), "the trough floor cracked; it is in compression"
    assert fld.cracked.any(), "nothing cracked anywhere over the ribs"


# --------------------------------------------------------------------------- B sensitivity


def test_width_sensitivity_spans_the_literature_range(cfg):
    x = np.array([1200.0])
    y = np.array([cfg.panel.width_m / 2.0])
    band = cracks.width_sensitivity(x, y, 690.0, cfg)
    assert set(band) == {"B=0.35r", "B=r/sqrt(2pi)", "B=0.40r"}
    lo, hi = float(band["B=0.35r"][0]), float(band["B=0.40r"][0])
    assert hi > lo > 0.0, "the B band collapsed; crack width must be sensitive to B"
    assert (hi - lo) / hi > 0.10, "0.35r to 0.40r should move the width by more than 10%"


# --------------------------------------------------------------------------- NCB damage


def test_change_of_length_is_strain_times_frontage(cfg):
    # 1000 ue over a 10 m frontage = 1000e-6 * 10 m = 10 mm
    assert cracks.change_of_length_mm(1000.0, 10.0) == pytest.approx(10.0)


def test_every_ncb_grade_is_reachable(cfg):
    L = 10.0
    # change of length in mm -> strain in ue is dl / (L * 1e-3) ... pick a value inside each band
    cases = [(20.0, "negligible"), (45.0, "very slight"), (90.0, "slight"),
             (150.0, "appreciable"), (240.0, "severe"), (400.0, "very severe")]
    for dl_mm, expected in cases:
        e1_ue = dl_mm / (L * 1.0e-6 * 1000.0)
        assert cracks.damage_grade(e1_ue, L) == expected, f"{dl_mm} mm should be {expected}"


def test_damage_is_graded_on_change_of_length_not_raw_strain(cfg):
    """The same strain must grade differently for a 5 m hut and a 30 m shed - that is the whole
    reason the NCB scale is change of length. The old sandbox graded on raw strain and could not
    tell them apart."""
    e1 = 4000.0
    assert cracks.damage_grade(e1, 5.0) != cracks.damage_grade(e1, 30.0)


def test_compression_damages_structures_too(cfg):
    assert cracks.damage_grade(-4000.0, 10.0) == cracks.damage_grade(4000.0, 10.0)


def test_dgms_tensile_limit_is_its_own_line(cfg):
    """The regulatory limit is not the cracking threshold and not an NCB edge - three separate
    scales. The old sandbox collapsed them into one ladder of strain flags."""
    limit = cfg.cracks.dgms_tensile_strain_limit_ue
    assert limit != cfg.cracks.tensile_strain_threshold_ue
    assert not bool(cracks.exceeds_dgms_tensile_limit(limit - 1.0, cfg))
    assert bool(cracks.exceeds_dgms_tensile_limit(limit + 1.0, cfg))


def test_ground_can_crack_without_reaching_the_dgms_limit(cfg):
    """Both thresholds are live and ordered: cracking starts below the regulatory line, so a crack
    on the ground is not automatically a statutory breach."""
    c = cfg.cracks
    between = 0.5 * (c.tensile_strain_threshold_ue + c.dgms_tensile_strain_limit_ue)
    assert cracks.opening_mm(between, c.tensile_strain_threshold_ue, c.crack_spacing_m) > 0.0
    assert not bool(cracks.exceeds_dgms_tensile_limit(between, cfg))
