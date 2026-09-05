"""Thread-safe single-slot last-write-wins buffer between trainer/producer and main render loop.

Non-negotiable Invariant I4:
Only the main thread touches VTK actors. Worker threads write into locked numpy buffers;
the render callback copies out.
"""
import threading
from typing import Any
import numpy as np


class SurfaceBuffer:
    """Single-slot, last-write-wins. Trainer writes, renderer reads."""

    def __init__(self, nx: int = 64, ny: int = 64):
        self.nx = nx
        self.ny = ny
        self._z = np.zeros(nx * ny, dtype=np.float32)
        self._meta: dict[str, Any] = {}
        self._lock = threading.Lock()
        self._dirty = False

    def write(self, z: np.ndarray, meta: dict[str, Any] | None = None) -> None:
        """Write reconstructed subsidence field (positive downward, metres) and metadata."""
        with self._lock:
            self._z[:] = np.asarray(z, dtype=np.float32).ravel()
            self._meta = dict(meta or {})
            self._dirty = True

    def read_if_dirty(self) -> tuple[np.ndarray | None, dict[str, Any] | None]:
        """Return a copy of the surface data and meta if dirty, resetting the dirty flag."""
        with self._lock:
            if not self._dirty:
                return None, None
            self._dirty = False
            return self._z.copy(), dict(self._meta)

    def read_latest(self) -> tuple[np.ndarray, dict[str, Any]]:
        """Return the latest surface data and meta unconditionally."""
        with self._lock:
            return self._z.copy(), dict(self._meta)

    def get_snapshot(self) -> tuple[np.ndarray, np.ndarray, dict[str, Any]] | None:
        """Return (s_pinn, s_truth, meta) grid arrays, or None if buffer has never been written."""
        with self._lock:
            if not self._dirty and not self._meta:
                return None
            z_pinn = self._z.copy().reshape((self.nx, self.ny))
            meta = dict(self._meta)
            z_truth = meta.get("s_truth_grid")
            if z_truth is None:
                z_truth = z_pinn.copy()
            return z_pinn, z_truth, meta
