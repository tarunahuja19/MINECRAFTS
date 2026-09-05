"""Ground truth package.

Non-negotiable Invariant I2:
scoring/score.py is the ONLY file permitted to import from truth/.
pinn/ and sim/ must not import truth.
"""
from .truth import TruthEngine

__all__ = ["TruthEngine"]
