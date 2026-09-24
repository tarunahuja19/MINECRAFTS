"""The run's real crack state at day T, read from out/cracks/ and put on the lab's grid (P2, hazard H5).

WHY A BASELINE EXISTS AT ALL
----------------------------
Cracks LATCH. Once a fissure has opened it does not heal; when the compression zone behind the face
passes over it, it narrows to a fraction of its widest (cracks.partial_closure_fraction = 0.35) and
stays. So the set of cracks open at day T is not "the cells whose strain is over the threshold at day
T" — it is every cell that was ever over it, walked forward from day 0.

That matters for the only crack number anyone will read: NEW cracks. "New = cracked after, not
cracked before" is only true if BEFORE is the latched state. Evaluated at one instant instead, the
lab would report a crack that opened on day 120 and has since narrowed as though the scenario had
just made it, which is a wrong answer in the direction that flatters the feature.

The latched state exists in exactly one place: out/cracks/crack_field_day<NNNN>.npz, written by
mine-sim/scripts/export_cracks.py, which walks the whole run. Step S7 wires that into
run-simulation.sh so a rebuild recreates it; before S7 a clean run left it absent.

WHEN IT IS MISSING
------------------
The lab says so, in plain words, and the count it cannot stand behind is not printed. It does not
fall back to an instantaneous "before" and call the difference new cracks.

GRIDS (hazard H6)
-----------------
The export is on its own axes at cracks.export_cell_m (10 m); the lab works on the world's 5 m grid.
The resample happens HERE, once, bilinearly, and nowhere else. The cracked mask is a boolean, so it
is interpolated as a fraction and cut at one half — a cell is called cracked when most of the ground
it covers was. That keeps a crack edge inside half an export cell instead of moving it by a whole one.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from lab.sampling import sample_on_axes


@dataclass(frozen=True)
class CrackBaseline:
    """The latched crack state of a finished run at one day, on the lab's grid."""
    day: int
    path: Path
    cracked: np.ndarray          # bool — has ever been over the tensile threshold by this day
    width_mm: np.ndarray         # current opening (already partially closed where the face has passed)
    max_width_mm: np.ndarray     # widest it has ever been
    covered: np.ndarray          # bool — where the export actually has values; elsewhere: no answer

    @property
    def cracked_cells(self) -> int:
        return int(np.count_nonzero(self.cracked))


def baseline_path(run_dir, day: float) -> Path:
    """Where export_cracks.py writes the baseline for this run and day.

    A run lives at mine-sim/out/<name>, and the export is a sibling directory out/cracks, because it
    describes the mine at a day rather than one simulation run of it.
    """
    return Path(run_dir).parent / "cracks" / f"crack_field_day{int(round(day)):04d}.npz"


def missing_reason(run_dir, day: float) -> str:
    """The plain sentence to give when there is no baseline — named file, named fix, no jargon."""
    return (f"the run's crack history has not been exported for day {int(round(day))} "
            f"({baseline_path(run_dir, day).name} is not there), so 'new cracks' cannot be counted "
            f"against what was already open. Run mine-sim/scripts/export_cracks.py --day "
            f"{int(round(day))} (it is step 9 of run-simulation.sh).")


def load_crack_baseline(run_dir, day: float, grid) -> Optional[CrackBaseline]:
    """The latched crack state at `day`, resampled onto `grid`. None when it has not been exported."""
    path = baseline_path(run_dir, day)
    if not path.is_file():
        return None
    X, Y = grid.centres()
    with np.load(path) as f:
        xs, ys = f["x_m"], f["y_m"]
        fraction = sample_on_axes(f["cracked"].astype(np.float64), xs, ys, X, Y)
        width = sample_on_axes(f["width_mm"], xs, ys, X, Y)
        max_width = sample_on_axes(f["max_width_mm"], xs, ys, X, Y)
    covered = np.isfinite(fraction)
    return CrackBaseline(
        day=int(round(day)), path=path,
        cracked=covered & (np.nan_to_num(fraction) >= 0.5),
        width_mm=np.nan_to_num(width),
        max_width_mm=np.nan_to_num(max_width),
        covered=covered)
