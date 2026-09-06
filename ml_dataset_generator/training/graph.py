"""Per-mine graph construction (plan Section 4.1).

The graph is fixed per mine: built once from node positions and tiers, then
reused at every tick. Only the message weights change tick to tick (§4.2).
"""

from __future__ import annotations

import numpy as np

from .config import TIERS, Config

# Role per tier, from nodes.parquet: 1A/1B/1C are scouts, 2A/2B are anchors,
# 3 is the gateway. Radii are chosen per role-pair because the physical
# sensing footprints differ by more than an order of magnitude.
TIER_ROLE = {"1A": "scout", "1B": "scout", "1C": "scout",
             "2A": "anchor", "2B": "anchor", "3": "gateway"}
ROLE_BY_INDEX = [TIER_ROLE[t] for t in TIERS]


def pair_radius(role_a: str, role_b: str, cfg: Config) -> float:
    """Connection radius for a node pair, by role (plan §4.1, [OPEN] choice).

    Asymmetric by design: the data spec places scouts ~15 m apart but anchors
    ~126 m apart, so one global radius would either isolate anchors or make
    every scout a neighbour of every other.
    """
    if "gateway" in (role_a, role_b):
        return cfg.radius_gateway_m
    if role_a == "anchor" and role_b == "anchor":
        return cfg.radius_anchor_anchor_m
    if "anchor" in (role_a, role_b):
        return cfg.radius_scout_anchor_m
    return cfg.radius_scout_scout_m


def build_graph(positions: np.ndarray, tier_ids: np.ndarray, cfg: Config
                ) -> tuple[np.ndarray, np.ndarray]:
    """Build the per-mine edge list.

    Args:
        positions: (N, 3) float, metres.
        tier_ids:  (N,) int, index into TIERS.

    Returns:
        edge_index: (2, E) int64, rows are (src j, dst i) — a message flows
                    from j to i, matching the aggregation in §4.2.
        edge_dist:  (E,) float32, euclidean distance in metres.

    Every node is guaranteed a self-loop (§4.1, required): radius construction
    can leave a sparsely-placed node with zero neighbours, which would make
    the softmax in §4.2 undefined over an empty set. With a self-loop such a
    node degrades cleanly to "no spatial info this tick" instead of needing a
    separate fallback branch in the aggregation code.
    """
    n = positions.shape[0]
    diff = positions[:, None, :] - positions[None, :, :]
    dist = np.sqrt((diff**2).sum(axis=-1))

    roles = [ROLE_BY_INDEX[t] for t in tier_ids]
    radius = np.empty((n, n), dtype=np.float64)
    for a in range(n):
        for b in range(n):
            radius[a, b] = pair_radius(roles[a], roles[b], cfg)

    adj = dist <= radius
    np.fill_diagonal(adj, True)          # guaranteed self-loop

    src_list: list[int] = []
    dst_list: list[int] = []
    for i in range(n):
        nbrs = np.flatnonzero(adj[i])
        if len(nbrs) > cfg.max_degree:
            # Keep the closest neighbours, but never drop the self-loop.
            order = nbrs[np.argsort(dist[i, nbrs])]
            keep = [j for j in order if j != i][: cfg.max_degree - 1]
            nbrs = np.array([i, *keep])
        src_list.extend(nbrs.tolist())
        dst_list.extend([i] * len(nbrs))

    edge_index = np.stack(
        [np.array(src_list, dtype=np.int64), np.array(dst_list, dtype=np.int64)]
    )
    edge_dist = dist[edge_index[0], edge_index[1]].astype(np.float32)
    return edge_index, edge_dist
