"""Tests for D1: 365-day dataset builder (simulation/scripts/build_dataset_365.py).

Uses a short 10-day build so the test suite runs fast and deterministically.
Checks:
- Two builds with the same seed give the identical SHA-256 for all files.
- The row count is days * 24 * 31 (7,440 rows for 10 days).
- A tier with no strain gauge has null strain, never 0.
- The hour-h row equals what tick number h returned.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
from pathlib import Path
import tempfile

import numpy as np
import pytest

from sandbox.session import SessionConfig, SimulationSession
from scripts.build_dataset_365 import build_dataset, get_provenance


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_two_builds_give_same_sha256(tmp_path: Path):
    """Two independent 10-day builds produce byte-for-byte identical output."""
    dir1 = tmp_path / "build1"
    dir2 = tmp_path / "build2"

    res1 = build_dataset(dir1, days=10, seed=42)
    res2 = build_dataset(dir2, days=10, seed=42)

    assert dir1.exists() and dir2.exists()

    for filename in ("nodes_hourly.csv.gz", "bowl_terms.npz", "events.csv", "meta.json", "README.md"):
        f1 = dir1 / filename
        f2 = dir2 / filename
        assert f1.exists(), f"missing {filename} in build 1"
        assert f2.exists(), f"missing {filename} in build 2"

        h1 = _file_sha256(f1)
        h2 = _file_sha256(f2)
        assert h1 == h2, f"{filename} SHA-256 differs between builds: {h1} != {h2}"

    assert res1["meta"]["files"]["nodes_hourly.csv.gz"]["sha256"] == res2["meta"]["files"]["nodes_hourly.csv.gz"]["sha256"]


def test_row_count_and_columns(tmp_path: Path):
    """The row count is days*24*31, and columns match specification."""
    out_dir = tmp_path / "build_count"
    days = 10
    build_dataset(out_dir, days=days, seed=42)

    gz_path = out_dir / "nodes_hourly.csv.gz"
    with gzip.open(gz_path, "rt", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader)
        rows = list(reader)

    expected_rows = days * 24 * 31  # 7440
    assert len(rows) == expected_rows, f"expected {expected_rows} rows, got {len(rows)}"

    # Check header structure
    assert header[:5] == ["t_hour", "day", "iso_time", "node_id", "tier"]
    assert header[-1] == "provenance"

    # Verify every row has exact header length
    for i, row in enumerate(rows):
        assert len(row) == len(header), f"row {i} has length {len(row)} != {len(header)}"


def test_tier_with_no_strain_gauge_has_null_strain(tmp_path: Path):
    """A tier with no strain gauge has null (empty string) strain, never 0 or 0.00."""
    out_dir = tmp_path / "build_strain"
    build_dataset(out_dir, days=10, seed=42)

    gz_path = out_dir / "nodes_hourly.csv.gz"
    with gzip.open(gz_path, "rt", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tier = row["tier"]
            strain_str = row["strain_ue"]
            if tier in ("1A", "1C", "2A", "2B", "3"):
                # No strain gauge on these tiers: MUST be empty
                assert strain_str == "", (
                    f"node {row['node_id']} tier {tier} has strain {strain_str!r}, expected empty string"
                )
                assert strain_str != "0"
                assert strain_str != "0.00"
            elif tier == "1B":
                # Tier 1B has strain gauge: must NOT be empty
                assert strain_str != "", f"node {row['node_id']} tier 1B has empty strain"


def test_hour_h_row_equals_tick_output(tmp_path: Path):
    """Row at hour h equals what tick number h returned for each node and channel."""
    out_dir = tmp_path / "build_replay"
    days = 10
    seed = 42
    build_dataset(out_dir, days=days, seed=seed)

    # Run session independently with exact same config
    with tempfile.TemporaryDirectory() as tmp:
        cfg = SessionConfig(
            ground="district",
            seed=seed,
            tick_duration_sim_s=3600.0,
            save_packet_json=False,
            out_dir=Path(tmp),
            base_iso_time="2026-01-01T00:00:00Z",
            enable_mqtt=False,
            enable_db=False,
            quiet=True,
            write_nodes_csv=False,
        )
        session = SimulationSession(cfg)
        session.start()

        target_h = 36  # day 1, hour 12
        for h in range(target_h + 1):
            session.tick()
        expected_readings = {r.node_id: r for r in session.last_readings}

    gz_path = out_dir / "nodes_hourly.csv.gz"
    with gzip.open(gz_path, "rt", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        h_rows = [row for row in reader if int(row["t_hour"]) == target_h]

    assert len(h_rows) == 31, f"expected 31 rows at hour {target_h}, got {len(h_rows)}"

    for row in h_rows:
        nid = int(row["node_id"])
        exp_r = expected_readings[nid]

        assert int(row["day"]) == target_h // 24
        assert row["tier"] == exp_r.tier
        assert row["provenance"] == get_provenance(exp_r.tier)

        for ch_name, ch_val in exp_r.channels.items():
            cell_str = row[ch_name]
            assert cell_str != "", f"expected value for {ch_name} on node {nid}"
            if isinstance(ch_val, (float, np.floating)):
                assert float(cell_str) == pytest.approx(float(ch_val), abs=0.01)
            else:
                assert int(cell_str) == int(ch_val)
