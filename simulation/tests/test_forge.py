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
    res = client.post("/forge/frame", json={"day": 0.0, "events": [], "include_grids": True})
    assert res.status_code == 200
    data = res.json()

    s_grid = np.array(data["channels"]["s"])
    assert np.all(s_grid == 0.0)
    assert data["terrain"]["max_subsidence_m"] == 0.0
    assert len(data["perturbations"]) == 0


def test_frame_day_30_no_events_matches_surface_channels(client):
    """Frame at day 30 with no events matches surface.channels(X, Y, 30) exactly."""
    res = client.post("/forge/frame", json={"day": 30.0, "events": [], "include_grids": True})
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
    res19 = client.post("/forge/frame", json={"day": 19.0, "events": event, "include_grids": True})
    assert res19.status_code == 200
    deltas19 = res19.json()["deltas"]
    delta_s_19 = np.array(deltas19["delta_s"])
    assert delta_s_19[cy_idx, cx_idx] == 0.0
    assert len(res19.json()["perturbations"]) == 0

    # 2. Day 25 (settled after dynamic collapse) -> centre delta is ≈ 10 m subsidence (-10 m elev)
    res25 = client.post("/forge/frame", json={"day": 25.0, "events": event, "include_grids": True})
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
    """POST /forge/range: no events -> 365; an event on day 360 -> end_day > 360."""
    # 1. No events -> exactly 365
    res_empty = client.post("/forge/range", json={"events": []})
    assert res_empty.status_code == 200
    assert res_empty.json()["end_day"] == 365

    # 2. Event on day 360 -> end_day > 360
    event_360 = [
        {
            "type": "cave_in",
            "x": 10.0,
            "y": 10.0,
            "radius_m": 50.0,
            "depth_m": 2.0,
            "day": 360.0,
            "duration_h": 4.8,
        }
    ]
    res_360 = client.post("/forge/range", json={"events": event_360})
    assert res_360.status_code == 200
    end_day = res_360.json()["end_day"]
    assert end_day > 360
    # 360 + 8/24 (0.333) + 4.8/24 (0.2) + 5 = 365.533 -> ceil = 366
    assert end_day == 366


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
        assert ev["warning_hours"] == 7.992
        assert ev["source"] == "live"

    # Case 2: :8000 is down (raises exception)
    with patch(
        "urllib.request.urlopen",
        side_effect=urllib.error.URLError("Connection refused"),
    ):
        res_down = client.get("/forge/seed")
        assert res_down.status_code == 503
        assert "unavailable" in res_down.json()["detail"].lower()


def test_frame_grids_opt_in(client):
    """Default frame has no channels/deltas keys; include_grids=True includes both."""
    # 1. Default (include_grids omitted or False) -> no channels, no deltas
    res_default = client.post("/forge/frame", json={"day": 5.0, "events": []})
    assert res_default.status_code == 200
    data_default = res_default.json()
    assert "channels" not in data_default
    assert "deltas" not in data_default
    assert "t_sim" in data_default
    assert "t_days" in data_default
    assert "perturbations" in data_default
    assert "nodes" in data_default
    assert "node_states" in data_default
    assert "terrain" in data_default

    # 2. include_grids=True -> channels and deltas included
    res_grids = client.post(
        "/forge/frame", json={"day": 5.0, "events": [], "include_grids": True}
    )
    assert res_grids.status_code == 200
    data_grids = res_grids.json()
    assert "channels" in data_grids
    assert "deltas" in data_grids
    assert "s" in data_grids["channels"]
    assert "delta_s" in data_grids["deltas"]


@pytest.mark.parametrize("endpoint", ["/forge/frame", "/forge/range"])
def test_strict_event_validation_422(client, endpoint):
    """Missing radius_m, missing x, or type 'crack' returns 422 for frame and range."""
    valid = {
        "type": "cave_in",
        "x": 10.0,
        "y": 20.0,
        "radius_m": 50.0,
        "depth_m": 2.0,
        "day": 5.0,
        "duration_h": 4.8,
    }

    # 1. Missing radius_m
    no_radius = dict(valid)
    del no_radius["radius_m"]
    res = client.post(endpoint, json={"day": 5.0, "events": [no_radius]})
    assert res.status_code == 422

    # 2. Missing x
    no_x = dict(valid)
    del no_x["x"]
    res = client.post(endpoint, json={"day": 5.0, "events": [no_x]})
    assert res.status_code == 422

    # 3. Type "crack"
    crack_ev = dict(valid, type="crack")
    res = client.post(endpoint, json={"day": 5.0, "events": [crack_ev]})
    assert res.status_code == 422


def test_seed_round_trip(client):
    """Mocked :8000 returns a failure with a 2 h warning; feed seed's events into /forge/frame

    and assert the rebuilt PillarFailure fields equal the original (t_collapse_days included).
    """
    t_init = 10.0
    warning_h = 2.0
    t_collapse = t_init + (warning_h / 24.0)
    duration_days = 0.2
    original_failure = {
        "cx": 45.0,
        "cy": -60.0,
        "radius_m": 75.0,
        "magnitude_m": 6.0,
        "t_init_days": t_init,
        "t_collapse_days": t_collapse,
        "duration_days": duration_days,
    }
    mock_live_payload = {
        "t_sim_seconds": 864000.0,
        "pillar_failures": [original_failure],
    }

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.read.return_value = json.dumps(mock_live_payload).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp

    with patch("urllib.request.urlopen", return_value=mock_resp):
        res_seed = client.get("/forge/seed")
        assert res_seed.status_code == 200
        seed_data = res_seed.json()

    seed_events = seed_data["events"]
    assert len(seed_events) == 1
    assert seed_events[0]["warning_hours"] == 2.0

    # Feed seed events into /forge/frame and assert the rebuilt PillarFailure fields equal original
    with patch("sandbox.collapse.collapse_deltas", wraps=collapse.collapse_deltas) as spy_collapse:
        res_frame = client.post(
            "/forge/frame", json={"day": t_init, "events": seed_events}
        )
        assert res_frame.status_code == 200
        assert spy_collapse.called
        rebuilt_failures = spy_collapse.call_args[0][3]
        assert len(rebuilt_failures) == 1
        rebuilt_pf = rebuilt_failures[0]

        assert rebuilt_pf.cx == original_failure["cx"]
        assert rebuilt_pf.cy == original_failure["cy"]
        assert rebuilt_pf.radius_m == original_failure["radius_m"]
        assert rebuilt_pf.magnitude_m == original_failure["magnitude_m"]
        assert rebuilt_pf.t_init_days == original_failure["t_init_days"]
        assert math.isclose(rebuilt_pf.t_collapse_days, original_failure["t_collapse_days"], rel_tol=1e-6)
        assert math.isclose(rebuilt_pf.duration_days, original_failure["duration_days"], rel_tol=1e-6)


def test_tilt_is_an_offset_cave_in(client):
    """A tilt event is computed exactly as the cave-in it describes."""
    cave = {"type": "cave_in", "x": 200.0, "y": 50.0, "radius_m": 100.0, "depth_m": 0.5,
            "day": 20.0, "duration_h": 4.8}
    tilt = dict(cave, kind="tilt", target_x=100.0, target_y=50.0, rate_mm_per_m=5.0, direction_deg=0.0)
    a = client.post("/forge/frame", json={"day": 40.0, "events": [cave]}).json()
    b = client.post("/forge/frame", json={"day": 40.0, "events": [tilt]}).json()
    assert a["terrain"] == b["terrain"]
    assert a["node_states"] == b["node_states"]
    assert [n["subsidence_mm"] for n in a["nodes"]] == [n["subsidence_mm"] for n in b["nodes"]]


def test_vibration_window(client):
    """Vibration adds its PPV to every node only inside [day, day + duration_s]."""
    vib = {"type": "vibration", "day": 10.0, "ppv_mm_s": 12.0, "duration_s": 3600.0}
    during = client.post("/forge/frame", json={"day": 10.02, "events": [vib]}).json()
    before = client.post("/forge/frame", json={"day": 9.99, "events": [vib]}).json()
    after = client.post("/forge/frame", json={"day": 10.05, "events": [vib]}).json()
    assert during["vib_mm_s"] == 12.0
    assert all(n["vib_rms"] == 12.0 and n["vib_peak"] == 17.4 for n in during["nodes"])
    assert before["vib_mm_s"] == 0 and after["vib_mm_s"] == 0
    # No ground and no node-state change (Session.apply_vibration moves no ground).
    quiet = client.post("/forge/frame", json={"day": 10.02, "events": []}).json()
    assert during["terrain"] == quiet["terrain"]
    assert during["node_states"] == quiet["node_states"]
    # Range ignores vibrations.
    assert client.post("/forge/range", json={"events": [vib]}).json() == {"end_day": 365}
    # PPV must be positive.
    bad = dict(vib, ppv_mm_s=0)
    assert client.post("/forge/frame", json={"day": 10.0, "events": [bad]}).status_code == 422


def test_frame_carries_moving_bowl(client):
    """The frame streams the y factor of the bowl and the face position, and
    the 3D views rebuild the drop as bowl_px[ix] * bowl_py[iy]."""
    early = client.post("/forge/frame", json={"day": 40.0, "events": []}).json()
    late = client.post("/forge/frame", json={"day": 200.0, "events": []}).json()
    assert len(early["bowl_py"]) == len(late["bowl_py"]) == 121
    assert early["face_y_m"] == round(surface.face_y(40.0), 1)
    assert late["face_y_m"] > early["face_y_m"]
    # The bowl grows north: the y factor's centre of mass moves toward +y.
    axis = np.linspace(-1.0, 1.0, 121)
    centroid = lambda py: float(np.dot(axis, py) / np.sum(py))
    assert centroid(late["bowl_py"]) > centroid(early["bowl_py"])
    # Reconstruction against the grids (the y axis is the row index).
    full = client.post("/forge/frame", json={"day": 200.0, "events": [], "include_grids": True}).json()
    px = np.array(surface.bowl_px_wire())
    np.testing.assert_allclose(
        np.outer(late["bowl_py"], px), np.array(full["channels"]["s"])[::2, ::2], atol=5e-4
    )
