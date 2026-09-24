"""Gate L1 (WP9 §8, Sitting C) — A scenario cannot change the real run.

L1 asserts that running EVERY scenario type against a REAL simulation run directory
leaves every file in that directory byte-identical (sha256 checked before and after).
We do NOT use a temp copy — we hash the real mine-sim/out/v2-690d in place, proving
the server cannot and does not write there.
"""

from __future__ import annotations

import hashlib
from http import HTTPStatus
import json
from pathlib import Path
import threading
from typing import Dict
import urllib.request

import pytest

from lab.events import EVENTS
from lab.server import create_server

REAL_RUN_DIR = Path(__file__).resolve().parents[3] / "mine-sim" / "out" / "v2-690d"


def _hash_files(directory: Path) -> Dict[str, str]:
    """Compute sha256 hex digest for every file directly inside directory."""
    hashes: Dict[str, str] = {}
    for f in sorted(directory.iterdir()):
        if f.is_file():
            h = hashlib.sha256()
            with open(f, "rb") as fp:
                while chunk := fp.read(1024 * 1024):
                    h.update(chunk)
            hashes[f.name] = h.hexdigest()
    return hashes


def test_l1_real_run_dir_byte_identical_after_all_scenarios(tmp_path):
    """L1: hash real run dir before and after running EVERY scenario type — byte-identical."""
    assert REAL_RUN_DIR.is_dir(), f"Real run directory not found: {REAL_RUN_DIR}"
    assert (REAL_RUN_DIR / "run_summary.json").is_file(), "run_summary.json missing in real run dir"
    assert (REAL_RUN_DIR / "nodes.csv").is_file(), "nodes.csv missing in real run dir"

    # 1. Hash every file in the REAL run dir BEFORE running scenarios
    before_hashes = _hash_files(REAL_RUN_DIR)
    assert len(before_hashes) >= 4, f"Expected at least 4 files in {REAL_RUN_DIR}, found {len(before_hashes)}"

    # 2. Boot server pointed at the REAL run dir, with a temporary store_dir
    server = create_server(
        run_dir=REAL_RUN_DIR,
        port=0,
        host="127.0.0.1",
        store_dir=tmp_path / "store",
    )
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    port = server.server_address[1]

    # Test requests for EVERY event type in EVENTS
    scenario_requests = [
        {"day": 172, "segment": "3", "type": "crack", "params": {"days_ahead": 60}},
        {"day": 300, "segment": "5", "type": "sudden_sinking", "params": {"collapse_radius_m": 40}},
        {"day": 300, "segment": "5", "type": "edge_collapse", "params": {"extra_width_m": 25}},
        # Also include a refusal case
        {"day": 10, "segment": "1", "type": "crack", "params": {"days_ahead": 10}},
    ]

    # Verify that all registered events in EVENTS are covered
    registered_events = set(EVENTS.keys())
    tested_events = {req["type"] for req in scenario_requests}
    assert registered_events.issubset(tested_events), f"Not all EVENTS covered: {registered_events - tested_events}"

    try:
        for req_dict in scenario_requests:
            url = f"http://127.0.0.1:{port}/api/scenario"
            body = json.dumps(req_dict).encode("utf-8")
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req) as resp:
                assert resp.status == HTTPStatus.OK
                data = json.loads(resp.read().decode("utf-8"))
                assert "scenario_id" in data
                assert data["kind"] == "scenario"
    finally:
        server.shutdown()
        server.server_close()

    # 3. Hash every file in the REAL run dir AFTER running all scenarios
    after_hashes = _hash_files(REAL_RUN_DIR)

    # 4. Strict byte-identical comparison
    assert set(before_hashes.keys()) == set(after_hashes.keys()), "Set of files in run dir changed!"
    for fname, before_h in before_hashes.items():
        after_h = after_hashes[fname]
        assert before_h == after_h, f"File {fname} modified by scenario run! {before_h} != {after_h}"
