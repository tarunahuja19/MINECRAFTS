"""Shared fixtures. The lab is a pure consumer of a FINISHED run, so every test needs one."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
MINE_SIM = REPO / "mine-sim"
DEFAULT_RUN = MINE_SIM / "out" / "v2-690d"
PY = os.environ.get("PY", sys.executable)
FALLBACK_DAYS = 80          # a 2-day run has no measurable subsidence; 80 days puts the face at 320 m


def _complete(run_dir: Path) -> bool:
    return all((run_dir / n).is_file()
               for n in ("run_summary.json", "terrain_state.npz", "terrain_changes.jsonl"))


@pytest.fixture(scope="session")
def run_dir(tmp_path_factory) -> Path:
    """The finished 690-day run if it is there, else an 80-day run built once for the session."""
    override = os.environ.get("LAB_TEST_RUN")
    if override:
        run = Path(override)
        if not _complete(run):
            raise RuntimeError(f"LAB_TEST_RUN={run} is not a finished run")
        return run
    if _complete(DEFAULT_RUN):
        return DEFAULT_RUN
    out = tmp_path_factory.mktemp("run") / f"v2-{FALLBACK_DAYS}d"
    subprocess.run([PY, "-m", "minesim.run", "--days", str(FALLBACK_DAYS), "--out", str(out)],
                   cwd=MINE_SIM, check=True, capture_output=True)
    return out


@pytest.fixture(scope="session")
def mid_day(run_dir) -> float:
    """A day with the face partway along the panel, so there is both settled and moving ground."""
    import json
    days = float(json.loads((run_dir / "run_summary.json").read_text())["days"])
    return 300.0 if days >= 300 else days / 2


@pytest.fixture(scope="session")
def snap(run_dir, mid_day):
    """The frozen snapshot every field/zone test works on. Session-scoped: loading replays the run."""
    from lab.snapshot import load_snapshot
    return load_snapshot(run_dir, mid_day)


@pytest.fixture(scope="session")
def cfg(snap):
    """The mine config behind that run — the single source of every physical number."""
    return snap.cfg


@pytest.fixture(scope="session")
def grid(snap):
    return snap.grid


@pytest.fixture(scope="session")
def snap_at_end(run_dir):
    """The snapshot at the run's last day — the day scripts/export_cracks.py exports by default,
    so gate L8-1c has something of the simulator's own to compare against."""
    import json
    from lab.snapshot import load_snapshot
    days = float(json.loads((run_dir / "run_summary.json").read_text())["days"])
    return load_snapshot(run_dir, days)
