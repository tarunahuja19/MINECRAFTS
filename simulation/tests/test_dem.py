"""
Tests for the real Adriyala DEM pipeline (`sandbox/dem.py`,
`sandbox/hypsometry.py`) and its exposure over the WebSocket wire protocol.

This is terrain/visuals only — no physics assertions here; those live in
`test_session_*` and stay untouched.
"""

import numpy as np
import pytest
from starlette.testclient import TestClient

from sandbox import dem, hypsometry
from sandbox.server import app


def test_dem_loads_with_absolute_elevation():
    """The raw tile is a delta about base_elevation_m; load_regional_dem()
    must return ABSOLUTE metres AMSL with the base already added."""
    raw = dem.load_regional_dem()
    assert raw["elevations_m"].shape == (128, 128)
    assert raw["base_elevation_m"] == pytest.approx(208.0)
    assert raw["elevations_m"].min() == pytest.approx(84.0, abs=2.0)
    assert raw["elevations_m"].max() == pytest.approx(529.0, abs=2.0)


def test_metres_per_pixel_matches_web_mercator():
    assert dem.metres_per_pixel(18.6435, 12) == pytest.approx(36.2, abs=0.3)


def test_panel_dem_shape_and_relief():
    Z = dem.panel_dem()
    assert Z.shape == (241, 241)
    assert not np.isnan(Z).any()
    assert not np.isinf(Z).any()

    stats = dem.elevation_stats(Z)
    assert 150.0 <= stats["relief_m"] <= 200.0
    assert stats["min_m"] > 150.0
    assert stats["max_m"] < 450.0


def test_panel_dem_deterministic():
    """No randomness anywhere in the resample pipeline — two calls must be
    bit-identical, matching this sandbox's determinism convention."""
    Z1 = dem.panel_dem()
    Z2 = dem.panel_dem()
    assert np.array_equal(Z1, Z2)


def test_contour_levels_readable_count():
    Z = dem.panel_dem()
    stats = dem.elevation_stats(Z)
    cl = hypsometry.contour_levels(stats["min_m"], stats["max_m"])

    assert 8 <= len(cl["levels"]) <= 15
    # Index contour is every 5th interval, per topographic-sheet convention.
    remainder = cl["index_m"] % cl["interval_m"]
    assert remainder == pytest.approx(0.0, abs=1e-6) or remainder == pytest.approx(
        cl["interval_m"], abs=1e-6
    )


def test_hillshade_bounded():
    Z = dem.panel_dem()
    hs = hypsometry.hillshade(Z)

    assert hs.shape == Z.shape
    assert not np.isnan(hs).any()
    assert hs.min() >= 0.0
    assert hs.max() <= 1.0


def test_slope_classes_sum_to_100():
    Z = dem.panel_dem()
    sc = hypsometry.slope_classes(Z)

    assert sum(sc["bands"].values()) == pytest.approx(100.0, abs=1e-6)


def test_server_init_payload_carries_dem_metadata():
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as ws:
            init_data = ws.receive_json()

    assert init_data["type"] == "init"
    assert len(init_data["z0_mesh"]) == 121
    assert len(init_data["z0_mesh"][0]) == 121
    assert init_data["elev_relief_m"] == pytest.approx(174.0, abs=25.0)
    assert init_data["dem_source"] == "adriyala_regional_z12"
    assert init_data["contour_interval_m"] > 0


def test_elevation_to_color_never_renders_ground_as_a_hole():
    """No ground on an above-sea-level panel may render dark enough to read
    as a hole, and neighbouring elevations must stay tellable apart.

    This previously asserted gist_earth's specific look — that low ground is
    blue-dominant and the summit near-white. Those described one palette
    rather than the property being protected, and gist_earth was the wrong
    instrument here: it spends its bottom third on deep ocean that this dry
    land panel (196-370 m AMSL) can never contain. The assertions below are
    on the invariants that must hold for ANY terrain ramp, so a future
    palette change is judged on whether terrain stays readable.
    """
    Z = dem.panel_dem()
    z_min, z_max = float(Z.min()), float(Z.max())

    lowest = hypsometry.elevation_to_color(z_min, z_min, z_max)
    highest = hypsometry.elevation_to_color(z_max, z_min, z_max)

    def luminance(rgb: tuple[int, int, int]) -> float:
        r, g, b = rgb
        return 0.2126 * r + 0.7152 * g + 0.0722 * b

    # 1. The valley floor must be clearly lit ground, never a black pit.
    assert luminance(lowest) > 45.0, f"valley floor reads as a hole: {lowest}"

    # 2. No stop anywhere on the ramp may read as a hole either — the darkest
    #    tint is now the SUMMIT (red-brown), not the valley, so checking only
    #    the endpoints would miss it.
    for stop_t, _ in hypsometry.TERRAIN_STOPS:
        rgb = hypsometry.hypsometric_color(stop_t)
        assert luminance(rgb) > 45.0, f"stop t={stop_t} reads as a hole: {rgb}"

    # 3. Adjacent elevations must stay TELLABLE APART. This replaces an
    #    assertion that lightness rise monotonically from valley to summit,
    #    which encoded one specific palette rather than the property being
    #    protected. The ramp is now the standard cartographic hypsometric
    #    sequence (green lowland -> yellow -> red-brown summit), whose entire
    #    premise is that HUE carries elevation; its lightness necessarily
    #    peaks at the yellow mid-stop and falls to the summit, so monotonicity
    #    is not available and not what makes terrain readable here.
    #
    #    Two things carry relief instead: hue separation between neighbouring
    #    bands, and the Horn hillshade composited over the tint. What must not
    #    happen is two ADJACENT samples collapsing into the same colour, so
    #    that is what is asserted.
    samples = [
        hypsometry.hypsometric_color(t) for t in np.linspace(0.0, 1.0, 24)
    ]
    for a, b in zip(samples, samples[1:]):
        dist = sum((int(x) - int(y)) ** 2 for x, y in zip(a, b)) ** 0.5
        assert dist > 1.0, f"adjacent ramp samples collapse together: {a} vs {b}"

    # 4. End to end the ramp must travel far enough in colour that the valley
    #    and the summit are unmistakably different ground.
    span = sum((int(x) - int(y)) ** 2 for x, y in zip(lowest, highest)) ** 0.5
    assert span > 80.0, f"ramp does not span enough colour: {lowest} -> {highest}"

    # NOTE: the subsidence ramp keeps the greyscale guarantee this one gives
    # up — it is the measured signal, so lightness must fall monotonically
    # with depth. That ramp lives client-side only (GROUND_CHANGE_STOPS in
    # frontend/src/utils/hypsometry.ts) and is asserted by `npm run
    # verify:physics`, so it is not re-checked here.

    # A degenerate range must not divide by zero.
    flat = hypsometry.elevation_to_color(200.0, 200.0, 200.0)
    assert len(flat) == 3
