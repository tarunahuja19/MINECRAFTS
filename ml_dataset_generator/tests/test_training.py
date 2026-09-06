"""Invariant tests for the training pipeline.

Each test maps to a property the implementation plan states explicitly and
asks to be checked rather than left for a future refactor to rediscover.

Run:  .venv-train/bin/python -m tests.test_training
"""

from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from training.config import CHANNELS, Config, smoke_config  # noqa: E402
from training.data import is_leakage_column, horizon_mask, time_to_bin  # noqa: E402
from training.graph import build_graph  # noqa: E402
from training.losses import survival_nll, total_loss  # noqa: E402
from training.model import (  # noqa: E402
    HazardModel,
    expm1_div,
    survival_from_hazard,
)

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  PASS  {name}")
    else:
        print(f"  FAIL  {name} {detail}")
        FAILURES.append(name)


# ---------------------------------------------------------------------------


def test_expm1_div_stability() -> None:
    """Plan §2.2: (exp(x)-1)/x must be finite and ~1 at x -> 0."""
    print("\n[1] expm1_div numerical stability (§2.2)")

    x = torch.tensor([0.0, 1e-12, -1e-12, 1e-8, -1e-8, 1e-5, -1e-5])
    y = expm1_div(x)
    check("finite near zero", bool(torch.isfinite(y).all()), f"got {y}")
    check("approx 1.0 at x=0", abs(float(y[0]) - 1.0) < 1e-6, f"got {float(y[0])}")

    # Away from zero it must agree with the direct form.
    xl = torch.tensor([0.5, -0.5, 2.0, -3.0, 5.0])
    direct = (torch.expm1(xl)) / xl
    check("matches direct form for large |x|",
          bool(torch.allclose(expm1_div(xl), direct, atol=1e-6)))

    # Gradients must not be NaN through the small-x branch — this is the
    # actual failure mode, since autograd propagates NaN through the untaken
    # side of a naive `where`.
    xg = torch.tensor([0.0, 1e-10, 1.0], requires_grad=True)
    expm1_div(xg).sum().backward()
    check("gradient finite through small-x branch",
          bool(torch.isfinite(xg.grad).all()), f"grad={xg.grad}")


def test_survival_monotone() -> None:
    """Plan §7.2(a): survival must be non-increasing in k, by construction."""
    print("\n[2] survival curve monotonicity (§7.2a)")
    torch.manual_seed(0)
    logits = torch.randn(4, 7, 12) * 5.0        # deliberately extreme
    s = survival_from_hazard(logits)
    diffs = s[..., 1:] - s[..., :-1]
    check("non-increasing in k", bool((diffs <= 1e-6).all()),
          f"max increase {float(diffs.max()):.3e}")
    check("within [0, 1]", bool(((s >= 0) & (s <= 1)).all()))


def test_mask_combination() -> None:
    """Plan §8: padding and horizon masks are disjoint and combine by product."""
    print("\n[3] mask combination invariant (§8)")
    cfg = Config()

    # Near the end of a sequence, later bins must fall outside the horizon.
    hm = horizon_mask(t_start=0, n_win=5, n_total=5, cfg=cfg)
    check("horizon mask shape", hm.shape == (5, cfg.n_bins), f"{hm.shape}")
    check("last tick masks all bins", not hm[-1].any())
    check("horizon shrinks monotonically over ticks",
          bool((hm.sum(axis=1)[1:] <= hm.sum(axis=1)[:-1]).all()))

    # Multiplicative combination must equal logical AND — i.e. they can be
    # combined without double-counting, which is the stated invariant.
    pad = np.array([[1, 1, 0], [1, 0, 0]], dtype=bool)
    hor = np.array([[1, 0, 1], [1, 1, 0]], dtype=bool)
    check("product == logical and",
          bool((( pad.astype(int) * hor.astype(int)).astype(bool) == (pad & hor)).all()))


def test_loss_finite_at_saturation() -> None:
    """Plan §6: clamped logs keep the loss finite when lambda saturates."""
    print("\n[4] loss finite under sigmoid saturation (§6)")
    cfg = Config()
    b, t, n, k = 1, 3, 4, cfg.n_bins

    for name, val in [("saturate high", 60.0), ("saturate low", -60.0)]:
        logits = torch.full((b, t, n, k), val)
        ev = torch.full((b, t, n), 2, dtype=torch.long)
        cen = torch.zeros(b, t, n, dtype=torch.bool)
        val_m = torch.ones(b, t, n, dtype=torch.bool)
        hm = torch.ones(b, t, k, dtype=torch.bool)
        loss = survival_nll(logits, ev, cen, val_m, hm, cfg)
        check(f"{name}: finite", bool(torch.isfinite(loss)), f"got {loss}")

    # Gradient must also be finite, not just the value.
    logits = torch.full((b, t, n, k), 60.0, requires_grad=True)
    ev = torch.full((b, t, n), 2, dtype=torch.long)
    cen = torch.zeros(b, t, n, dtype=torch.bool)
    val_m = torch.ones(b, t, n, dtype=torch.bool)
    hm = torch.ones(b, t, k, dtype=torch.bool)
    survival_nll(logits, ev, cen, val_m, hm, cfg).backward()
    check("gradient finite at saturation",
          bool(torch.isfinite(logits.grad).all()))

    # An all-censored batch must still produce a finite loss: 39 of the 100
    # mines in this dataset are fully censored, so this is a real case.
    cen_all = torch.ones(b, t, n, dtype=torch.bool)
    ev_none = torch.full((b, t, n), -1, dtype=torch.long)
    loss = survival_nll(torch.zeros(b, t, n, k), ev_none, cen_all, val_m, hm, cfg)
    check("all-censored batch finite", bool(torch.isfinite(loss)), f"got {loss}")


def test_feedback_path_option_a() -> None:
    """Plan §5: h' (post-GNN) must never flow into the next tick's h."""
    print("\n[5] feedback path is Option A (§5)")
    import inspect

    from training.model import SelectiveSSM

    # The SSM's signature is the structural guarantee: it only accepts
    # (x, h_prev), so there is no parameter through which h' could enter.
    params = list(inspect.signature(SelectiveSSM.forward).parameters)
    check("SSM.forward takes only (self, x, h_prev)",
          params == ["self", "x", "h_prev"], f"got {params}")

    src = inspect.getsource(HazardModel.forward)
    # h must be updated from the SSM output, never from h_prime.
    check("h never assigned from h_prime",
          "h = g * h_new" in src and "h = g * h_prime" not in src)
    check("h_prime is consumed by the head only",
          "self.head(h_prime)" in src)


def test_no_leakage_columns() -> None:
    """Plan §7.1: truth_* and spatial_weight must never reach features."""
    print("\n[6] leakage columns excluded (§7.1)")
    for col in ["truth_tilt_x_urad", "truth_strain_ue", "truth_subsidence_m",
                "truth_tilt_y_urad", "spatial_weight"]:
        check(f"{col} flagged as leakage", is_leakage_column(col))
    for col in ["tilt_x_urad", "die_temp_c", "pore_pressure_kpa"]:
        check(f"{col} allowed", not is_leakage_column(col))
    check("no leakage column in CHANNELS",
          not any(is_leakage_column(c) for c in CHANNELS))


def test_graph_self_loops() -> None:
    """Plan §4.1: every node needs a self-loop, even if isolated."""
    print("\n[7] graph self-loops guaranteed (§4.1)")
    cfg = Config()

    # Deliberately place one node far outside every radius.
    pos = np.array([[0, 0, 0], [10, 0, 0], [20, 0, 0], [99999, 0, 0]],
                   dtype=np.float32)
    tiers = np.array([0, 0, 0, 0], dtype=np.int64)
    ei, ed = build_graph(pos, tiers, cfg)

    for i in range(len(pos)):
        has_self = bool(((ei[0] == i) & (ei[1] == i)).any())
        check(f"node {i} has self-loop", has_self)
    isolated_edges = int((ei[1] == 3).sum())
    check("isolated node has exactly its self-loop", isolated_edges == 1,
          f"got {isolated_edges}")
    check("degree cap respected",
          all(int((ei[1] == i).sum()) <= cfg.max_degree for i in range(len(pos))))


def test_bin_assignment() -> None:
    """Hazard bins must be ordered and cover the observed ttc range."""
    print("\n[8] hazard bin assignment")
    cfg = Config()
    edges = np.array(cfg.hazard_bin_edges_hours)
    check("bin edges strictly increasing", bool((np.diff(edges) > 0).all()))
    check("K matches edge count", cfg.n_bins == len(edges))

    # 30 min -> bin 0; 100 h -> a late bin; beyond the last edge -> K.
    secs = np.array([0.0, 1800.0, 3600.0 * 100, 3600.0 * 1000])
    b = time_to_bin(secs, cfg)
    check("t=0 -> bin 0", b[0] == 0, f"got {b[0]}")
    check("30min -> bin 0", b[1] == 0, f"got {b[1]}")
    check("100h -> late bin", 8 <= b[2] < cfg.n_bins, f"got {b[2]}")
    check("beyond horizon -> K (treated as censored)", b[3] == cfg.n_bins,
          f"got {b[3]}")


def test_forward_and_backward() -> None:
    """End-to-end: model runs, loss is finite, gradients reach every stage."""
    print("\n[9] forward/backward smoke")
    cfg = replace(smoke_config(), d_model=8, hazard_hidden=8, gnn_edge_hidden=8)
    torch.manual_seed(0)

    n, t = 6, 5
    model = HazardModel(cfg)
    pos = np.random.RandomState(0).rand(n, 3).astype(np.float32) * 50
    tiers = np.array([0, 0, 1, 3, 4, 5], dtype=np.int64)
    ei_np, ed_np = build_graph(pos, tiers, cfg)

    from training.train import edge_features
    ei = torch.from_numpy(ei_np)
    ed = torch.from_numpy(ed_np)
    ef = torch.from_numpy(edge_features(ei_np, ed_np, tiers))

    x = torch.randn(1, t, n, cfg.input_width)
    state = model.init_state(1, n, torch.device("cpu"))
    hazard, gate, novelty, new_state = model(x, ei, ef, state, 0, 100)

    check("hazard shape", tuple(hazard.shape) == (1, t, n, cfg.n_bins),
          f"{tuple(hazard.shape)}")
    check("gate shape", tuple(gate.shape) == (1, t, n, 1), f"{tuple(gate.shape)}")
    check("gate in [0,1]", bool(((gate >= 0) & (gate <= 1)).all()))
    check("hazard finite", bool(torch.isfinite(hazard).all()))
    check("state carries forward", bool(torch.isfinite(new_state["h"]).all()))

    ev = torch.randint(0, cfg.n_bins, (1, t, n))
    cen = torch.rand(1, t, n) > 0.5
    ev = torch.where(cen, torch.full_like(ev, -1), ev)
    vm = torch.ones(1, t, n, dtype=torch.bool)
    hm = torch.ones(1, t, cfg.n_bins, dtype=torch.bool)

    loss, parts = total_loss(hazard, gate, novelty, ev, cen, vm, hm, ei, ed, cfg)
    check("total loss finite", bool(torch.isfinite(loss)), f"got {loss}")
    loss.backward()

    # Every stage must receive gradient — a stage with none is silently dead.
    for stage in ["ssm", "gnn", "head"]:
        mod = getattr(model, stage)
        grads = [p.grad for p in mod.parameters() if p.grad is not None]
        got = bool(grads) and any(float(g.abs().sum()) > 0 for g in grads)
        check(f"{stage} receives gradient", got)

    check("SSM A stays negative (stability)",
          bool((model.ssm.a_diag < 0).all()))


def test_gate_schedule() -> None:
    """Plan §3: temperature anneals by global step, and warm-up forces open."""
    print("\n[10] gate warm-up and step-indexed annealing (§3)")
    cfg = Config()
    model = HazardModel(cfg)
    g = model.gate

    total = 1000
    check("warm-up active at step 0", g.is_warmup(0, total))
    check("warm-up over by mid-training", not g.is_warmup(total // 2, total))

    temps = [g.temperature(s, total) for s in range(0, total, 100)]
    check("temperature non-increasing",
          all(temps[i] >= temps[i + 1] - 1e-9 for i in range(len(temps) - 1)),
          f"{[round(t, 3) for t in temps]}")
    check("ends near gate_temp_end",
          abs(g.temperature(total, total) - cfg.gate_temp_end) < 1e-6)

    # During warm-up the gate must be fully open so gradient reaches the
    # recurrence — this is the gradient-starvation fix, not a nicety.
    score = torch.tensor([[0.0, 10.0]])
    open_g = g(score, 0, total, training=True)
    check("warm-up gate fully open", bool((open_g == 1.0).all()))

    # At inference the gate must be hard 0/1, since the compute saving
    # depends on a real skip rather than a blend.
    hard = g(score, total, total, training=False)
    check("inference gate is hard 0/1",
          bool(((hard == 0) | (hard == 1)).all()), f"got {hard.flatten()}")


def test_concordance_index() -> None:
    """C-index: ranks observed events by risk, ignores censored-censored pairs."""
    from training.metrics import ConcordanceAccumulator, concordance_index

    print("\n[11] concordance index (README: don't judge on loss alone)")
    # node 0 collapses in bin 1, node 1 censored. High-risk logits on node 0.
    logits = torch.zeros(1, 1, 2, 4)
    logits[0, 0, 0, :] = 4.0
    logits[0, 0, 1, :] = -4.0
    ev = torch.tensor([[[1, -1]]])
    cen = torch.tensor([[[False, True]]])
    val = torch.ones(1, 1, 2, dtype=torch.bool)
    c, n_pairs = concordance_index(logits, ev, cen, val)
    check("perfect ranking -> C = 1", c == 1.0 and n_pairs == 1, f"got {c}")
    c_bad, _ = concordance_index(-logits, ev, cen, val)
    check("inverted ranking -> C = 0", c_bad == 0.0, f"got {c_bad}")

    # fully censored -> no comparable pair, NaN not a crash
    cen_all = torch.ones(1, 1, 2, dtype=torch.bool)
    c_nan, n0 = concordance_index(logits, ev, cen_all, val)
    check("fully censored -> NaN, 0 pairs", np.isnan(c_nan) and n0 == 0)

    acc = ConcordanceAccumulator()
    acc.update(logits, ev, cen, val)
    acc.update(logits, ev, cen_all, val)   # contributes nothing
    pooled, pairs = acc.compute()
    check("accumulator pools pair counts", pooled == 1.0 and pairs == 1,
          f"got {pooled}, {pairs}")


def main() -> int:
    print("=" * 68)
    print("Training pipeline invariants (plan_1_patched.md)")
    print("=" * 68)

    test_expm1_div_stability()
    test_survival_monotone()
    test_mask_combination()
    test_loss_finite_at_saturation()
    test_feedback_path_option_a()
    test_no_leakage_columns()
    test_graph_self_loops()
    test_bin_assignment()
    test_forward_and_backward()
    test_gate_schedule()
    test_concordance_index()

    print("\n" + "=" * 68)
    if FAILURES:
        print(f"FAILED ({len(FAILURES)}): {', '.join(FAILURES)}")
        return 1
    print("All invariants passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
