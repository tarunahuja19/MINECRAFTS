"""Evaluation metrics beyond the training loss.

The README is explicit that loss alone is misleading on this dataset: 75% of
node-labels are censored and a model that predicts "nothing ever collapses"
scores deceptively well on the censored likelihood. A rank metric that only
looks at the *observed* events is the honest check, so a concordance index is
computed on val/test alongside the loss and both are logged together.

Nothing here feeds gradient — it is measurement only.
"""

from __future__ import annotations

import numpy as np
import torch


def _risk_score(hazard_logits: torch.Tensor) -> torch.Tensor:
    """Collapse the per-bin hazard to one scalar risk per (tick, node).

    Higher = more imminent risk. 1 - S(t+K | t) is the model's own estimate
    of "collapses within the predicted horizon", which is the quantity the
    concordance index should be ranking on.
    """
    lam = torch.sigmoid(hazard_logits)
    surv_to_horizon = torch.cumprod(1.0 - lam, dim=-1)[..., -1]
    return 1.0 - surv_to_horizon


def concordance_index(
    hazard_logits: torch.Tensor,
    event_bin: torch.Tensor,
    censored: torch.Tensor,
    valid_mask: torch.Tensor,
) -> tuple[float, int]:
    """Harrell's C-index over comparable (node, tick) pairs within one mine.

    A pair (a, b) is comparable when a has an observed event in an earlier bin
    than b's event-or-censoring bin. The pair is concordant if the model gave
    a the higher risk score. Ties in risk count as 0.5.

    Args:
        hazard_logits: (B, T, N, K)
        event_bin:     (B, T, N)   collapse bin, -1 where censored
        censored:      (B, T, N)   bool
        valid_mask:    (B, T, N)   bool

    Returns:
        (c_index, n_pairs). c_index is NaN when no comparable pair exists
        (e.g. a fully-censored mine) — callers should pool the pair counts
        across mines rather than averaging per-mine C directly.
    """
    risk = _risk_score(hazard_logits)              # (B, T, N)

    # "Time" is the bin index; censored rows use K (survived the whole
    # predicted horizon) so they can still serve as the later half of a pair.
    k = hazard_logits.shape[-1]
    time = torch.where(censored, torch.full_like(event_bin, k), event_bin)

    valid = valid_mask & torch.isfinite(risk)
    observed = valid & (~censored)

    r = risk[valid].detach().cpu().numpy()
    t = time[valid].detach().cpu().numpy()
    obs = observed[valid].detach().cpu().numpy()

    # Every (node, tick) is flattened; a comparable pair needs the earlier
    # member to be an observed event. Vectorised over all pairs.
    n = len(r)
    if n < 2 or obs.sum() == 0:
        return float("nan"), 0

    ti = t[:, None]
    tj = t[None, :]
    obs_i = obs[:, None]
    comparable = obs_i & (ti < tj)                 # i events strictly before j

    ri = r[:, None]
    rj = r[None, :]
    concordant = comparable & (ri > rj)
    tied = comparable & (ri == rj)

    n_pairs = int(comparable.sum())
    if n_pairs == 0:
        return float("nan"), 0
    c = (concordant.sum() + 0.5 * tied.sum()) / n_pairs
    return float(c), n_pairs


class ConcordanceAccumulator:
    """Pools concordant/comparable counts across mines for one dataset-level C.

    Averaging per-mine C-indices over-weights small mines and silently drops
    fully-censored ones; accumulating the raw pair counts and dividing once at
    the end is the correct pooling.
    """

    def __init__(self) -> None:
        self._concordant = 0.0
        self._pairs = 0

    def update(self, hazard_logits, event_bin, censored, valid_mask) -> None:
        c, n_pairs = concordance_index(
            hazard_logits, event_bin, censored, valid_mask
        )
        if n_pairs > 0 and not np.isnan(c):
            self._concordant += c * n_pairs
            self._pairs += n_pairs

    def compute(self) -> tuple[float, int]:
        if self._pairs == 0:
            return float("nan"), 0
        return self._concordant / self._pairs, self._pairs
