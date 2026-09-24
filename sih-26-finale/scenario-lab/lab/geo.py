"""Single metres <-> lat/lon module for Scenario Lab (WP9 §3, Prompt 2 Sitting B).

Origin: panel_centre_lat_deg 18.6435, panel_centre_lon_deg 79.5725 from
mine-sim/config/mines/adriyala_lw1.yaml (read at runtime via the Config, never copied).

Convention: +x = advance direction at bearing advance_direction_deg (0 = east),
+y = toward tailgate. Equirectangular projection with cos(latitude) scaling on longitude.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple, Union

import numpy as np

from lab.config import LabConfig, load_lab_config
from lab.zones import Zone, zone_by_id


def panel_to_latlon(
    x_m: Union[float, np.ndarray],
    y_m: Union[float, np.ndarray],
    cfg: Any,
    lab_cfg: Optional[LabConfig] = None,
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """Convert panel-frame coordinates (x_m, y_m) to (lat, lon) in degrees.

    Convention:
    +x is the advance direction along bearing advance_direction_deg (0 = east).
    +y is transverse toward tailgate (perpendicular to advance, counter-clockwise / north when advance=0).
    Origin of panel coordinates (0, 0) is at the starting face centre.
    Panel centre (length_m * 0.5, 0) sits at site (panel_centre_lat_deg, panel_centre_lon_deg).
    """
    site = cfg.layout.site or {}
    if "panel_centre_lat_deg" not in site or "panel_centre_lon_deg" not in site:
        raise ValueError("Config.layout.site must specify panel_centre_lat_deg and panel_centre_lon_deg")

    lat0 = float(site["panel_centre_lat_deg"])
    lon0 = float(site["panel_centre_lon_deg"])

    lab = lab_cfg if lab_cfg is not None else load_lab_config()
    m_per_deg_lat = lab.m_per_deg_lat

    # Panel centre along advance is length_m * 0.5; along y is 0.0
    cx = cfg.panel.length_m * 0.5
    cy = 0.0

    x_arr = np.asarray(x_m, dtype=np.float64)
    y_arr = np.asarray(y_m, dtype=np.float64)
    is_scalar = x_arr.ndim == 0 and y_arr.ndim == 0

    dx = x_arr - cx
    dy = y_arr - cy

    theta = np.radians(float(cfg.panel.advance_direction_deg))
    cos_t = np.cos(theta)
    sin_t = np.sin(theta)

    east = cos_t * dx - sin_t * dy
    north = sin_t * dx + cos_t * dy

    m_per_deg_lon = m_per_deg_lat * np.cos(np.radians(lat0))

    lat = lat0 + north / m_per_deg_lat
    lon = lon0 + east / m_per_deg_lon

    if is_scalar:
        return float(lat), float(lon)
    return lat, lon


def latlon_to_panel(
    lat: Union[float, np.ndarray],
    lon: Union[float, np.ndarray],
    cfg: Any,
    lab_cfg: Optional[LabConfig] = None,
) -> Tuple[Union[float, np.ndarray], Union[float, np.ndarray]]:
    """Convert (lat, lon) in degrees to panel-frame coordinates (x_m, y_m).

    Exact inverse of panel_to_latlon.
    """
    site = cfg.layout.site or {}
    if "panel_centre_lat_deg" not in site or "panel_centre_lon_deg" not in site:
        raise ValueError("Config.layout.site must specify panel_centre_lat_deg and panel_centre_lon_deg")

    lat0 = float(site["panel_centre_lat_deg"])
    lon0 = float(site["panel_centre_lon_deg"])

    lab = lab_cfg if lab_cfg is not None else load_lab_config()
    m_per_deg_lat = lab.m_per_deg_lat

    cx = cfg.panel.length_m * 0.5
    cy = 0.0

    lat_arr = np.asarray(lat, dtype=np.float64)
    lon_arr = np.asarray(lon, dtype=np.float64)
    is_scalar = lat_arr.ndim == 0 and lon_arr.ndim == 0

    north = (lat_arr - lat0) * m_per_deg_lat
    m_per_deg_lon = m_per_deg_lat * np.cos(np.radians(lat0))
    east = (lon_arr - lon0) * m_per_deg_lon

    theta = np.radians(float(cfg.panel.advance_direction_deg))
    cos_t = np.cos(theta)
    sin_t = np.sin(theta)

    dx = cos_t * east + sin_t * north
    dy = -sin_t * east + cos_t * north

    x = dx + cx
    y = dy + cy

    if is_scalar:
        return float(x), float(y)
    return x, y


def segment_bounds_latlon(
    segment_id: Union[int, str],
    cfg: Any,
    grid: Any,
    lab_cfg: Optional[LabConfig] = None,
) -> Dict[str, float]:
    """Lat/lon bounds {north, south, east, west} for a segment (1..10 or 'full').

    Uses the same 10-slice split along x as lab/zones.py.
    """
    zone = zone_by_id(str(segment_id), cfg, grid)
    # The 4 corners in panel coordinates
    c0_lat, c0_lon = panel_to_latlon(zone.x0_m, zone.y0_m, cfg, lab_cfg=lab_cfg)
    c1_lat, c1_lon = panel_to_latlon(zone.x0_m, zone.y1_m, cfg, lab_cfg=lab_cfg)
    c2_lat, c2_lon = panel_to_latlon(zone.x1_m, zone.y0_m, cfg, lab_cfg=lab_cfg)
    c3_lat, c3_lon = panel_to_latlon(zone.x1_m, zone.y1_m, cfg, lab_cfg=lab_cfg)

    lats = [c0_lat, c1_lat, c2_lat, c3_lat]
    lons = [c0_lon, c1_lon, c2_lon, c3_lon]

    return {
        "north": float(max(lats)),
        "south": float(min(lats)),
        "east": float(max(lons)),
        "west": float(min(lons)),
    }


def bounds_to_zone(
    bounds: Dict[str, float],
    cfg: Any,
    grid: Any,
    zone_id: str = "custom",
    lab_cfg: Optional[LabConfig] = None,
) -> Zone:
    """Convert a {north, south, east, west} lat/lon bounding box into a Zone for freehand selections."""
    north = float(bounds["north"])
    south = float(bounds["south"])
    east = float(bounds["east"])
    west = float(bounds["west"])

    if north < south:
        raise ValueError(f"north ({north}) must be >= south ({south})")
    if east < west:
        raise ValueError(f"east ({east}) must be >= west ({west})")

    p0_x, p0_y = latlon_to_panel(south, west, cfg, lab_cfg=lab_cfg)
    p1_x, p1_y = latlon_to_panel(south, east, cfg, lab_cfg=lab_cfg)
    p2_x, p2_y = latlon_to_panel(north, west, cfg, lab_cfg=lab_cfg)
    p3_x, p3_y = latlon_to_panel(north, east, cfg, lab_cfg=lab_cfg)

    xs = [p0_x, p1_x, p2_x, p3_x]
    ys = [p0_y, p1_y, p2_y, p3_y]

    x0_m = float(min(xs))
    x1_m = float(max(xs))
    y0_m = float(min(ys))
    y1_m = float(max(ys))

    return Zone(
        id=str(zone_id),
        index=None,
        x0_m=x0_m,
        x1_m=x1_m,
        y0_m=y0_m,
        y1_m=y1_m,
        label=f"Freehand selection ({x0_m:.0f}..{x1_m:.0f}, {y0_m:.0f}..{y1_m:.0f} m)",
    )
