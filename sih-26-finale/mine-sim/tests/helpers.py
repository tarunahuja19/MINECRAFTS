"""Shared test helpers (not tests)."""

import tempfile
from pathlib import Path
from typing import Callable, Optional

import yaml

from minesim.config import Config, load_config

MINE_SIM = Path(__file__).resolve().parent.parent


def load_mutated_config(mutate_assumptions: Optional[Callable[[dict], None]] = None,
                        mutate_mine: Optional[Callable[[dict], None]] = None) -> Config:
    """Load the real config after mutating copies of assumptions.yaml and the mine file.

    The copies live in a temp `config/` dir; the real files are never touched (no src/ or
    config/ change is needed to run a variant — that is what G15 relies on).
    """
    assumptions = yaml.safe_load((MINE_SIM / "config" / "assumptions.yaml").read_text())
    if mutate_assumptions:
        mutate_assumptions(assumptions)
    mine_name = assumptions["mine"]
    mine = yaml.safe_load((MINE_SIM / "config" / "mines" / f"{mine_name}.yaml").read_text())
    if mutate_mine:
        mutate_mine(mine)
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "config" / "mines").mkdir(parents=True)
        (root / "config" / "mines" / f"{mine_name}.yaml").write_text(yaml.dump(mine))
        path = root / "config" / "assumptions.yaml"
        path.write_text(yaml.dump(assumptions))
        return load_config(path)
