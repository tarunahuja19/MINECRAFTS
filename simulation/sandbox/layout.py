"""
The six-tier sensor node layout — geology-weighted, structured placement.

This module defines the canonical 31-node monitoring layout across six tiers:
what a node *is* (six tiers, each carrying a different sensor set) and where it
goes (geology-aligned placement across monitoring zones).

------------------------------------------------------------------------
Geological zones and layout structure
------------------------------------------------------------------------
The tensile band (strain_x > EPS_TENSILE_LIMIT = 5.3 mm/m) is ~57 m
wide, crossing +5.3 mm/m at x = +-177.5 m and again at +-232.5 m, peaking
at +6.06 mm/m at x = +-204 m.

- Tier 1A (9): Widened 3x3 baseline monitoring grid in the flat interior bowl
  (|strain_x| < ~1 mm/m) with deterministic jitter.
- Tier 1B (10): Instrumented ribs (5 West, 5 East) staggered alternating by
  +-12 m in x, sampling the tensile band with peak detection at x = +-204 m.
- Tier 1C (6): Fault transect along the 28 deg geological fault corridor,
  offset perpendicular off the grid centre (~90 m) to read as a distinct lineament.
- Tier 2A (3): Triangular router anchors across the monitoring perimeter.
- Tier 2B (2): Deep geotech boreholes along the center subsidence axis.
- Tier 3  (1): Master sink gateway situated 650 m outside the angle of draw.

------------------------------------------------------------------------
Node counts are ARITHMETIC, not preference (brief section 3)
------------------------------------------------------------------------
An Anchor bundles its children into a single 138-byte payload; a Scout
packet is exactly 23 bytes. 138 / 23 = 6 exactly, so:

    6 = hard physical ceiling (a 7th child needs 161 B and overflows)
    5 = design point, leaving one slot for an orphan failing over from a
        dead neighbouring Anchor

Placement is deterministic: the layout is a fixed physical decision
for this mine, so it reproduces byte-for-byte across runs.
"""

import math

import numpy as np

from sandbox.constants import R_INFL, WINDOW_SIZE_M

# ---------------------------------------------------------------------------
# Tiers.
# ---------------------------------------------------------------------------

TIER_1A = "1A"
TIER_1B = "1B"
TIER_1C = "1C"
TIER_2A = "2A"
TIER_2B = "2B"
TIER_3 = "3"

SCOUT_TIERS = (TIER_1A, TIER_1B, TIER_1C)
ANCHOR_TIERS = (TIER_2A, TIER_2B)

#: Human-facing role name per tier, for UI labelling.
TIER_ROLE = {
    TIER_1A: "Scout / baseline",
    TIER_1B: "Scout / tension",
    TIER_1C: "Scout / fault",
    TIER_2A: "Anchor / router",
    TIER_2B: "Anchor / borehole",
    TIER_3: "Gateway",
}

# ---------------------------------------------------------------------------
# Fan-out — brief section 3. These two numbers drive every count below.
# ---------------------------------------------------------------------------

CLUSTER_FANOUT_NOMINAL = 5   # design point: one slot of bundle headroom
CLUSTER_FANOUT_MAX = 6       # 138 B bundle / 23 B packet — hard ceiling

# ---------------------------------------------------------------------------
# Spacing and Standoff
# ---------------------------------------------------------------------------

SCOUT_SPACING_M = 20.0     # brief: scouts 15-25 m apart
ANCHOR_SPACING_M = 125.0   # brief: anchors 100-150 m apart
ANCHOR_2A_COUNT = 3
ANCHOR_2B_COUNT = 2
ANCHOR_2A_COUNT_MIN = 2

_GATEWAY_STANDOFF_M = 650.0


def _build() -> list[tuple[int, float, float, str]]:
    """Place every node systematically, deterministically, and return
    [(id, x, y, tier), ...] in tier order: scouts, anchors, gateway.

    Layout uses structured placement aligned with geological zones:
    - Tier 1A (9): widened 3x3 baseline monitoring grid in flat interior bowl
    - Tier 1B (10): 5 along West rib, 5 along East rib across tensile peak, staggered alternating
    - Tier 1C (6): diagonal transect along 28 deg geological fault lineament, offset off grid
    - Tier 2A (3): perimeter triangular router anchors
    - Tier 2B (2): deep boreholes along center subsidence axis
    - Tier 3  (1): gateway outside angle of draw on stable bedrock
    Total: 31 nodes.
    """
    # 1A grid: widened baseline monitoring grid in interior bowl with deterministic offsets
    scouts_1a = [
        (-135.0, 135.0), (-5.0, 100.0), (135.0, 138.0),
        (-140.0, 5.0),   (0.0, 0.0),    (140.0, -5.0),
        (-135.0, -160.0), (5.0, -100.0), (135.0, -138.0),
    ]
    # 1B ribs: 5 along West rib, 5 along East rib across tensile band (x ~ +-204m), staggered alternating,
    # rescaled outward in y (+-250m) to cover Northern and Southern bounds
    scouts_1b = [
        (-216.0, 250.0), (-192.0, 125.0), (-204.0, 20.0), (-216.0, -125.0), (-192.0, -250.0),
        (192.0, 250.0),  (216.0, 125.0),  (204.0, -20.0), (192.0, -125.0),  (216.0, -250.0),
    ]
    # 1C fault transect: 28 deg bearing, offset perpendicular off grid centre, spread across domain
    scouts_1c = [
        (-245.0, -147.3), (-150.0, -96.8), (-50.0, -43.6),
        (50.0, 9.6),      (150.0, 62.8),   (245.0, 113.3),
    ]
    # 2A router anchors: outer perimeter triangle covering Northern and Southern bounds
    anchors_2a = [
        (0.0, 275.0), (-270.0, -210.0), (270.0, -210.0),
    ]
    # 2B borehole anchors: deep boreholes along center subsidence axis
    anchors_2b = [
        (0.0, 180.0), (0.0, -180.0),
    ]
    draw_edge = WINDOW_SIZE_M / 2.0 + R_INFL
    gw = draw_edge + _GATEWAY_STANDOFF_M
    gateway = [(float(gw * 0.72), float(-gw * 0.62), TIER_3)]

    ordered: list[tuple[float, float, str]] = []
    for x, y in scouts_1a:
        ordered.append((x, y, TIER_1A))
    for x, y in scouts_1b:
        ordered.append((x, y, TIER_1B))
    for x, y in scouts_1c:
        ordered.append((x, y, TIER_1C))
    for x, y in anchors_2a:
        ordered.append((x, y, TIER_2A))
    for x, y in anchors_2b:
        ordered.append((x, y, TIER_2B))
    ordered.extend(gateway)

    return [(i + 1, x, y, tier) for i, (x, y, tier) in enumerate(ordered)]


_NODES = _build()

N_NODES = len(_NODES)
N_SCOUTS = sum(1 for _, _, _, t in _NODES if t in SCOUT_TIERS)
N_ANCHORS = sum(1 for _, _, _, t in _NODES if t in ANCHOR_TIERS)


def node_positions() -> np.ndarray:
    """The node layout as an (N_NODES, 2) array of (x, y) in metres.

    Deterministic: row order is scouts (1A, 1B, 1C), then anchors (2A, 2B),
    then the gateway, matching `node_ids()` and `node_tiers()`.
    """
    return np.array([[x, y] for _, x, y, _ in _NODES], dtype=float)


def node_ids() -> np.ndarray:
    """A stable integer id (1..N_NODES) per row of `node_positions()`."""
    return np.array([i for i, _, _, _ in _NODES], dtype=int)


def node_tiers() -> list[str]:
    """The tier string per row of `node_positions()`, in the same order.

    Tier determines what sensors a node carries and therefore which
    telemetry channels are non-null — see `sensors.TIER_CHANNELS`.
    """
    return [t for _, _, _, t in _NODES]
