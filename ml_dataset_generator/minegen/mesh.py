"""
Mesh topology: who talks to whom (mesh-communication-mechanics.md 3, 6).

This module is STATIC TOPOLOGY ONLY. It answers "which Anchor parents this
Scout, and which Anchor does it fall back to". It deliberately does NOT
simulate packet loss, ACK failure or node death -- those are deferred (see
metadata "deferred" block), so `readings.parquet` stays a clean dense
rectangle and the dataset stays easy to work with.

THE FAN-OUT RULE (the reason this file exists)

    mesh doc 3: an Anchor "listens to its 5 or 6 Scout children, bundles their
    packets into a single 138-byte payload"
    mesh doc 4: a Scout packet is exactly 23 bytes

    138 / 23 = exactly 6

So SIX children is a physical ceiling, not a style preference -- a 7th child
needs 161 B and overflows the bundle the Anchor is specified to transmit. The
design point is FIVE (K.CLUSTER_FANOUT_NOMINAL), leaving one slot of bundle
headroom so an orphan failing over from a dead neighbour still fits.

The TDMA window is NOT the binding constraint: t=2.0-11.5 s at 250 ms slots is
38 slots, and one Scout needs 90.4 ms TX + 20 ms ACK = 110.4 ms. Timing alone
would allow ~38 children. The payload is what caps it at 6.

WHY ASSIGNMENT IS CAPACITATED

Assigning every Scout to its nearest Anchor is unbalanced -- it hands some
Anchor nine children while a neighbour sits at two. That silently breaks the
bundle limit, which is exactly the bug this module was written to prevent. So
assignment is greedy over (scout, anchor) pairs in ascending distance, skipping
any Anchor already at CLUSTER_FANOUT_MAX. A Scout whose nearest Anchor is full
falls to its next-nearest, which is real behaviour: cluster membership in a
pre-planned DAG is decided by the network planner, not by proximity alone.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import constants as K
from .layout import Node


@dataclass
class MeshLink:
    node_id: int
    parent_id: int | None        # primary parent; None for the gateway
    backup_parent_id: int | None # pre-calculated failover (mesh doc 6)
    cluster_id: int              # node_id of the cluster-head anchor
    hop_count: int               # gateway 0, anchor 1, scout 2
    dist_to_parent_m: float
    dist_to_backup_m: float
    tx_power_dbm_nominal: float


def _dist(a: Node, b: Node) -> float:
    return float(np.hypot(a.x - b.x, a.y - b.y))


def _tx_power(dist_m: float) -> float:
    """
    Nominal TX power for a link of this length (mesh doc 3.2).

    A Scout 20 m from its Anchor does not shout -- it runs the PA at minimum to
    survive on one 18650 + a 1 W panel. Longer links step up. The +22 dBm
    maximum is reserved for the emergency blast, so it is not a nominal value.
    """
    if dist_m <= 150.0:
        return 5.0
    if dist_m <= 500.0:
        return 10.0
    return 14.0


def build_mesh(nodes: list[Node]) -> tuple[list[MeshLink], dict]:
    """
    Build the 3-tier DAG over already-placed nodes. Pure function of position.

    Returns one MeshLink per node plus a metadata dict. Raises if the fan-out
    ceiling cannot be honoured, because a dataset that violates it describes a
    network that cannot physically exist.
    """
    scouts = [n for n in nodes if n.node_type == "scout"]
    anchors = [n for n in nodes if n.node_type == "anchor"]
    gateways = [n for n in nodes if n.node_type == "gateway"]

    if not anchors:
        raise ValueError("mesh: no Tier 2 anchors to act as cluster heads")
    if not gateways:
        raise ValueError("mesh: no Tier 3 gateway to sink the backbone")
    gw = gateways[0]

    capacity = len(anchors) * K.CLUSTER_FANOUT_MAX
    if len(scouts) > capacity:
        raise ValueError(
            f"mesh: {len(scouts)} scouts exceed {len(anchors)} anchors x "
            f"{K.CLUSTER_FANOUT_MAX} = {capacity} bundle slots. "
            "layout.build_layout should have capped scouts to anchor capacity."
        )

    # ---- capacitated nearest-anchor assignment ---------------------------
    # All (scout, anchor) pairs sorted by distance; take greedily, skipping
    # anchors that have already filled their 6 bundle slots.
    pairs = []
    for si, s in enumerate(scouts):
        for ai, a in enumerate(anchors):
            pairs.append((_dist(s, a), si, ai))
    pairs.sort()

    load = [0] * len(anchors)
    primary: dict[int, int] = {}      # scout index -> anchor index
    for d, si, ai in pairs:
        if si in primary or load[ai] >= K.CLUSTER_FANOUT_MAX:
            continue
        primary[si] = ai
        load[ai] += 1

    if len(primary) != len(scouts):
        raise ValueError("mesh: capacitated assignment left scouts unparented")

    links: list[MeshLink] = []

    # ---- gateway: the sink, hop 0 ----------------------------------------
    links.append(MeshLink(gw.node_id, None, None, gw.node_id, 0, 0.0, 0.0, 0.0))

    # ---- anchors: hop 1, backbone straight to the gateway ----------------
    # Backup for an anchor is the nearest other anchor: if the backbone link
    # fails it relays via a peer rather than going silent.
    for ai, a in enumerate(anchors):
        d_gw = _dist(a, gw)
        others = sorted(
            ((_dist(a, b), b.node_id) for bi, b in enumerate(anchors) if bi != ai)
        )
        b_id, b_d = (others[0][1], others[0][0]) if others else (gw.node_id, d_gw)
        links.append(MeshLink(
            node_id=a.node_id,
            parent_id=gw.node_id,
            backup_parent_id=b_id,
            cluster_id=a.node_id,          # an anchor heads its own cluster
            hop_count=1,
            dist_to_parent_m=d_gw,
            dist_to_backup_m=b_d,
            tx_power_dbm_nominal=_tx_power(d_gw),
        ))

    # ---- scouts: hop 2, primary + pre-calculated backup ------------------
    for si, s in enumerate(scouts):
        pa = anchors[primary[si]]
        d_p = _dist(s, pa)
        # Backup = nearest anchor that is not the primary (mesh doc 6: the
        # backup is written into nodes.json at commissioning, not discovered).
        others = sorted(
            ((_dist(s, a), a.node_id) for ai, a in enumerate(anchors)
             if ai != primary[si])
        )
        b_id, b_d = (others[0][1], others[0][0]) if others else (gw.node_id, _dist(s, gw))
        links.append(MeshLink(
            node_id=s.node_id,
            parent_id=pa.node_id,
            backup_parent_id=b_id,
            cluster_id=pa.node_id,
            hop_count=2,
            dist_to_parent_m=d_p,
            dist_to_backup_m=b_d,
            tx_power_dbm_nominal=_tx_power(d_p),
        ))

    links.sort(key=lambda l: l.node_id)

    sizes = [n for n in load if n > 0]
    meta = {
        "n_clusters": len(sizes),
        "cluster_fanout_nominal": K.CLUSTER_FANOUT_NOMINAL,
        "cluster_fanout_max": K.CLUSTER_FANOUT_MAX,
        "cluster_sizes": sorted(sizes, reverse=True),
        "max_cluster_size": max(sizes) if sizes else 0,
        "mean_cluster_size": float(np.mean(sizes)) if sizes else 0.0,
        "scout_link_m": {
            "min": float(min(l.dist_to_parent_m for l in links if l.hop_count == 2)),
            "max": float(max(l.dist_to_parent_m for l in links if l.hop_count == 2)),
        },
        "anchor_to_gateway_m": {
            "min": float(min(l.dist_to_parent_m for l in links if l.hop_count == 1)),
            "max": float(max(l.dist_to_parent_m for l in links if l.hop_count == 1)),
        },
        "sx1262_range_m": 3000.0,
        "assignment": "capacitated nearest-anchor, greedy by ascending distance",
        "note": "Communication DAG only. NOT the GNN edge list (spec 6 forbids "
                "shipping edges; they are built downstream by kNN/radius).",
    }
    return links, meta
