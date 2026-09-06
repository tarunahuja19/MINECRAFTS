"""
Elevation analysis and industry-standard cartographic colouring for the real
Adriyala DEM panel (`sandbox/dem.py`).

Everything here is presentation logic, not physics: contour intervals, a
hillshade, engineering slope classification, aspect, and a hypsometric tint.
None of it feeds `surface.py` / `collapse.py` and none of it is randomised —
each function is a pure transform of an elevation grid `Z`.
"""

import numpy as np

from sandbox.constants import WINDOW_SIZE_M

# Hypsometric tint ramp: the conventional cartographic elevation sequence -
# green lowland -> yellow mid slope -> tan/brown upland -> red-brown summit.
# This is the Imhof / Bartholomew / Peucker convention that has been standard
# on physical maps for over 150 years, so it reads without a legend.
#
# MUST MATCH `TERRAIN_STOPS` in frontend/src/utils/hypsometry.ts exactly - the
# browser and any server-rendered figure colour the same DEM, so a divergence
# here means the two disagree about what elevation a tint means. See that
# file for the measured lightness trade-off this ramp accepts.
#
# This replaces a direct sampling of matplotlib's `gist_earth`, which was the
# wrong instrument for this panel. gist_earth reserves its bottom third for
# deep ocean (#000000 -> #102977 -> #215e7b), but Adriyala is entirely dry
# land at 196-370 m AMSL, so a third of the ramp encoded a condition that
# cannot occur here while real relief was compressed into what remained. The
# saturated blue-to-green-to-white sweep also read as a false biome gradient:
# viewers see "water, forest, snow" where the ground is uniformly dry
# Gondwana scrub, and the high chroma fights the red/amber hazard overlays
# that have to stay legible on top of it.
#
# Properties this ramp is built to hold, all checked in tests/test_dem.py:
#   - luminance increases monotonically across every stop, so relief still
#     reads correctly in greyscale, under colour-blind simulation, and on a
#     projector — height is carried by lightness, not by hue alone;
#   - peak saturation 0.28, well below the ~0.6+ of the old ramp, leaving
#     saturated red/amber free to mean "hazard" and nothing else;
#   - it never reaches black, so no ground reads as a hole (see RAMP_FLOOR,
#     which existed only to work around gist_earth's ocean-black bottom).
#
# Stops are (t, "#rrggbb") with t in [0, 1]; `hypsometric_color` linearly
# interpolates between them.
TERRAIN_STOPS: list[tuple[float, str]] = [
    (0.00, "#3f7a3a"),  # lowland - green
    (0.15, "#5b9440"),  # rising lowland
    (0.30, "#87ad45"),  # green-yellow transition
    (0.45, "#bcbf55"),  # mid slope - yellow
    (0.60, "#c9a052"),  # yellow-tan
    (0.75, "#b87844"),  # upland - tan/brown
    (0.88, "#9c5334"),  # high ground - red-brown
    (1.00, "#7d3527"),  # summit - deep red-brown
]

# Retained so existing importers keep working; the ramp is no longer
# gist_earth, hence the new name above is the one to use.
GIST_EARTH_STOPS = TERRAIN_STOPS

# Engineering slope classification bands, in degrees. These thresholds are
# the conventional geotechnical bands used for slope-stability and
# excavation-risk screening (gentle grade -> walkable -> equipment-limited
# -> near angle-of-repose for loose rock -> effectively a cliff face).
_SLOPE_BANDS: list[tuple[str, float, float]] = [
    ("gentle", 0.0, 5.0),
    ("moderate", 5.0, 15.0),
    ("steep", 15.0, 30.0),
    ("very_steep", 30.0, 45.0),
    ("cliff", 45.0, np.inf),
]

# The 1/2/5 x 10^n series: the standard "nice number" progression used to
# choose map intervals (contour spacing, axis ticks, etc.) because every
# step is either double or 2.5x the previous one, so no candidate interval
# is ever more than ~2x away from whatever the data actually calls for.
_NICE_SERIES = (1.0, 2.0, 5.0)


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def hypsometric_color(t: float) -> tuple[int, int, int]:
    """Map normalised elevation `t` in [0, 1] to an RGB triple by linearly
    interpolating between the `GIST_EARTH_STOPS`.

    Callers should normalise real elevation to `t` themselves (see the
    module note on where to start the ramp for above-sea-level terrain,
    e.g. in a panel-colouring helper) — this function just walks the stops.
    """
    t = float(np.clip(t, 0.0, 1.0))
    stops = GIST_EARTH_STOPS
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t0 <= t <= t1:
            frac = 0.0 if t1 == t0 else (t - t0) / (t1 - t0)
            r0, g0, b0 = _hex_to_rgb(c0)
            r1, g1, b1 = _hex_to_rgb(c1)
            return (
                round(r0 + frac * (r1 - r0)),
                round(g0 + frac * (g1 - g0)),
                round(b0 + frac * (b1 - b0)),
            )
    # t == 1.0 falls through the loop's closed interval on the last stop
    # only if float rounding pushes it fractionally past 1.0; clip above
    # already guarantees t is in-range, so this is unreachable in practice
    # but returning the top stop is the only sane fallback if it ever fires.
    return _hex_to_rgb(stops[-1][1])


# Lowest point on the ramp that terrain is allowed to reach.
#
# This was 0.1 to keep land off the old gist_earth ramp's ocean-black bottom.
# TERRAIN_STOPS starts at a legible lowland green (#3f7a3a) instead, so there
# is no longer a dead zone to skip and the floor is 0.0: the full ramp is
# usable, and the valley floor gets the ramp's green rather than an
# arbitrary 10% offset that silently discarded a tenth of the colour range.
#
# Kept as a named constant (rather than deleted) because `elevation_to_color`
# takes it as a tunable parameter and the frontend legend draws the ramp from
# it — both sides must agree on where the ramp starts or the legend stops
# describing the mesh.
RAMP_FLOOR = 0.0


def elevation_to_color(
    z: float, z_min: float, z_max: float, floor: float = RAMP_FLOOR
) -> tuple[int, int, int]:
    """Colour an absolute elevation `z` by hypsometric tint.

    Normalises `z` over the real [z_min, z_max] range and remaps it into
    [floor, 1.0] before sampling the ramp, so above-sea-level terrain never
    reaches the ramp's ocean-black bottom. This is the function callers should
    use for terrain; `hypsometric_color` is the raw ramp walk beneath it.
    """
    if z_max <= z_min:
        return hypsometric_color(floor)
    t = (float(z) - z_min) / (z_max - z_min)
    t = float(np.clip(t, 0.0, 1.0))
    return hypsometric_color(floor + t * (1.0 - floor))


def hypsometric_normalise(Z: "np.ndarray", strength: float = 0.7) -> "np.ndarray":
    """Map elevations to ramp position [0,1] using the terrain's own distribution.

    Real relief is rarely uniformly distributed. On this panel the median
    elevation (211.0 m) sits only 9% of the way up the 196-370 m range, so a
    straight linear stretch squeezes more than half the ground into the bottom
    9% of the colour ramp and renders it as one dark blue mass — detail that is
    present in the data is thrown away by the colouring.

    Cartographers solve this with a hypsometric (cumulative-area) stretch:
    colour is assigned by the *rank* of an elevation within the surface rather
    than its raw value, so equal areas of ground receive equal shares of the
    ramp. That is histogram equalisation, and it is why hypsometric tints on
    published sheets show detail in both lowland and highland.

    `strength` blends between the two: 0.0 is a pure linear stretch (physically
    proportional, poor contrast), 1.0 is full equalisation (maximum contrast,
    but colour no longer maps linearly to height). The 0.7 default keeps the
    ramp broadly monotonic in elevation while recovering lowland detail.

    Returns an array in [0, 1] with the same shape as `Z`.
    """
    Z = np.asarray(Z, dtype=float)
    z_min, z_max = float(Z.min()), float(Z.max())
    if z_max <= z_min:
        return np.zeros_like(Z)

    linear = (Z - z_min) / (z_max - z_min)

    # Rank each cell within the surface -> cumulative area fraction.
    flat = Z.ravel()
    order = np.argsort(flat, kind="stable")
    ranks = np.empty(flat.size, dtype=float)
    ranks[order] = np.arange(flat.size, dtype=float)
    equalised = (ranks / max(1.0, flat.size - 1.0)).reshape(Z.shape)

    s = float(np.clip(strength, 0.0, 1.0))
    return np.clip((1.0 - s) * linear + s * equalised, 0.0, 1.0)


def contour_levels(z_min: float, z_max: float, target_count: int = 12) -> dict:
    """Choose a survey-convention contour interval for the range [z_min, z_max].

    Topographic sheets pick contour spacing from the 1/2/5 x 10^n series
    (e.g. 1, 2, 5, 10, 20, 50, 100 m) rather than an arbitrary round number,
    because it is the standard "nice number" progression: candidates are
    at most a factor of ~2 apart, so there is always one that lands the
    contour count in the readable band without ever needing an odd
    interval like "7 m". This picks the 1/2/5 candidate whose resulting
    contour count is closest to `target_count`, subject to landing in the
    conventional 8-15 readable band when any candidate can.

    The index (heavier-drawn) contour is every 5th interval line, per
    standard topographic map convention (e.g. USGS quads: index contours
    every 5th line, labelled; intermediate contours unlabelled).

    Returns {'interval_m', 'index_m', 'levels', 'index_levels'}.
    """
    relief = z_max - z_min
    if relief <= 0:
        raise ValueError("z_max must exceed z_min to choose a contour interval")

    # Build 1/2/5 x 10^n candidates spanning a wide enough range that at
    # least one gives a contour count in [8, 15] for any realistic relief.
    exponents = range(-2, 6)
    candidates = sorted(
        m * (10.0**e) for e in exponents for m in _NICE_SERIES
    )

    def count_for(interval: float) -> int:
        return int(np.floor(z_max / interval) - np.ceil(z_min / interval) + 1)

    in_band = [c for c in candidates if 8 <= count_for(c) <= 15]
    if in_band:
        # Prefer the candidate whose count is closest to target_count.
        interval = min(in_band, key=lambda c: abs(count_for(c) - target_count))
    else:
        # No candidate lands in-band (relief too small/large for this
        # series' range) — fall back to whichever candidate's count is
        # numerically closest to target_count.
        interval = min(candidates, key=lambda c: abs(count_for(c) - target_count))

    index_interval = interval * 5.0

    first_level = np.ceil(z_min / interval) * interval
    levels = np.arange(first_level, z_max + interval, interval)
    levels = levels[levels <= z_max + 1e-9]

    first_index = np.ceil(z_min / index_interval) * index_interval
    index_levels = np.arange(first_index, z_max + index_interval, index_interval)
    index_levels = index_levels[index_levels <= z_max + 1e-9]

    return {
        "interval_m": float(interval),
        "index_m": float(index_interval),
        "levels": levels.tolist(),
        "index_levels": index_levels.tolist(),
    }


def _slope_aspect_components(Z: np.ndarray, window_m: float) -> tuple[np.ndarray, np.ndarray, float]:
    """Shared dz/dx, dz/dy and grid spacing for hillshade/slope/aspect, so
    the three functions agree on exactly one gradient estimate of `Z`."""
    n = Z.shape[0]
    spacing = window_m / (n - 1)
    dz_dy, dz_dx = np.gradient(Z, spacing)
    return dz_dx, dz_dy, spacing


def hillshade(
    Z: np.ndarray,
    window_m: float = WINDOW_SIZE_M,
    azimuth_deg: float = 315.0,
    altitude_deg: float = 45.0,
) -> np.ndarray:
    """Horn (1981) analytical hillshade of `Z`, values clipped to [0, 1].

    Horn, B.K.P. (1981), "Hill shading and the reflectance map",
    Proceedings of the IEEE 69(1), pp. 14-47 — the standard finite-difference
    hillshade algorithm used by GIS tools (ESRI, GDAL `gdaldem hillshade`,
    QGIS) for exactly this z_factor/slope/aspect/Lambertian-reflectance
    formulation:
        slope  = arctan(hypot(dz/dx, dz/dy))
        aspect = arctan2(dz/dy, -dz/dx)
        shaded = sin(alt)*cos(slope) + cos(alt)*sin(slope)*cos(az - aspect)

    Azimuth 315 deg (NW) and altitude 45 deg are the cartographic default
    (matching ESRI/GDAL defaults) because human relief perception is
    strongly biased to reading illumination as coming from the upper-left:
    lit from that direction, convex terrain reads as convex. Light the same
    terrain from the opposite (SE) side and the visual system's prior
    inverts it — ridges read as valleys and vice versa — even though the
    underlying elevation data has not changed at all.
    """
    dz_dx, dz_dy, _ = _slope_aspect_components(Z, window_m)

    slope = np.arctan(np.hypot(dz_dx, dz_dy))
    aspect = np.arctan2(dz_dy, -dz_dx)

    az = np.radians(azimuth_deg)
    alt = np.radians(altitude_deg)

    shaded = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shaded, 0.0, 1.0)


def slope_classes(Z: np.ndarray, window_m: float = WINDOW_SIZE_M) -> dict:
    """Classify `Z`'s per-cell slope into engineering bands and report the
    percentage of panel area in each.

    Bands (degrees): gentle 0-5, moderate 5-15, steep 15-30,
    very_steep 30-45, cliff >45 — the conventional geotechnical screening
    bands (walkable grade / equipment-limited / near angle-of-repose for
    loose rock / cliff face). Returns {'bands': {name: pct}, 'slope_deg': array}.
    """
    dz_dx, dz_dy, _ = _slope_aspect_components(Z, window_m)
    slope_deg = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))

    total = slope_deg.size
    bands = {}
    for name, lo, hi in _SLOPE_BANDS:
        count = np.count_nonzero((slope_deg >= lo) & (slope_deg < hi))
        bands[name] = float(100.0 * count / total)

    return {"bands": bands, "slope_deg": slope_deg}
