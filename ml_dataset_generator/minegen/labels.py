"""
Survival-analysis labels (spec 5).

Spec 5 opens with an explicit prohibition: do NOT generate a simple binary
"will collapse" label. The target is a hazard curve, so every node at every
timestep carries three separate quantities:

  time_to_collapse_s   seconds until the RELEVANT collapse for that node.
                       "Relevant" means the nearest event in space that
                       plausibly affects it -- not one global mine-wide time.
                       NaN where the node is censored.

  censored_flag        1 if the horizon ended with no collapse observed for
                       this node's region. Censored means "survived at least
                       this long", NOT "safe forever". Whole mines are fully
                       censored by design (spec 5.2) so the model sees stable
                       ground as well as failing ground.

  spatial_weight       how much to trust this node's time label during
                       training. A node far from the failure barely felt it,
                       so its label is weak evidence. Gaussian falloff.

Spec 5.3 is emphatic that the weight is its own column and must never be baked
into the time value, so a downstream trainer can choose to ignore it.

RELEVANCE RULE
A node is assigned to the event that is nearest in space, but only if it lies
within the event's relevance radius. Beyond that the event is treated as not
having affected the node at all, and if no event reaches it, that node is
censored even in a mine that collapsed elsewhere.
"""

from __future__ import annotations

import numpy as np

from . import constants as K
from .field import GroundField

# A node further than this many event radii from a collapse is treated as
# unaffected by it. Recorded in GENERATION_NOTES.md.
RELEVANCE_RADII = 4.0


def build_labels(
    nodes: list, gf: GroundField, t_s: np.ndarray, horizon_s: float
) -> tuple[dict[str, np.ndarray], dict]:
    """
    Compute per-node, per-timestep labels.

    Returns (n_nodes, n_steps) arrays plus a metadata dict describing the
    decay function and relevance rule actually used.
    """
    n_nodes = len(nodes)
    n_steps = t_s.size
    xy = np.array([[n.x, n.y] for n in nodes], dtype=np.float64)

    sigma = K.SPATIAL_WEIGHT_SIGMA_FRAC_OF_R * gf.r

    time_to = np.full((n_nodes, n_steps), np.nan)
    censored = np.ones((n_nodes, n_steps), dtype=np.int8)
    weight = np.zeros((n_nodes, n_steps), dtype=np.float64)
    relevant_event = np.full(n_nodes, -1, dtype=np.int64)

    if not gf.events:
        # Fully censored mine: stable ground for the whole horizon. Weight is
        # zero everywhere because there is no event to be near.
        meta = {
            "decay_function": "gaussian",
            "sigma_m": sigma,
            "sigma_frac_of_r": K.SPATIAL_WEIGHT_SIGMA_FRAC_OF_R,
            "relevance_radii": RELEVANCE_RADII,
            "fully_censored": True,
            "relevant_event_per_node": relevant_event.tolist(),
        }
        return (
            {
                "time_to_collapse_s": time_to,
                "censored_flag": censored,
                "spatial_weight": weight,
            },
            meta,
        )

    # ---- assign each node to its nearest reaching event --------------------
    ev_xy = np.array([[e.x, e.y] for e in gf.events])
    dists = np.sqrt(
        ((xy[:, None, :] - ev_xy[None, :, :]) ** 2).sum(axis=2)
    )  # (n_nodes, n_events)

    reach = np.array([RELEVANCE_RADII * e.radius_m for e in gf.events])
    within = dists <= reach[None, :]

    for i in range(n_nodes):
        cand = np.where(within[i])[0]
        if cand.size == 0:
            continue  # no event reaches this node -> stays censored
        j = int(cand[np.argmin(dists[i, cand])])
        relevant_event[i] = j
        ev = gf.events[j]

        # time remaining until that event's collapse instant
        remaining = ev.t_collapse_s - t_s
        # Before the collapse: a real time-to-event. At or after it, the event
        # has already happened, so there is no remaining time to predict.
        observed = remaining > 0.0
        time_to[i, observed] = remaining[observed]
        censored[i, observed] = 0
        # after collapse: leave NaN and censored=1, since the survival target
        # is undefined once the event has occurred

        w = float(np.exp(-0.5 * (dists[i, j] / sigma) ** 2))
        weight[i, :] = max(w, K.SPATIAL_WEIGHT_FLOOR)

    meta = {
        "decay_function": "gaussian: w = exp(-0.5 * (d/sigma)^2)",
        "sigma_m": sigma,
        "sigma_frac_of_r": K.SPATIAL_WEIGHT_SIGMA_FRAC_OF_R,
        "weight_floor": K.SPATIAL_WEIGHT_FLOOR,
        "relevance_radii": RELEVANCE_RADII,
        "fully_censored": False,
        "relevant_event_per_node": relevant_event.tolist(),
        "n_nodes_reached": int((relevant_event >= 0).sum()),
        "n_nodes_censored_despite_collapse": int((relevant_event < 0).sum()),
    }
    return (
        {
            "time_to_collapse_s": time_to,
            "censored_flag": censored,
            "spatial_weight": weight,
        },
        meta,
    )
