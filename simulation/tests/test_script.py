"""C1: scenario script format, validated loader, and the default demo's reach.

Run from `simulation/`:
    .venv/bin/python -m pytest tests/test_script.py -q
"""

import copy
import json
import math

import pytest

from forge import states
from sandbox import collapse, layout, surface
from sandbox.events import to_failures
from sandbox.script import SCENARIO_DIR, ScriptError, available_scripts, load_script, parse_script
from sandbox.sensors import SensorArray, SensorNoiseConfig


@pytest.fixture(scope="module")
def demo():
    return load_script("default_demo")


def _nodes():
    return SensorArray(SensorNoiseConfig(enable_noise=False)).nodes


def _states_on(script, day):
    X, Y = surface.grid()
    events = list(script.events)
    by_event = [to_failures(ev) for ev in events]
    failures = [pf for fs in by_event for pf in fs]
    delta = collapse.collapse_deltas(X, Y, day, failures)
    return states.forge_node_states(_nodes(), events, by_event, day, delta)


def test_demo_shape(demo):
    assert available_scripts() == ["default_demo"]
    assert (demo.name, demo.duration_days) == ("default_demo", 365)
    assert [e["type"] for e in demo.events] == ["crack", "tilt", "vibration", "cave_in"]
    assert [e["day"] for e in demo.events] == [60, 120, 150, 200]
    assert demo.n_ticks == 365 * 24


def test_demo_reaches_three_warnings_and_a_critical(demo):
    got = _states_on(demo, demo.duration_days)
    assert list(got.values()).count("WARNING") >= 3
    assert list(got.values()).count("CRITICAL") >= 1


def test_demo_stays_quiet_until_the_first_event(demo):
    assert set(_states_on(demo, 59.0).values()) == {"ACTIVE"}


def test_each_event_reddens_or_yellows_its_own_nodes(demo):
    """Every state-changing event adds nodes the ones before it did not."""
    seen: set[str] = set()
    for day, kind in [(100, "crack"), (140, "tilt"), (250, "cave_in")]:
        now = {k for k, v in _states_on(demo, day).items() if v != "ACTIVE"}
        assert now - seen, f"{kind} changed no node"
        seen |= now


def test_cave_in_critical_node_is_inside_the_white_ring(demo):
    cave = next(e for e in demo.events if e["type"] == "cave_in")
    got = _states_on(demo, demo.duration_days)
    ids, pos = layout.node_ids(), layout.node_positions()
    critical = [
        (int(i), math.hypot(x - cave["x"], y - cave["y"]))
        for i, (x, y) in zip(ids, pos)
        if got[f"N{int(i):02d}"] == "CRITICAL" and math.hypot(x - cave["x"], y - cave["y"]) < 1.5 * cave["radius_m"]
    ]
    assert critical and all(d <= 1.2 * cave["radius_m"] for _, d in critical)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _raw():
    return json.loads((SCENARIO_DIR / "default_demo.json").read_text())


def _bad(mutate, expect):
    raw = _raw()
    mutate(raw)
    with pytest.raises(ScriptError) as err:
        parse_script(raw)
    assert expect in str(err.value), str(err.value)


def test_events_are_sorted_by_day_and_defaults_filled():
    raw = _raw()
    raw["events"].reverse()
    script = parse_script(raw)
    assert [e["day"] for e in script.events] == [60, 120, 150, 200]
    vib = script.events[2]
    assert (vib["duration_s"], vib["x"], vib["y"]) == (60, 0, 0)
    assert script.events[3]["warning_hours"] == 8.0


def test_bad_inputs_name_the_event_and_field():
    _bad(lambda r: r["events"][0].update(throw_m=3), "events[0].throw_m: 3 is above the maximum 2")
    _bad(lambda r: r["events"][1].update(rate_mm_per_m=0.1), "events[1].rate_mm_per_m: 0.1 is below the minimum 0.5")
    _bad(lambda r: r["events"][3].update(x=301), "events[3].x: 301 is above the maximum 300")
    _bad(lambda r: r["events"][0].update(y1=-320), "events[0].y1: -320 is below the minimum -300")
    _bad(lambda r: r["events"][2].update(day=400), "events[2].day: 400 is above the maximum 365")
    _bad(lambda r: r["events"][3].update(depth_m="deep"), "events[3].depth_m: expected a number")
    _bad(lambda r: r["events"][3].update(radius_m=True), "events[3].radius_m: expected a number")
    _bad(lambda r: r["events"][0].pop("width_m"), "events[0].width_m: missing")
    _bad(lambda r: r["events"][0].pop("day"), "events[0].day: missing")
    _bad(lambda r: r["events"][1].update(raduis_m=5), "events[1].raduis_m: unknown field")
    _bad(lambda r: r["events"][2].update(type="earthquake"), "events[2].type: 'earthquake'")
    _bad(lambda r: r["events"][0].update(x1=-110, y1=-70), "events[0].x1: a crack needs two different end points")
    _bad(lambda r: r["events"].append(5), "events[4]: expected an object")
    _bad(lambda r: r["events"][0].update(day=float("nan")), "events[0].day: expected a number")


def test_bad_top_level_fields():
    _bad(lambda r: r.update(name="../etc"), "name:")
    _bad(lambda r: r.update(seed="x"), "seed: expected an integer")
    _bad(lambda r: r.update(base_iso_time="yesterday"), "base_iso_time:")
    _bad(lambda r: r.update(base_iso_time="2026-01-01T00:00:00"), "needs a time zone")
    _bad(lambda r: r.update(duration_days=0), "duration_days: 0 is below the minimum 1")
    _bad(lambda r: r.update(tick_seconds=5), "tick_seconds: 5 is below the minimum 60")
    _bad(lambda r: r.update(events="none"), "events: expected a list")
    _bad(lambda r: r.update(extra=1), "extra: unknown field")


def test_loading_by_name_and_missing_file(tmp_path):
    with pytest.raises(ScriptError, match="not found"):
        load_script("nope")
    broken = tmp_path / "broken.json"
    broken.write_text("{not json")
    with pytest.raises(ScriptError, match="not valid JSON"):
        load_script(broken)
    copy_path = tmp_path / "copy.json"
    copy_path.write_text(json.dumps(_raw()))
    assert load_script(copy_path) == load_script("default_demo")


def test_parse_does_not_mutate_its_input():
    raw = _raw()
    snapshot = copy.deepcopy(raw)
    parse_script(raw)
    assert raw == snapshot
