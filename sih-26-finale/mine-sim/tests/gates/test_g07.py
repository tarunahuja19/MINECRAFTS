"""Gate G07 — dedup key is (node_id, epoch), never seq."""

import ast
from pathlib import Path

import numpy as np

from minesim.config import load_config
from minesim.radio import Superframe, deduplicate
from minesim.sensors import read_node
from minesim.sizing import size_network
from minesim.world import WorldState
from tests.helpers import load_mutated_config

SRC = Path(__file__).resolve().parents[2] / "src" / "minesim"


def _seq_misuse(source: str):
    """seq used as a dict key, set element, subscript, or in a comparison."""
    hits = []

    def mentions_seq(node):
        return any((isinstance(n, ast.Attribute) and n.attr == "seq") or (isinstance(n, ast.Name) and n.id == "seq")
                   for n in ast.walk(node))

    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Dict) and any(k is not None and mentions_seq(k) for k in node.keys):
            hits.append(("dict key", node.lineno))
        elif isinstance(node, (ast.Set, ast.SetComp)) and mentions_seq(node):
            hits.append(("set", node.lineno))
        elif isinstance(node, ast.Subscript) and mentions_seq(node.slice):
            hits.append(("subscript key", node.lineno))
        elif isinstance(node, ast.Compare) and mentions_seq(node):
            hits.append(("comparison", node.lineno))
        elif isinstance(node, ast.FunctionDef) and "dedup" in node.name and mentions_seq(node):
            hits.append(("dedup function", node.lineno))
    return hits


def test_g07_static_no_seq_keys():
    for f in ("radio.py", "packet.py", "stream.py"):
        path = SRC / f
        if path.exists():
            assert _seq_misuse(path.read_text()) == [], f


def test_g07_negative_seq_key_detected():
    assert _seq_misuse("seen = {}\nseen[(p.node_id, p.seq)] = p\n")
    assert _seq_misuse("def dedup(rs):\n    return {r.seq for r in rs}\n")


def test_g07_reboot_same_seq_both_survive():
    cfg = load_mutated_config(lambda d: d["radio"].__setitem__("bernoulli_loss_prob", 0.0))
    layout = size_network(cfg)
    world = WorldState(cfg, layout)
    sf = Superframe(cfg, layout)
    rng = np.random.default_rng(1)
    node = next(n for n in layout.nodes if n.tier == "1C")
    world.step()
    first = sf.run([read_node(node, world, cfg, rng)], world.epoch, rng)
    sf.reboot(node.node_id)
    world.step()
    second = sf.run([read_node(node, world, cfg, rng)], world.epoch, rng)
    assert first[0].packet.seq == second[0].packet.seq  # reboot reset seq
    assert len(deduplicate(first + second)) == 2
    assert len(deduplicate(first + first)) == 1
