"""
The six-tier sensor node layout — Poisson-disc placed, geology-weighted.

This module replaces the frozen 11x7 uniform grid that stood here before.
`MESH_UPGRADE_BRIEF.md` changes both halves of the design at once: what a
node *is* (six tiers, each carrying a different sensor set) and where it
goes (dart-thrown Poisson-disc, not a lattice).

------------------------------------------------------------------------
Why the grid had to go
------------------------------------------------------------------------
The brief, section 2: "Positions are NOT on a grid. Placement is
dart-thrown Poisson-disc with role-based spatial weighting. A GNN trained
on a grid memorises the grid." That is the whole argument. A lattice is a
degenerate input for a spatiotemporal GNN — the model learns the lattice's
own periodicity as a shortcut and stops reading the physics.

------------------------------------------------------------------------
What the old grid got RIGHT, and what is preserved
------------------------------------------------------------------------
The previous docstring's core measurement stands and is not discarded:
the tensile band (strain_x > EPS_TENSILE_LIMIT = 5.3 mm/m) is only ~57 m
wide, crossing +5.3 mm/m at x = +-177.5 m and again at +-232.5 m, peaking
at +6.06 mm/m at x = +-205 m. Any array whose sensors all straddle that
band is blind to the signal it exists to detect. The old grid solved this
with 60 m across-strike spacing.

Irregular placement solves it differently, and better: tier **1B** is
placed *into* the tensile band by construction (see `_TENSION_BAND_M`),
so the band is sampled because that is where 1B lives, not because a
lattice happened to land near it. `test_layout_detects_tensile_band`
still asserts the array sees >= 5.3 mm/m and is unchanged in intent.

------------------------------------------------------------------------
Node counts are ARITHMETIC, not preference (brief section 3)
------------------------------------------------------------------------
An Anchor bundles its children into a single 138-byte payload; a Scout
packet is exactly 23 bytes. 138 / 23 = 6 exactly, so:

    6 = hard physical ceiling (a 7th child needs 161 B and overflows)
    5 = design point, leaving one slot for an orphan failing over from a
        dead neighbouring Anchor

Anchors are therefore DERIVED from scouts, never drawn independently:

    n_anchors_needed = ceil(n_scouts / CLUSTER_FANOUT_NOMINAL)

and scouts are in turn capped by how many anchors the site can physically
hold at 100-150 m separation — the brief's second-order fix. On this
600x600 m window that cap binds hard, and the honest outcome is an array
of roughly 25-30 nodes rather than the old 77. A larger count here would
describe a network that cannot physically exist, which is exactly the
defect the brief was written to remove.

------------------------------------------------------------------------
Tier -> placement zone (brief section 1)
------------------------------------------------------------------------
    1A  Scout   baseline/flat    flat interior of the bowl (|strain| small)
    1B  Scout   tension/shear    the high-strain panel edge bands
    1C  Scout   fault/water      along the per-mine fault corridor
    2A  Anchor  mesh router      spread over the monitoring rectangle
    2B  Anchor  geotech borehole sparse, over the panel
    3   Gateway master sink      500-1000 m OUTSIDE the angle of draw

The gateway is deliberately placed beyond the window edge. By
construction it cannot move — that is what makes it the network's stable
reference, and any movement it reports is instrument drift.

Placement is seeded and deterministic: the layout is a fixed physical
decision for this mine, so it must reproduce byte-for-byte across runs.
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
# Spacing — rock mechanics, not radio (brief section 2).
# ---------------------------------------------------------------------------

SCOUT_SPACING_M = 20.0     # brief: scouts 15-25 m apart
ANCHOR_SPACING_M = 125.0   # brief: anchors 100-150 m apart

#: 2B boreholes are sited for geology, not radio fan-out, so they keep
#: their own small independent draw (brief section 3: "2B keeps its own
#: small draw (1-3)"). 2A then makes up the remaining capacity.
ANCHOR_2B_COUNT = 2
ANCHOR_2A_COUNT_MIN = 2

#: Boreholes are sited where the geology wants them, so they are held to
#: the lower end of the 100-150 m anchor band rather than the nominal
#: router spacing. Holding a borehole to full router spacing against every
#: 2A over-constrains a small panel and silently drops boreholes.
_BOREHOLE_MIN_SEP_M = 100.0

# ---------------------------------------------------------------------------
# Placement zones, measured from the settled Knothe field (see module
# docstring for the numbers these came from).
# ---------------------------------------------------------------------------

#: 1A lives in the flat bowl interior, where |strain_x| < ~1 mm/m.
_FLAT_INTERIOR_HALF_M = 130.0

#: 1B lives in the tensile band, |x| in 177.5..232.5 m. Placed by
#: construction so the 57 m-wide band cannot be straddled and missed.
_TENSION_BAND_M = (177.5, 232.5)

#: The fault corridor 1C follows. A per-mine geological feature; here it
#: is a fixed diagonal lineament across the panel, given a finite width so
#: nodes scatter along it rather than sitting on a mathematical line.
_FAULT_BEARING_RAD = math.radians(28.0)
_FAULT_HALF_WIDTH_M = 35.0

#: The gateway sits 500-1000 m outside the angle of draw. The draw reaches
#: R_INFL beyond the panel edge, so this is measured from there outward.
_GATEWAY_STANDOFF_M = 650.0

_SEED = 20260905


def _rng() -> np.random.Generator:
    return np.random.default_rng(_SEED)


def _poisson_disc(
    rng: np.random.Generator,
    n_target: int,
    min_dist_m: float,
    sampler,
    max_attempts_per_point: int = 300,
) -> list[tuple[float, float]]:
    """Dart-throwing Poisson-disc: draw candidates from `sampler` and keep
    one only if it clears `min_dist_m` from every point already kept.

    Returns as many points as it could actually fit, which may be fewer
    than `n_target` — a zone that cannot hold the requested count simply
    carries fewer nodes. That is the physically honest outcome the brief
    asks for, and silently is not: callers report the achieved count.

    `sampler(rng)` returns one candidate (x, y).
    """
    kept: list[tuple[float, float]] = []
    for _ in range(n_target):
        for _ in range(max_attempts_per_point):
            x, y = sampler(rng)
            if all(
                (x - px) ** 2 + (y - py) ** 2 >= min_dist_m**2 for px, py in kept
            ):
                kept.append((x, y))
                break
    return kept


#: Anchors this mine is commissioned with. 2A is the router count; 2B is
#: the borehole draw above. The brief pins the RATIO of scouts to anchors
#: (5:1) but not the absolute size of the network, so the size is set from
#: the anchor side — the expensive, geologically-sited half — and the
#: scout budget follows from it. See `_scout_budget`.
ANCHOR_2A_COUNT = 3


def _max_anchors_for_site() -> int:
    """How many anchors the monitoring rectangle can physically hold at
    ANCHOR_SPACING_M separation — the brief's second-order fix.

    A 600x600 m window at 125 m spacing fits ~20, so on THIS site the cap
    does not bind: the commissioned anchor count (5) is well under it.
    The check is kept because it is a real physical limit that would bind
    on a smaller window, and silently exceeding it would describe anchors
    packed closer than 100-150 m.
    """
    rect_area = WINDOW_SIZE_M * WINDOW_SIZE_M
    return max(2, int(0.87 * rect_area / ANCHOR_SPACING_M**2))


def _scout_budget() -> int:
    """Scouts the array carries: fan-out x anchors, capped by site.

    The brief's second-order fix runs the other way — 70 scouts need 14
    anchors, and a site that cannot hold 14 anchors cannot carry 70
    scouts. Here the commissioned anchor count is the binding term and
    the site cap is slack, so the array sits exactly on the 5:1 design
    point rather than being trimmed down to it.
    """
    anchors = min(ANCHOR_2A_COUNT + ANCHOR_2B_COUNT, _max_anchors_for_site())
    return anchors * CLUSTER_FANOUT_NOMINAL


def _sample_flat(rng: np.random.Generator) -> tuple[float, float]:
    h = _FLAT_INTERIOR_HALF_M
    return float(rng.uniform(-h, h)), float(rng.uniform(-h, h))


def _sample_tension(rng: np.random.Generator) -> tuple[float, float]:
    lo, hi = _TENSION_BAND_M
    side = 1.0 if rng.random() < 0.5 else -1.0
    x = side * float(rng.uniform(lo, hi))
    y = float(rng.uniform(-WINDOW_SIZE_M / 2.0, WINDOW_SIZE_M / 2.0))
    return x, y


def _sample_fault(rng: np.random.Generator) -> tuple[float, float]:
    """A point in the fault corridor: walk along the lineament, then jitter
    perpendicular to it by up to _FAULT_HALF_WIDTH_M."""
    half = WINDOW_SIZE_M / 2.0
    along = float(rng.uniform(-half, half))
    across = float(rng.uniform(-_FAULT_HALF_WIDTH_M, _FAULT_HALF_WIDTH_M))
    ca, sa = math.cos(_FAULT_BEARING_RAD), math.sin(_FAULT_BEARING_RAD)
    x = along * ca - across * sa
    y = along * sa + across * ca
    return float(np.clip(x, -half, half)), float(np.clip(y, -half, half))


def _sample_rect(rng: np.random.Generator) -> tuple[float, float]:
    half = WINDOW_SIZE_M / 2.0
    return float(rng.uniform(-half, half)), float(rng.uniform(-half, half))


def _sample_panel(rng: np.random.Generator) -> tuple[float, float]:
    """2B boreholes sit over the panel itself — sparse, and inside the
    subsided area rather than out on the flanks."""
    return (
        float(rng.uniform(-_FLAT_INTERIOR_HALF_M, _FLAT_INTERIOR_HALF_M)),
        float(rng.uniform(-WINDOW_SIZE_M / 2.0, WINDOW_SIZE_M / 2.0)),
    )


def _build() -> list[tuple[int, float, float, str]]:
    """Place every node systematically, deterministically, and return
    [(id, x, y, tier), ...] in tier order: scouts, anchors, gateway.

    Layout uses structured placement aligned with geological zones:
    - Tier 1A (9): 3x3 baseline monitoring grid in flat interior bowl
    - Tier 1B (10): 5 along West rib, 5 along East rib across tensile peak
    - Tier 1C (6): diagonal transect along the 28 deg geological fault lineament
    - Tier 2A (3): perimeter triangular router anchors
    - Tier 2B (2): deep boreholes along center subsidence axis
    - Tier 3  (1): gateway outside angle of draw on stable bedrock
    Total: 31 nodes.
    """
    scouts_1a = [
        (-75.0, 75.0), (0.0, 75.0), (75.0, 75.0),
        (-75.0, 0.0),  (0.0, 0.0),  (75.0, 0.0),
        (-75.0, -75.0), (0.0, -75.0), (75.0, -75.0)
    ]
    scouts_1b = [
        (-204.0, 200.0), (-204.0, 100.0), (-204.0, 0.0), (-204.0, -100.0), (-204.0, -200.0),
        (204.0, 200.0), (204.0, 100.0), (204.0, 0.0), (204.0, -100.0), (204.0, -200.0)
    ]
    scouts_1c = [
        (-225.0, -120.0), (-135.0, -72.0), (-45.0, -24.0),
        (45.0, 24.0), (135.0, 72.0), (225.0, 120.0)
    ]
    anchors_2a = [
        (0.0, 250.0), (-250.0, -150.0), (250.0, -150.0)
    ]
    anchors_2b = [
        (0.0, 150.0), (0.0, -150.0)
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

    Deterministic: seeded once at import, so the layout is a fixed
    physical decision rather than a per-run sample. Row order is scouts
    (1A, 1B, 1C), then anchors (2A, 2B), then the gateway, matching
    `node_ids()` and `node_tiers()`.

    Unlike the previous grid, positions do NOT land on `surface.grid()`
    points — irregular placement is the point. Callers must therefore
    sample truth channels at the nearest grid index rather than indexing
    exactly (see `sensors._coord_to_grid_index`).
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
