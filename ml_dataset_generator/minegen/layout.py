"""
Mine geometry and node placement (spec 3.3, 4.2, 6).

Two hard rules from the sources:

1. Node positions must NOT be on a regular grid (spec 3.3). Real deployments
   cannot guarantee grid placement, and a GNN trained on grids memorises the
   grid instead of learning a function of position.

2. Spacing is geotechnical, not radio (mesh doc 2). Scouts sit 15-25 m apart
   because ground failure is highly localised. Anchors sit 100-150 m apart
   because they only need to reconstruct the macro-shape of the bowl. The
   gateway sits 500-1000 m outside the angle of draw on immovable bedrock.

Tier roles drive WHERE each tier goes, straight from the sensor image:
    1A  baseline / flat zones        -> flat interior of the bowl
    1B  tension / shear zones        -> the high-curvature panel edges
    1C  fault / water zones          -> a per-mine fault corridor
    2A  standard mesh router         -> spread across the whole area
    2B  geotech borehole             -> deep holes, sparse, near the panel
    3   master sink / edge AI        -> far outside, on stable ground
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from . import constants as K


@dataclass
class Node:
    node_id: int
    tier: str          # "1A" | "1B" | "1C" | "2A" | "2B" | "3"
    node_type: str     # "scout" | "anchor" | "gateway"
    x: float
    y: float
    z: float


def _poisson_disc(
    rng: np.random.Generator,
    n_target: int,
    xlim: tuple[float, float],
    ylim: tuple[float, float],
    min_dist: float,
    weight_fn=None,
    max_tries: int = 40,
) -> np.ndarray:
    """
    Irregular placement by dart-throwing with a minimum-separation constraint.

    This is deliberately not a jittered grid: a jittered grid still has grid
    structure at long range, which is exactly what spec 3.3 forbids. Dart
    throwing produces genuinely irregular spacing while still honouring the
    geotechnical minimum separation from the mesh doc.

    weight_fn(x, y) -> acceptance probability in [0, 1], used to bias a tier
    toward the zone its sensors are meant to watch.
    """
    pts: list[tuple[float, float]] = []
    tries = 0
    limit = n_target * max_tries
    while len(pts) < n_target and tries < limit:
        tries += 1
        x = rng.uniform(*xlim)
        y = rng.uniform(*ylim)
        if weight_fn is not None and rng.random() > weight_fn(x, y):
            continue
        if pts:
            arr = np.asarray(pts)
            if np.min((arr[:, 0] - x) ** 2 + (arr[:, 1] - y) ** 2) < min_dist**2:
                continue
        pts.append((x, y))
    return np.asarray(pts, dtype=np.float64).reshape(-1, 2)


def build_layout(rng: np.random.Generator, geom: dict) -> tuple[list[Node], dict]:
    """
    Place every node for one mine.

    `geom` carries the already-drawn mine extent and panel corners. Returns the
    node list plus a dict of placement facts to record in metadata.json.
    """
    x1, y1, x2, y2 = geom["panel_x1"], geom["panel_y1"], geom["panel_x2"], geom["panel_y2"]
    W, Hgt = geom["mine_width"], geom["mine_height"]
    r = geom["r"]

    scout_spacing = rng.uniform(*K.SCOUT_SPACING_RANGE)
    anchor_spacing = rng.uniform(*K.ANCHOR_SPACING_RANGE)
    gateway_standoff = rng.uniform(*K.GATEWAY_STANDOFF_RANGE)

    # Monitoring rectangle: the panel plus one radius of influence on every
    # side, clipped to the mine extent. Nothing outside r can move.
    mx1 = max(0.0, x1 - r)
    my1 = max(0.0, y1 - r)
    mx2 = min(W, x2 + r)
    my2 = min(Hgt, y2 + r)

    n_scouts = int(rng.integers(K.SCOUT_COUNT_RANGE[0], K.SCOUT_COUNT_RANGE[1] + 1))

    # ---- cap scouts by the anchor capacity the site can physically hold ----
    # A scout is only deployable if some Anchor can parent it (fan-out 5, mesh
    # doc 3). Anchors need 100-150 m separation, so a small monitoring
    # rectangle physically cannot host enough of them -- e.g. a 340x160 m site
    # at 139 m spacing fits ~3 anchors, supporting ~15 scouts, not 70.
    # Dart-throwing packs at roughly 0.87 of ideal square packing.
    _rect_area = (mx2 - mx1) * (my2 - my1)
    _max_anchors = max(2, int(0.87 * _rect_area / anchor_spacing**2))
    n_scouts = min(n_scouts, _max_anchors * K.CLUSTER_FANOUT_NOMINAL)

    mix = rng.dirichlet(
        np.array([K.SCOUT_TIER_MIX[t] for t in ("1A", "1B", "1C")])
        * K.SCOUT_TIER_MIX_CONCENTRATION
    )
    n_1a = max(1, int(round(n_scouts * mix[0])))
    n_1b = max(1, int(round(n_scouts * mix[1])))
    n_1c = max(1, int(round(n_scouts * mix[2])))

    # ---- fault / water corridor for tier 1C -------------------------------
    # A straight corridor crossing the mine at a random angle, which 1C nodes
    # cluster along. This is the "fault / water zone" from the sensor image.
    fault_theta = rng.uniform(0.0, np.pi)
    fault_cx = rng.uniform(x1, x2)
    fault_cy = rng.uniform(y1, y2)
    fault_halfwidth = rng.uniform(0.35, 0.8) * r
    nx_f, ny_f = np.cos(fault_theta), np.sin(fault_theta)

    def fault_weight(x: float, y: float) -> float:
        d = abs((x - fault_cx) * nx_f + (y - fault_cy) * ny_f)
        return float(np.exp(-0.5 * (d / fault_halfwidth) ** 2))

    # ---- tier 1B: the high-tension shear edges ----------------------------
    # Curvature peaks a little outside each panel edge, so weight by distance
    # to the nearest edge line rather than to the panel interior.
    def edge_weight(x: float, y: float) -> float:
        dx = min(abs(x - x1), abs(x - x2))
        dy = min(abs(y - y1), abs(y - y2))
        d = min(dx, dy)
        return float(np.exp(-0.5 * (d / (0.55 * r)) ** 2))

    # ---- tier 1A: the flat interior of the subsidence bowl ----------------
    def interior_weight(x: float, y: float) -> float:
        inside_x = x1 + 0.15 * (x2 - x1) < x < x2 - 0.15 * (x2 - x1)
        inside_y = y1 + 0.15 * (y2 - y1) < y < y2 - 0.15 * (y2 - y1)
        return 1.0 if (inside_x and inside_y) else 0.15

    nodes: list[Node] = []
    nid = 0

    for tier, count, wfn in (
        ("1A", n_1a, interior_weight),
        ("1B", n_1b, edge_weight),
        ("1C", n_1c, fault_weight),
    ):
        pts = _poisson_disc(rng, count, (mx1, mx2), (my1, my2), scout_spacing, wfn)
        for px, py in pts:
            nodes.append(Node(nid, tier, "scout", float(px), float(py), 0.0))
            nid += 1

    # ---- anchor count is DERIVED from scout count (cluster fan-out) -------
    # mesh doc 3: one Anchor parents 5-6 Scouts and bundles them into 138 B.
    # Six is the hard ceiling (6 * 23 B); we design at CLUSTER_FANOUT_NOMINAL=5.
    # Anchors must therefore be numerous enough to adopt every scout placed.
    n_scouts_placed = sum(n.node_type == "scout" for n in nodes)
    n_anchors_needed = int(np.ceil(n_scouts_placed / K.CLUSTER_FANOUT_NOMINAL))

    # 2B is sited for geology (deep holes over the panel), so it keeps its own
    # small draw; 2A makes up whatever capacity remains.
    n_2b = int(rng.integers(K.ANCHOR_2B_COUNT_RANGE[0], K.ANCHOR_2B_COUNT_RANGE[1] + 1))
    n_2a = max(K.ANCHOR_2A_COUNT_MIN, n_anchors_needed - n_2b)

    # ---- tier 2A: mesh routers, spread over the whole monitoring rectangle -
    pts = _poisson_disc(rng, n_2a, (mx1, mx2), (my1, my2), anchor_spacing)
    for px, py in pts:
        nodes.append(Node(nid, "2A", "anchor", float(px), float(py), 0.0))
        nid += 1

    # ---- tier 2B: geotech boreholes, sparse, over the panel ---------------
    pts = _poisson_disc(rng, n_2b, (x1, x2), (y1, y2), anchor_spacing)
    for px, py in pts:
        nodes.append(Node(nid, "2B", "anchor", float(px), float(py), 0.0))
        nid += 1

    # ---- tier 3: gateway on bedrock, outside the angle of draw ------------
    # Placed beyond x2 + r by the standoff, so by construction it cannot move.
    gw_x = x2 + r + gateway_standoff
    gw_y = 0.5 * (y1 + y2) + rng.uniform(-0.15, 0.15) * (y2 - y1)
    for _ in range(K.N_GATEWAYS):
        nodes.append(Node(nid, "3", "gateway", float(gw_x), float(gw_y), 0.0))
        nid += 1

    placement = {
        "scout_spacing_m": scout_spacing,
        "anchor_spacing_m": anchor_spacing,
        "gateway_standoff_m": gateway_standoff,
        "monitoring_rect": [mx1, my1, mx2, my2],
        "fault_corridor": {
            "theta_rad": fault_theta,
            "cx": fault_cx,
            "cy": fault_cy,
            "halfwidth_m": fault_halfwidth,
        },
        "counts_by_tier": {
            "1A": sum(n.tier == "1A" for n in nodes),
            "1B": sum(n.tier == "1B" for n in nodes),
            "1C": sum(n.tier == "1C" for n in nodes),
            "2A": sum(n.tier == "2A" for n in nodes),
            "2B": sum(n.tier == "2B" for n in nodes),
            "3": sum(n.tier == "3" for n in nodes),
        },
        "n_nodes": len(nodes),
        "borehole_depths_m": list(K.BOREHOLE_DEPTHS_M),
        "cluster_fanout_nominal": K.CLUSTER_FANOUT_NOMINAL,
        "cluster_fanout_max": K.CLUSTER_FANOUT_MAX,
        "n_scouts_placed": n_scouts_placed,
        "n_anchors_needed": n_anchors_needed,
    }
    return nodes, placement
