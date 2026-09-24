"""Gate G04 — every value carries one of exactly three provenance tags (Reading level).

The nodes.csv column check lives in tests/unit/test_stream.py once the writers exist.
"""

from collections import Counter
from pathlib import Path

import numpy as np

from minesim.config import load_config
from minesim.provenance import TAGS
from minesim.sensors import read_node
from minesim.sizing import size_network
from minesim.world import WorldState

FIELDS = ("subsidence", "tilt_x", "tilt_y", "strain", "displacement", "battery_mv")


def _bad_values(readings):
    bad = []
    for r in readings:
        for f in FIELDS:
            v = getattr(r, f)
            if v is None:
                continue
            if v.provenance not in TAGS:
                bad.append((r.node_id, r.epoch, f, v.provenance))
            elif f != "subsidence" and v.provenance != "synthetic":
                bad.append((r.node_id, r.epoch, f, "derivative not synthetic"))
    return bad


def test_g04_thirty_day_run_all_tagged():
    cfg = load_config(Path("config/assumptions.yaml"))
    layout = size_network(cfg)
    world = WorldState(cfg, layout)
    rng = np.random.default_rng(cfg.sim.rng_seed)
    scouts = [n for n in layout.nodes if n.tier in ("1A", "1B", "1C")]
    readings = []
    for _ in range(int(30 * 86400 / cfg.sim.timestep_s)):
        world.step()
        readings.extend(read_node(n, world, cfg, rng) for n in scouts)
    assert _bad_values(readings) == []
    counts = Counter(getattr(r, f).provenance for r in readings for f in FIELDS if getattr(r, f))
    total = sum(counts.values())
    print({k: f"{100.0 * v / total:.2f}%" for k, v in counts.items()})


def test_g04_negative_bad_tag_detected():
    class Fake:
        node_id, epoch = 100, 1
        subsidence = type("V", (), {"provenance": "measured"})()
        tilt_x = tilt_y = displacement = None
        strain = type("V", (), {"provenance": "pinned"})()
        battery_mv = type("V", (), {"provenance": "synthetic"})()
    assert len(_bad_values([Fake()])) == 2
