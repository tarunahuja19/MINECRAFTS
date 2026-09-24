"""World state engine and terrain truth - WP3.

Owns the live surface Z. Nothing else writes Z (Invariant 1, G13).

Grid: np.int32 millimetres, shape (nx, ny), i <-> x and j <-> y.
Cell (i, j) centre = (origin_x + (i + 0.5) * cell, origin_y + (j + 0.5) * cell).
Accumulation is integer: each step targets round(S_t) and emits dz = -(round(S_t) - S_int),
so replaying the deltas reproduces the grid exactly (G6) and never drifts from the model.
"""

from dataclasses import dataclass
import math
from typing import Tuple

import numpy as np

from minesim import physics
from minesim.config import Config
from minesim.sizing import Layout

SECONDS_PER_DAY = 86400.0


@dataclass(frozen=True)
class Delta:
    t_s: float
    epoch: int
    cells: Tuple[Tuple[int, int, int], ...]   # (i, j, dz_mm) — integer mm


class WorldState:
    def __init__(self, cfg: Config, layout: Layout) -> None:
        self._cfg = cfg
        self._layout = layout
        cell = cfg.sim.grid_cell_m
        # Footprint: the whole district plus 2r on every side (S there is below 1e-6 of its peak).
        # With one panel, district_half_width_m is width/2 and this is the old footprint exactly.
        margin = 2.0 * cfg.r
        x_min, x_max = -margin, cfg.panel.length_m + margin
        y_half = cfg.panel.district_half_width_m + margin
        nx = math.ceil((x_max - x_min) / cell)
        ny = math.ceil((2.0 * y_half) / cell)
        self.cell_m = cell
        self.origin_x_m = x_min
        self.origin_y_m = -y_half
        self.shape = (nx, ny)
        self._x_centres = self.origin_x_m + (np.arange(nx) + 0.5) * cell
        self._y_centres = self.origin_y_m + (np.arange(ny) + 0.5) * cell
        self.z0_mm = np.zeros(self.shape, dtype=np.int32)      # flat terrain at t = 0 (v1)
        self._z = self.z0_mm.copy()                              # live surface, int32 mm
        self._s_int = np.zeros(self.shape, dtype=np.int32)       # accumulated subsidence, mm, >= 0
        self._epoch = 0

    @property
    def epoch(self) -> int:
        return self._epoch

    @property
    def t_s(self) -> float:
        return self._epoch * self._cfg.sim.timestep_s

    @property
    def t_days(self) -> float:
        return self.t_s / SECONDS_PER_DAY

    def model_subsidence_mm(self, t_days: float) -> np.ndarray:
        """physics.subsidence over the whole grid (float mm, positive down), one vectorised call."""
        return physics.subsidence(
            self._x_centres[:, np.newaxis], self._y_centres[np.newaxis, :],
            t_days, self._cfg.panel, self._cfg.knothe,
        )

    def step(self) -> Delta:
        """Advance one timestep, mutate the surface, return the delta."""
        self._epoch += 1
        target = np.rint(self.model_subsidence_mm(self.t_days)).astype(np.int32)
        ds = target - self._s_int                  # integer mm of new sinking this step, >= 0
        dz = -ds
        self._s_int = target
        self._z += dz
        ii, jj = np.nonzero(dz)
        cells = tuple(zip(ii.tolist(), jj.tolist(), dz[ii, jj].tolist()))
        return Delta(t_s=self.t_s, epoch=self._epoch, cells=cells)

    def z_at(self, x_m: float, y_m: float) -> float:
        """Live surface Z in mm at an arbitrary point. Bilinear interpolation."""
        nx, ny = self.shape
        fi = min(max((x_m - self.origin_x_m) / self.cell_m - 0.5, 0.0), nx - 1.0)
        fj = min(max((y_m - self.origin_y_m) / self.cell_m - 0.5, 0.0), ny - 1.0)
        i0, j0 = int(math.floor(fi)), int(math.floor(fj))
        i1, j1 = min(i0 + 1, nx - 1), min(j0 + 1, ny - 1)
        wi, wj = fi - i0, fj - j0
        z = self._z
        return float(
            (1.0 - wi) * (1.0 - wj) * z[i0, j0] + wi * (1.0 - wj) * z[i1, j0]
            + (1.0 - wi) * wj * z[i0, j1] + wi * wj * z[i1, j1]
        )

    def snapshot(self) -> np.ndarray:
        """Snapshot of current int32 elevation grid."""
        return self._z.copy()
