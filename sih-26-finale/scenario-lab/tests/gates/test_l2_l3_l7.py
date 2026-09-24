"""Gates L2, L3, L7 (WP9 §8, Sitting C) — Determinism, Network Boundary, and Labelling.

L2: POST the same scenario twice -> byte-identical response bodies.
L3: (a) AST scan over lab/**/*.py forbidding OUTBOUND client imports:
        requests, httpx, urllib.request, socket.
        http.server and urllib.parse are INBOUND/parsing and explicitly allowed;
        name them as allowed in the test docstring so a future reader does not "fix" it.
    (b) Every path the server writes resolves inside store_dir.
L7: Every POST /api/scenario response contains label "SCENARIO (HYPOTHETICAL)".
"""

from __future__ import annotations

import ast
from http import HTTPStatus
import json
from pathlib import Path
import threading
from typing import Dict, List, Set
import urllib.request

import pytest

from lab import store
from lab.events import EVENTS
from lab.server import create_server

LAB_DIR = Path(__file__).resolve().parents[2] / "lab"
REAL_RUN_DIR = Path(__file__).resolve().parents[3] / "mine-sim" / "out" / "v2-690d"


# ---------------------------------------------------------------------------
# Gate L2 — Determinism
# ---------------------------------------------------------------------------


def test_l2_post_same_scenario_twice_byte_identical(tmp_path):
    """L2: POST the same scenario twice -> byte-identical response bodies."""
    server = create_server(
        run_dir=REAL_RUN_DIR,
        port=0,
        host="127.0.0.1",
        store_dir=tmp_path / "store",
    )
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    port = server.server_address[1]

    req_dict = {
        "day": 172,
        "segment": "3",
        "type": "crack",
        "params": {"days_ahead": 60},
    }
    url = f"http://127.0.0.1:{port}/api/scenario"

    try:
        # First POST
        body1 = json.dumps(req_dict).encode("utf-8")
        req1 = urllib.request.Request(url, data=body1, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req1) as resp1:
            assert resp1.status == HTTPStatus.OK
            raw_bytes1 = resp1.read()
            json1 = json.loads(raw_bytes1.decode("utf-8"))

        # Second POST (exact same request)
        body2 = json.dumps(req_dict).encode("utf-8")
        req2 = urllib.request.Request(url, data=body2, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req2) as resp2:
            assert resp2.status == HTTPStatus.OK
            raw_bytes2 = resp2.read()
            json2 = json.loads(raw_bytes2.decode("utf-8"))

        # Raw response bodies must be byte-identical
        assert raw_bytes1 == raw_bytes2, "Response bodies for identical POST requests were not byte-identical!"
        assert json1["scenario_id"] == json2["scenario_id"]

        # Third POST with different dictionary key ordering in JSON (canonical request hashing check)
        req_reordered = {
            "params": {"days_ahead": 60},
            "type": "crack",
            "segment": "3",
            "day": 172,
        }
        body3 = json.dumps(req_reordered).encode("utf-8")
        req3 = urllib.request.Request(url, data=body3, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req3) as resp3:
            assert resp3.status == HTTPStatus.OK
            raw_bytes3 = resp3.read()
            json3 = json.loads(raw_bytes3.decode("utf-8"))

        # Must yield same scenario_id and byte-identical payload
        assert json3["scenario_id"] == json1["scenario_id"]
        assert raw_bytes3 == raw_bytes1

        # File in store must exist and match response
        stored_file = tmp_path / "store" / f"{json1['scenario_id']}.json"
        assert stored_file.is_file(), "Saved scenario file missing in store_dir"
        stored_data = json.loads(stored_file.read_text(encoding="utf-8"))
        assert stored_data["scenario_id"] == json1["scenario_id"]
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Gate L3 — Network boundary and store containment
# ---------------------------------------------------------------------------


def test_l3_a_ast_scan_forbids_outbound_client_imports():
    """L3(a): AST scan over lab/**/*.py forbidding OUTBOUND client imports:

    requests, httpx, urllib.request, socket.

    Note for future readers:
    http.server and urllib.parse are INBOUND / parsing and explicitly allowed.
    """
    forbidden_modules = {
        "requests",
        "httpx",
        "socket",
        "minesim.world",
        "minesim.stream",
    }
    violations: List[str] = []

    for path in sorted(LAB_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    name = alias.name
                    if name in forbidden_modules or name.startswith("urllib.request"):
                        violations.append(f"{path.relative_to(LAB_DIR.parent)}:{node.lineno} imports forbidden {name}")
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ""
                if module in forbidden_modules:
                    violations.append(f"{path.relative_to(LAB_DIR.parent)}:{node.lineno} imports from forbidden {module}")
                if module == "urllib":
                    for alias in node.names:
                        if alias.name == "request":
                            violations.append(
                                f"{path.relative_to(LAB_DIR.parent)}:{node.lineno} imports forbidden urllib.request"
                            )

    assert not violations, f"Forbidden outbound/world imports found in lab/:\n" + "\n".join(violations)


def test_l3_b_all_server_writes_resolve_inside_store_dir(tmp_path):
    """L3(b): Every path the server writes resolves strictly inside store_dir."""
    store_dir = tmp_path / "sandbox_store"
    server = create_server(
        run_dir=REAL_RUN_DIR,
        port=0,
        host="127.0.0.1",
        store_dir=store_dir,
    )
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    port = server.server_address[1]

    try:
        # Run a scenario to trigger writes
        req_dict = {"day": 172, "segment": "3", "type": "crack", "params": {"days_ahead": 60}}
        url = f"http://127.0.0.1:{port}/api/scenario"
        req = urllib.request.Request(
            url,
            data=json.dumps(req_dict).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req) as resp:
            assert resp.status == HTTPStatus.OK
            data = json.loads(resp.read().decode("utf-8"))
            sid = data["scenario_id"]

        # Verify all files written are inside store_dir
        written_files = list(store_dir.rglob("*"))
        assert len(written_files) > 0, "Expected scenario files to be written in store_dir"
        store_resolved = store_dir.resolve()
        for f in written_files:
            assert f.resolve().is_relative_to(store_resolved), f"File {f} is not inside {store_resolved}"

        # Test store path traversal refusal
        with pytest.raises(PermissionError, match="Target path .* resolves outside store directory"):
            store.get_scenario("../outside", store_dir=store_dir)

    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------------------
# Gate L7 — Scenario hypothetical labelling
# ---------------------------------------------------------------------------


def test_l7_every_scenario_response_contains_hypothetical_label(tmp_path):
    """L7: Every POST /api/scenario response contains label 'SCENARIO (HYPOTHETICAL)'."""
    server = create_server(
        run_dir=REAL_RUN_DIR,
        port=0,
        host="127.0.0.1",
        store_dir=tmp_path / "store",
    )
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    port = server.server_address[1]

    # Test cases: all event types plus a refusal case
    test_cases = [
        {"day": 172, "segment": "3", "type": "crack", "params": {"days_ahead": 60}},
        {"day": 300, "segment": "5", "type": "sudden_sinking", "params": {"collapse_radius_m": 40}},
        {"day": 300, "segment": "5", "type": "edge_collapse", "params": {"extra_width_m": 25}},
        # Refusal case: ground not moving
        {"day": 10, "segment": "1", "type": "crack", "params": {"days_ahead": 10}},
        # Out-of-range parameter refusal case
        {"day": 172, "segment": "3", "type": "crack", "params": {"days_ahead": 99999}},
    ]

    try:
        for payload in test_cases:
            url = f"http://127.0.0.1:{port}/api/scenario"
            body = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req) as resp:
                assert resp.status == HTTPStatus.OK
                data = json.loads(resp.read().decode("utf-8"))
                # Gate L7 assertions
                assert "label" in data, f"Missing label in scenario response for {payload}"
                assert data["label"] == "SCENARIO (HYPOTHETICAL)", f"Wrong label: {data['label']}"
                assert data["kind"] == "scenario", f"Wrong kind: {data['kind']}"
                assert "schema_version" in data
                assert "possible" in data
    finally:
        server.shutdown()
        server.server_close()
