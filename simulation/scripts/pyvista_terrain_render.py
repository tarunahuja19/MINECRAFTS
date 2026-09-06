"""
Render the Adriyala panel terrain the way a survey report would present it.

Reproduces the standard geoscience figure pair: a 2D hypsometric map with
contour lines and sample points, and the same surface as a 3D PyVista view.
Everything is drawn from backend truth (`sandbox.dem`, `sandbox.hypsometry`,
`sandbox.layout`) so the figure cannot drift from what the simulator uses.

Run headless:
    .venv/bin/python scripts/pyvista_terrain_render.py

Writes out/terrain_reference.png (3D) and out/terrain_2d_map.png (2D).
"""

import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from sandbox import dem, hypsometry, layout
from sandbox.constants import WINDOW_SIZE_M

OUT_DIR = PROJECT_ROOT / "out"


def _grid():
    Z = dem.panel_dem()
    n = Z.shape[0]
    half = WINDOW_SIZE_M / 2.0
    axis = np.linspace(-half, half, n)
    X, Y = np.meshgrid(axis, axis)
    return X, Y, Z


def render_2d_map(X, Y, Z, contours, path):
    """2D hypsometric map with red contours and sensor monuments."""
    fig, ax = plt.subplots(figsize=(7.2, 6.4), dpi=140)

    # Colour by equal-area hypsometric rank, then multiply by hillshade so
    # relief is legible as shape and not only as hue.
    t = hypsometry.hypsometric_normalise(Z)
    t = hypsometry.RAMP_FLOOR + t * (1.0 - hypsometry.RAMP_FLOOR)
    rgb = matplotlib.colormaps["gist_earth"](t)[..., :3]
    shade = hypsometry.hillshade(Z)[..., None]
    rgb = np.clip(rgb * (0.45 + 0.55 * shade), 0.0, 1.0)
    ax.imshow(rgb, origin="lower",
              extent=[X.min(), X.max(), Y.min(), Y.max()],
              interpolation="bilinear")

    # Colour bar built from the same equal-area stretch, but ticked in real
    # metres — so the legend stays honest about height even though the ramp is
    # distributed by area.
    import matplotlib.colors as mcolors
    ticks = np.linspace(Z.min(), Z.max(), 7)
    tick_t = hypsometry.RAMP_FLOOR + np.interp(
        ticks, np.sort(Z.ravel()),
        np.linspace(0.0, 1.0, Z.size)) * (1.0 - hypsometry.RAMP_FLOOR)
    im = plt.cm.ScalarMappable(
        norm=mcolors.Normalize(0.0, 1.0), cmap="gist_earth")
    im.set_array([])

    # Intermediate contours thin, index contours heavy — topo sheet convention.
    ax.contour(X, Y, Z, levels=contours["levels"],
               colors="red", linewidths=0.8, alpha=0.85)
    if contours["index_levels"]:
        ax.contour(X, Y, Z, levels=contours["index_levels"],
                   colors="red", linewidths=1.9)

    pos = layout.node_positions()
    ax.scatter(pos[:, 0], pos[:, 1], s=34, c="#1414ff",
               edgecolors="white", linewidths=0.6, zorder=5)

    cb = fig.colorbar(im, ax=ax, shrink=0.86, pad=0.02)
    cb.set_ticks(tick_t)
    cb.set_ticklabels([f"{v:.0f}" for v in ticks])
    cb.set_label("Elevation (m AMSL)")

    ax.set_title("Adriyala panel — hypsometric map\n"
                 f"contours {contours['interval_m']:.0f} m "
                 f"(index {contours['index_m']:.0f} m)", fontsize=10)
    ax.set_xlabel("Easting from panel centre (m)")
    ax.set_ylabel("Northing from panel centre (m)")
    ax.set_aspect("equal")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


def render_3d(X, Y, Z, contours, path, z_exag=2.2):
    """3D PyVista surface with hypsometric tint, draped contours and monuments."""
    import pyvista as pv
    pv.OFF_SCREEN = True

    surf = pv.StructuredGrid(X, Y, Z * z_exag)
    surf["Elevation (m AMSL)"] = Z.ravel(order="F")
    # A second scalar drives colour via the equal-area stretch; the elevation
    # scalar stays as the honest value the scalar bar is labelled from.
    surf["tint"] = hypsometry.hypsometric_normalise(Z).ravel(order="F")

    # The mesh is coloured by tint, so label the bar with the real elevations
    # those tint values correspond to. A bar reading 0-1 would say nothing
    # about height.
    z_sorted = np.sort(Z.ravel())
    cdf = np.linspace(0.0, 1.0, z_sorted.size)
    annotations = {
        float(np.interp(v, z_sorted, cdf)): f"{v:.0f} m"
        for v in np.linspace(Z.min(), Z.max(), 6)
    }

    pl = pv.Plotter(off_screen=True, window_size=(1500, 950))
    pl.add_mesh(
        surf, scalars="tint", cmap="gist_earth", clim=[0.0, 1.0],
        annotations=annotations,
        smooth_shading=True, ambient=0.22, diffuse=0.85, specular=0.10,
        scalar_bar_args={
            "title": "Elevation (m AMSL)", "vertical": True,
            "position_x": 0.86, "position_y": 0.22,
            "height": 0.56, "width": 0.045, "color": "black",
            "title_font_size": 16, "label_font_size": 12, "n_labels": 0,
        },
    )

    # Drape contours slightly proud of the surface so they are not z-fought.
    lift = 0.006 * (Z.max() - Z.min()) * z_exag
    band = pv.StructuredGrid(X, Y, Z * z_exag)
    band["z_true"] = Z.ravel(order="F")
    for lv in contours["levels"]:
        line = band.contour(isosurfaces=[float(lv)], scalars="z_true")
        if line.n_points == 0:
            continue
        line.points[:, 2] += lift
        heavy = lv in contours["index_levels"]
        pl.add_mesh(line, color="red", line_width=5 if heavy else 2)

    # Sensor monuments, sitting on the ground they actually stand on.
    pos = layout.node_positions()
    zs = _sample(X, Y, Z, pos[:, 0], pos[:, 1]) * z_exag + lift * 2.0
    pl.add_points(
        np.column_stack([pos[:, 0], pos[:, 1], zs]),
        color="#1414ff", point_size=12, render_points_as_spheres=True,
    )

    # Z is drawn exaggerated, so label the vertical axis in TRUE metres —
    # an axis reading exaggerated values would misstate the terrain's height.
    pl.show_grid(
        xtitle="Easting (m)", ytitle="Northing (m)",
        ztitle=f"Elevation (m AMSL)  [x{z_exag:g} vert. exag.]",
        color="black", font_size=10,
        n_xlabels=4, n_ylabels=4, n_zlabels=4,
        axes_ranges=[X.min(), X.max(), Y.min(), Y.max(), Z.min(), Z.max()],
    )
    pl.set_background("white")
    pl.camera_position = "iso"
    pl.camera.azimuth = -55
    pl.camera.elevation = 12
    pl.camera.zoom(0.88)
    pl.screenshot(str(path))
    pl.close()


def _sample(X, Y, Z, xq, yq):
    """Nearest-node elevation lookup for scattered query points."""
    half = WINDOW_SIZE_M / 2.0
    n = Z.shape[0]
    ix = np.clip(((xq + half) / WINDOW_SIZE_M * (n - 1)).round().astype(int), 0, n - 1)
    iy = np.clip(((yq + half) / WINDOW_SIZE_M * (n - 1)).round().astype(int), 0, n - 1)
    return Z[iy, ix]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    X, Y, Z = _grid()
    stats = dem.elevation_stats(Z)
    contours = hypsometry.contour_levels(stats["min_m"], stats["max_m"])
    bands = hypsometry.slope_classes(Z)["bands"]

    print("Adriyala panel terrain")
    print(f"  elevation   {stats['min_m']:.1f} - {stats['max_m']:.1f} m AMSL")
    print(f"  relief      {stats['relief_m']:.1f} m")
    print(f"  slope       mean {stats['slope_mean_deg']:.1f}째, "
          f"max {stats['slope_max_deg']:.1f}째")
    print(f"  contours    {contours['interval_m']:.0f} m interval, "
          f"{len(contours['levels'])} levels")
    print("  slope bands " + ", ".join(f"{k} {v:.0f}%" for k, v in bands.items()))

    p2 = OUT_DIR / "terrain_2d_map.png"
    render_2d_map(X, Y, Z, contours, p2)
    print(f"  wrote {p2}")

    p3 = OUT_DIR / "terrain_reference.png"
    try:
        render_3d(X, Y, Z, contours, p3)
        print(f"  wrote {p3}")
    except Exception as exc:
        print(f"  3D render skipped ({type(exc).__name__}: {exc})")


if __name__ == "__main__":
    main()
