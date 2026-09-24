"""Unit tests for minesim.packet and minesim.radio (WP5, v1 cut)."""

from collections import defaultdict
from pathlib import Path

import numpy as np
import pytest

from minesim.config import load_config
from minesim.packet import airtime_ms
from minesim.radio import (EMERGENCY_WINDOW_LENGTH_S, EMERGENCY_WINDOW_OPEN_S, UPLINK_WINDOW_CLOSE_S,
                           SCOUT_UPLINK_BYTES, Superframe, emergency_subslot)
from minesim.sensors import read_node
from minesim.sizing import size_network
from minesim.world import WorldState
from tests.helpers import load_mutated_config

# Contract §6 table. The two 6 B cells at SF8/SF9 (65.9, 118.6) do not match the Semtech
# formula that reproduces every other cell; they are recorded in the walkthrough, not asserted.
AIRTIME_TABLE = {
    (23, 7): 61.7, (23, 8): 113.2, (23, 9): 205.8,
    (98, 7): 169.2, (98, 8): 297.5, (98, 9): 533.5,
    (6, 7): 36.1,
    (1, 7): 25.9, (1, 8): 51.7, (1, 9): 103.4,
}


def _scouts(layout):
    return [n for n in layout.nodes if n.tier in ("1A", "1B", "1C")]


def _one_frame(cfg, seed=1):
    layout = size_network(cfg)
    world = WorldState(cfg, layout)
    world.step()
    rng = np.random.default_rng(seed)
    readings = [read_node(n, world, cfg, rng) for n in _scouts(layout)]
    sf = Superframe(cfg, layout)
    return layout, sf, sf.run(readings, world.epoch, rng)


@pytest.fixture(scope="module")
def cfg():
    return load_config(Path("config/assumptions.yaml"))


@pytest.mark.parametrize("key,expected", sorted(AIRTIME_TABLE.items()))
def test_airtime_matches_contract(cfg, key, expected):
    payload, sf = key
    assert abs(airtime_ms(payload, sf, cfg.radio) - expected) < 0.5


def test_one_record_per_scout_with_23_byte_payload(cfg):
    layout, _, records = _one_frame(cfg)
    assert sorted(r.packet.node_id for r in records) == sorted(n.node_id for n in _scouts(layout))
    assert all(len(r.packet.payload) == SCOUT_UPLINK_BYTES for r in records)


def test_no_slot_overlap_and_window_fit(cfg):
    layout, sf, records = _one_frame(cfg)
    by_channel = defaultdict(list)
    for n in _scouts(layout):
        slot_index, channel, start = sf.slot_of(n.node_id)
        by_channel[channel].append((start, start + airtime_ms(SCOUT_UPLINK_BYTES, cfg.radio.scout_sf, cfg.radio) / 1000.0))
    for spans in by_channel.values():
        spans.sort()
        for (s0, e0), (s1, _) in zip(spans, spans[1:]):
            assert e0 <= s1
        assert spans[-1][1] <= UPLINK_WINDOW_CLOSE_S


def test_full_loss_still_writes_every_record():
    cfg = load_mutated_config(lambda d: d["radio"].__setitem__("bernoulli_loss_prob", 1.0))
    layout, _, records = _one_frame(cfg)
    assert len(records) == len(_scouts(layout))
    assert not any(r.delivered for r in records)
    assert all(r.via_emergency for r in records)


def test_link_margin_failure_is_undelivered():
    cfg = load_mutated_config(lambda d: d["radio"].__setitem__("link_margin_db_min", 500.0))
    _, _, records = _one_frame(cfg)
    assert not any(r.delivered for r in records)


def test_no_loss_all_delivered_on_primary():
    cfg = load_mutated_config(lambda d: d["radio"].__setitem__("bernoulli_loss_prob", 0.0))
    layout, _, records = _one_frame(cfg)
    parents = {n.node_id: n.parent_id for n in layout.nodes}
    assert all(r.delivered and not r.via_emergency for r in records)
    assert all(r.parent_used == parents[r.packet.node_id] for r in records)


def test_emergency_uses_backup_and_child_index_subslot():
    cfg = load_mutated_config(lambda d: d["radio"].__setitem__("bernoulli_loss_prob", 1.0))
    layout, _, records = _one_frame(cfg)
    nodes = {n.node_id: n for n in layout.nodes}
    sub_s = EMERGENCY_WINDOW_LENGTH_S / cfg.layout.max_children_per_anchor
    for r in records:
        n = nodes[r.packet.node_id]
        assert r.parent_used == n.backup_parent_id
        offset = r.t_s - (r.packet.epoch * cfg.sim.timestep_s)
        assert offset == pytest.approx(EMERGENCY_WINDOW_OPEN_S + emergency_subslot(n) * sub_s)


def test_duty_cycles(cfg):
    layout = size_network(cfg)
    sf = Superframe(cfg, layout)
    ceiling = cfg.radio.duty_cycle_ceiling_pct / 100.0
    assert sf.duty_cycle("scout") == pytest.approx(0.00103, abs=5e-5)
    assert sf.duty_cycle("anchor") == pytest.approx(0.00556, abs=5e-5)
    assert sf.duty_cycle("gateway") < ceiling
    assert sf.duty_cycle("anchor") < ceiling


def test_loss_rate_roughly_matches_config(cfg):
    layout = size_network(cfg)
    world = WorldState(cfg, layout)
    rng = np.random.default_rng(cfg.sim.rng_seed)
    sf = Superframe(cfg, layout)
    records = []
    for _ in range(200):
        world.step()
        records += sf.run([read_node(n, world, cfg, rng) for n in _scouts(layout)], world.epoch, rng)
    primary_lost = sum(r.via_emergency for r in records) / len(records)
    assert abs(primary_lost - cfg.radio.bernoulli_loss_prob) < 0.01
    lost = sum(not r.delivered for r in records) / len(records)
    assert lost < primary_lost  # the emergency retry recovers most losses
