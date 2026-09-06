"""Losses: censored survival likelihood + physics regularizers.

Plan Sections 6 and 7. The supervised term is the discrete-time survival
log-likelihood with censoring; the regularizers use ONLY simulator-independent
structural properties (§7.1), never mine-specific physical parameters.
"""

from __future__ import annotations

import torch

from .config import Config


def survival_nll(hazard_logits: torch.Tensor, event_bin: torch.Tensor,
                 censored: torch.Tensor, valid_mask: torch.Tensor,
                 horizon_mask: torch.Tensor, cfg: Config) -> torch.Tensor:
    """Discrete-time survival negative log-likelihood with censoring (§6).

    For an observed collapse in bin k*:
        maximize  log λ(k*) + Σ_{j<k*} log(1 - λ(j))
    For a censored observation:
        maximize  Σ_j log(1 - λ(j))            (no hazard term — the event
                                                was never observed)

    This is deliberately NOT a regression on time-to-collapse: that would
    silently discard the censoring information, and 75% of this dataset's
    node-labels are censored, so it would throw away most of the signal.

    Args:
        hazard_logits: (B, T, N, K)
        event_bin:     (B, T, N)   collapse bin index, -1 where censored
        censored:      (B, T, N)   bool
        valid_mask:    (B, T, N)   bool — node exists and reported (§8 padding)
        horizon_mask:  (B, T, K)   bool — bin fits inside the simulated horizon
        cfg:           for log_eps

    Returns:
        Scalar mean NLL over valid (node, tick) pairs.
    """
    eps = cfg.log_eps
    b, t, n, k = hazard_logits.shape

    lam = torch.sigmoid(hazard_logits)
    # Clamp before EVERY log (§6, required). sigmoid saturates to exactly 0/1
    # in float32 well before it mathematically should, and log(0) = -inf is
    # the single most common way this model silently emits NaN loss partway
    # through training. Do not rely on sigmoid's smoothness here.
    log_surv = torch.log(torch.clamp(1.0 - lam, eps, 1.0 - eps))
    log_haz = torch.log(torch.clamp(lam, eps, 1.0 - eps))

    # Two independent masks, combined MULTIPLICATIVELY (§8 invariant). They
    # mask disjoint failure modes — padding means "this node/tick does not
    # exist", horizon-truncation means "it exists but the simulation did not
    # run far enough to fill this bin" — and neither subsumes the other.
    hmask = horizon_mask.unsqueeze(2).expand(b, t, n, k)
    vmask = valid_mask.unsqueeze(-1).expand(b, t, n, k)
    mask = (hmask & vmask).to(lam.dtype)

    idx = torch.arange(k, device=hazard_logits.device).view(1, 1, 1, k)
    ev = event_bin.unsqueeze(-1)

    # Survived every bin strictly before the event bin. For censored rows
    # event_bin is -1, so `before` is all-True and the whole horizon counts
    # as survived — which is exactly the censored branch above.
    is_event = (~censored).unsqueeze(-1) & (idx == ev)
    before = torch.where(censored.unsqueeze(-1), torch.ones_like(is_event),
                         idx < ev)

    ll = before.to(lam.dtype) * log_surv + is_event.to(lam.dtype) * log_haz
    ll = ll * mask

    # Normalise by valid (node, tick) pairs, so mines of different size and
    # length contribute comparably (consistent with §7.2's mean-not-sum rule).
    denom = valid_mask.to(lam.dtype).sum().clamp_min(1.0)
    return -(ll.sum() / denom)


def spatial_smoothness(hazard_logits: torch.Tensor, edge_index: torch.Tensor,
                       edge_dist: torch.Tensor, valid_mask: torch.Tensor
                       ) -> torch.Tensor:
    """L_spatial (§7.2c): graph-adjacent nodes should agree, absent anomaly.

        L = (1/|E|) Σ_(i,j) 1/(1+dist_ij) · ‖λ_i - λ_j‖²

    Uses only fixed graph structure — positions, already known at inference —
    and never mine-specific physical parameters, so it leaks no simulator
    information into training (§7.1).

    Normalised by edge count (mean, not sum) per §7.2's scale-conflation fix:
    N varies per mine, so an unnormalised sum would let a large mine dominate
    the batch purely by having more edges, making the effective regularization
    weight drift batch-to-batch instead of staying stable.
    """
    src, dst = edge_index[0], edge_index[1]
    self_edge = src != dst          # self-loops carry no smoothness signal
    if not bool(self_edge.any()):
        return hazard_logits.sum() * 0.0

    src, dst = src[self_edge], dst[self_edge]
    dist = edge_dist[self_edge]

    lam = torch.sigmoid(hazard_logits)                    # (B, T, N, K)
    diff = lam[:, :, src, :] - lam[:, :, dst, :]          # (B, T, E, K)
    w = (1.0 / (1.0 + dist)).view(1, 1, -1, 1)

    # Only penalise where both endpoints are real, reported nodes.
    both = (valid_mask[:, :, src] & valid_mask[:, :, dst]).unsqueeze(-1)
    per_edge = (w * diff.pow(2) * both.to(lam.dtype)).sum(dim=-1)

    denom = both.squeeze(-1).to(lam.dtype).sum().clamp_min(1.0)
    return per_edge.sum() / denom


def temporal_smoothness(hazard_logits: torch.Tensor, gate: torch.Tensor,
                        novelty: torch.Tensor, valid_mask: torch.Tensor
                        ) -> torch.Tensor:
    """L_temporal (§7.2d): don't oscillate tick-to-tick without new evidence.

        L = (1/|node-ticks|) Σ g_i(t)·(1 - novelty_i(t))·‖λ_i(t) - λ_i(t-1)‖²

    The g_i(t) factor is REQUIRED (§7.2, stated fix). Without it the term is
    also computed on gated-shut ticks, where the hazard is already forced to
    decay(hazard(t-1)) by the gate itself — so the penalty is either wasted
    compute (if decay ≈ identity) or actively fights the intended decay. With
    it, the term only constrains ticks where the model actually ran and made
    a free choice about how far to move.

    Normalised by node-tick count for the same reason as L_spatial.
    """
    if hazard_logits.shape[1] < 2:
        return hazard_logits.sum() * 0.0

    lam = torch.sigmoid(hazard_logits)
    diff = (lam[:, 1:] - lam[:, :-1]).pow(2).sum(dim=-1)      # (B, T-1, N)

    g = gate[:, 1:, :, 0]                                     # (B, T-1, N)
    quiet = (1.0 - novelty[:, 1:]).clamp(0.0, 1.0)            # low novelty -> penalise
    m = (valid_mask[:, 1:] & valid_mask[:, :-1]).to(lam.dtype)

    num = (g * quiet * diff * m).sum()
    return num / m.sum().clamp_min(1.0)


def total_loss(hazard_logits: torch.Tensor, gate: torch.Tensor,
               novelty: torch.Tensor, event_bin: torch.Tensor,
               censored: torch.Tensor, valid_mask: torch.Tensor,
               horizon_mask: torch.Tensor, edge_index: torch.Tensor,
               edge_dist: torch.Tensor, cfg: Config
               ) -> tuple[torch.Tensor, dict[str, float]]:
    """L_total (§7.3).

        L = L_survival + λ_spatial·L_spatial + λ_temporal·L_temporal

    L_mono is absent by design: the §6 hazard head parameterization makes
    survival monotone by construction, so the penalty would be redundant
    (§7.2a explicitly says to add it only otherwise).
    """
    l_surv = survival_nll(hazard_logits, event_bin, censored, valid_mask,
                          horizon_mask, cfg)
    l_spat = spatial_smoothness(hazard_logits, edge_index, edge_dist, valid_mask)
    l_temp = temporal_smoothness(hazard_logits, gate, novelty, valid_mask)

    loss = l_surv + cfg.lambda_spatial * l_spat + cfg.lambda_temporal * l_temp
    return loss, {
        "loss": float(loss.detach()),
        "survival": float(l_surv.detach()),
        "spatial": float(l_spat.detach()),
        "temporal": float(l_temp.detach()),
    }
