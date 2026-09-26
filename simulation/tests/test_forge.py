"""Tests for FORGE private math server on :8020."""

import io
import json
import math
from unittest.mock import MagicMock, patch
import urllib.error

import numpy as np
import pytest
from starlette.testclient import TestClient

from forge.server import app, _X, _Y, _sensor_array
from sandbox import collapse, surface
from sandbox.collapse import PillarFailure
from sandbox.mqtt_bridge import _node_topic_id
from sandbox.sensors import _coord_to_grid_index
from sandbox.session import SimulationSession, active_collapses


@pytest.fixture
def client():
    return TestClient(app)


def test_frame_day_zero_subsidence_zero(client):
    """Frame at day 0: subsidence is zero everywhere."""
    res = client.post("/forge/frame", json={"day": 0.0, "events": []})
    assert res.status_code == 200
    data = res.json()

    s_grid = np.array(data["channels"]["s"])
    assert np.all(s_grid == 0.0)
    assert data["terrain"]["max_subsidence_m"] == 0.0
    assert len(data["perturbations"]) == 0


def test_frame_day_30_no_events_matches_surface_channels(client):
    """Frame at day 30 with no events matches surface.channels(X, Y, 30) exactly."""
    res = client.post("/forge/frame", json={"day": 30.0, "events": []})
    assert res.status_code == 200
    data = res.json()

    expected_channels = surface.channels(_X, _Y, 30.0)
    for key, expected_arr in expected_channels.items():
        assert key in data["channels"]
        actual_arr = np.array(data["channels"][key])
        np.testing.assert_allclose(
            actual_arr,
            expected_arr,
            atol=0.0,
            err_msg=f"Channel {key} does not match surface.channels exactly",
        )


def test_cave_in_delta_evolution(client):
    """Cave-in 10 m depth / 100 m radius at day 20:

    At day 19 the centre delta is 0; at day 25 (settled) the centre delta is ≈ -10 m (±5%).
    """
    event = [
        {
            "type": "cave_in",
            "x": 0.0,
            "y": 0.0,
            "radius_m": 100.0,
            "depth_m": 10.0,
            "day": 20.0,
            "duration_h": 4.8,
        }
    ]
    cx_idx = _coord_to_grid_index(0.0)
    cy_idx = _coord_to_grid_index(0.0)

    # 1. Day 19 (before initiation) -> centre delta is 0
    res19 = client.post("/forge/frame", json={"day": 19.0, "events": event})
    assert res19.status_code == 200
    deltas19 = res19.json()["deltas"]
    delta_s_19 = np.array(deltas19["delta_s"])
    assert delta_s_19[cy_idx, cx_idx] == 0.0
    assert len(res19.json()["perturbations"]) == 0

    # 2. Day 25 (settled after dynamic collapse) -> centre delta is ≈ 10 m subsidence (-10 m elev)
    res25 = client.post("/forge/frame", json={"day": 25.0, "events": event})
    assert res25.status_code == 200
    deltas25 = res25.json()["deltas"]
    delta_s_25 = np.array(deltas25["delta_s"])
    centre_delta = float(delta_s_25[cy_idx, cx_idx])
    # Delta s is positive downward subsidence (10.0 m ± 5%, i.e. 9.5 to 10.5 m)
    assert 9.5 <= centre_delta <= 10.5
    # Relative vertical displacement delta is -10.0 m ± 5%
    assert -10.5 <= -centre_delta <= -9.5


def test_node_states_match_session(client):
    """Node_states match Session's own result for the same failures and day."""
    day = 20.2
    event = [
        {
            "type": "cave_in",
            "x": 25.0,
            "y": 30.0,
            "radius_m": 80.0,
            "depth_m": 5.0,
            "day": 20.0,
            "duration_h": 4.8,
        }
    ]

    res = client.post("/forge/frame", json={"day": day, "events": event})
    assert res.status_code == 200
    forge_states = res.json()["node_states"]

    # Build Session with identical failure
    session = SimulationSession()
    pf = PillarFailure(
        cx=25.0,
        cy=30.0,
        radius_m=80.0,
        t_init_days=20.0,
        t_collapse_days=20.0 + (8.0 / 24.0),
        duration_days=4.8 / 24.0,
        magnitude_m=5.0,
    )
    session.pillar_failures = [pf]
    active_colls = active_collapses(session.pillar_failures, day)
    expected_states = session._assign_node_states(active_colls)

    assert forge_states == expected_states


def test_nodes_inside_critical_radius_lifecycle(client):
    """Nodes inside 1.2R are CRITICAL during the active window and ACTIVE after it ends."""
    # Find a node close to center (0, 0)
    target_node = min(_sensor_array.nodes, key=lambda n: math.hypot(n.x_m, n.y_m))
    dist = math.hypot(target_node.x_m, target_node.y_m)
    radius_m = max(dist + 20.0, 60.0)  # Ensures target_node is well inside 1.2 * radius_m

    event = [
        {
            "type": "cave_in",
            "x": 0.0,
            "y": 0.0,
            "radius_m": radius_m,
            "depth_m": 8.0,
            "day": 20.0,
            "duration_h": 4.8,
        }
    ]
    node_key = _node_topic_id(target_node.node_id)

    # Active window: t_init=20.0, t_collapse=20.333, duration=0.2d, window_end=20.5833
    # At day 20.25 (during active window):
    res_active = client.post("/forge/frame", json={"day": 20.25, "events": event})
    assert res_active.status_code == 200
    states_active = res_active.json()["node_states"]
    assert states_active[node_key] == "CRITICAL"

    # After window ends (e.g. day 21.0):
    res_ended = client.post("/forge/frame", json={"day": 21.0, "events": event})
    assert res_ended.status_code == 200
    states_ended = res_ended.json()["node_states"]
    assert states_ended[node_key] == "ACTIVE"


def test_forge_range(client):
    """POST /forge/range: no events -> 120; an event on day 118 -> end_day > 118."""
    # 1. No events -> exactly 120
    res_empty = client.post("/forge/range", json={"events": []})
    assert res_empty.status_code == 200
    assert res_empty.json()["end_day"] == 120

    # 2. Event on day 118 -> end_day > 118
    event_118 = [
        {
            "type": "cave_in",
            "x": 10.0,
            "y": 10.0,
            "radius_m": 50.0,
            "depth_m": 2.0,
            "day": 118.0,
            "duration_h": 4.8,
        }
    ]
    res_118 = client.post("/forge/range", json={"events": event_118})
    assert res_118.status_code == 200
    end_day = res_118.json()["end_day"]
    assert end_day > 118
    # 118 + 8/24 (0.333) + 4.8/24 (0.2) + 5 = 123.533 -> ceil = 124
    assert end_day == 124


def test_unknown_event_type_raises_422(client):
    """Unknown event type -> 422."""
    res_frame = client.post(
        "/forge/frame",
        json={"day": 10.0, "events": [{"type": "earthquake", "x": 0, "y": 0}]},
    )
    assert res_frame.status_code == 422

    res_range = client.post(
        "/forge/range",
        json={"events": [{"type": "explosion", "x": 0, "y": 0}]},
    )
    assert res_range.status_code == 422


def test_forge_seed_mocked_and_down(client):
    """/forge/seed with :8000 mocked -> correct {day, events}; with :8000 down -> 503."""
    mock_live_payload = {
        "t_sim_seconds": 172800.0,  # 2.0 days
        "pillar_failures": [
            {
                "cx": 15.0,
                "cy": 25.0,
                "radius_m": 70.0,
                "t_init_days": 1.5,
                "t_collapse_days": 1.833,
                "duration_days": 0.2,
                "magnitude_m": 3.2,
            }
        ],
    }

    # Case 1: :8000 is healthy and mocked
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = json.dumps(mock_live_payload).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res = client.get("/forge/seed")
        assert res.status_code == 200
        seed_data = res.json()
        assert seed_data["day"] == 2.0
        assert len(seed_data["events"]) == 1
        ev = seed_data["events"][0]
        assert ev["type"] == "cave_in"
        assert ev["x"] == 15.0
        assert ev["y"] == 25.0
        assert ev["radius_m"] == 70.0
        assert ev["depth_m"] == 3.2
        assert ev["day"] == 1.5
        assert ev["duration_h"] == 4.8
        assert ev["source"] == "live"

    # Case 2: :8000 is down (raises exception)
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("Connection refused"),
    ):
        res_down = client.get("/forge/seed")
        assert res_down.status_code == 503
        assert "unavailable" in res_down.json()["detail"].lower()
