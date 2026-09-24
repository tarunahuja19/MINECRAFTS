"""F4: size_network(cfg) returns the v3 planned network when layout.source == plan."""

import csv
import inspect
from pathlib import Path

import pytest

from minesim.config import load_config
from minesim.placement import load_plan_config, plan_network
from minesim.run import run_sim
from minesim.sizing import size_network

CONFIG = Path("config/assumptions.yaml")
SCOUTS = ("1A", "1B", "1C")


@pytest.fixture(scope="module")
def cfg():
    c = load_config(CONFIG)
    assert c.layout.source == "plan"
    return c


def test_layout_equals_node_plan(cfg):
    layout = size_network(cfg)
    plan = plan_network(cfg, load_plan_config(CONFIG)).to_json()
    got = [(n.node_id, n.tier, n.parent_id, n.backup_parent_id, n.child_index, n.x_m, n.y_m) for n in layout.nodes]
    want = [(n["node_id"], n["tier"], n["parent_id"], n["backup_parent_id"], n["child_index"], n["x_m"], n["y_m"])
            for n in plan["nodes"]]
    assert got == want
    assert layout.cost.total_inr == plan["cost_inr"]["total"]
    assert all(n.z0_mm == 0.0 for n in layout.nodes)


def test_size_network_still_takes_one_argument():
    from tests.gates.test_g02 import _violations
    assert _violations(size_network) == []
    assert list(inspect.signature(size_network).parameters) == ["cfg"]


def test_80_day_plan_run_rows_and_no_duplicates(cfg, tmp_path):
    summary = run_sim(cfg, 80.0, tmp_path, config_path=CONFIG)
    scouts = sum(1 for n in size_network(cfg).nodes if n.tier in SCOUTS)
    assert summary["scouts"] == scouts
    keys = set()
    rows = 0
    with open(tmp_path / "nodes.csv", newline="") as f:
        for row in csv.DictReader(f):
            rows += 1
            keys.add((row["node_id"], row["epoch"]))
    assert rows == scouts * summary["epochs"]
    assert len(keys) == rows
