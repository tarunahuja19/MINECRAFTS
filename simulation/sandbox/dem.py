"""
Real digital elevation model of the Adriyala site, resampled onto the
600x600 m simulation panel.

`sandbox/terrain.py` is a SYNTHETIC baseline (planar slope + smoothed noise)
used as this sandbox's deterministic physics substrate; existing tests pin
its output and it must stay untouched. This module is a separate, ADDITIVE
source of ground elevation for VISUALS: a genuine SRTM-derived regional tile
covering the real Adriyala longwall site (18.6435 N, 79.5725 E, Telangana),
shipped at `data/adriyala_dem_regional.json`. It does not feed `surface.py`
or any subsidence physics — it only gives the 3D view a real hill to sit
under the synthetic bowl instead of an invented one.

Units convention (load-bearing): the tile's `elevations` array is stored as
a DELTA about `base_elevation_m`, not absolute metres. Verified on the raw
file: raw min is -124.0, meaningless on its own; `base_elevation_m (208.0) +
raw` reproduces the tile's own declared `min_elevation_m`/`max_elevation_m`
(83/529) exactly. `load_regional_dem()` adds the base once, at load time, so
every other function in this module and its callers only ever see absolute
metres AMSL — the delta convention does not leak past this one function.

Regional vs. panel scale: the tile is a zoom-12 Web Mercator tile, ~36.2
m/pixel, 128 px per side -> ~4.6 km across. The simulation panel is only
`WINDOW_SIZE_M` (600 m) across. So the tile is not "the terrain" directly —
it is a regional context raster that must be resampled DOWN onto the much
smaller, much finer panel grid centred on the same point.
"""

import json
from pathlib import Path

import numpy as np
from scipy.ndimage import map_coordinates

from sandbox.constants import GRID_N, WINDOW_SIZE_M

DEM_PATH = Path(__file__).resolve().parent.parent / "data" / "adriyala_dem_regional.json"

# Web-Mercator tile geometry: 128x128 px per tile side, centre pixel (64, 64).
_TILE_PX = 128
_TILE_CENTER_PX = 64.0


def load_regional_dem() -> dict:
    """Load the raw regional DEM tile and normalise it to absolute elevation.

    Returns a dict with keys:
      'elevations_m'    : (128, 128) float64 array, ABSOLUTE metres AMSL
                          (base_elevation_m already added — see module note).
      'lat', 'lon'      : tile centre coordinates, degrees.
      'zoom'            : Web Mercator zoom level (12).
      'base_elevation_m': the offset that was added to the raw delta array.
      'metres_per_pixel': ground resolution at this tile's latitude/zoom.
      'extent_m'        : full tile width/height in metres (128 * mpp).
    """
    with open(DEM_PATH) as f:
        raw = json.load(f)

    base = float(raw["base_elevation_m"])
    elevations_m = np.asarray(raw["elevations"], dtype=np.float64) + base

    lat = float(raw["lat"])
    zoom = int(raw["zoom"])
    mpp = metres_per_pixel(lat, zoom)

    return {
        "elevations_m": elevations_m,
        "lat": lat,
        "lon": float(raw["lon"]),
        "zoom": zoom,
        "base_elevation_m": base,
        "metres_per_pixel": mpp,
        "extent_m": _TILE_PX * mpp,
    }


def metres_per_pixel(lat: float, zoom: int) -> float:
    """Web-Mercator ground resolution in metres/pixel at `lat`, `zoom`.

    Standard formula: the equator's resolution at zoom z (156543.03392 m/px,
    from the 2*pi*earth_radius / 256px tile convention) shrinks by cos(lat)
    away from the equator, since Web Mercator preserves angle, not area —
    pixels near the poles cover less ground than pixels at the equator for
    the same tile. At (18.6435, 12) this comes out to ~36.2 m/pixel.
    """
    return 156543.03392 * np.cos(np.radians(lat)) / (2**zoom)


def _resample(elevations_m: np.ndarray, mpp: float, n: int, window_m: float) -> np.ndarray:
    """Bicubic-resample the regional tile onto an (n, n) grid covering a
    `window_m`-wide square centred on the tile centre.

    The panel's (X, Y) metre coordinates are mapped to fractional tile-pixel
    coordinates and sampled with `map_coordinates(order=3)` (bicubic, matching
    the smoothness already present in genuine terrain — a nearest/linear
    resample would introduce faceting the source data does not have).
    `mode="reflect"` rather than "constant"/0 because the panel window is
    fully inside the tile for any sane WINDOW_SIZE_M; reflect only matters at
    the tile's own edge and avoids fabricating a false slope to zero there.

    Pixel mapping (centre of the 128x128 tile is pixel (64, 64)):
        px = 64 + X / mpp
        py = 64 - Y / mpp
    The MINUS on py is not a typo: image/array row index increases
    downward/south while the simulation's Y axis increases north, so without
    the sign flip the resampled panel is mirrored north-south — the terrain
    would still "look plausible" (real elevation values, real texture) while
    being silently flipped, which is the kind of bug that survives casual
    inspection.
    """
    half = window_m / 2.0
    axis = np.linspace(-half, half, n)
    X, Y = np.meshgrid(axis, axis)

    px = _TILE_CENTER_PX + X / mpp
    py = _TILE_CENTER_PX - Y / mpp

    # map_coordinates indexes as [row, col] = [py, px].
    resampled = map_coordinates(
        elevations_m, [py, px], order=3, mode="reflect"
    )
    return resampled


# Cache the default panel resample at import time, the way surface.py
# precomputes `_BASE_S` once: the regional tile and the default panel
# geometry never change at runtime, so recomputing the bicubic resample on
# every call would be pure waste. Non-default (n, window_m) still recompute.
_REGIONAL = load_regional_dem()
_PANEL_DEM = _resample(
    _REGIONAL["elevations_m"], _REGIONAL["metres_per_pixel"], GRID_N, WINDOW_SIZE_M
)


def panel_dem(n: int = GRID_N, window_m: float = WINDOW_SIZE_M) -> np.ndarray:
    """Real terrain elevation, absolute metres AMSL, resampled onto an
    (n, n) grid over the `window_m`-wide simulation panel, centred on the
    regional tile's centre (which is also the panel's origin).

    With default arguments this returns the module-level cached grid; any
    other (n, window_m) recomputes the bicubic resample fresh.
    """
    if n == GRID_N and window_m == WINDOW_SIZE_M:
        return _PANEL_DEM
    return _resample(_REGIONAL["elevations_m"], _REGIONAL["metres_per_pixel"], n, window_m)


def elevation_at(x, y) -> np.ndarray | float:
    """Real ground elevation, absolute metres AMSL, at panel coordinate(s) (x, y).

    This samples the REGIONAL tile directly rather than the cached
    `panel_dem()` grid, and that is the whole point of the function: the
    panel grid only covers `WINDOW_SIZE_M` (600 m), while some nodes live
    outside it — the Tier-3 gateway N31 sits at about (826, -711) m, placed
    beyond the angle of draw on purpose. Interpolating it from the panel
    grid would clamp it to the window edge and give it a confidently wrong
    height. The regional tile is ~4.6 km across, so it contains N31 with
    room to spare.

    Uses the same pixel mapping and bicubic interpolation as `_resample`,
    including the deliberate MINUS on `py` (array rows run south, the
    simulation's Y axis runs north). `mode="reflect"` matches too, so a
    point near the tile edge degrades the same way the panel resample does
    instead of falling off to zero.

    Accepts scalars or arrays. Returns a float for scalar input, otherwise
    an array shaped like the broadcast inputs.
    """
    mpp = _REGIONAL["metres_per_pixel"]
    X = np.asarray(x, dtype=np.float64)
    Y = np.asarray(y, dtype=np.float64)
    scalar = (X.ndim == 0 and Y.ndim == 0)
    X, Y = np.broadcast_arrays(X, Y)

    px = _TILE_CENTER_PX + X / mpp
    py = _TILE_CENTER_PX - Y / mpp

    z = map_coordinates(
        _REGIONAL["elevations_m"],
        [py.ravel(), px.ravel()],
        order=3,
        mode="reflect",
    ).reshape(X.shape)

    return float(z) if scalar else z


def elevation_stats(Z: np.ndarray, window_m: float = WINDOW_SIZE_M) -> dict:
    """Summary statistics for an elevation grid `Z`: min/max/mean/relief in
    metres, and slope statistics in degrees.

    Slope is estimated with `np.gradient` (central differences, forward/back
    at the edges) at the grid's true spacing `window_m / (n - 1)`, then
    combined into a scalar gradient magnitude per cell:
        slope_deg = degrees(arctan(hypot(dz/dx, dz/dy)))
    This is a diagnostic/reporting statistic only (unlike `surface.py`'s
    subsidence derivatives, which must be analytic-kernel convolutions
    because they feed strain detection) — finite-differencing real,
    already-noisy terrain for a summary max/mean slope has no downstream
    physics to corrupt.
    """
    n = Z.shape[0]
    spacing = window_m / (n - 1)
    gy, gx = np.gradient(Z, spacing)
    slope_deg = np.degrees(np.arctan(np.hypot(gx, gy)))

    return {
        "min_m": float(Z.min()),
        "max_m": float(Z.max()),
        "mean_m": float(Z.mean()),
        "relief_m": float(Z.max() - Z.min()),
        "slope_mean_deg": float(slope_deg.mean()),
        "slope_max_deg": float(slope_deg.max()),
    }
