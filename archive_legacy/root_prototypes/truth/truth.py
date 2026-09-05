"""Analytic ground truth oracle for scoring and validation.

Non-negotiable Invariant I2:
scoring/score.py is the ONLY file permitted to import from truth/.
pinn/ and sim/ must not import truth.
"""
from typing import Any
import numpy as np
from ground.surface import GroundModel, KnotheParameters


class TruthEngine:
    """Computes exact ground truth subsidence fields and error statistics."""

    def __init__(self, ground_model: GroundModel | None = None):
        self.ground = ground_model or GroundModel()

    def get_true_grid(self, X: np.ndarray, Y: np.ndarray, t: float) -> np.ndarray:
        """Compute true subsidence (metres, positive downward) on a 2D mesh grid."""
        return self.ground.S(X, Y, t)

    def evaluate_reconstruction(
        self,
        recon_S: np.ndarray,
        X: np.ndarray,
        Y: np.ndarray,
        t: float,
    ) -> dict[str, float]:
        """Compute honest RMSE and max error against analytic truth in millimetres."""
        s_true = self.get_true_grid(X, Y, t)
        diff_m = np.asarray(recon_S).ravel() - s_true.ravel()

        diff_mm = diff_m * 1000.0
        rmse_mm = float(np.sqrt(np.mean(diff_mm ** 2)))
        max_err_mm = float(np.max(np.abs(diff_mm)))
        mae_mm = float(np.mean(np.abs(diff_mm)))

        return {
            "rmse_mm": rmse_mm,
            "max_err_mm": max_err_mm,
            "mae_mm": mae_mm,
        }
