"""Unit tests for minesim.physics core Knothe implementation."""

from pathlib import Path
import numpy as np
import pytest

from minesim.config import load_config
from minesim import physics
from minesim.physics import subsidence, tilt, curvature, strain, displacement, face_position


@pytest.fixture
def cfg():
    return load_config(Path("config/assumptions.yaml"))


def test_zero_at_t0(cfg):
    """S(x, y, 0) == 0 everywhere."""
    for x in [0.0, 100.0, 500.0]:
        for y in [-100.0, 0.0, 100.0]:
            assert subsidence(x, y, 0.0, cfg.panel, cfg.knothe) == 0.0


def test_transverse_symmetry(cfg):
    """S(x, y, t) == S(x, -y, t) to float tolerance."""
    t_days = 200.0
    x = 500.0
    for y in [10.0, 50.0, 100.0, 150.0, 200.0]:
        s_pos = subsidence(x, y, t_days, cfg.panel, cfg.knothe)
        s_neg = subsidence(x, -y, t_days, cfg.panel, cfg.knothe)
        assert abs(s_pos - s_neg) < 1e-6


def test_peak_location(cfg):
    """Maximum subsidence sits at the panel centre transversely (y=0)."""
    t_days = 500.0
    x = 500.0
    s_center = subsidence(x, 0.0, t_days, cfg.panel, cfg.knothe)
    for y in [-50.0, -25.0, 25.0, 50.0]:
        s_flank = subsidence(x, y, t_days, cfg.panel, cfg.knothe)
        assert s_center >= s_flank


def test_subcritical_peak_formula(cfg):
    """Peak at t -> inf equals the geometry-derived subcritical value."""
    s_inf = subsidence(500.0, 0.0, 10000.0, cfg.panel, cfg.knothe)
    m_mm = cfg.panel.seam_thickness_m * 1000.0
    s_full_mm = cfg.knothe.subsidence_factor * m_mm
    from scipy.special import erf
    effective_width = cfg.panel.width_m - 2.0 * cfg.panel.inflection_offset_m
    expected_peak = s_full_mm * erf(np.sqrt(np.pi) * effective_width / (2.0 * cfg.r))
    assert abs(s_inf - expected_peak) < 1.0


def test_edge_decay(cfg):
    """Subsidence at y = +-(width/2 + r) decays toward 0 mm."""
    edge_y = cfg.panel.width_m / 2.0 + cfg.r
    s_edge = subsidence(500.0, edge_y, 1000.0, cfg.panel, cfg.knothe)
    s_center = subsidence(500.0, 0.0, 1000.0, cfg.panel, cfg.knothe)
    assert s_edge < 0.05 * s_center


def test_tilt_zero_at_centre(cfg):
    """dS/dy == 0 on the panel centreline."""
    tx, ty = tilt(500.0, 0.0, 500.0, cfg.panel, cfg.knothe)
    assert abs(ty) < 1e-3


def test_vectorisation(cfg):
    """Array input returns an array of matching shape, equal elementwise to scalar calls."""
    x = np.array([100.0, 200.0, 300.0])
    y = np.array([-50.0, 0.0, 50.0])
    s_vec = subsidence(x, y, 100.0, cfg.panel, cfg.knothe)
    assert s_vec.shape == (3,)
    for i in range(3):
        s_scalar = subsidence(x[i], y[i], 100.0, cfg.panel, cfg.knothe)
        assert abs(s_vec[i] - s_scalar) < 1e-6


def test_baseline_sensitivity_strain(cfg):
    """Strain across 30 m wire differs from 10 m rod in the peak-strain band.

    Horizontal strain crosses zero at the inflection point (the rib), so the comparison
    is made where |strain| over the 10 m rod is largest.
    """
    ys = np.linspace(0.0, cfg.panel.width_m / 2.0 + cfg.r, 200)
    peak_y = float(ys[np.argmax(np.abs(strain(500.0, ys, 500.0, cfg.panel, cfg.knothe, 10.0, "y")))])
    strain_10 = strain(500.0, peak_y, 500.0, cfg.panel, cfg.knothe, 10.0, "y")
    strain_30 = strain(500.0, peak_y, 500.0, cfg.panel, cfg.knothe, 30.0, "y")
    assert abs(strain_10 - strain_30) > 1.0  # Differ materially in microstrain


# --- M2 Part 0: sign, strain and panel-end fixes (2026-09-14) ---

def test_displacement_points_toward_trough(cfg):
    """Outside the +y rib, ground moves toward the trough centre (uy < 0)."""
    _, uy = displacement(1000.0, 150.0, 690.0, cfg.panel, cfg.knothe)
    assert uy < 0.0
    _, uy_neg = displacement(1000.0, -150.0, 690.0, cfg.panel, cfg.knothe)
    assert uy_neg > 0.0


def test_strain_tension_outside_rib(cfg):
    """Horizontal strain is tension (positive) just outside the panel edge."""
    assert strain(1000.0, 150.0, 690.0, cfg.panel, cfg.knothe, 10.0, "y") > 0.0


def test_strain_compression_over_centre(cfg):
    """Horizontal strain is compression (negative) over the panel centre."""
    assert strain(1000.0, 0.0, 690.0, cfg.panel, cfg.knothe, 10.0, "y") < 0.0


def test_strain_is_not_tilt(cfg):
    """Strain differences horizontal displacement, so it must not equal tilt."""
    _, ty = tilt(1000.0, 150.0, 690.0, cfg.panel, cfg.knothe)
    sy = strain(1000.0, 150.0, 690.0, cfg.panel, cfg.knothe, 10.0, "y")
    assert abs(sy - ty) > 0.1 * abs(ty)


def test_face_stops_at_panel_end(cfg):
    """Nothing is extracted past panel.length_m, so S is ~0 well beyond the panel end."""
    t_days = 690.0
    assert face_position(t_days, cfg.knothe) > cfg.panel.length_m  # unclamped clock runs on
    x_far = cfg.panel.length_m + 3.0 * cfg.r
    assert subsidence(x_far, 0.0, t_days, cfg.panel, cfg.knothe) < 1.0


def test_ground_near_panel_end_settles_fully(cfg):
    """After the face stops, ground behind it keeps settling toward the long-term value."""
    x = cfg.panel.length_m - 5.0 * cfg.r
    s_long = subsidence(x, 0.0, 100000.0, cfg.panel, cfg.knothe)
    stop_day = cfg.panel.length_m / cfg.knothe.advance_m_per_day
    s_later = subsidence(x, 0.0, stop_day + 10.0 * cfg.t63, cfg.panel, cfg.knothe)
    assert s_later > 0.99 * s_long


def test_peak_near_long_term_value(cfg):
    """Peak at (1000, 0, 690) is ≈ 930 mm: at most the long-term static value, within 1%."""
    s = subsidence(1000.0, 0.0, 690.0, cfg.panel, cfg.knothe)
    s_static = subsidence(1000.0, 0.0, 1.0e6, cfg.panel, cfg.knothe)
    assert s <= s_static + 1e-6
    assert s >= 0.99 * s_static


def test_continuous_at_the_face(cfg):
    """No cliff at the moving face: S just behind and just ahead differ by under 1 mm."""
    for t_days in (100.0, 300.0, 600.0):
        xf = face_position(t_days, cfg.knothe)
        behind = subsidence(xf - 0.05, 0.0, t_days, cfg.panel, cfg.knothe)
        ahead = subsidence(xf + 0.05, 0.0, t_days, cfg.panel, cfg.knothe)
        assert abs(behind - ahead) < 1.0


def test_more_subsidence_behind_the_face(cfg):
    """Mined ground (behind the face) sinks more than unmined ground ahead of it."""
    t_days = 300.0
    xf = face_position(t_days, cfg.knothe)
    assert subsidence(xf - cfg.r, 0.0, t_days, cfg.panel, cfg.knothe) > \
        subsidence(xf + cfg.r, 0.0, t_days, cfg.panel, cfg.knothe)


def test_monotone_in_time(cfg):
    """Every point only sinks: S(x, t) never decreases as t grows (needed for dz <= 0)."""
    xs = np.linspace(-cfg.r, cfg.panel.length_m + 2.0 * cfg.r, 301)
    prev = np.zeros_like(xs)
    for t_days in np.arange(0.0, 900.0, 3.0):
        s = subsidence(xs, 0.0, t_days, cfg.panel, cfg.knothe)
        assert (s - prev).min() >= -1e-9
        prev = s


def test_inflection_offset_is_knothe_on_the_effective_panel(cfg):
    """S with offset d == classical Knothe on a panel W-2d x L-2d, shifted by d, whose goaf starts 2d/v later."""
    import dataclasses
    p, k = cfg.panel, cfg.knothe
    d = p.inflection_offset_m
    assert d > 0.0
    eff = dataclasses.replace(p, width_m=p.width_m - 2 * d, length_m=p.length_m - 2 * d, inflection_offset_m=0.0)
    xs = np.linspace(-200.0, p.length_m + 200.0, 301)
    for t_days in (20.0, 100.0, 400.0, 700.0):
        for y in (0.0, 60.0, 150.0):
            with_d = subsidence(xs, y, t_days, p, k)
            classical = subsidence(xs - d, y, t_days - 2 * d / k.advance_m_per_day, eff, k)
            assert np.allclose(with_d, classical, atol=1e-9)


def test_closed_form_matches_numeric_knothe_integral(cfg):
    """The closed-form time lag equals direct quadrature of dS/dt = c (S_static - S), also after the panel end."""
    import dataclasses
    from scipy.integrate import quad
    from scipy.special import erf
    p, k = dataclasses.replace(cfg.panel, inflection_offset_m=0.0), cfg.knothe
    a = np.sqrt(np.pi) / cfg.r
    s_full = k.subsidence_factor * p.seam_thickness_m * 1000.0
    f_y = erf(a * p.width_m / 2.0)
    t_stop = p.length_m / k.advance_m_per_day

    def f_static(x, tau):
        face = min(k.advance_m_per_day * tau, p.length_m)
        return 0.5 * (erf(a * x) - erf(a * (x - face)))

    for t_days in (10.0, 312.0, t_stop + 20.0):
        for x in (-50.0, 300.0, 1250.0, p.length_m + 50.0):
            lag, _ = quad(lambda tau: k.time_coefficient * np.exp(-k.time_coefficient * (t_days - tau)) * f_static(x, tau),
                          0.0, t_days, limit=400, points=[t_stop] if t_days > t_stop else None)
            assert abs(subsidence(x, 0.0, t_days, p, k) - s_full * f_y * lag) < 0.01


def test_finite_for_slow_face_and_fast_settling(cfg):
    """Large c/v (slow advance, fast settling) must not overflow to NaN (mine independence)."""
    import dataclasses
    for v, c in ((0.25, 0.1), (1.0, 1.0), (4.0, 50.0)):
        k = dataclasses.replace(cfg.knothe, advance_m_per_day=v, time_coefficient=c)
        xs = np.linspace(-2.0 * cfg.r, cfg.panel.length_m + 2.0 * cfg.r, 2001)
        for t_days in (0.5, 0.5 * cfg.panel.length_m / v, 2.0 * cfg.panel.length_m / v):
            s = subsidence(xs, 0.0, t_days, cfg.panel, k)
            assert np.all(np.isfinite(s))
            assert s.max() <= k.subsidence_factor * cfg.panel.seam_thickness_m * 1000.0 + 1e-6


# ------------------------------------------------------------------ F10: the strain tensor


def _cfg_f10():
    from minesim.config import load_config
    return load_config()


def test_principal_axes_are_the_panel_axes_on_the_centre_line():
    """On y = 0 the trough is symmetric, so the cross-derivative vanishes and the principal axes
    must be the panel axes. Anywhere else this is not guaranteed."""
    cfg = _cfg_f10()
    for x in (400.0, 1200.0, 2000.0):
        _e1, _e2, theta = physics.principal_strain(x, 0.0, 690.0, cfg.panel, cfg.knothe)
        assert abs(float(theta) % 90.0) < 1e-6, f"axes rotated on the centre-line at x={x}"


def test_cross_derivative_is_zero_on_the_centre_line():
    cfg = _cfg_f10()
    cxy = physics.curvature_xy(1200.0, 0.0, 690.0, cfg.panel, cfg.knothe)
    cyy = physics.curvature(1200.0, 0.0, 690.0, cfg.panel, cfg.knothe)[1]
    assert abs(float(cxy)) < 1e-6 * max(1.0, abs(float(cyy)))


def test_principal_axes_rotate_at_a_panel_corner():
    """The corners are doubly curved and the principal axes swing off-axis there. This is the whole
    reason curvature_xy exists; without it every crack would be drawn axis-aligned."""
    cfg = _cfg_f10()
    d = cfg.panel.inflection_offset_m
    x = cfg.panel.length_m - d
    y = cfg.panel.width_m / 2.0 - d
    _e1, _e2, theta = physics.principal_strain(x, y, 690.0, cfg.panel, cfg.knothe)
    off = abs(float(theta) % 90.0)
    assert 5.0 < off < 85.0, f"corner axes did not rotate (theta={float(theta)})"


def test_e1_is_always_the_major_principal_strain():
    cfg = _cfg_f10()
    y = np.linspace(-400.0, 400.0, 81)
    x = np.full_like(y, 1200.0)
    e1, e2, _theta = physics.principal_strain(x, y, 690.0, cfg.panel, cfg.knothe)
    assert np.all(e1 >= e2 - 1e-9)


def test_tensor_trace_is_invariant():
    """exx + eyy is invariant under rotation, so it must equal e1 + e2 everywhere. This catches a
    sign slip or a factor error in the Mohr's-circle algebra."""
    cfg = _cfg_f10()
    y = np.linspace(-400.0, 400.0, 41)
    x = np.full_like(y, 1200.0)
    b = physics.horizontal_displacement_factor(cfg.panel, cfg.knothe)
    cxx, cyy = physics.curvature(x, y, 690.0, cfg.panel, cfg.knothe)
    e1, e2, _theta = physics.principal_strain(x, y, 690.0, cfg.panel, cfg.knothe)
    np.testing.assert_allclose(e1 + e2, b * (cxx + cyy) * 1.0e3, rtol=1e-9, atol=1e-9)


def test_trough_floor_is_in_compression_and_the_ribs_are_in_tension():
    """The physical shape of the answer: a subsidence bowl is compressive in the middle and tensile
    at its edges. If this inverts, every crack and damage number downstream is wrong."""
    cfg = _cfg_f10()
    centre, _, _ = physics.principal_strain(1200.0, 0.0, 690.0, cfg.panel, cfg.knothe)
    rib_e1, _, _ = physics.principal_strain(1200.0, cfg.panel.width_m / 2.0, 690.0, cfg.panel, cfg.knothe)
    _c1, centre_minor, _ = physics.principal_strain(1200.0, 0.0, 690.0, cfg.panel, cfg.knothe)
    assert float(centre_minor) < 0.0, "the trough floor is not in compression"
    assert float(rib_e1) > 0.0, "the rib line is not in tension"
    assert float(rib_e1) > float(centre)


def test_b_factor_has_one_definition():
    """displacement() and principal_strain() must use the same B, or strain and displacement
    disagree about the same ground."""
    cfg = _cfg_f10()
    b = physics.horizontal_displacement_factor(cfg.panel, cfg.knothe)
    tilt_x, _ = physics.tilt(1200.0, 120.0, 690.0, cfg.panel, cfg.knothe)
    ux, _ = physics.displacement(1200.0, 120.0, 690.0, cfg.panel, cfg.knothe)
    assert float(ux) == pytest.approx(b * float(tilt_x) * 1e-3)
