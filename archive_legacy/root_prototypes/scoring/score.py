"""Honest scoring module.

Non-negotiable Invariant I2:
scoring/score.py is the ONLY file permitted to import from truth/.
pinn/ and sim/ must not import truth.
"""
from typing import Any
import numpy as np
from truth.truth import TruthEngine


class SubsidenceScorer:
    """Evaluates reconstruction accuracy against truth."""

    def __init__(self):
        self._truth_engine = TruthEngine()

    def score_grid(
        self,
        recon_z: np.ndarray,
        X: np.ndarray,
        Y: np.ndarray,
        t_days: float,
    ) -> dict[str, Any]:
        """Compute score dictionary containing RMSE (mm), Max Error (mm), and truth surface."""
        metrics = self._truth_engine.evaluate_reconstruction(recon_z, X, Y, t_days)
        s_true = self._truth_engine.get_true_grid(X, Y, t_days)
        return {
            **metrics,
            "truth_z": s_true,
        }
