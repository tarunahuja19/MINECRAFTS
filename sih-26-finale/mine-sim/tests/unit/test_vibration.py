"""Ground vibration (F10).

`test_two_nodes_at_different_distances_read_different_ppv` is the one that matters: the old sandbox
handed every node in the mine the same PPV regardless of where it stood, which is the defect this
module exists to fix.
"""

import numpy as np
import pytest

from minesim import vibration as vib
from minesim.config import load_config


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def blast(cfg, x=1200.0, y=900.0, kg=50.0):
    return vib.VibrationSource(kind="blast", x_m=x, y_m=y, charge_kg=kg)


# --------------------------------------------------------------------------- attenuation


def test_two_nodes_at_different_distances_read_different_ppv(cfg):
    src = blast(cfg)
    near = float(vib.ppv_mm_s(1200.0, 800.0, src, cfg))     # 100 m away
    far = float(vib.ppv_mm_s(1200.0, -100.0, src, cfg))     # 1000 m away
    assert near > far, "PPV must fall with distance - this is the old sandbox's defect"
    assert near / far > 10.0, "a 10x distance should attenuate strongly at B=1.5"


def test_ppv_falls_monotonically_with_distance(cfg):
    src = blast(cfg)
    d = np.array([50.0, 100.0, 200.0, 400.0, 800.0, 1600.0])
    p = vib.ppv_mm_s(src.x_m + d, np.full_like(d, src.y_m), src, cfg)
    assert np.all(np.diff(p) < 0.0)


def test_scaled_distance_law_matches_a_hand_computed_value(cfg):
    """PPV = K (D / sqrt(W)) ** -B, computed by hand at one point."""
    src = blast(cfg, kg=100.0)
    d = 500.0
    expected = cfg.vibration.blast_k * (d / np.sqrt(100.0)) ** (-cfg.vibration.blast_b)
    got = float(vib.ppv_mm_s(src.x_m + d, src.y_m, src, cfg))
    assert got == pytest.approx(expected)


def test_a_blast_without_a_charge_weight_is_refused(cfg):
    src = vib.VibrationSource(kind="blast", x_m=0.0, y_m=0.0, charge_kg=None)
    with pytest.raises(ValueError, match="charge_kg"):
        vib.ppv_mm_s(100.0, 0.0, src, cfg)


def test_depth_caps_how_close_a_caving_event_can_be(cfg):
    """A caving event at seam depth is never nearer the surface than the depth, whatever the plan
    distance. Ignoring depth would let PPV blow up directly above the face."""
    src = vib.VibrationSource(kind="caving", x_m=1200.0, y_m=0.0, depth_m=cfg.panel.depth_m)
    assert float(vib.slant_distance_m(1200.0, 0.0, src)) == pytest.approx(cfg.panel.depth_m)
    overhead = float(vib.ppv_mm_s(1200.0, 0.0, src, cfg))
    assert np.isfinite(overhead) and overhead > 0.0


def test_machinery_is_a_flat_floor(cfg):
    src = vib.VibrationSource(kind="machinery", x_m=0.0, y_m=0.0)
    a = float(vib.ppv_mm_s(10.0, 10.0, src, cfg))
    b = float(vib.ppv_mm_s(3000.0, 900.0, src, cfg))
    assert a == pytest.approx(b) == pytest.approx(cfg.vibration.machinery_floor_mm_s)


# --------------------------------------------------------------------------- caving cycle


def test_caving_events_follow_face_advance(cfg):
    v, k = cfg.vibration, cfg.knothe
    day_of_first_fall = v.first_fall_advance_m / k.advance_m_per_day
    assert vib.caving_events(cfg, day_of_first_fall - 0.1) == []
    first = vib.caving_events(cfg, day_of_first_fall + 0.1)
    assert len(first) == 1
    assert first[0].x_m == pytest.approx(v.first_fall_advance_m)
    assert first[0].depth_m == pytest.approx(cfg.panel.depth_m)

    # one more event per periodic_weighting_interval_m of further advance
    later_day = (v.first_fall_advance_m + 3 * v.periodic_weighting_interval_m) / k.advance_m_per_day
    assert len(vib.caving_events(cfg, later_day + 0.1)) == 4


def test_caving_stops_when_the_face_stops(cfg):
    """Nothing is extracted past the panel end, so no further weighting events occur."""
    at_end = vib.caving_events(cfg, cfg.panel.length_m / cfg.knothe.advance_m_per_day)
    long_after = vib.caving_events(cfg, float(cfg.sim.duration_days))
    assert len(at_end) == len(long_after)
    assert all(e.x_m <= cfg.panel.length_m for e in long_after)


# --------------------------------------------------------------------------- frequency and DGMS


def test_each_source_lands_in_its_own_band(cfg):
    for kind, band in (("blast", "blast"), ("caving", "microseismic"), ("machinery", "conveyor")):
        lo, hi = cfg.vibration.bands_hz[band]
        f = vib.dominant_frequency_hz(kind, cfg)
        assert lo <= f <= hi, f"{kind} landed outside {band}"


def test_caving_is_microseismic_not_blast(cfg):
    """Roof caving and blasting are different signatures; collapsing them makes the channel useless
    for telling a fall from a shot."""
    assert vib.dominant_frequency_hz("caving", cfg) > vib.dominant_frequency_hz("blast", cfg)


def test_the_dgms_limit_depends_on_the_frequency_band(cfg):
    low = vib.dgms_limit_mm_s("domestic", 5.0, cfg)
    mid = vib.dgms_limit_mm_s("domestic", 15.0, cfg)
    high = vib.dgms_limit_mm_s("domestic", 40.0, cfg)
    assert low < mid < high, "low-frequency ground motion is the damaging kind; its limit is lowest"


def test_industrial_structures_get_a_higher_limit_than_houses(cfg):
    for f in (5.0, 15.0, 40.0):
        assert vib.dgms_limit_mm_s("industrial", f, cfg) > vib.dgms_limit_mm_s("domestic", f, cfg)


def test_an_unknown_structure_class_is_refused(cfg):
    with pytest.raises(ValueError, match="unknown structure class"):
        vib.dgms_limit_mm_s("palace", 20.0, cfg)


def test_exceeds_limit_reports_and_does_not_gate(cfg):
    over = vib.exceeds_limit(500.0, "domestic", 15.0, cfg)
    under = vib.exceeds_limit(0.5, "domestic", 15.0, cfg)
    assert bool(over) and not bool(under)


# --------------------------------------------------------------------------- coupling


def test_vibration_cannot_crack_sound_ground(cfg):
    """The one coupling rule is deliberately narrow: shaking extends cracks in ground already near
    failure, it does not crack sound ground."""
    huge_ppv = 10000.0
    assert not bool(vib.crack_trigger(0.0, huge_ppv, "blast", cfg))
    assert not bool(vib.crack_trigger(100.0, huge_ppv, "blast", cfg))


def test_vibration_can_tip_ground_already_near_failure(cfg):
    near = cfg.vibration.trigger_fraction * cfg.cracks.tensile_strain_threshold_ue + 1.0
    assert bool(vib.crack_trigger(near, 10000.0, "blast", cfg))
    assert not bool(vib.crack_trigger(near, 0.001, "blast", cfg)), "an imperceptible event triggered a crack"
