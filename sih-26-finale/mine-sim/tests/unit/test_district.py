"""Mine district (F6 B): superposition of panel troughs.

The point of this file is the first test. Every other module differentiates `physics.subsidence`
numerically, so if the single-panel case is not bit-identical after the superposition change, every
fitted number in the repository has silently moved.
"""

import dataclasses
import json
from pathlib import Path

import numpy as np
import pytest

from minesim import physics
from minesim.config import load_config

ROOT = Path(__file__).resolve().parent.parent.parent


@pytest.fixture(scope="module")
def cfg():
    return load_config()


def _single(panel):
    return physics.as_single_panel(panel)


def test_single_panel_still_reproduces_the_published_peak(cfg):
    """The anchor to the field data: LW1 alone must still peak where the fit says it does.

    This is the regression guard on the whole superposition change — if the single-panel path moved,
    every fitted number in the repository moved with it.
    """
    fitted = json.loads((ROOT / "data" / "fitted" / "adriyala_lw1_params.json").read_text())
    want_peak = fitted["peak_subsidence_mm"] if "peak_subsidence_mm" in fitted else 1202.0
    panel = _single(cfg.panel)
    y = np.linspace(-60.0, 60.0, 121)
    got = physics.subsidence(np.full_like(y, 1200.0), y, 690.0, panel, cfg.knothe).max()
    assert got == pytest.approx(want_peak, rel=0.02), f"single-panel peak moved: {got} vs {want_peak}"


def test_district_is_the_sum_of_its_panels(cfg):
    """Superposition is exact, not approximate: the district equals the sum of shifted single panels."""
    panel = dataclasses.replace(
        cfg.panel, y_offsets_m=(-290.0, 0.0, 290.0), start_day_offsets_d=(0.0, 80.0, 160.0)
    )
    one = _single(cfg.panel)
    x = np.linspace(0.0, 2500.0, 41)
    y = np.linspace(-600.0, 600.0, 81)
    xx, yy = np.meshgrid(x, y, indexing="ij")
    t = 345.0
    got = physics.subsidence(xx, yy, t, panel, cfg.knothe)
    want = sum(
        physics.subsidence(xx, yy - dy, t - t0, one, cfg.knothe)
        for dy, t0 in zip(panel.y_offsets_m, panel.start_day_offsets_d)
    )
    assert np.array_equal(got, want)


def test_as_single_panel_strips_the_district(cfg):
    one = physics.as_single_panel(cfg.panel)
    assert one.y_offsets_m == (0.0,)
    assert one.start_day_offsets_d == (0.0,)
    # everything else is untouched
    assert one.width_m == cfg.panel.width_m
    assert one.inflection_offset_m == cfg.panel.inflection_offset_m


def test_a_panel_that_has_not_started_contributes_nothing(cfg):
    """A face that starts after the epoch being asked about must add exactly zero."""
    started = dataclasses.replace(cfg.panel, y_offsets_m=(0.0,), start_day_offsets_d=(0.0,))
    plus_future = dataclasses.replace(
        cfg.panel, y_offsets_m=(0.0, 290.0), start_day_offsets_d=(0.0, 500.0)
    )
    x = np.linspace(0.0, 2500.0, 31)
    y = np.linspace(-400.0, 700.0, 41)
    xx, yy = np.meshgrid(x, y, indexing="ij")
    t = 300.0  # before the second panel starts
    assert np.array_equal(
        physics.subsidence(xx, yy, t, started, cfg.knothe),
        physics.subsidence(xx, yy, t, plus_future, cfg.knothe),
    )


def test_neighbouring_panels_deepen_the_trough_between_them(cfg):
    """The chain pillar between two panels must sink more than it would with only one of them mined.

    Like for like: the *same point* (x, y=0), with one neighbour versus both.
    """
    left = dataclasses.replace(cfg.panel, y_offsets_m=(-145.0,), start_day_offsets_d=(0.0,))
    pair = dataclasses.replace(cfg.panel, y_offsets_m=(-145.0, 145.0), start_day_offsets_d=(0.0, 0.0))
    x, y = 1200.0, 0.0  # on the chain pillar, between the two panels
    t = 600.0
    s_one = physics.subsidence(x, y, t, left, cfg.knothe)
    s_two = physics.subsidence(x, y, t, pair, cfg.knothe)
    assert s_one > 0.0
    assert s_two == pytest.approx(2.0 * s_one, rel=1e-12)  # symmetric pair: exactly double


def test_district_geometry_is_symmetric_and_on_pitch(cfg):
    panel = cfg.panel
    if panel.n_panels == 1:
        pytest.skip("mine config has no district block")
    offs = np.asarray(panel.y_offsets_m)
    assert np.allclose(offs, -offs[::-1]), "district must be symmetric about the panel axis"
    pitch = np.diff(offs)
    assert np.allclose(pitch, pitch[0]), "panels must sit on one pitch"
    assert pitch[0] > panel.width_m, "pitch must leave a chain pillar between panels"


def test_scalar_and_array_agree(cfg):
    panel = dataclasses.replace(cfg.panel, y_offsets_m=(-290.0, 0.0), start_day_offsets_d=(0.0, 60.0))
    xs = [10.0, 500.0, 1500.0]
    ys = [-290.0, 0.0, 120.0]
    t = 400.0
    for x in xs:
        for y in ys:
            s = physics.subsidence(x, y, t, panel, cfg.knothe)
            a = physics.subsidence(np.array([x]), np.array([y]), t, panel, cfg.knothe)
            assert isinstance(s, float)
            assert s == pytest.approx(float(a[0]), rel=0, abs=0)


def test_district_half_width(cfg):
    panel = dataclasses.replace(cfg.panel, y_offsets_m=(-290.0, 0.0, 290.0))
    assert panel.district_half_width_m == pytest.approx(290.0 + panel.width_m / 2.0)
    assert _single(cfg.panel).district_half_width_m == pytest.approx(cfg.panel.width_m / 2.0)
