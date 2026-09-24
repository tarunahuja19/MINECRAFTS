"""Zone geometry and the zone weight (P1).

The gate-level consequence of getting the weight wrong is in tests/gates/test_l8.py; this file covers
the plain behaviour - where zones are, that they tile the panel, and that a click is validated.
"""

import numpy as np
import pytest

from lab.zones import (
    Zone,
    boundary_fade_m,
    distance_to_zone_m,
    hard_zone_mask,
    load_zone_config,
    resolve_click,
    zone_by_id,
    zone_weight,
    zones_for,
)


def test_zone_config_loads_and_refuses_an_unsupported_axis(tmp_path):
    zcfg = load_zone_config()
    assert zcfg.n_zones >= 1
    assert zcfg.axis == "x"
    assert zcfg.full_zone_id

    bad = tmp_path / "zones.yaml"
    bad.write_text("n_zones: 10\naxis: y\nboundary_fade_m: null\nfull_zone_id: full\n")
    with pytest.raises(ValueError, match="axis"):
        load_zone_config(bad)


def test_numbered_zones_tile_the_panel_with_no_gap_or_overlap(cfg, grid):
    zcfg = load_zone_config()
    numbered = [z for z in zones_for(cfg, grid, zcfg) if not z.is_full]

    assert len(numbered) == zcfg.n_zones
    assert numbered[0].x0_m == pytest.approx(0.0)
    assert numbered[-1].x1_m == pytest.approx(cfg.panel.length_m)
    for a, b in zip(numbered, numbered[1:]):
        assert a.x1_m == pytest.approx(b.x0_m), "zones must meet exactly - a gap loses ground"

    # Each zone spans the whole district width, so n_panels needs no special case.
    half_w = cfg.panel.district_half_width_m
    for z in numbered:
        assert z.y0_m == pytest.approx(-half_w) and z.y1_m == pytest.approx(half_w)


def test_full_zone_covers_every_cell(cfg, grid):
    full = zone_by_id(load_zone_config().full_zone_id, cfg, grid)
    assert full.is_full
    X, Y = grid.centres()
    assert np.all(distance_to_zone_m(full, X, Y) == 0.0), "a cell of the grid is outside 'full'"
    assert np.all(zone_weight(full, grid, boundary_fade_m(cfg, load_zone_config())) == 1.0)


def test_unknown_zone_is_refused_with_the_valid_list(cfg, grid):
    with pytest.raises(ValueError, match="unknown zone"):
        zone_by_id("99", cfg, grid)


def test_zone_weight_is_one_inside_and_zero_well_outside(cfg, grid):
    zcfg = load_zone_config()
    z = zone_by_id("5", cfg, grid, zcfg)
    fade = boundary_fade_m(cfg, zcfg)
    w = zone_weight(z, grid, fade)
    X, Y = grid.centres()
    d = distance_to_zone_m(z, X, Y)

    assert np.all((w >= 0.0) & (w <= 1.0))
    assert np.all(w[d == 0.0] == 1.0)
    assert np.all(w[d > fade] == 0.0)
    # and strictly between at the halfway point of the fade, i.e. it really is a ramp
    mid = (d > 0.4 * fade) & (d < 0.6 * fade)
    if mid.any():
        assert np.all((w[mid] > 0.0) & (w[mid] < 1.0))


def test_zone_weight_defaults_its_fade_to_the_influence_radius(cfg):
    zcfg = load_zone_config()
    assert zcfg.boundary_fade_m is None, "the shipped config should default to r, not pin a number"
    assert boundary_fade_m(cfg, zcfg) == pytest.approx(cfg.r)


def test_a_click_defaults_to_the_zone_centre_and_outside_is_refused(cfg, grid):
    z = zone_by_id("3", cfg, grid)
    assert resolve_click(z) == z.centre_m
    inside = (0.5 * (z.x0_m + z.x1_m), 0.0)
    assert resolve_click(z, *inside) == inside
    with pytest.raises(ValueError, match="outside zone 3"):
        resolve_click(z, z.x1_m + cfg.r, 0.0)
    with pytest.raises(ValueError, match="both"):
        resolve_click(z, inside[0], None)


def test_hard_mask_is_boolean_and_the_weight_is_not(cfg, grid):
    zcfg = load_zone_config()
    z = zone_by_id("5", cfg, grid, zcfg)
    hard = hard_zone_mask(z, grid)
    soft = zone_weight(z, grid, boundary_fade_m(cfg, zcfg))
    assert set(np.unique(hard)) <= {0.0, 1.0}
    assert np.any((soft > 0.0) & (soft < 1.0)), "the zone weight must have a ramp, not just 0 and 1"
