"""
The static mesh DAG — who talks to whom, decided once at commissioning.

Built from node positions alone, after placement (`MESH_UPGRADE_BRIEF.md`
section 4). Three hops:

    Scout (hop 2) ──> Anchor (hop 1) ──> Gateway (hop 0)
          └── backup: 2nd-nearest Anchor, pre-calculated

------------------------------------------------------------------------
Assignment is CAPACITATED — this is the subtle part
------------------------------------------------------------------------
Assigning each scout to its nearest anchor is *unbalanced*: it hands one
anchor 9 children while a neighbour sits at 2, silently breaking the
bundle limit. An Anchor bundles its children into a single 138-byte
payload and a Scout packet is 23 bytes, so 6 children is a hard physical
ceiling — a 7th needs 161 B and cannot be transmitted.

So instead of nearest-parent:

    Sort all (scout, anchor) pairs by ascending distance. Take greedily,
    skipping any anchor already at CLUSTER_FANOUT_MAX. A scout whose
    nearest anchor is full falls to its next-nearest.

That is real behaviour — cluster membership in a pre-planned DAG is
decided by the network planner, not by proximity alone. `build_mesh`
asserts no cluster exceeds the ceiling and raises rather than emitting an
impossible network.

------------------------------------------------------------------------
This is NOT the GNN's edge list
------------------------------------------------------------------------
The mesh is the COMMUNICATION graph. The physics graph is a separate
thing, built downstream from (x, y) by kNN or radius so different
strategies can be tried. Do not feed `parent_id` in as adjacency.
"""

from dataclasses import dataclass

import numpy as np

from sandbox.layout import (
    ANCHOR_TIERS,
    CLUSTER_FANOUT_MAX,
    SCOUT_TIERS,
    TIER_3,
    node_ids,
    node_positions,
    node_tiers,
)

# TX power ladder (brief section 4 / mesh doc 3.2). The +22 dBm maximum is
# reserved for the emergency blast and for orphan failover, so it is not a
# nominal value. Scouts run minimum PA to survive on one 18650 + a 1 W panel.
_TX_NEAR_M = 150.0
_TX_MID_M = 500.0
TX_POWER_NEAR_DBM = 5
TX_POWER_MID_DBM = 10
TX_POWER_FAR_DBM = 14


def tx_power_dbm(dist_m: float) -> int:
    """Nominal TX power for a link of this length."""
    if dist_m <= _TX_NEAR_M:
        return TX_POWER_NEAR_DBM
    if dist_m <= _TX_MID_M:
        return TX_POWER_MID_DBM
    return TX_POWER_FAR_DBM


@dataclass(frozen=True)
class MeshLink:
    """One node's place in the DAG — one row of the mesh table."""

    node_id: int
    tier: str
    parent_id: int | None
    backup_parent_id: int | None
    cluster_id: int | None  # the head anchor's node_id
    hop_count: int          # 0 gateway, 1 anchor, 2 scout
    dist_to_parent_m: float | None
    dist_to_backup_m: float | None
    tx_power_dbm_nominal: int | None


def build_mesh() -> list[MeshLink]:
    """Build the full mesh DAG for the current layout.

    Returns one `MeshLink` per node, in `node_positions()` row order. The
    gateway row carries null parent/backup — it is the sink.
    """
    ids = node_ids()
    pos = node_positions()
    tiers = node_tiers()

    by_id = {int(i): (float(p[0]), float(p[1])) for i, p in zip(ids, pos)}
    tier_by_id = {int(i): t for i, t in zip(ids, tiers)}

    scout_ids = [i for i, t in tier_by_id.items() if t in SCOUT_TIERS]
    anchor_ids = [i for i, t in tier_by_id.items() if t in ANCHOR_TIERS]
    gateway_ids = [i for i, t in tier_by_id.items() if t == TIER_3]

    if len(gateway_ids) != 1:
        raise ValueError(f"expected exactly one gateway, found {len(gateway_ids)}")
    gateway_id = gateway_ids[0]
    if not anchor_ids:
        raise ValueError("no anchors placed — scouts would have nowhere to report")

    def dist(a: int, b: int) -> float:
        (ax, ay), (bx, by) = by_id[a], by_id[b]
        return float(np.hypot(ax - bx, ay - by))

    # --- Capacitated scout -> anchor assignment. -------------------------
    #
    # Every (scout, anchor) pair, globally sorted by distance, taken
    # greedily. This is what keeps clusters balanced; nearest-parent does
    # not, and would emit clusters over the bundle ceiling.
    pairs = sorted(
        ((dist(s, a), s, a) for s in scout_ids for a in anchor_ids),
        key=lambda p: (p[0], p[1], p[2]),
    )
    parent_of: dict[int, int] = {}
    load: dict[int, int] = {a: 0 for a in anchor_ids}
    for d, s, a in pairs:
        if s in parent_of or load[a] >= CLUSTER_FANOUT_MAX:
            continue
        parent_of[s] = a
        load[a] += 1

    unassigned = [s for s in scout_ids if s not in parent_of]
    if unassigned:
        raise ValueError(
            f"{len(unassigned)} scouts could not be assigned: total anchor "
            f"capacity is {len(anchor_ids) * CLUSTER_FANOUT_MAX} for "
            f"{len(scout_ids)} scouts"
        )

    links: list[MeshLink] = []
    for node_id in (int(i) for i in ids):
        tier = tier_by_id[node_id]

        if tier == TIER_3:
            # The sink. Null parent and backup by construction.
            links.append(
                MeshLink(
                    node_id=node_id,
                    tier=tier,
                    parent_id=None,
                    backup_parent_id=None,
                    cluster_id=None,
                    hop_count=0,
                    dist_to_parent_m=None,
                    dist_to_backup_m=None,
                    tx_power_dbm_nominal=None,
                )
            )
            continue

        if tier in ANCHOR_TIERS:
            # Anchors relay to the gateway; backup is the nearest peer
            # anchor, which can carry the cluster onward if the direct
            # backbone hop fails.
            peers = [a for a in anchor_ids if a != node_id]
            backup = min(peers, key=lambda a: dist(node_id, a)) if peers else None
            d_parent = dist(node_id, gateway_id)
            links.append(
                MeshLink(
                    node_id=node_id,
                    tier=tier,
                    parent_id=gateway_id,
                    backup_parent_id=backup,
                    cluster_id=node_id,  # an anchor heads its own cluster
                    hop_count=1,
                    dist_to_parent_m=round(d_parent, 2),
                    dist_to_backup_m=(
                        round(dist(node_id, backup), 2) if backup is not None else None
                    ),
                    tx_power_dbm_nominal=tx_power_dbm(d_parent),
                )
            )
            continue

        # Scout. Backup = nearest anchor that is not the primary, written
        # in at commissioning rather than discovered at runtime.
        primary = parent_of[node_id]
        others = [a for a in anchor_ids if a != primary]
        backup = min(others, key=lambda a: dist(node_id, a)) if others else None
        d_parent = dist(node_id, primary)
        links.append(
            MeshLink(
                node_id=node_id,
                tier=tier,
                parent_id=primary,
                backup_parent_id=backup,
                cluster_id=primary,
                hop_count=2,
                dist_to_parent_m=round(d_parent, 2),
                dist_to_backup_m=(
                    round(dist(node_id, backup), 2) if backup is not None else None
                ),
                tx_power_dbm_nominal=tx_power_dbm(d_parent),
            )
        )

    _assert_valid(links)
    return links


def _assert_valid(links: list[MeshLink]) -> None:
    """Refuse to emit a network that cannot physically exist.

    The brief is explicit that the old dataset shipped anchors with 13
    children bundling 322 bytes into a 138-byte payload. Raising here is
    the point: a silently-broken topology is worse than a hard failure,
    because everything downstream keeps working and quietly trains on an
    impossible radio network.
    """
    sizes: dict[int, int] = {}
    for l in links:
        if l.hop_count == 2:
            sizes[l.cluster_id] = sizes.get(l.cluster_id, 0) + 1

    for cluster_id, n in sizes.items():
        if n > CLUSTER_FANOUT_MAX:
            raise ValueError(
                f"cluster {cluster_id} has {n} children, over the "
                f"{CLUSTER_FANOUT_MAX}-packet bundle ceiling"
            )

    for l in links:
        if l.hop_count == 2 and l.parent_id == l.backup_parent_id:
            raise ValueError(f"node {l.node_id}: backup parent equals primary")


def cluster_sizes(links: list[MeshLink]) -> dict[int, int]:
    """Children per cluster head, for metadata and gates."""
    sizes: dict[int, int] = {}
    for l in links:
        if l.hop_count == 2 and l.cluster_id is not None:
            sizes[l.cluster_id] = sizes.get(l.cluster_id, 0) + 1
    return sizes
