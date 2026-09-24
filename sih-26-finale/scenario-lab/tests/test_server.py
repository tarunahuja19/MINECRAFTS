"""Unit tests for Scenario Lab HTTP server endpoints (Sitting C).

Tests all endpoints:
  - GET /health
  - POST /control
  - GET /api/run
  - GET /api/segments
  - GET /api/events
  - GET /api/objects
  - GET /api/snapshot
  - POST /api/scenario
  - GET /api/scenarios, GET /api/scenarios/{id}
  - Static file serving from renderer/ at /
"""

from __future__ import annotations

from http import HTTPStatus
import json
from pathlib import Path
import threading
from typing import Any, Dict, Tuple
import urllib.request
import urllib.error

import pytest

from lab.server import create_server

REAL_RUN_DIR = Path(__file__).resolve().parents[2] / "mine-sim" / "out" / "v2-690d"


@pytest.fixture
def running_server(tmp_path):
    """Start in-process ThreadingHTTPServer on an ephemeral port with isolated store."""
    store_dir = tmp_path / "store"
    server = create_server(
        run_dir=REAL_RUN_DIR,
        port=0,
        host="127.0.0.1",
        store_dir=store_dir,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"

    yield server, base_url, store_dir

    server.shutdown()
    server.server_close()


def http_get(url: str) -> Tuple[int, Dict[str, Any]]:
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def http_post(url: str, data: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def test_health_and_control(running_server):
    """GET /health and POST /control in the Box-2 shape."""
    _server, base_url, _store = running_server

    # GET /health
    status, health = http_get(f"{base_url}/health")
    assert status == HTTPStatus.OK
    assert health["is_running"] is True
    assert health["is_paused"] is False
    assert health["state"] == "running"
    assert "t_sim_seconds" in health

    # POST /control stop
    status, ctrl = http_post(f"{base_url}/control", {"action": "stop"})
    assert status == HTTPStatus.OK
    assert ctrl["is_running"] is False
    assert ctrl["state"] == "stopped"

    # Verify /health reflects stopped
    status, health2 = http_get(f"{base_url}/health")
    assert health2["is_running"] is False
    assert health2["state"] == "stopped"

    # POST /control start
    status, ctrl2 = http_post(f"{base_url}/control", {"action": "start"})
    assert status == HTTPStatus.OK
    assert ctrl2["is_running"] is True
    assert ctrl2["state"] == "running"


def test_api_run(running_server):
    """GET /api/run returns mine, run_id, days, face position, and node/tier counts."""
    _server, base_url, _store = running_server
    status, data = http_get(f"{base_url}/api/run")
    assert status == HTTPStatus.OK
    assert data["mine"] == "adriyala_lw1"
    assert len(data["run_id"]) == 8
    assert data["days"] == 690.0
    assert data["face_position_m"] == 2500.0
    assert "nodes_per_tier" in data
    assert data["node_counts"]["total"] == 410
    assert data["node_counts"]["scouts"] == 327

    # With day parameter
    status, data_d172 = http_get(f"{base_url}/api/run?day=172")
    assert status == HTTPStatus.OK
    assert data_d172["face_position_m"] == pytest.approx(688.0, abs=1.0)


def test_api_segments(running_server):
    """GET /api/segments returns 10 zones + full with lat/lon bounds from lab/geo.py."""
    _server, base_url, _store = running_server
    status, data = http_get(f"{base_url}/api/segments")
    assert status == HTTPStatus.OK
    assert isinstance(data, list)
    assert len(data) == 11  # 1..10 + full

    zone_ids = [z["id"] for z in data]
    assert zone_ids[:10] == [str(i) for i in range(1, 11)]
    assert zone_ids[10] == "full"

    # Verify bounds in each segment
    for seg in data:
        assert "bounds" in seg
        b = seg["bounds"]
        assert b["north"] > b["south"]
        assert b["east"] > b["west"]


def test_api_events(running_server):
    """GET /api/events returns event specs loaded via lab.config.load_event_spec."""
    _server, base_url, _store = running_server
    status, events = http_get(f"{base_url}/api/events")
    assert status == HTTPStatus.OK
    assert "crack" in events
    assert "sudden_sinking" in events
    assert "edge_collapse" in events

    crack_spec = events["crack"]
    assert "inputs" in crack_spec
    days_ahead = crack_spec["inputs"]["days_ahead"]
    for key in ("default", "min", "max", "unit", "source"):
        assert key in days_ahead


def test_api_objects(running_server):
    """GET /api/objects returns illustrative village objects with lat/lon."""
    _server, base_url, _store = running_server
    status, objs = http_get(f"{base_url}/api/objects")
    assert status == HTTPStatus.OK
    assert isinstance(objs, list)
    assert len(objs) > 0

    # Every point object has lat and lon
    for obj in objs:
        if obj.get("type") in ("house", "pole"):
            assert "lat" in obj and "lon" in obj
            assert 18.0 < obj["lat"] < 19.0
            assert 79.0 < obj["lon"] < 80.0
        elif obj.get("type") == "road":
            assert "line_latlon" in obj
            assert len(obj["line_latlon"]) >= 2


def test_api_snapshot(running_server):
    """GET /api/snapshot?day=&segment= returns block-averaged negative-down subsidence."""
    _server, base_url, _store = running_server
    status, snap = http_get(f"{base_url}/api/snapshot?day=172&segment=3")
    assert status == HTTPStatus.OK
    assert snap["day"] == 172.0
    assert snap["segment"] == "3"
    assert snap["cell_m"] == 20.0
    assert "subsidence_mm" in snap
    assert "shape" in snap

    # Negative-down convention check: sinking values must be <= 0.0
    grid_vals = [val for row in snap["subsidence_mm"] for val in row]
    assert min(grid_vals) < 0.0, "Expected non-zero sinking to be negative on wire"
    assert max(grid_vals) <= 0.0, "Negative-down convention violated: found positive value"


def test_api_scenario_smoke_case(running_server):
    """Smoke case: POST /api/scenario with crack event at day 172, segment 3."""
    _server, base_url, store_dir = running_server
    req_body = {"day": 172, "segment": "3", "type": "crack", "params": {"days_ahead": 60}}
    status, data = http_post(f"{base_url}/api/scenario", req_body)

    assert status == HTTPStatus.OK
    assert data["summary"]["new_cracks"] == 2252
    assert data["summary"]["max_extra_sinking_mm"] < 0.0
    assert data["summary"]["max_extra_sinking_mm"] == pytest.approx(-679.63, abs=1.0)
    assert data["label"] == "SCENARIO (HYPOTHETICAL)"

    # Verify scenario was saved and retrievable via /api/scenarios and /api/scenarios/{id}
    sid = data["scenario_id"]
    status, sc_list = http_get(f"{base_url}/api/scenarios")
    assert status == HTTPStatus.OK
    assert any(s["scenario_id"] == sid for s in sc_list)

    status, fetched = http_get(f"{base_url}/api/scenarios/{sid}")
    assert status == HTTPStatus.OK
    assert fetched["scenario_id"] == sid
    assert fetched["summary"]["new_cracks"] == 2252


def test_api_scenario_refusal_returns_200_not_error(running_server):
    """A refusal returns HTTP 200 with possible:false and the sentence — never an error."""
    _server, base_url, _store = running_server
    # Ground not moving at day 10, Zone 1
    req_body = {"day": 10, "segment": "1", "type": "crack", "params": {"days_ahead": 10}}
    status, data = http_post(f"{base_url}/api/scenario", req_body)

    assert status == HTTPStatus.OK
    assert data["possible"] is False
    assert "not moving now" in data["reason"] or "not possible" in data["reason"].lower()
    assert data["label"] == "SCENARIO (HYPOTHETICAL)"


def test_api_scenario_with_bounds(running_server):
    """POST /api/scenario accepting bounds instead of segment."""
    _server, base_url, _store = running_server
    # Lat/lon bounds corresponding to Zone 3
    status, segs = http_get(f"{base_url}/api/segments")
    seg3 = next(s for s in segs if s["id"] == "3")
    bounds = seg3["bounds"]

    req_body = {"day": 172, "bounds": bounds, "type": "crack", "params": {"days_ahead": 60}}
    status, data = http_post(f"{base_url}/api/scenario", req_body)
    assert status == HTTPStatus.OK
    assert data["possible"] is True
    assert data["summary"]["new_cracks"] == 2252
    assert data["label"] == "SCENARIO (HYPOTHETICAL)"


def test_static_renderer_serving(running_server):
    """Server serves renderer/ files at /."""
    _server, base_url, _store = running_server
    req = urllib.request.Request(f"{base_url}/")
    with urllib.request.urlopen(req) as resp:
        assert resp.status == HTTPStatus.OK
        content = resp.read()
        assert b"<!DOCTYPE html>" in content or b"<html" in content

    # Test 404 for nonexistent static file
    with pytest.raises(urllib.error.HTTPError) as exc_info:
        urllib.request.urlopen(f"{base_url}/nonexistent_file_12345.xyz")
    assert exc_info.value.code == HTTPStatus.NOT_FOUND
