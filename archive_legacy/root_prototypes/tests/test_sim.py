"""Unit and integration tests for the simulation producer, sensor damage chain, and radio mesh.

Stage 3 Gate checks:
1. Run full 40-day scenario headless.
2. Assert epoch dictionaries validate against JSON schema derived from part1-reference.md §4.3.
3. Assert two runs with the same configuration produce bit-identical output (Invariant I7).
4. Measure and report sim-days per wall-second.
"""
import json
import queue
import time
import jsonschema
import numpy as np
import pytest

from ground.surface import GroundModel, KnotheParameters
from sim.producer import SimulationProducer
from viz.controls import ControlState


# JSON Schema for the epoch dictionary per §4.3
EPOCH_JSON_SCHEMA = {
    "type": "object",
    "required": ["epoch_id", "t_iso", "t_days", "panel", "observations", "anchors", "quality"],
    "properties": {
        "epoch_id": {"type": "integer"},
        "t_iso": {"type": "string"},
        "t_days": {"type": "number"},
        "panel": {
            "type": "object",
            "required": ["x1", "y1", "x2", "y2", "depth_m", "seam_thickness_m", "tan_beta", "influence_radius_m", "subsidence_factor"],
            "properties": {
                "x1": {"type": "number"},
                "y1": {"type": "number"},
                "x2": {"type": "number"},
                "y2": {"type": "number"},
                "depth_m": {"type": "number"},
                "seam_thickness_m": {"type": "number"},
                "tan_beta": {"type": "number"},
                "influence_radius_m": {"type": "number"},
                "subsidence_factor": {"type": "number"},
            },
        },
        "observations": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["node_id", "xy", "tilt", "strain", "ext_delta_m", "ext_line"],
                "properties": {
                    "node_id": {"type": "integer"},
                    "xy": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    "tilt": {"anyOf": [{"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}, {"type": "null"}]},
                    "strain": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "ext_delta_m": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "ext_line": {"type": "array", "minItems": 2, "maxItems": 2},
                    "sigma": {
                        "anyOf": [
                            {
                                "type": "object",
                                "required": ["tilt", "strain", "ext"],
                                "properties": {
                                    "tilt": {"type": "number"},
                                    "strain": {"type": "number"},
                                    "ext": {"type": "number"},
                                },
                            },
                            {"type": "null"},
                        ]
                    },
                    "age_s": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                    "dead_since": {"type": "string"},
                },
            },
        },
        "anchors": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["node_id", "xy", "S_m"],
                "properties": {
                    "node_id": {"type": "integer"},
                    "xy": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
                    "S_m": {"type": "number"},
                },
            },
        },
        "quality": {
            "type": "object",
            "required": ["nodes_expected", "nodes_reporting"],
            "properties": {
                "nodes_expected": {"type": "integer"},
                "nodes_reporting": {"type": "integer"},
                "max_age_s": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
            },
        },
    },
}


@pytest.fixture
def config():
    with open("config/nodes.json", "r") as f:
        return json.load(f)


def test_schema_and_40day_simulation(config):
    """Run full 40-day simulation headless, validate JSON schema, and measure throughput."""
    q = queue.Queue(maxsize=4)
    ctrl = ControlState()
    producer = SimulationProducer(config, q, ctrl, base_seed=123)

    t0 = time.time()
    n_epochs = 40 * 48  # 40 days * 48 epochs/day = 1920 epochs
    epoch_samples = []

    for i in range(n_epochs):
        epoch = producer.step_epoch()
        if i % 100 == 0:
            epoch_samples.append(epoch)

    wall_time = time.time() - t0
    sim_days_per_sec = 40.0 / wall_time

    print(f"\n[STAGE 3 GATE] Simulated 40.0 days ({n_epochs} epochs) in {wall_time:.3f} s ({sim_days_per_sec:.1f} sim-days/sec)")

    # Validate schema on sampled epochs
    for ep in epoch_samples:
        jsonschema.validate(instance=ep, schema=EPOCH_JSON_SCHEMA)

    assert len(epoch_samples) > 10
    assert producer.t_days >= 40.0


def test_seed_reproducibility_invariant_i7(config):
    """Assert two runs with identical seeds produce bit-identical output (Invariant I7)."""
    q1 = queue.Queue(maxsize=4)
    ctrl1 = ControlState()
    prod1 = SimulationProducer(config, q1, ctrl1, base_seed=999)

    q2 = queue.Queue(maxsize=4)
    ctrl2 = ControlState()
    prod2 = SimulationProducer(config, q2, ctrl2, base_seed=999)

    # Step both for 50 epochs
    for _ in range(50):
        ep1 = prod1.step_epoch()
        ep2 = prod2.step_epoch()

        # Check exact equality of observation readings
        assert json.dumps(ep1, sort_keys=True) == json.dumps(ep2, sort_keys=True), "Invariant I7 violated: Non-reproducible epoch output!"
