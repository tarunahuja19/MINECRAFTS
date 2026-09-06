"""The four-stage model (plan Sections 2, 3, 4, 6).

Kept as four separate, clearly-named modules matching the §7.4 split exactly,
because that separation is a deliberate architectural choice and should be
visible in the code structure rather than only in the math:

    SelectiveSSM  -> temporal representation, per node, from sensor history
    ComputeGate   -> novelty gating, per node per tick
    SpatialGNN    -> spatial interaction, per tick, across nodes
    HazardHead    -> failure risk, per node, from the corrected embedding
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from .config import N_CHANNELS, N_TIERS, Config


# ---------------------------------------------------------------------------
# Section 2.2 — numerically stable ZOH helper
# ---------------------------------------------------------------------------


def expm1_div(x: torch.Tensor, eps: float = 1e-4) -> torch.Tensor:
    """(exp(x) - 1) / x, evaluated stably near x = 0.

    Plan §2.2 (required): the naive ZOH form for B̄ needs A invertible, and a
    diagonal HiPPO-style A has channels that start — or drift during training
    — near zero, so `(exp(x)-1)/x` divides by ~0 and produces inf/NaN. The
    small-|x| branch is a 3-term Taylor expansion, and `torch.where` keeps the
    whole thing differentiable and vectorised.

    Note the double-where: the branch must also sanitise the denominator on
    the *unused* side, because autograd propagates NaN through the untaken
    branch of a `where` if that branch's value is non-finite.
    """
    safe_x = torch.where(x.abs() > eps, x, torch.ones_like(x))
    large = torch.expm1(safe_x) / safe_x
    small = 1.0 + x / 2.0 + x * x / 6.0
    return torch.where(x.abs() > eps, large, small)


class SelectiveSSM(nn.Module):
    """Per-node selective SSM (plan §2.2).

    S4-style with scalar-per-channel state: A is diagonal, so Δ, B and C are
    all d-dimensional vectors and every product below is elementwise. There is
    deliberately NO separate expanded state dimension N — that would be the
    S6/full-Mamba parameterization, which §2.2 explicitly rules out.

    A is a fixed learned parameter, NOT a function of x. Only Δ, B and C are
    input-dependent. Weights are shared across every node in every mine: this
    is one module instance called per node per tick, not N separate models.
    """

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        d, m = cfg.d_model, cfg.input_width

        # Input projections for the selective (input-dependent) terms.
        # NOTE (plan §2.1): the tier one-hot lives in the last channels of x
        # and must survive this projection rather than being summed away —
        # it is the only thing distinguishing a structurally zero-padded
        # channel from a genuine near-zero reading. A plain Linear can learn
        # to route on it because each output channel gets its own weights
        # over the indicator dims; keep it that way if this is ever swapped
        # for something that mixes inputs before projection.
        self.proj_delta = nn.Linear(m, d)
        self.proj_b = nn.Linear(m, d)
        self.proj_c = nn.Linear(m, d)
        self.proj_x = nn.Linear(m, d)

        # Diagonal A, negative real part (HiPPO-style init) so that
        # Ā = exp(Δ·A) stays bounded for every Δ > 0. Stored as log(-A) so A
        # cannot cross zero during training and flip the system unstable.
        a = torch.empty(d).uniform_(cfg.a_init_min, cfg.a_init_max)
        self.log_neg_a = nn.Parameter(torch.log(-a))

    @property
    def a_diag(self) -> torch.Tensor:
        return -torch.exp(self.log_neg_a)

    def forward(self, x: torch.Tensor, h_prev: torch.Tensor) -> torch.Tensor:
        """One tick of the recurrence.

        Args:
            x:      (B, N, m) input features at this tick
            h_prev: (B, N, d) previous SSM state
        Returns:
            h:      (B, N, d) new SSM state

        This module only ever sees (h_prev, x) — never h' (the post-GNN
        readout). That is plan §5 Option A, and keeping the signature this
        narrow is what makes the constraint impossible to violate by accident.
        """
        a = self.a_diag                                   # (d,)
        delta = F.softplus(self.proj_delta(x))            # (B, N, d), > 0
        b = self.proj_b(x)
        u = self.proj_x(x)

        da = delta * a                                    # (B, N, d)
        a_bar = torch.exp(da)
        b_bar = expm1_div(da, self.cfg.expm1_div_eps) * delta * b
        return a_bar * h_prev + b_bar * u

    def readout(self, x: torch.Tensor, h: torch.Tensor) -> torch.Tensor:
        """C(t)-projected readout of the state."""
        return self.proj_c(x) * h


# ---------------------------------------------------------------------------
# Section 3 — compute gate
# ---------------------------------------------------------------------------


class ComputeGate(nn.Module):
    """Novelty gate in front of the SSM+GNN pass (plan §3).

    Gating is PER-NODE ([OPEN] choice, see config): nodes become novel at
    independent times, so a mine-global gate would either waste compute on
    quiet nodes or shut a genuinely novel one because the mine was calm on
    average.

    Two mechanisms exist specifically to prevent gradient starvation through
    the gate, and both are required (§3):
      1. Warm-up — the gate is forced fully open for the first
         `gate_warmup_frac` of training, so the SSM learns real dynamics and
         a meaningful baseline before anything is skipped.
      2. Soft gate — after warm-up, training uses a differentiable sigmoid
         relaxation so gradient still flows through the low-side branch,
         annealed toward hard behaviour. Inference always uses the hard
         threshold, since the compute saving depends on the real skip.

    The temperature is annealed by GLOBAL OPTIMIZER STEP, never by epoch
    (§3, required): hidden state resets at every mine boundary and T varies
    per mine, so an epoch-indexed schedule would make a mine's effective
    temperature depend on batch ordering — a silent reproducibility hazard
    rather than a crash.
    """

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg

    def temperature(self, step: int, total_steps: int) -> float:
        warmup = int(self.cfg.gate_warmup_frac * total_steps)
        span = max(total_steps - warmup, 1)
        frac = min(max((step - warmup) / span, 0.0), 1.0)
        t0, t1 = self.cfg.gate_temp_start, self.cfg.gate_temp_end
        return t0 * (t1 / t0) ** frac          # geometric anneal

    def is_warmup(self, step: int, total_steps: int) -> bool:
        return step < int(self.cfg.gate_warmup_frac * total_steps)

    def novelty(self, x: torch.Tensor, baseline: torch.Tensor,
                scale: torch.Tensor) -> torch.Tensor:
        """Per-node deviation of the current reading from its rolling baseline.

        Returns (B, N), a robust z-score style distance.

        Two details matter here, and getting either wrong silently disables
        the gate:

        1. Reduce with MAX over channels, not mean. A collapse precursor
           shows up in a handful of channels (tilt, strain) while the other
           ~20 sit quiet; averaging buries that spike under the quiet
           majority, so a genuinely novel node never scores much above a calm
           one. Max asks "is ANY channel behaving unusually", which is the
           actual question the gate is for.
        2. Only count channels the node actually carries. Structurally absent
           channels are zero-filled (§2.1), so their deviation is a constant
           zero that would drag a mean down and can never be novel.

        `scale` is an EMA of |x - baseline|, so this is a deviation measured
        in units of that channel's own typical movement — roughly a z-score.
        A quiet channel sits near 1.0 and a spiking one goes well above it.
        """
        dev = (x - baseline).abs() / scale.clamp_min(1e-3)
        # Presence bits occupy channels [N_CHANNELS : 2*N_CHANNELS] of x when
        # the mask is enabled; a channel is real where its bit is set.
        n_ch = N_CHANNELS
        if x.shape[-1] >= 2 * n_ch:
            present = x[..., n_ch:2 * n_ch] > 0.5
            dev = dev[..., :n_ch].masked_fill(~present, 0.0)
        return dev.amax(dim=-1)

    def forward(self, score: torch.Tensor, step: int, total_steps: int,
                training: bool) -> torch.Tensor:
        """Gate openness g in [0, 1], shape (B, N, 1).

        Warm-up and training use soft/open values so gradient reaches the
        recurrence; inference hardens to the 0/1 threshold from §3.
        """
        if training and self.is_warmup(step, total_steps):
            return torch.ones_like(score).unsqueeze(-1)
        if training:
            temp = self.temperature(step, total_steps)
            return torch.sigmoid((score - self.cfg.gate_tau) / temp).unsqueeze(-1)
        return (score >= self.cfg.gate_tau).to(score.dtype).unsqueeze(-1)


# ---------------------------------------------------------------------------
# Section 4.2 / 4.3 — spatial GNN
# ---------------------------------------------------------------------------


class SpatialGNN(nn.Module):
    """Message passing over the fixed per-mine graph (plan §4.2, §4.3).

    Aggregation is a softmax-normalised weighted AVERAGE, not a raw weighted
    sum (§4.2, required fix): a raw sum makes message magnitude scale with
    neighbour count, which breaks generalisation across mines of different
    node density — the exact cross-mine goal of §1.

    w_ij is a learned function of (distance, tier_i, tier_j, staleness), not a
    hand-picked formula, so training can decide how much an anchor neighbour
    should matter relative to a scout one.
    """

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        d = cfg.d_model
        n_tiers = N_TIERS

        # Edge scorer inputs: log-distance, src tier one-hot, dst tier one-hot,
        # and (optionally) the source node's gate openness as a staleness cue.
        edge_in = 1 + 2 * n_tiers + (1 if cfg.gnn_use_staleness else 0)
        self.edge_mlp = nn.Sequential(
            nn.Linear(edge_in, cfg.gnn_edge_hidden),
            nn.ReLU(),
            nn.Linear(cfg.gnn_edge_hidden, 1),
        )
        # GRU-style gated combine of centre state with aggregated message
        # ([OPEN] — either MLP or GRU is acceptable per §4.3; GRU chosen so
        # the node can learn to ignore an uninformative neighbourhood).
        self.update = nn.GRUCell(d, d)

    def forward(self, h: torch.Tensor, edge_index: torch.Tensor,
                edge_feat: torch.Tensor, gate: torch.Tensor | None) -> torch.Tensor:
        """Run k hops of message passing.

        Args:
            h:          (B, N, d) per-node SSM state at this tick
            edge_index: (2, E) rows (src, dst)
            edge_feat:  (E, F) static edge features (log-dist + tier one-hots)
            gate:       (B, N, 1) gate openness, or None
        Returns:
            h_prime:    (B, N, d) post-GNN readout — a PURE READ-OUT that is
                        never written back into the SSM state (plan §5).
        """
        b, n, d = h.shape
        src, dst = edge_index[0], edge_index[1]

        feats = edge_feat.unsqueeze(0).expand(b, -1, -1)          # (B, E, F)
        if self.cfg.gnn_use_staleness and gate is not None:
            # [OPEN — CHOSEN] option (a) from §4.2: let attention see how
            # fresh each neighbour's state is. Without this a gated-shut
            # neighbour's stale identity-carried h_j would receive exactly
            # the same weight as a freshly-computed one, silently dominating
            # the aggregate with old information and leaving no signal
            # anywhere in the model that it happened.
            stale = gate[:, src, 0].unsqueeze(-1)                 # (B, E, 1)
            feats = torch.cat([feats, stale], dim=-1)

        logits = self.edge_mlp(feats).squeeze(-1)                 # (B, E)

        h_cur = h
        for _ in range(self.cfg.gnn_hops):
            # Softmax over each destination node's in-edges. Every node has a
            # self-loop (§4.1), so this is never a softmax over an empty set.
            a = _segment_softmax(logits, dst, n)                  # (B, E)
            msg = h_cur[:, src, :] * a.unsqueeze(-1)              # (B, E, d)
            agg = torch.zeros_like(h_cur)
            agg.index_add_(1, dst, msg)
            h_cur = self.update(
                agg.reshape(b * n, d), h_cur.reshape(b * n, d)
            ).reshape(b, n, d)
        return h_cur


def _segment_softmax(logits: torch.Tensor, index: torch.Tensor,
                     n_segments: int) -> torch.Tensor:
    """Softmax of `logits` grouped by destination `index`. Shapes (B, E)."""
    b = logits.shape[0]
    max_per = torch.full((b, n_segments), float("-inf"), device=logits.device,
                         dtype=logits.dtype)
    max_per = max_per.index_reduce(1, index, logits, "amax", include_self=True)
    centred = logits - max_per[:, index]
    exp = centred.exp()
    denom = torch.zeros((b, n_segments), device=logits.device, dtype=logits.dtype)
    denom.index_add_(1, index, exp)
    return exp / denom[:, index].clamp_min(1e-12)


# ---------------------------------------------------------------------------
# Section 6 — hazard head
# ---------------------------------------------------------------------------


class HazardHead(nn.Module):
    """Discrete-time hazard head (plan §6, the recommended formulation).

    Emits per-bin hazard logits; the survival curve is the running product of
    (1 - λ). Because λ = sigmoid(·) ∈ (0, 1), survival is monotonically
    non-increasing in k and hazard is non-negative BY CONSTRUCTION — which is
    exactly why the §7.2(a) monotonicity and §7.2(b) non-negativity penalties
    are correctly omitted from the loss rather than added as redundant terms.
    """

    def __init__(self, cfg: Config):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(cfg.d_model, cfg.hazard_hidden),
            nn.ReLU(),
            nn.Linear(cfg.hazard_hidden, cfg.n_bins),
        )
        # Bias the output toward LOW hazard at init. A default-initialised
        # final layer starts every bin at lambda = 0.5, i.e. "a coin flip that
        # this node collapses in this bin" -- across K bins that asserts
        # near-certain imminent collapse everywhere, which is a terrible prior
        # and sits far from the data (75% of node-labels here are censored).
        # Starting near the base rate puts the head in the right regime
        # immediately rather than making it climb out of a bad plateau.
        nn.init.constant_(self.net[-1].bias, cfg.hazard_bias_init)

    def forward(self, h_prime: torch.Tensor) -> torch.Tensor:
        """(B, N, d) -> (B, N, K) hazard logits."""
        return self.net(h_prime)


def survival_from_hazard(hazard_logits: torch.Tensor) -> torch.Tensor:
    """S(t+k | t) = prod_{j<=k} (1 - λ_j), from logits. (…, K) -> (…, K)."""
    lam = torch.sigmoid(hazard_logits)
    return torch.cumprod(1.0 - lam, dim=-1)


# ---------------------------------------------------------------------------
# Assembled model
# ---------------------------------------------------------------------------


class HazardModel(nn.Module):
    """The four stages wired together, one tick at a time."""

    def __init__(self, cfg: Config):
        super().__init__()
        self.cfg = cfg
        self.ssm = SelectiveSSM(cfg)
        self.gate = ComputeGate(cfg)
        self.gnn = SpatialGNN(cfg)
        self.head = HazardHead(cfg)

    def forward(self, x: torch.Tensor, edge_index: torch.Tensor,
                edge_feat: torch.Tensor, state: dict, step: int,
                total_steps: int
                ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, dict]:
        """Run one truncated-BPTT window.

        Args:
            x:     (B, T, N, m) window features
            state: dict carrying h, baseline, scale, prev hazard logits.
                   Reset to zeros at mine boundaries (plan §2.3); carried
                   forward (detached) across windows within a mine.
        Returns:
            hazard_logits: (B, T, N, K)
            gate_values:   (B, T, N, 1) — reused by L_temporal (§7.2d)
            novelty:       (B, T, N)    — the same score the gate used, reused
                                          as L_temporal's down-weighting factor
            state:         updated, ready for the next window
        """
        b, t, n, _ = x.shape
        h = state["h"]
        baseline = state["baseline"]
        scale = state["scale"]
        prev_lam = state["hazard"]      # carried as PROBABILITY, not logits

        out_hazard, out_gate, out_novelty = [], [], []
        mom = self.cfg.gate_baseline_momentum

        for ti in range(t):
            xt = x[:, ti]                                     # (B, N, m)

            score = self.gate.novelty(xt, baseline, scale)    # (B, N)
            g = self.gate(score, step, total_steps, self.training)

            # SSM state update, blended by the gate. A shut gate carries the
            # previous state through unchanged (identity carry, §3).
            h_new = self.ssm(xt, h)
            h = g * h_new + (1.0 - g) * h

            # GNN is a pure read-out: h' feeds the head and is discarded,
            # never written back into h (plan §5, Option A).
            h_prime = self.gnn(h, edge_index, edge_feat, g)

            hz_new = self.head(h_prime)
            # Gated-shut ticks reuse a decayed copy of the last output (§3).
            #
            # decay() MUST act in probability space, not on logits. Shrinking
            # a logit toward 0 drives lambda toward 0.5 -- maximum uncertainty
            # -- which is the opposite of "risk fades", and it is a strong
            # attractor: it pulls the head's output to zero and flattens the
            # loss at the lambda=0.5 plateau. Decaying the probability sends
            # lambda toward 0, which is what "no new evidence, risk ages out"
            # actually means. Blending is therefore done on probabilities and
            # mapped back to logits for the head's output contract.
            eps = self.cfg.log_eps
            lam_new = torch.sigmoid(hz_new)
            lam = g * lam_new + (1.0 - g) * (prev_lam * self.cfg.hazard_decay)
            lam = lam.clamp(eps, 1.0 - eps)
            hz = torch.log(lam) - torch.log1p(-lam)
            prev_lam = lam

            # Rolling baseline/scale for the next tick's novelty score.
            baseline = baseline + mom * (xt - baseline)
            scale = scale + mom * ((xt - baseline).abs() - scale)

            out_hazard.append(hz)
            out_gate.append(g)
            # Normalised into [0, 1] so L_temporal's (1 - novelty) weight is
            # a sensible "how quiet was this tick" factor rather than an
            # unbounded score.
            out_novelty.append(torch.tanh(score / self.cfg.gate_tau))

        new_state = {
            "h": h,
            "baseline": baseline,
            "scale": scale,
            "hazard": prev_lam,
        }
        return (
            torch.stack(out_hazard, 1),
            torch.stack(out_gate, 1),
            torch.stack(out_novelty, 1),
            new_state,
        )

    def init_state(self, b: int, n: int, device, dtype=torch.float32) -> dict:
        """Zero state at a mine boundary (plan §2.3 — a hard reset).

        Never carried across mines. This is enforced by the training loop
        calling this at each mine's first window, not learned by the model.
        """
        return {
            "h": torch.zeros(b, n, self.cfg.d_model, device=device, dtype=dtype),
            "baseline": torch.zeros(b, n, self.cfg.input_width, device=device,
                                    dtype=dtype),
            "scale": torch.ones(b, n, self.cfg.input_width, device=device,
                                dtype=dtype),
            # Carried as a PROBABILITY (see the decay note in forward), so
            # zero here means "no prior risk", not lambda = 0.5.
            "hazard": torch.zeros(b, n, self.cfg.n_bins, device=device,
                                  dtype=dtype),
        }


def detach_state(state: dict) -> dict:
    """Cut the autograd graph at a truncated-BPTT window boundary.

    Values carry FORWARD so the model still sees the full sequence; only the
    gradient path is truncated.
    """
    return {k: v.detach() for k, v in state.items()}
