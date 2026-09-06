"""
The single metres <-> lat/lon link between the simulation and every display.

The physics in this sandbox is expressed purely in METRES about the panel
centre (x=0, y=0), over the 600x600 m window defined by
`constants.WINDOW_SIZE_M`. Every display surface — the dashboard map, the
sector grid, the Three.js terrain — needs geographic coordinates instead.
This module is the ONLY place that conversion is defined. Nothing else in
the tree may hand-roll a metres->degrees factor: if two places disagree the
map and the physics silently drift apart, which is exactly the bug this
module exists to remove.

The anchor is the real Adriyala longwall site in Telangana (18.6435 N,
79.5725 E), already used by `dem.py` for the SRTM tile and reported by
`server.py` as `dem_lat`/`dem_lon`. Those literals stay where they are;
this module is the authority they agree with.

Projection: flat-earth (equirectangular) about the origin. Over a 600 m
window the error against a proper geodesic is well under a metre — far
below anything the sensors or the map resolve — and it keeps the inverse
exact, so a round trip through xy_to_latlon/latlon_to_xy returns the input.
"""

from __future__ import annotations

import math

# ---------------------------------------------------------------------------
# Anchor constants
# ---------------------------------------------------------------------------

ORIGIN_LAT = 18.6435     # panel centre (x=0, y=0), Adriyala, Telangana
ORIGIN_LON = 79.5725

# ASSUMPTION - the true compass bearing of the Adriyala panel's long axis was
# not found in this repo or in open literature, so +y is treated as due north
# and +x as due east. This is the ONE constant to change if SCCL/CIL data ever
# gives the real bearing: because every consumer (nodes, sector grid, terrain)
# reads its coordinates through this module, changing this number rotates the
# whole picture together and keeps it self-consistent. Flag to SCCL/CIL.
PANEL_BEARING_DEG = 0.0

# Metres per degree of latitude, spherical-earth mean. Constant with latitude
# for our purposes; the longitude scale is the one that varies.
M_PER_DEG_LAT = 111320.0

# At 18.6435 N, cos(lat) = 0.9475, so one degree of longitude is ~105,480 m.
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(ORIGIN_LAT))


def _rotate(x: float, y: float, deg: float) -> tuple[float, float]:
    """Rotate a panel-frame vector into the east/north frame by `deg` clockwise
    from north. With PANEL_BEARING_DEG = 0.0 this is the identity, and it is
    written to be exactly the identity (no floating-point drift) in that case
    so the default path is bit-for-bit clean."""
    if deg == 0.0:
        return x, y
    r = math.radians(deg)
    cos_r, sin_r = math.cos(r), math.sin(r)
    east = x * cos_r + y * sin_r
    north = -x * sin_r + y * cos_r
    return east, north


def xy_to_latlon(x: float, y: float) -> tuple[float, float]:
    """Panel-frame metres -> (lat, lon) degrees.

    x is across strike (+east at bearing 0), y is along strike (+north).
    """
    east, north = _rotate(x, y, PANEL_BEARING_DEG)
    lat = ORIGIN_LAT + north / M_PER_DEG_LAT
    lon = ORIGIN_LON + east / M_PER_DEG_LON
    return lat, lon


def latlon_to_xy(lat: float, lon: float) -> tuple[float, float]:
    """(lat, lon) degrees -> panel-frame metres. Exact inverse of
    `xy_to_latlon`, so callers can round-trip without drift."""
    north = (lat - ORIGIN_LAT) * M_PER_DEG_LAT
    east = (lon - ORIGIN_LON) * M_PER_DEG_LON
    # Inverse rotation is a rotation by the negated bearing.
    x, y = _rotate(east, north, -PANEL_BEARING_DEG)
    return x, y
