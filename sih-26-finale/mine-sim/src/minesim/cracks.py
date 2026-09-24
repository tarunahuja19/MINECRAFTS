"""Surface cracking and structure damage - WP1 extension (F10).

Two different things live here and they are deliberately kept apart, because the old sandbox
(`sih26/simulation/sandbox/sensors.py`) conflated them and got both scales wrong:

  * GROUND CRACKING - a tension fissure opening in the soil/rock cover. Governed by the ground's
    own tensile capacity, thresholds in the thousands of microstrain.
  * STRUCTURE DAMAGE - what that ground movement does to something built on it. Governed by the
    NCB change-of-length scale, which bites at a few hundred microstrain over a 10 m frontage.

A crack opens perpendicular to the MAJOR principal tensile strain e1, which is why this module
needs physics.principal_strain and not the axis-aligned physics.strain: over the ribs the two
agree, but at the panel corners the principal axes rotate by tens of degrees and the corners are
where field crews record the worst cracking.

Sign convention: strain positive = tension, matching physics.strain and physics.principal_strain.
Nothing in this module writes to S(x, y, t), to the world grid, or to node Z.
No alarm logic, no thresholding of telemetry, no filtering (Invariant 3): these are ground-truth
fields, and deciding what to do about them belongs downstream.
"""

from dataclasses import dataclass, field
from typing import Dict, Optional, Tuple

import numpy as np

from minesim import physics
from minesim.config import Config


@dataclass
class CrackField:
    """Latched crack state over a fixed set of points, advanced in time by `update`.

    Latching is the whole point: a fissure is not strain. Strain is recoverable and reverses when
    the compression zone arrives; a crack that has opened does not close back up. What it does do
    is PARTIALLY close - the tensile zone travels ahead of the face, and once the face has passed,
    that ground goes into compression and the crack narrows without healing. So two widths are
    carried: `max_width_mm` is what a survey crew would have recorded at its worst, `width_mm` is
    what they would measure today. Both are wanted and they are not the same number.
    """

    cracked: np.ndarray            # bool, has ever exceeded the tensile threshold
    width_mm: np.ndarray           # current opening
    max_width_mm: np.ndarray       # largest opening ever reached
    azimuth_deg: np.ndarray        # bearing of the crack line, CCW from +x, in [0, 180)
    first_cracked_day: np.ndarray  # day it first opened; NaN where it never has

    @classmethod
    def empty(cls, shape) -> "CrackField":
        z = np.zeros(shape, dtype=np.float64)
        return cls(
            cracked=np.zeros(shape, dtype=bool),
            width_mm=z.copy(),
            max_width_mm=z.copy(),
            azimuth_deg=z.copy(),
            first_cracked_day=np.full(shape, np.nan),
        )

    def update(self, x, y, t_days: float, cfg: Config) -> "CrackField":
        """Advance the latched state to day `t_days`. Call with increasing t_days."""
        c = cfg.cracks
        e1, _e2, theta_deg = physics.principal_strain(x, y, t_days, cfg.panel, cfg.knothe)
        w_now = opening_mm(e1, c.tensile_strain_threshold_ue, c.crack_spacing_m)

        opening = w_now > 0.0
        newly = opening & ~self.cracked
        self.first_cracked_day = np.where(newly, t_days, self.first_cracked_day)
        # A crack's bearing is fixed when it forms: the ground tore along one line and later strain
        # rotating does not re-cut it somewhere else.
        self.azimuth_deg = np.where(newly, (theta_deg + 90.0) % 180.0, self.azimuth_deg)
        self.cracked = self.cracked | opening
        self.max_width_mm = np.maximum(self.max_width_mm, w_now)
        # Latched floor: an existing crack narrows under compression but never below this fraction
        # of its own recorded maximum, and never disappears.
        floor = np.where(self.cracked, c.partial_closure_fraction * self.max_width_mm, 0.0)
        self.width_mm = np.maximum(w_now, floor)
        return self


def opening_mm(e1_ue, threshold_ue: float, spacing_m: float):
    """Crack opening in mm from major principal tensile strain.

    The tensile extension accumulated over one crack spacing has to go somewhere, and in jointed
    surface cover it localises into a discrete fissure rather than stretching the ground uniformly:

        opening [m]  = (e1 - threshold) [strain] * spacing [m]
        opening [mm] = (e1_ue * 1e-6 - threshold_ue * 1e-6) * spacing_m * 1000

    `spacing_m` is the explicit, configurable replacement for the old sandbox's
    `opening = max(0, strain_x) * 1000.0 * 2.0`, whose bare `2000` silently asserted a 2 m spacing
    and no threshold at all. Strain below the threshold is carried elastically by the ground and
    opens nothing.
    """
    excess = np.maximum(0.0, np.asarray(e1_ue, dtype=np.float64) - threshold_ue)
    return excess * 1.0e-6 * spacing_m * 1000.0


def width_sensitivity(x, y, t_days: float, cfg: Config) -> Dict[str, np.ndarray]:
    """Crack width recomputed across the literature spread of B, as {label: width_mm}.

    B is the one unfitted constant in the deformation chain (see
    physics.horizontal_displacement_factor) and crack width is linear in it, so a single width is
    a more precise-looking number than the inputs support. Anything that reports a crack width
    should report this band with it.
    """
    c = cfg.cracks
    r = cfg.panel.depth_m / cfg.knothe.tan_beta
    b_ship = physics.horizontal_displacement_factor(cfg.panel, cfg.knothe)
    e1, _e2, _th = physics.principal_strain(x, y, t_days, cfg.panel, cfg.knothe)
    out = {}
    for label, b in (("B=0.35r", 0.35 * r), ("B=r/sqrt(2pi)", b_ship), ("B=0.40r", 0.40 * r)):
        # e1 is linear in B, so rescaling it is exact, not an approximation.
        out[label] = opening_mm(e1 * (b / b_ship), c.tensile_strain_threshold_ue, c.crack_spacing_m)
    return out


# NCB Subsidence Engineers' Handbook damage classification, by CHANGE OF LENGTH of the structure
# (strain x structure length), not by raw strain. Edges in millimetres, ascending.
# OPEN - VERIFY edition and exact edges against the printed table before this reaches a demo.
NCB_EDGES_MM: Tuple[float, ...] = (30.0, 60.0, 120.0, 180.0, 300.0)
NCB_GRADES: Tuple[str, ...] = (
    "negligible", "very slight", "slight", "appreciable", "severe", "very severe",
)


def change_of_length_mm(e1_ue, structure_length_m: float):
    """Change of length in mm for a structure of the given frontage sitting in strain e1."""
    return np.asarray(e1_ue, dtype=np.float64) * 1.0e-6 * structure_length_m * 1000.0


def damage_grade(e1_ue: float, structure_length_m: float) -> str:
    """NCB damage grade for one structure. Compression damages masonry too, so the magnitude of
    the change of length is what is classified, not its sign."""
    dl = abs(float(change_of_length_mm(e1_ue, structure_length_m)))
    return NCB_GRADES[int(np.searchsorted(NCB_EDGES_MM, dl, side="right"))]


def damage_grade_field(e1_ue, structure_length_m: float) -> np.ndarray:
    """Vectorised damage_grade: an integer grade index per point, into NCB_GRADES."""
    dl = np.abs(change_of_length_mm(e1_ue, structure_length_m))
    return np.searchsorted(NCB_EDGES_MM, dl, side="right")


def exceeds_dgms_tensile_limit(e1_ue, cfg: Config):
    """Whether major principal tensile strain is over the claimed DGMS limit.

    Separate from both the ground-cracking threshold and the NCB scale, because it is a third,
    REGULATORY line rather than a physical one: ground can crack below it and a structure can be
    damaged below it, but this is the number a statutory notice would be written against.

    The limit itself is `OPEN — VERIFY` and carries a warning in config/assumptions.yaml: it comes
    from the old sandbox calling 5.3 mm/m a "DGMS tensile limit" in four places without citing the
    circular. Reported, never acted on - alarm logic does not live in minesim (Invariant 3).
    """
    return np.asarray(e1_ue, dtype=np.float64) > cfg.cracks.dgms_tensile_strain_limit_ue
