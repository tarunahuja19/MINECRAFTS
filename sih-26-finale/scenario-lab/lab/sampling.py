"""Reading a gridded field at points that are not grid cells, and the contour lines of one (P2).

Three things need this and they must all do it the same way, or the same ground gives three answers:

  * an object (a house, a road, a pole) sits where it sits, not on a cell centre;
  * the run's exported crack baseline is on a 10 m grid of its own and the lab works on the world's
    5 m grid (hazard H6) - moving between them is a resample, and the method has to be stated;
  * the vibration layer is drawn as contour LINES (Adarsh, session 26), which means finding where a
    field crosses a level, not colouring the cells that are over it.

The resampling method is BILINEAR, written out here rather than pulled from scipy so that it is
visible and not a dependency's choice. A nearest-cell lookup would move a crack edge by up to half a
cell - 5 m on the export grid - and that is the difference between a crack being in a road and beside
it. Points outside the grid return NaN rather than the edge value: off the grid there is no answer,
and an edge value pretending to be one is how an object outside the mine acquires a damage grade.
"""

from __future__ import annotations

from typing import List, Tuple

import numpy as np


def cell_fractions(grid, x_m, y_m) -> Tuple[np.ndarray, np.ndarray]:
    """Position of (x, y) in cell-centre index space: centre of cell i is at exactly i.0.

    Cell centres are origin + (i + 0.5)*cell (WP9 §3), so the index coordinate of a point is
    (x - origin)/cell - 0.5. Getting this half-cell wrong shifts every sampled field by 2.5 m.
    """
    fx = (np.asarray(x_m, dtype=np.float64) - grid.origin_x_m) / grid.cell_m - 0.5
    fy = (np.asarray(y_m, dtype=np.float64) - grid.origin_y_m) / grid.cell_m - 0.5
    return fx, fy


def sample(field: np.ndarray, grid, x_m, y_m) -> np.ndarray:
    """Bilinear sample of a field on `grid` at world points (x_m, y_m). NaN outside the grid."""
    values = np.asarray(field, dtype=np.float64)
    fx, fy = cell_fractions(grid, x_m, y_m)
    return _bilinear_at(values, fx, fy)


def sample_on_axes(values: np.ndarray, xs: np.ndarray, ys: np.ndarray, x_m, y_m) -> np.ndarray:
    """Bilinear sample of a field given on its own regular axes `xs`, `ys` (the exported crack field
    is on a 10 m grid with its own origin). NaN outside those axes. Same interpolation as `sample`,
    so the lab resamples the baseline exactly once and in one way (hazard H6)."""
    values = np.asarray(values, dtype=np.float64)
    xs = np.asarray(xs, dtype=np.float64)
    ys = np.asarray(ys, dtype=np.float64)
    fx = (np.asarray(x_m, dtype=np.float64) - xs[0]) / (xs[1] - xs[0])
    fy = (np.asarray(y_m, dtype=np.float64) - ys[0]) / (ys[1] - ys[0])
    return _bilinear_at(values, fx, fy)


def _bilinear_at(values: np.ndarray, fx: np.ndarray, fy: np.ndarray) -> np.ndarray:
    nx, ny = values.shape
    i0 = np.floor(fx).astype(np.int64)
    j0 = np.floor(fy).astype(np.int64)
    inside = (i0 >= 0) & (i0 < nx - 1) & (j0 >= 0) & (j0 < ny - 1)
    ic = np.clip(i0, 0, nx - 2)
    jc = np.clip(j0, 0, ny - 2)
    wx = fx - ic
    wy = fy - jc
    out = ((1 - wx) * (1 - wy) * values[ic, jc]
           + wx * (1 - wy) * values[ic + 1, jc]
           + (1 - wx) * wy * values[ic, jc + 1]
           + wx * wy * values[ic + 1, jc + 1])
    return np.where(inside, out, np.nan)


def grid_bounds_m(grid) -> Tuple[float, float, float, float]:
    """(x_min, x_max, y_min, y_max) of the grid's OUTER edges, in metres."""
    nx, ny = grid.shape
    return (grid.origin_x_m, grid.origin_x_m + nx * grid.cell_m,
            grid.origin_y_m, grid.origin_y_m + ny * grid.cell_m)


def polyline_points(line, spacing_m: float) -> Tuple[np.ndarray, np.ndarray]:
    """Points along a polyline at roughly `spacing_m`, ends always included.

    Used for roads and, in S6, for a railway or a pipe: a long thin thing is asked about along its
    whole length, because the worst tilt under a road is rarely at either end of it.
    """
    xs: List[float] = []
    ys: List[float] = []
    pts = [(float(a), float(b)) for a, b in line]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        length = float(np.hypot(x1 - x0, y1 - y0))
        n = max(1, int(np.ceil(length / spacing_m)))
        t = np.linspace(0.0, 1.0, n + 1)
        xs.extend(x0 + t * (x1 - x0))
        ys.extend(y0 + t * (y1 - y0))
    return np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)


def distance_to_polyline_m(line, X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    """Shortest distance from each point to the polyline, in metres (exact, per segment)."""
    best = np.full(np.shape(X), np.inf, dtype=np.float64)
    pts = [(float(a), float(b)) for a, b in line]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        length_sq = dx * dx + dy * dy
        if length_sq == 0:
            d = np.hypot(X - x0, Y - y0)
        else:
            t = np.clip(((X - x0) * dx + (Y - y0) * dy) / length_sq, 0.0, 1.0)
            d = np.hypot(X - (x0 + t * dx), Y - (y0 + t * dy))
        best = np.minimum(best, d)
    return best


def footprint_points(x_m: float, y_m: float, width_m: float, depth_m: float, spacing_m: float
                     ) -> Tuple[np.ndarray, np.ndarray]:
    """A grid of points covering a rectangular footprint centred on (x, y), corners included.

    A house is asked about over its whole footprint rather than at its centre because that is where
    the NCB change-of-length scale comes from: the damage is the difference in movement between one
    end of the building and the other.
    """
    nx = max(1, int(np.ceil(width_m / spacing_m)))
    ny = max(1, int(np.ceil(depth_m / spacing_m)))
    xs = x_m + np.linspace(-0.5, 0.5, nx + 1) * width_m
    ys = y_m + np.linspace(-0.5, 0.5, ny + 1) * depth_m
    gx, gy = np.meshgrid(xs, ys, indexing="ij")
    return gx.ravel(), gy.ravel()


def iso_segments(field: np.ndarray, grid, level: float) -> List[Tuple[float, float, float, float]]:
    """Line segments where `field` crosses `level`, as (x0, y0, x1, y1) in metres — marching squares.

    Contour LINES rather than coloured cells, because that is what Adarsh asked for in session 26 for
    both cracks and vibration, and because a line is the honest shape for "this is where the limit
    is": a filled patch suggests a measurement everywhere inside it.

    Segments come back unordered - each is drawn on its own - so nothing here has to stitch a contour
    into a closed ring, which is where marching-squares implementations normally acquire their bugs.
    """
    values = np.asarray(field, dtype=np.float64)
    nx, ny = values.shape
    if nx < 2 or ny < 2:
        return []
    # The four corners of every cell, named rather than indexed: gate L4 allows no bare 3 in lab/,
    # and c01 says which corner it is where corners[3] does not.
    c00, c10, c11, c01 = values[:-1, :-1], values[1:, :-1], values[1:, 1:], values[:-1, 1:]
    lo = np.minimum(np.minimum(c00, c10), np.minimum(c11, c01))
    hi = np.maximum(np.maximum(c00, c10), np.maximum(c11, c01))
    crossing = np.argwhere(np.isfinite(lo) & np.isfinite(hi) & (lo <= level) & (hi > level))

    out: List[Tuple[float, float, float, float]] = []
    offsets = ((0, 0), (1, 0), (1, 1), (0, 1))          # the four corners of a cell, going round
    for i, j in crossing:
        pts: List[Tuple[float, float]] = []
        for k in range(len(offsets)):
            ai, aj = offsets[k]
            bi, bj = offsets[(k + 1) % len(offsets)]
            va = values[i + ai, j + aj]
            vb = values[i + bi, j + bj]
            if not np.isfinite(va) or not np.isfinite(vb) or (va > level) == (vb > level):
                continue
            t = (level - va) / (vb - va)
            gx = grid.origin_x_m + (i + ai + t * (bi - ai) + 0.5) * grid.cell_m
            gy = grid.origin_y_m + (j + aj + t * (bj - aj) + 0.5) * grid.cell_m
            pts.append((float(gx), float(gy)))
        # Two crossings is the ordinary case; four is a saddle, drawn as two segments in corner order.
        for a in range(0, len(pts) - 1, 2):
            out.append((pts[a][0], pts[a][1], pts[a + 1][0], pts[a + 1][1]))
    return out
