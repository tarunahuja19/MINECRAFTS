"""E1: shared event maths, lasting FORGE node states, strain cracks."""

import math

import numpy as np
import pytest
from starlette.testclient import TestClient

from forge.server import app, _sensor_array
from sandbox import collapse, constants, surface
from sandbox.events import to_failures
from sandbox.mqtt_bridge import _node_topic_id


@pytest.fixture
def client():
    return TestClient(app)


def _frame(client, day, events):
    res = client.post("/forge/frame", json={"day": day, "events": events})
    assert res.status_code == 200
    return res.json()


def _cave(x=0.0, y=0.0, radius_m=100.0, depth_m=10.0, day=20.0):
    return {"type": "cave_in", "x": x, "y": y, "radius_m": radius_m,
            "depth_m": depth_m, "day": day, "duration_h": 4.8}


def _settled(failures, x, y, key):
    d = collapse.collapse_deltas(np.array([[x]]), np.array([[y]]), 1.0e3, failures)
    return d[key][0, 0]


@pytest.mark.parametrize("radius", [50.0, 150.0, 300.0])
@pytest.mark.parametrize("rate", [1.0, 5.0, 20.0])
@pytest.mark.parametrize("direction", [0.0, 90.0, 225.0])
def test_tilt_at_target_matches_rate(rate, radius, direction):
    ev = {"type": "tilt", "x": 0.0, "y": 0.0, "radius_m": radius, "rate_mm_per_m": rate,
          "direction_deg": direction, "over_days": 3.0, "day": 5.0}
    fails = to_failures(ev)
    assert len(fails) == 1
    b = math.radians(direction)
    assert (fails[0].cx, fails[0].cy) == pytest.approx((radius * math.sin(b), radius * math.cos(b)))
    assert fails[0].t_collapse_days - fails[0].t_init_days == pytest.approx(1.0 / 24.0)
    assert fails[0].duration_days == 3.0
    tilt = math.hypot(_settled(fails, 0.0, 0.0, "delta_tilt_x"), _settled(fails, 0.0, 0.0, "delta_tilt_y"))
    assert tilt * 1000.0 == pytest.approx(rate, rel=0.05)


def test_crack_midpoint_depth_matches_throw():
    for (x0, y0, x1, y1, throw, width) in [
        (-100.0, -50.0, 120.0, 70.0, 0.5, 10.0),
        (0.0, 0.0, 200.0, 0.0, 1.5, 25.0),
        (30.0, 30.0, 60.0, 30.0, 0.2, 4.0),
    ]:
        ev = {"type": "crack", "x0": x0, "y0": y0, "x1": x1, "y1": y1, "throw_m": throw,
              "width_m": width, "open_days": 4.0, "day": 5.0}
        fails = to_failures(ev)
        assert all(f.radius_m == width for f in fails)
        length = math.hypot(x1 - x0, y1 - y0)
        assert len(fails) >= length / (width / 2.0)
        assert (fails[0].cx, fails[0].cy) == pytest.approx((x0, y0))
        assert (fails[-1].cx, fails[-1].cy) == pytest.approx((x1, y1))
        assert len({f.magnitude_m for f in fails}) == 1
        depth = _settled(fails, (x0 + x1) / 2.0, (y0 + y1) / 2.0, "delta_s")
        assert depth == pytest.approx(throw, rel=0.05)


def _node_at(fraction_of_r, radius_m):
    """The node whose distance from the origin is closest to fraction * R."""
    want = fraction_of_r * radius_m
    return min(_sensor_array.nodes, key=lambda n: abs(math.hypot(n.x_m, n.y_m) - want))


def test_node_inside_pit_stays_critical(client):
    node = _node_at(0.5, 100.0)
    assert math.hypot(node.x_m, node.y_m) <= 120.0
    key = _node_topic_id(node.node_id)
    assert _frame(client, 50.0, [_cave()])["node_states"][key] == "CRITICAL"
    assert _frame(client, 365.0, [_cave()])["node_states"][key] == "CRITICAL"
    assert _frame(client, 19.0, [_cave()])["node_states"][key] == "ACTIVE"


def test_node_in_fringe_is_warning(client):
    # 1 m keeps the event's own tilt under TILT_CRITICAL_MM_M at 1.3 R: a 10 m
    # pit puts ~56 mm/m there, which the rule rightly calls CRITICAL.
    node = _node_at(1.3, 100.0)
    dist = math.hypot(node.x_m, node.y_m)
    assert 120.0 < dist <= 150.0
    ev = _cave(depth_m=1.0)
    tilt = 1.0 * dist / 100.0**2 * math.exp(-dist**2 / (2 * 100.0**2)) * 1000.0
    assert tilt < constants.TILT_CRITICAL_MM_M
    assert _frame(client, 50.0, [ev])["node_states"][_node_topic_id(node.node_id)] == "WARNING"


def test_big_pit_tilt_does_not_redden_nodes_outside_the_white_ring(client):
    # A 10 m / 100 m pit tilts ~56 mm/m at 1.3 R and still ~11 mm/m at 250 m. The
    # rings are the rule for CRITICAL, so those nodes are WARNING, never red.
    fringe = _node_at(1.3, 100.0)
    assert _frame(client, 50.0, [_cave()])["node_states"][_node_topic_id(fringe.node_id)] == "WARNING"
    states = _frame(client, 50.0, [_cave()])["node_states"]
    for n in _sensor_array.nodes:
        if math.hypot(n.x_m, n.y_m) > 120.0:
            assert states[_node_topic_id(n.node_id)] != "CRITICAL", n.node_id


def test_rings_and_node_colours_agree_for_a_cave_in(client):
    states = _frame(client, 50.0, [_cave()])["node_states"]
    for n in _sensor_array.nodes:
        d = math.hypot(n.x_m, n.y_m)
        got = states[_node_topic_id(n.node_id)]
        if d <= 120.0:
            assert got == "CRITICAL"
        elif d <= 150.0:
            assert got == "WARNING"
        else:
            assert got in ("ACTIVE", "WARNING")


def test_tilt_event_flags_nodes_by_tilt_only(client):
    ev = {"type": "tilt", "x": 0.0, "y": 0.0, "radius_m": 150.0, "rate_mm_per_m": 12.0,
          "direction_deg": 90.0, "over_days": 2.0, "day": 10.0}
    states = _frame(client, 30.0, [ev])["node_states"]
    node = min(_sensor_array.nodes, key=lambda n: math.hypot(n.x_m, n.y_m))
    assert states[_node_topic_id(node.node_id)] == "CRITICAL"  # 12 mm/m >= TILT_CRITICAL


def test_crack_capsule_states(client):
    ev = {"type": "crack", "x0": -200.0, "y0": 0.0, "x1": 200.0, "y1": 0.0, "throw_m": 0.3,
          "width_m": 20.0, "open_days": 2.0, "day": 10.0}
    states = _frame(client, 30.0, [ev])["node_states"]
    for n in _sensor_array.nodes:
        d = abs(n.y_m) if abs(n.x_m) <= 200.0 else math.hypot(abs(n.x_m) - 200.0, n.y_m)
        if d <= 24.0:
            assert states[_node_topic_id(n.node_id)] == "CRITICAL"


def test_no_event_frame_never_warns(client):
    for day in (0.0, 60.0, 200.0, 365.0):
        states = _frame(client, day, [])["node_states"]
        assert set(states.values()) == {"ACTIVE"}, day


def test_cracks_deterministic_and_empty_at_day_zero(client):
    assert _frame(client, 0.0, [])["cracks"] == []
    events = [_cave(), {"type": "crack", "x0": -80.0, "y0": 40.0, "x1": 90.0, "y1": -20.0,
                        "throw_m": 0.4, "width_m": 8.0, "open_days": 3.0, "day": 30.0}]
    a = _frame(client, 60.0, events)
    b = _frame(client, 60.0, events)
    assert a["cracks"] == b["cracks"] and a["zones"] == b["zones"]
    assert 0 < len(a["cracks"]) <= 400 + 10
    assert any(c["isNew"] for c in a["cracks"])
    # The drawn crack contributes 6-10 pieces, all new, while the crack is open or settled.
    drawn = [c for c in a["cracks"] if c["isNew"] and c["width_mm"] == 400.0]
    assert 6 <= len(drawn) <= 10


def test_zones_only_for_started_events(client):
    events = [_cave(day=20.0), {"type": "crack", "x0": 0.0, "y0": 0.0, "x1": 50.0, "y1": 0.0,
                                "throw_m": 0.2, "width_m": 10.0, "open_days": 1.0, "day": 100.0}]
    assert _frame(client, 19.0, events)["zones"] == []
    zones = _frame(client, 50.0, events)["zones"]
    assert zones == [{"event_index": 0, "kind": "cave_in", "cx": 0.0, "cy": 0.0,
                      "r_white": pytest.approx(120.0), "r_red": pytest.approx(150.0)}]
    zones = _frame(client, 150.0, events)["zones"]
    assert [z["kind"] for z in zones] == ["cave_in", "crack"]
    assert zones[1]["polyline"] == [[0.0, 0.0], [50.0, 0.0]]
    assert zones[1]["r_white"] == pytest.approx(12.0)


def test_legacy_cave_in_tilt_still_works(client):
    legacy = dict(_cave(x=200.0, y=50.0, depth_m=0.5), kind="tilt", target_x=100.0,
                  target_y=50.0, rate_mm_per_m=5.0, direction_deg=90.0)
    new = {"type": "tilt", "x": 100.0, "y": 50.0, "radius_m": 100.0, "rate_mm_per_m": 5.0,
           "direction_deg": 90.0, "over_days": 3.0, "day": 20.0}
    a = _frame(client, 40.0, [legacy])
    b = _frame(client, 40.0, [new])
    assert a["terrain"] == b["terrain"] and a["node_states"] == b["node_states"]
    assert client.post("/forge/range", json={"events": [legacy]}).json() == {"end_day": 365}


def test_range_for_tilt_and_crack(client):
    tilt = {"type": "tilt", "x": 0.0, "y": 0.0, "radius_m": 100.0, "rate_mm_per_m": 5.0,
            "direction_deg": 0.0, "over_days": 10.0, "day": 400.0}
    crack = {"type": "crack", "x0": 0.0, "y0": 0.0, "x1": 50.0, "y1": 0.0, "throw_m": 0.2,
             "width_m": 10.0, "open_days": 20.5, "day": 380.0}
    assert client.post("/forge/range", json={"events": [tilt]}).json() == {"end_day": 415}
    assert client.post("/forge/range", json={"events": [crack]}).json() == {"end_day": 406}
