#!/usr/bin/env python3
"""Fetch the real ground elevation (DEM) around a mine's panel and store it in panel coordinates.

Source: AWS Open Data "Terrain Tiles" (terrarium PNG encoding), which for India is SRTM-derived
(~30 m native). Public, no key: https://registry.opendata.aws/terrain-tiles/

Why not the old sandbox tile (simulation/data/adriyala_dem_regional.json): that file is one zoom-12
tile whose CENTRE the sandbox assumed to be the site. The site's lat/lon actually falls at pixel
(46, 4) of that tile — 2.2 km from the centre, on its north edge — so the old terrain was misplaced
and a 2.5 km panel runs off the tile. Here every sample is georeferenced individually.

Output: data/real/<mine>_dem.npz
    elev_m        float32 (nx, ny), metres AMSL, i <-> x (along panel), j <-> y (across), like world.py
    origin_x_m    x of cell (0, 0) centre, panel frame
    origin_y_m    y of cell (0, 0) centre
    cell_m        grid spacing
    lat_deg, lon_deg  float32 (nx, ny) geographic position of every cell
    meta_json     provenance: source, zoom, tile URLs, site, rotation, fetch date

Panel frame (same as physics.py): x = 0 at the starting face, along the advance; y = 0 on the panel
axis. The site lat/lon in the mine yaml is the panel centre (x = L/2, y = 0).
advance_direction_deg is the advance bearing measured counter-clockwise from east.

Usage: python scripts/fetch_dem.py [--config config/assumptions.yaml]
"""

import argparse
import datetime as dt
import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
import yaml
from PIL import Image
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from minesim.config import load_config  # noqa: E402

TILE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
TILE_PX = 256
EARTH_RADIUS_M = 6378137.0


def _global_px(lat, lon, zoom):
    """Web-Mercator global pixel coordinates (float) for 256-px tiles."""
    n = TILE_PX * 2 ** zoom
    lat_r = np.radians(lat)
    px = (np.asarray(lon) + 180.0) / 360.0 * n
    py = (1.0 - np.log(np.tan(lat_r) + 1.0 / np.cos(lat_r)) / math.pi) / 2.0 * n
    return px, py


def _fetch_tile(z, x, y):
    url = TILE_URL.format(z=z, x=x, y=y)
    with urllib.request.urlopen(url, timeout=30) as resp:
        rgb = np.asarray(Image.open(io.BytesIO(resp.read())).convert("RGB"), dtype=np.float64)
    # terrarium: elevation = R*256 + G + B/256 - 32768
    return rgb[..., 0] * 256.0 + rgb[..., 1] + rgb[..., 2] / 256.0 - 32768.0, url


def build(config_path: Path) -> Path:
    cfg = load_config(config_path)
    assumptions = yaml.safe_load(config_path.read_text())
    mine = assumptions["mine"]
    mine_yaml = yaml.safe_load((config_path.parent / "mines" / f"{mine}.yaml").read_text())
    site = mine_yaml.get("site")
    if not site:
        raise SystemExit(f"config/mines/{mine}.yaml has no site block — nothing to fetch")
    plan = assumptions["placement"]

    lat0 = float(site["panel_centre_lat_deg"])
    lon0 = float(site["panel_centre_lon_deg"])
    zoom = int(plan["dem_zoom"])
    cell = float(plan["dem_cell_m"])
    margin = float(plan["dem_margin_m"])
    theta = math.radians(cfg.panel.advance_direction_deg)

    # Panel-frame box: deformation footprint (panel + 2r) plus the gateway margin.
    reach = 2.0 * cfg.r + margin
    x_min, x_max = -reach, cfg.panel.length_m + reach
    y_half = cfg.panel.width_m / 2.0 + reach
    nx = int(math.ceil((x_max - x_min) / cell)) + 1
    ny = int(math.ceil(2.0 * y_half / cell)) + 1
    xs = x_min + np.arange(nx) * cell
    ys = -y_half + np.arange(ny) * cell
    X, Y = np.meshgrid(xs, ys, indexing="ij")

    # Panel frame -> local east/north (centred on the site) -> lat/lon.
    dx = X - cfg.panel.length_m / 2.0
    east = math.cos(theta) * dx - math.sin(theta) * Y
    north = math.sin(theta) * dx + math.cos(theta) * Y
    lat = lat0 + np.degrees(north / EARTH_RADIUS_M)
    lon = lon0 + np.degrees(east / (EARTH_RADIUS_M * math.cos(math.radians(lat0))))

    gpx, gpy = _global_px(lat, lon, zoom)
    tx0, tx1 = int(gpx.min() // TILE_PX), int(gpx.max() // TILE_PX)
    ty0, ty1 = int(gpy.min() // TILE_PX), int(gpy.max() // TILE_PX)
    mosaic = np.zeros(((ty1 - ty0 + 1) * TILE_PX, (tx1 - tx0 + 1) * TILE_PX))
    urls = []
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            tile, url = _fetch_tile(zoom, tx, ty)
            r0, c0 = (ty - ty0) * TILE_PX, (tx - tx0) * TILE_PX
            mosaic[r0:r0 + TILE_PX, c0:c0 + TILE_PX] = tile
            urls.append(url)
            print(f"  fetched {url}")

    # Pixel centres sit at +0.5; bicubic like the old sandbox (terrain is smooth at this scale).
    rows = gpy - ty0 * TILE_PX - 0.5
    cols = gpx - tx0 * TILE_PX - 0.5
    elev = map_coordinates(mosaic, [rows, cols], order=3, mode="nearest").astype(np.float32)

    mpp = 156543.03392 * math.cos(math.radians(lat0)) / 2 ** zoom
    meta = {
        "provenance": "real",
        "source": "AWS Open Data Terrain Tiles (terrarium), SRTM-derived over India",
        "source_url": "https://registry.opendata.aws/terrain-tiles/",
        "zoom": zoom,
        "native_m_per_px": round(mpp, 2),
        "tiles": urls,
        "mine": mine,
        "panel_centre_lat_deg": lat0,
        "panel_centre_lon_deg": lon0,
        "advance_direction_deg_ccw_from_east": cfg.panel.advance_direction_deg,
        "fetched_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    out = ROOT / str(site["dem_npz"])
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        out, elev_m=elev, origin_x_m=np.float64(x_min), origin_y_m=np.float64(-y_half),
        cell_m=np.float64(cell), lat_deg=lat.astype(np.float32), lon_deg=lon.astype(np.float32),
        meta_json=np.array(json.dumps(meta)),
    )
    print(f"wrote {out.relative_to(ROOT)}  grid {nx}x{ny} @ {cell:g} m  "
          f"elev {elev.min():.0f}-{elev.max():.0f} m AMSL")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", default=str(ROOT / "config" / "assumptions.yaml"))
    build(Path(ap.parse_args().config))


if __name__ == "__main__":
    main()
