"""Frozen snapshot of a finished run at day T (WP9 §4).

Read-only. The run's own replay lives in minesim.stream, which gate L3 forbids this package from
importing, so the delta replay is re-implemented here against the same two files and the test asserts
the two agree cell for cell (np.array_equal), rather than trusting that they do.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

from minesim import physics
from minesim.config import Config, load_config

from lab.baseline import CrackBaseline, load_crack_baseline, missing_reason
from lab.config import LabConfig, load_lab_config

SECONDS_PER_DAY = 86400


@dataclass(frozen=True)
class Grid:
    origin_x_m: float
    origin_y_m: float
    cell_m: float
    shape: Tuple[int, int]      # (nx, ny); i <-> x, j <-> y

    def centres(self) -> Tuple[np.ndarray, np.ndarray]:
        """Cell-centre coordinates, meshed to `shape` — WP9 §3: centre x = origin_x + (i + 0.5)*cell."""
        nx, ny = self.shape
        xs = self.origin_x_m + (np.arange(nx) + 0.5) * self.cell_m
        ys = self.origin_y_m + (np.arange(ny) + 0.5) * self.cell_m
        return np.meshgrid(xs, ys, indexing="ij")


@dataclass(frozen=True)
class Snapshot:
    run_dir: Path
    mine: str
    run_id: str
    day: float
    epoch: int
    t_s: float
    face_x_m: float
    grid: Grid
    z0_mm: np.ndarray           # int32, surface at t = 0
    s_mm: np.ndarray            # int32, POSITIVE DOWN, replayed world grid — display and surface numbers only
    s_model_mm: np.ndarray      # float64, POSITIVE DOWN, physics.subsidence at cell centres — all derivatives
    cfg: Config
    lab: LabConfig
    # The run's LATCHED crack state at this day, when scripts/export_cracks.py has written it
    # (hazard H5). None means "not exported", which is a refusal to count new cracks, not zero
    # cracks - crack_baseline_reason carries the plain sentence saying so.
    crack_baseline: Optional[CrackBaseline] = None
    crack_baseline_reason: Optional[str] = None


def _replay(run_dir: Path, to_epoch: int) -> np.ndarray:
    """Surface Z in int32 mm at `to_epoch`, from terrain_state.npz + terrain_changes.jsonl.

    Deliberately NOT minesim.stream.replay_terrain (gate L3 forbids importing minesim.stream from lab/).
    Same two files, same integer accumulation, and test_snapshot asserts the results are identical.
    """
    with np.load(run_dir / "terrain_state.npz") as state:
        z = state["z0_mm"].astype(np.int32).copy()
    with open(run_dir / "terrain_changes.jsonl") as f:
        for line in f:
            delta = json.loads(line)
            if delta["epoch"] > to_epoch:
                break
            if delta["cells"]:
                cells = np.array(delta["cells"], dtype=np.int64)
                np.add.at(z, (cells[:, 0], cells[:, 1]), cells[:, 2].astype(np.int32))
    return z


def _assumptions_for(run_dir: Path, override) -> Path:
    """Which assumptions.yaml describes this run.

    A run normally sits at mine-sim/out/<name>, so the config is two levels up. A run written anywhere
    else (a temp dir in a test) has no such parent, so fall back to the config shipped beside the
    installed minesim package. Guessing wrong would silently describe the run with another mine's
    geometry, so the fallback is explicit and a missing file still raises.
    """
    if override is not None:
        return Path(override)
    beside_run = run_dir.parent.parent / "config" / "assumptions.yaml"
    if beside_run.is_file():
        return beside_run
    import minesim
    return Path(minesim.__file__).resolve().parents[2] / "config" / "assumptions.yaml"


def load_snapshot(run_dir, day: float, assumptions_path=None, lab_cfg: Optional[LabConfig] = None) -> Snapshot:
    """Freeze `run_dir` at `day`. A day beyond the run raises ValueError; nothing is written."""
    run_dir = Path(run_dir)
    summary_bytes = (run_dir / "run_summary.json").read_bytes()
    summary = json.loads(summary_bytes)
    days, timestep_s = float(summary["days"]), float(summary["timestep_s"])
    day = float(day)
    if day < 0 or day > days:
        raise ValueError(f"day {day} is outside the run (0 .. {days} days in {run_dir})")

    lab = lab_cfg if lab_cfg is not None else load_lab_config()
    run_id = sha256(summary_bytes).hexdigest()[:lab.id_hash_chars]
    cfg = load_config(_assumptions_for(run_dir, assumptions_path))

    epoch = int(round(day * SECONDS_PER_DAY / timestep_s))
    with np.load(run_dir / "terrain_state.npz") as state:
        grid = Grid(float(state["origin_x_m"]), float(state["origin_y_m"]), float(state["cell_m"]),
                    tuple(int(v) for v in state["shape"]))
        z0_mm = state["z0_mm"].astype(np.int32)
    z = _replay(run_dir, epoch)
    # WP3 accumulates dz = -(round(S) - S_int), so Z falls as the ground sinks: S positive down = z0 - z.
    s_mm = (z0_mm - z).astype(np.int32)

    X, Y = grid.centres()
    s_model_mm = np.asarray(physics.subsidence(X, Y, day, cfg.panel, cfg.knothe), dtype=np.float64)
    worst = float(np.max(np.abs(s_model_mm - s_mm.astype(np.float64)))) if s_mm.size else 0.0
    if worst > lab.world_model_tolerance_mm:
        raise ValueError(
            f"replayed world grid and physics.subsidence disagree by {worst:.3f} mm at day {day} "
            f"(tolerance {lab.world_model_tolerance_mm} mm). The run and the model are not the same ground.")

    face_x_m = float(min(physics.face_position(day, cfg.knothe), cfg.panel.length_m))
    baseline = load_crack_baseline(run_dir, day, grid)
    return Snapshot(run_dir=run_dir, mine=str((summary.get("fit") or {}).get("mine", "unknown")), run_id=run_id,
                    day=day, epoch=epoch, t_s=epoch * timestep_s, face_x_m=face_x_m, grid=grid,
                    z0_mm=z0_mm, s_mm=s_mm, s_model_mm=s_model_mm, cfg=cfg, lab=lab,
                    crack_baseline=baseline,
                    crack_baseline_reason=None if baseline is not None else missing_reason(run_dir, day))
