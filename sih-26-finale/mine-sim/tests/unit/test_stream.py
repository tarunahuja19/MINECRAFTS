"""Unit tests for minesim.stream writers (WP6) and the csv-level G04 check."""

import csv
import json
from pathlib import Path

import numpy as np
import pytest

from minesim.config import load_config
from minesim.provenance import TAGS
from minesim.run import run_sim
from minesim.stream import NODES_CSV_HEADER, replay_terrain
from minesim.world import WorldState
from minesim.sizing import size_network
from tests.helpers import load_mutated_config

CONTRACT_HEADER = (
    "epoch,t_s,node_id,tier,x_m,y_m,z0_mm,subsidence_mm,subsidence_prov,"
    "tilt_x_urad,tilt_y_urad,tilt_prov,strain_ustrain,strain_prov,"
    "disp_mm,disp_prov,battery_mv,rssi_dbm,parent_used,delivered,via_emergency"
)
VALUE_PROV_PAIRS = (("subsidence_mm", "subsidence_prov"), ("tilt_x_urad", "tilt_prov"),
                    ("tilt_y_urad", "tilt_prov"), ("strain_ustrain", "strain_prov"), ("disp_mm", "disp_prov"))
DAYS = 12.0


@pytest.fixture(scope="module")
def run_dir(tmp_path_factory):
    cfg = load_config(Path("config/assumptions.yaml"))
    out = tmp_path_factory.mktemp("run")
    run_sim(cfg, DAYS, out)
    return out


def _rows(run_dir):
    with open(run_dir / "nodes.csv", newline="") as f:
        return list(csv.DictReader(f))


def test_header_exactly_contract(run_dir):
    assert ",".join(NODES_CSV_HEADER) == CONTRACT_HEADER
    assert (run_dir / "nodes.csv").read_text().splitlines()[0] == CONTRACT_HEADER


def test_four_artefacts(run_dir):
    for name in ("nodes.csv", "terrain_state.npz", "terrain_changes.jsonl", "run_summary.json"):
        assert (run_dir / name).is_file()


def test_row_per_scout_per_epoch(run_dir):
    cfg = load_config(Path("config/assumptions.yaml"))
    scouts = sum(n.tier in ("1A", "1B", "1C") for n in size_network(cfg).nodes)
    epochs = int(DAYS * 86400 / cfg.sim.timestep_s)
    rows = _rows(run_dir)
    assert len(rows) == scouts * epochs
    assert sorted({int(r["epoch"]) for r in rows}) == list(range(1, epochs + 1))


def test_g04_csv_every_value_has_populated_prov(run_dir):
    for r in _rows(run_dir):
        for value_col, prov_col in VALUE_PROV_PAIRS:
            if r[value_col] != "":
                assert r[prov_col] in TAGS
            elif value_col != "tilt_y_urad":
                assert r[prov_col] == ""
        assert r["subsidence_prov"] in TAGS


def test_tier_empty_fields(run_dir):
    for r in _rows(run_dir):
        if r["tier"] == "1A":
            assert r["tilt_x_urad"] and r["strain_ustrain"] == "" and r["disp_mm"] == ""
        elif r["tier"] == "1B":
            assert r["strain_ustrain"] and r["disp_mm"] and r["tilt_x_urad"] == ""
        else:
            assert r["strain_ustrain"] and r["disp_mm"] == "" and r["tilt_x_urad"] == ""


def test_jsonl_one_line_per_step_with_empty_cells(run_dir):
    lines = (run_dir / "terrain_changes.jsonl").read_text().splitlines()
    parsed = [json.loads(l) for l in lines]
    assert [p["epoch"] for p in parsed] == list(range(1, len(parsed) + 1))
    assert any(p["cells"] == [] for p in parsed)
    assert all(isinstance(v, int) for p in parsed for c in p["cells"] for v in c)


def test_jsonl_round_trip_equals_world_deltas(run_dir):
    cfg = load_config(Path("config/assumptions.yaml"))
    world = WorldState(cfg, size_network(cfg))
    with open(run_dir / "terrain_changes.jsonl") as f:
        for line in f:
            d = world.step()
            assert json.loads(line)["cells"] == [list(c) for c in d.cells]
    assert np.array_equal(replay_terrain(run_dir), world.snapshot())


def test_npz_keys(run_dir):
    with np.load(run_dir / "terrain_state.npz") as s:
        assert set(s.files) == {"origin_x_m", "origin_y_m", "cell_m", "shape", "z0_mm"}
        assert s["z0_mm"].dtype == np.int32
        assert tuple(s["shape"]) == s["z0_mm"].shape


def test_summary(run_dir):
    s = json.loads((run_dir / "run_summary.json").read_text())
    assert s["sign_convention"] == "negative_down"
    assert s["packets"] == len(_rows(run_dir))
    assert abs(sum(v["pct"] for v in s["provenance"].values()) - 100.0) < 1e-6
    assert set(s["provenance"]) == set(TAGS)
    fitted = json.loads(Path("data/fitted/adriyala_lw1_params.json").read_text())
    assert s["fit"]["knothe_r_squared"] == fitted["fit"]["r_squared"]


def test_full_loss_still_writes_rows(tmp_path):
    cfg = load_mutated_config(lambda d: d["radio"].__setitem__("bernoulli_loss_prob", 1.0))
    run_sim(cfg, 1.0, tmp_path)
    rows = _rows(tmp_path)
    assert rows and all(r["delivered"] == "false" for r in rows)


def test_same_seed_identical_csv(tmp_path):
    cfg = load_config(Path("config/assumptions.yaml"))
    run_sim(cfg, 2.0, tmp_path / "a")
    run_sim(cfg, 2.0, tmp_path / "b")
    assert (tmp_path / "a" / "nodes.csv").read_bytes() == (tmp_path / "b" / "nodes.csv").read_bytes()
    assert (tmp_path / "a" / "terrain_changes.jsonl").read_bytes() == (tmp_path / "b" / "terrain_changes.jsonl").read_bytes()
