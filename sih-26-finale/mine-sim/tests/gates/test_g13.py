"""Gate G13 — z0 is a static t=0 baseline; only the world state holds live Z."""

import dataclasses
from pathlib import Path

import numpy as np
import pytest

from minesim.config import load_config
from minesim.sizing import size_network
from minesim.world import WorldState


def test_g13_z0_unchanged_by_a_run():
    cfg = load_config(Path("config/assumptions.yaml"))
    layout = size_network(cfg)
    z0_nodes = [n.z0_mm for n in layout.nodes]
    world = WorldState(cfg, layout)
    z0_grid = world.z0_mm.copy()
    for _ in range(int(300 * 86400 / cfg.sim.timestep_s)):
        world.step()
    assert [n.z0_mm for n in layout.nodes] == z0_nodes
    assert np.array_equal(world.z0_mm, z0_grid)
    live = world.z_at(1000.0, 0.0)
    assert live < -100.0, "live Z must move while z0 stays put"
    assert live != layout.nodes[0].z0_mm


def test_g13_negative_node_z0_is_frozen():
    layout = size_network(load_config(Path("config/assumptions.yaml")))
    with pytest.raises(dataclasses.FrozenInstanceError):
        layout.nodes[0].z0_mm = -5.0
