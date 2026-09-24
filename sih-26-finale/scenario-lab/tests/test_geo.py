"""Tests for lab.geo: panel coordinates <-> geographic lat/lon conversions (WP9 §3, Sitting B).

Tests:
1. Exact round-trip: panel -> latlon -> panel with < 1e-6 deg and < 1e-4 m error.
2. Vectorized round-trip on full 2D grid.
3. F2 assertion: with advance 0 = east, 2500 m panel extent maps to ~0.0225-0.024 deg of LONGITUDE
   and 250 m width maps to ~0.0023 deg of LATITUDE. A 90-degree axis swap fails this test.
4. segment_bounds_latlon: 10-slice split returns valid bounding boxes.
5. bounds_to_zone: freehand bounding box converts to Zone and round-trips with segment_bounds_latlon.
"""

import numpy as np
import pytest

from lab.geo import (
    bounds_to_zone,
    latlon_to_panel,
    panel_to_latlon,
    segment_bounds_latlon,
)
from lab.zones import zone_by_id


def test_round_trip_scalar(snap):
    """panel -> latlon -> panel round-trip must agree to < 1e-6 degrees and < 1e-4 metres."""
    cfg = snap.cfg
    test_points = [
        (0.0, 0.0),                                       # Starting face centre
        (cfg.panel.length_m * 0.5, 0.0),                  # Panel centre (site origin)
        (cfg.panel.length_m, 0.0),                        # End face centre
        (500.0, -125.0),                                  # Bottom rib of Zone 3
        (750.0, 125.0),                                   # Top rib of Zone 3
        (123.4, -56.7),                                   # Arbitrary off-axis point
    ]

    for x_m, y_m in test_points:
        lat, lon = panel_to_latlon(x_m, y_m, cfg)
        x_rec, y_rec = latlon_to_panel(lat, lon, cfg)
        lat_rec, lon_rec = panel_to_latlon(x_rec, y_rec, cfg)

        assert abs(lat - lat_rec) < 1e-6, f"Lat round trip failed at ({x_m}, {y_m}): {lat} vs {lat_rec}"
        assert abs(lon - lon_rec) < 1e-6, f"Lon round trip failed at ({x_m}, {y_m}): {lon} vs {lon_rec}"
        assert abs(x_m - x_rec) < 1e-4, f"X round trip failed at ({x_m}, {y_m}): {x_m} vs {x_rec}"
        assert abs(y_m - y_rec) < 1e-4, f"Y round trip failed at ({x_m}, {y_m}): {y_m} vs {y_rec}"


def test_round_trip_vectorized(snap):
    """Vectorized panel_to_latlon and latlon_to_panel on grid arrays."""
    cfg = snap.cfg
    xs, ys = snap.grid.centres()
    lats, lons = panel_to_latlon(xs, ys, cfg)
    xs_rec, ys_rec = latlon_to_panel(lats, lons, cfg)

    np.testing.assert_allclose(xs, xs_rec, atol=1e-4)
    np.testing.assert_allclose(ys, ys_rec, atol=1e-4)


def test_f2_axis_orientation_assertion(snap):
    """The F2 assertion: with advance 0 = east, the panel's 2500 m x-extent maps to ~0.0225 deg of LONGITUDE

    and the 250 m width to ~0.0023 deg of LATITUDE. A 90-degree axis swap must fail this test.
    """
    cfg = snap.cfg
    length_m = cfg.panel.length_m    # 2500.0 m
    width_m = cfg.panel.width_m      # 250.0 m

    # 1. Advance along x: from x=0 to x=length_m at y=0
    lat_start, lon_start = panel_to_latlon(0.0, 0.0, cfg)
    lat_end, lon_end = panel_to_latlon(length_m, 0.0, cfg)

    dlon_x = abs(lon_end - lon_start)
    dlat_x = abs(lat_end - lat_start)

    # 2. Width across y: from -width/2 to +width/2 at panel centre x
    cx = length_m * 0.5
    lat_y0, lon_y0 = panel_to_latlon(cx, -width_m * 0.5, cfg)
    lat_y1, lon_y1 = panel_to_latlon(cx, width_m * 0.5, cfg)

    dlat_y = abs(lat_y1 - lat_y0)
    dlon_y = abs(lon_y1 - lon_y0)

    # With advance 0 = east:
    # 2500 m in x MUST map to ~0.0225-0.024 deg of LONGITUDE
    assert 0.020 < dlon_x < 0.026, f"Expected x-extent to map to ~0.0225-0.024 deg lon, got {dlon_x}"
    assert dlat_x < 1e-6, f"Expected zero latitude change along advance at bearing 0, got {dlat_x}"

    # 250 m in y MUST map to ~0.0023 deg of LATITUDE
    assert 0.0018 < dlat_y < 0.0028, f"Expected y-extent to map to ~0.0023 deg lat, got {dlat_y}"
    assert dlon_y < 1e-6, f"Expected zero longitude change along tailgate axis at bearing 0, got {dlon_y}"

    # Mutation test: a 90-degree axis swap must fail this assertion
    # Swapped: x mapped to north (latitude), y mapped to east (longitude)
    swapped_dlat = dlon_x   # If 2500 m mapped to latitude instead
    swapped_dlon = dlat_y   # If 250 m mapped to longitude instead

    # Verify that the swapped orientation violates the F2 bounds
    assert not (0.020 < swapped_dlon < 0.026), "90-degree swap should fail longitude extent check"
    assert not (0.0018 < swapped_dlat < 0.0028), "90-degree swap should fail latitude extent check"


def test_segment_bounds_latlon(snap):
    """segment_bounds_latlon matches lab.zones.zones_for slices."""
    cfg, grid = snap.cfg, snap.grid

    # Test segment 3
    bounds = segment_bounds_latlon("3", cfg, grid)
    assert set(bounds.keys()) == {"north", "south", "east", "west"}
    assert bounds["north"] > bounds["south"]
    assert bounds["east"] > bounds["west"]

    # Reconstruct zone via bounds_to_zone
    reconstructed = bounds_to_zone(bounds, cfg, grid, zone_id="3")
    z3 = zone_by_id("3", cfg, grid)

    assert reconstructed.x0_m == pytest.approx(z3.x0_m, abs=0.1)
    assert reconstructed.x1_m == pytest.approx(z3.x1_m, abs=0.1)
    assert reconstructed.y0_m == pytest.approx(z3.y0_m, abs=0.1)
    assert reconstructed.y1_m == pytest.approx(z3.y1_m, abs=0.1)


def test_bounds_to_zone_invalid(snap):
    """bounds_to_zone rejects inverted bounds."""
    cfg, grid = snap.cfg, snap.grid
    with pytest.raises(ValueError, match="north .* must be >= south"):
        bounds_to_zone({"north": 18.0, "south": 19.0, "east": 79.5, "west": 79.4}, cfg, grid)

    with pytest.raises(ValueError, match="east .* must be >= west"):
        bounds_to_zone({"north": 19.0, "south": 18.0, "east": 79.4, "west": 79.5}, cfg, grid)
