"""Unit test for the run.py CLI (WP6 run loop)."""

import json
import subprocess
import sys
from pathlib import Path


def test_cli_two_day_run_writes_four_artefacts(tmp_path):
    out = tmp_path / "run"
    result = subprocess.run(
        [sys.executable, "-m", "minesim.run", "--days", "2", "--out", str(out)],
        cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    for name in ("nodes.csv", "terrain_state.npz", "terrain_changes.jsonl", "run_summary.json"):
        assert (out / name).is_file()
    assert json.loads((out / "run_summary.json").read_text())["epochs"] == 48
