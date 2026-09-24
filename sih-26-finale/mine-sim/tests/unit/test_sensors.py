"""Unit tests for minesim.sensors and minesim.provenance (WP4, v1 cut)."""

from pathlib import Path

import numpy as np
import pytest

from minesim import physics
from minesim.config import load_config
from minesim.errors import ProvenanceError
from minesim.provenance import Value
from minesim.sensors import read_node
from minesim.sizing import Node, size_network
from minesim.world import WorldState
from tests.helpers import load_mutated_config

DERIVED = ("tilt_x", "tilt_y", "strain", "displacement", "battery_mv")


pytestmark = pytest.mark.usefixtures("layout_v1")   # F4: module fixtures + monument test use the v1 travelling cross


@pytest.fixture(scope="module")
def cfg():
    return load_config(Path("config/assumptions.yaml"))


@pytest.fixture(scope="module")
def layout(cfg):
    return size_network(cfg)


@pytest.fixture(scope="module")
def world_day300(cfg, layout):
    w = WorldState(cfg, layout)
    for _ in range(int(300 * 86400 / cfg.sim.timestep_s)):
        w.step()
    return w


def _node(layout, tier, line=None):
    return next(n for n in layout.nodes if n.tier == tier and (line is None or n.line == line))


def _scout(x, y, tier="1C", line="transverse"):
    return Node(900, x, y, 0.0, tier, 1, 2, 0, line)


def test_value_rejects_bad_tag():
    with pytest.raises(ProvenanceError):
        Value(1.0, "mm", "unknown")


def test_tier_fields(cfg, layout, world_day300):
    rng = np.random.default_rng(1)
    a = read_node(_node(layout, "1A"), world_day300, cfg, rng)
    b = read_node(_node(layout, "1B"), world_day300, cfg, rng)
    c = read_node(_node(layout, "1C"), world_day300, cfg, rng)
    assert a.tilt_x and a.tilt_y and a.strain is None and a.displacement is None
    assert b.strain and b.displacement and b.tilt_x is None
    assert c.strain and c.displacement is None and c.tilt_x is None
    for r in (a, b, c):
        assert r.subsidence.unit == "mm" and r.battery_mv.unit == "mV"
        assert r.epoch == world_day300.epoch and r.t_s == world_day300.t_s


def test_non_scouts_rejected(cfg, layout, world_day300):
    with pytest.raises(ValueError):
        read_node(_node(layout, "anchor"), world_day300, cfg, np.random.default_rng(1))


def test_derived_values_always_synthetic(cfg, layout, world_day300):
    rng = np.random.default_rng(2)
    for n in layout.nodes:
        if n.tier in ("1A", "1B", "1C"):
            r = read_node(n, world_day300, cfg, rng)
            for field in DERIVED:
                v = getattr(r, field)
                assert v is None or v.provenance == "synthetic"


def test_noise_differs_and_seed_reproduces(cfg, layout, world_day300):
    n = _node(layout, "1B")
    r1 = read_node(n, world_day300, cfg, np.random.default_rng(7))
    r2 = read_node(n, world_day300, cfg, np.random.default_rng(8))
    r3 = read_node(n, world_day300, cfg, np.random.default_rng(7))
    assert r1 != r2
    assert r1 == r3


def test_signs_outside_the_rib(cfg, world_day300):
    """Outside the +y rib, behind the face: ground down, surface rises toward +y, tension."""
    rng = np.random.default_rng(3)
    x, y = 900.0, 150.0
    r1c = read_node(_scout(x, y, "1C"), world_day300, cfg, rng)
    r1a = read_node(_scout(x, y, "1A"), world_day300, cfg, rng)
    assert r1c.subsidence.magnitude < 0.0
    assert r1c.strain.magnitude > 0.0
    assert r1a.tilt_y.magnitude > 0.0
    _, ty = physics.tilt(x, y, world_day300.t_days, cfg.panel, cfg.knothe)
    assert ty < 0.0  # physics convention (S positive down) is the opposite sign


def test_baseline_effect(cfg, world_day300):
    """A 30 m wire reads a different strain than a 10 m rod at the same spot."""
    x, y, t = 900.0, 150.0, world_day300.t_days
    e30 = physics.strain(x, y, t, cfg.panel, cfg.knothe, cfg.sensing.extensometer_baseline_m, "y")
    e10 = physics.strain(x, y, t, cfg.panel, cfg.knothe, cfg.sensing.strain_rod_baseline_m, "y")
    assert abs(e30 - e10) > cfg.sensors.strain_1c.noise_sigma


def test_tilt_drift_dominates_low_gradient_1a(cfg, layout):
    """Honest result: temperature drift is larger than the tilt signal at a low-gradient 1A node."""
    far = max((n for n in layout.nodes if n.tier == "1A"), key=lambda n: abs(n.y_m))
    days = np.arange(0.0, cfg.sim.duration_days + 1.0)
    signal = max(float(np.hypot(*physics.tilt(far.x_m, far.y_m, t, cfg.panel, cfg.knothe))) for t in days)
    drift = cfg.sensors.tilt_1a.temp_drift_per_c * cfg.sensors.temperature_amplitude_c
    assert drift > signal


def test_battery_drains(cfg, layout):
    w = WorldState(cfg, layout)
    n = _node(layout, "1A")
    early = read_node(n, w, cfg, np.random.default_rng(4)).battery_mv.magnitude
    for _ in range(int(100 * 86400 / cfg.sim.timestep_s)):
        w.step()
    late = read_node(n, w, cfg, np.random.default_rng(4)).battery_mv.magnitude
    assert late < early
    assert cfg.sensors.battery.empty_mv <= late <= cfg.sensors.battery.full_mv


def test_all_synthetic_without_a_survey_line():
    cfg = load_mutated_config(mutate_mine=lambda m: m["pinning"].__setitem__("survey_line_x_m", None))
    layout = size_network(cfg)
    w = WorldState(cfg, layout)
    for _ in range(int(210 * 86400 / cfg.sim.timestep_s)):
        w.step()
    tags = {read_node(n, w, cfg, np.random.default_rng(5)).subsidence.provenance
            for n in layout.nodes if n.tier in ("1A", "1B", "1C")}
    assert tags == {"synthetic"}


def test_transverse_scouts_stand_on_monuments(cfg, layout):
    """With the survey line set, the transverse line sits on it and most Scouts are on a monument."""
    from minesim.provenance import load_monuments, monument_at
    mon = load_monuments(str(cfg.profiles_csv), cfg.survey_line_x_m, cfg.survey_origin_offset_m)
    line = [n for n in layout.nodes if n.line in ("transverse", "crossing")]
    assert all(n.x_m == cfg.survey_line_x_m for n in line)
    on = [n for n in line if monument_at(mon, n.x_m, n.y_m, cfg.sensors.monument_position_tolerance_m) is not None]
    assert len(on) >= len(line) - 2


def test_real_pinned_synthetic_rules():
    """With a survey line position set: real at monument + monument epoch, pinned off-epoch,
    synthetic when moved 5 m off the monument."""
    cfg = load_config(Path("config/assumptions.yaml"))
    layout = size_network(cfg)
    w = WorldState(cfg, layout)
    for _ in range(int(210 * 86400 / cfg.sim.timestep_s)):
        w.step()
    rng = np.random.default_rng(6)
    x_line = cfg.survey_line_x_m
    y_monument = -199.8 - cfg.survey_origin_offset_m      # CSV distance -199.8 m, in the panel frame
    on = _scout(x_line, y_monument)
    real = read_node(on, w, cfg, rng)
    assert real.subsidence.provenance == "real"
    assert real.subsidence.magnitude == -1.0 * abs(real.subsidence.magnitude)  # measured, negative down
    moved = read_node(_scout(x_line, y_monument + 5.0), w, cfg, rng)
    assert moved.subsidence.provenance == "synthetic"
    w.step()
    assert read_node(on, w, cfg, rng).subsidence.provenance == "pinned"
