"""Training loop (plan Section 8).

Batching is at the MINE level: one training example is one mine's full node
set over its full tick sequence. Because mines have different N and T, each
mine is processed on its own (batch dim 1) and gradients are accumulated
across `batch_mines` mines before stepping — this gives the plan's mine-level
batch semantics without padding every mine to the batch maximum, which at
N=82 / T=20035 would waste most of the tensor on padding.

Hidden state is hard-reset to zero at every mine boundary (§2.3) and carried
forward, detached, across truncated-BPTT windows within a mine.

Usage:
    .venv-train/bin/python -m training.train --smoke
    .venv-train/bin/python -m training.train --epochs 2 --limit 10
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import asdict, replace

import numpy as np
import torch

from .config import N_TIERS, Config, smoke_config
from .data import (
    Mine,
    cache_path,
    horizon_mask,
    iter_windows,
    list_mines,
    load_cached,
    load_mine,
    split_mines,
)
from .graph import build_graph
from .losses import total_loss
from .metrics import ConcordanceAccumulator
from .model import HazardModel, detach_state


def pick_device(name: str) -> torch.device:
    if name != "auto":
        return torch.device(name)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def edge_features(edge_index: np.ndarray, edge_dist: np.ndarray,
                  tier_ids: np.ndarray) -> np.ndarray:
    """Static per-edge features: log-distance + src/dst tier one-hots.

    Distance enters as log1p so the 15 m scout spacing and the 400 m gateway
    radius occupy a comparable dynamic range instead of the former being
    numerically invisible next to the latter.
    """
    src, dst = edge_index[0], edge_index[1]
    e = len(src)
    log_d = np.log1p(edge_dist).reshape(e, 1).astype(np.float32)
    src_oh = np.zeros((e, N_TIERS), dtype=np.float32)
    dst_oh = np.zeros((e, N_TIERS), dtype=np.float32)
    src_oh[np.arange(e), tier_ids[src]] = 1.0
    dst_oh[np.arange(e), tier_ids[dst]] = 1.0
    return np.concatenate([log_d, src_oh, dst_oh], axis=1)


class MineStore:
    """Loads mines from cache when present, else straight from parquet."""

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.norm = self._load_norm()

    def _load_norm(self):
        path = os.path.join(self.cfg.cache_dir, f"norm_s{self.cfg.tick_stride}.npz")
        if os.path.exists(path):
            z = np.load(path)
            return z["mean"], z["std"]
        return None

    def get(self, mine_id: str) -> Mine:
        cached = cache_path(self.cfg, mine_id)
        if os.path.exists(cached):
            mine = load_cached(cached)
        else:
            mine = load_mine(os.path.join(self.cfg.dataset_dir, mine_id), self.cfg)
        if self.norm is not None:
            from .data import apply_norm
            mine.features = apply_norm(mine.features, *self.norm)
        return mine


def run_mine(model: HazardModel, mine: Mine, cfg: Config, device: torch.device,
             step: int, total_steps: int, train: bool,
             cindex: ConcordanceAccumulator | None = None
             ) -> tuple[torch.Tensor | None, dict[str, float]]:
    """Forward (and optionally backward) one mine, window by window.

    Returns the summed loss for logging plus its components. When `train` is
    True the backward pass runs per window, so the graph for a window is freed
    before the next one is built — this is what keeps a 20k-tick mine inside
    memory.

    When `cindex` is supplied, each window's hazard predictions are fed into
    the concordance accumulator (measurement only — no gradient).
    """
    edge_index_np, edge_dist_np = build_graph(mine.positions, mine.tier_ids, cfg)
    edge_index = torch.from_numpy(edge_index_np).to(device)
    edge_dist = torch.from_numpy(edge_dist_np).to(device)
    edge_feat = torch.from_numpy(
        edge_features(edge_index_np, edge_dist_np, mine.tier_ids)
    ).to(device)

    state = model.init_state(1, mine.n_nodes, device)   # hard reset (§2.3)
    totals: dict[str, float] = {}
    n_windows = 0

    for win in iter_windows(mine, cfg):
        x = torch.from_numpy(win.features).unsqueeze(0).to(device)
        ev = torch.from_numpy(win.event_bin).unsqueeze(0).to(device)
        cen = torch.from_numpy(win.censored).unsqueeze(0).to(device)
        val = torch.from_numpy(win.valid).unsqueeze(0).to(device)

        hm = horizon_mask(win.t_start, win.t_end - win.t_start,
                          mine.n_ticks, cfg)
        hmask = torch.from_numpy(hm).unsqueeze(0).to(device)

        if not val.any():
            state = detach_state(state)
            continue

        hazard, gate, novelty, state = model(
            x, edge_index, edge_feat, state, step, total_steps
        )
        loss, parts = total_loss(hazard, gate, novelty, ev, cen, val, hmask,
                                 edge_index, edge_dist, cfg)

        if train:
            loss.backward()
        if cindex is not None:
            cindex.update(hazard.detach(), ev, cen, val)
        # Values carry forward; only the gradient path is cut (truncated BPTT).
        state = detach_state(state)

        for k, v in parts.items():
            totals[k] = totals.get(k, 0.0) + v
        n_windows += 1

    if n_windows == 0:
        return None, {}
    return None, {k: v / n_windows for k, v in totals.items()}


def evaluate(model: HazardModel, store: MineStore, mine_ids: list[str],
             cfg: Config, device: torch.device, step: int, total_steps: int
             ) -> dict[str, float]:
    model.eval()
    agg: dict[str, float] = {}
    n = 0
    cindex = ConcordanceAccumulator()
    with torch.no_grad():
        for mid in mine_ids:
            _, parts = run_mine(model, store.get(mid), cfg, device, step,
                                total_steps, train=False, cindex=cindex)
            if not parts:
                continue
            for k, v in parts.items():
                agg[k] = agg.get(k, 0.0) + v
            n += 1
    model.train()
    out = {k: v / max(n, 1) for k, v in agg.items()}
    c, n_pairs = cindex.compute()
    out["c_index"] = c
    out["c_index_pairs"] = float(n_pairs)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--smoke", action="store_true",
                    help="tiny fast run that proves the pipeline works")
    ap.add_argument("--epochs", type=int, default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--stride", type=int, default=None)
    ap.add_argument("--tbptt", type=int, default=None)
    ap.add_argument("--device", default=None)
    ap.add_argument("--resume", default=None)
    args = ap.parse_args()

    cfg = smoke_config() if args.smoke else Config()
    over = {}
    if args.epochs is not None:
        over["epochs"] = args.epochs
    if args.limit is not None:
        over["limit_mines"] = args.limit
    if args.stride is not None:
        over["tick_stride"] = args.stride
    if args.tbptt is not None:
        over["tbptt_len"] = args.tbptt
    if args.device:
        over["device"] = args.device
    cfg = replace(cfg, **over)

    torch.manual_seed(cfg.seed)
    np.random.seed(cfg.seed)
    device = pick_device(cfg.device)

    mine_ids = [os.path.basename(p) for p in list_mines(cfg)]
    splits = split_mines(mine_ids, cfg)
    store = MineStore(cfg)

    print(f"device={device}  mines={len(mine_ids)}  "
          f"train/val/test={len(splits['train'])}/{len(splits['val'])}/"
          f"{len(splits['test'])}")
    print(f"stride={cfg.tick_stride} tbptt={cfg.tbptt_len} d={cfg.d_model} "
          f"K={cfg.n_bins} m={cfg.input_width}")
    if store.norm is None:
        # Not a warning: raw readings span ~1e4 (tilt in urad) against ~1e-3
        # (accel in g), and training on that scale produces a loss two orders
        # of magnitude off with no other symptom. Refuse rather than emit a
        # number someone might believe.
        raise SystemExit(
            f"No normalization stats for stride {cfg.tick_stride}.\n"
            f"Run:  .venv-train/bin/python -m training.prepare_cache "
            f"--stride {cfg.tick_stride}"
            + (f" --limit {cfg.limit_mines}" if cfg.limit_mines else "")
        )

    model = HazardModel(cfg).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"parameters: {n_params:,}")

    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr,
                            weight_decay=cfg.weight_decay)

    start_epoch = 0
    if args.resume and os.path.exists(args.resume):
        ck = torch.load(args.resume, map_location=device)
        model.load_state_dict(ck["model"])
        opt.load_state_dict(ck["optim"])
        start_epoch = ck["epoch"] + 1
        print(f"resumed from {args.resume} at epoch {start_epoch}")

    train_ids = splits["train"]
    steps_per_epoch = max(len(train_ids) // cfg.batch_mines, 1)
    total_steps = steps_per_epoch * cfg.epochs
    os.makedirs(cfg.checkpoint_dir, exist_ok=True)

    step = start_epoch * steps_per_epoch
    history = []
    best_c = float("-inf")
    best_epoch = -1
    epochs_since_best = 0

    for epoch in range(start_epoch, cfg.epochs):
        order = np.random.permutation(len(train_ids))
        epoch_stats: dict[str, float] = {}
        n_seen = 0
        t0 = time.time()
        opt.zero_grad(set_to_none=True)

        for i, idx in enumerate(order):
            mine = store.get(train_ids[idx])
            _, parts = run_mine(model, mine, cfg, device, step, total_steps,
                                train=True)
            if parts:
                for k, v in parts.items():
                    epoch_stats[k] = epoch_stats.get(k, 0.0) + v
                n_seen += 1

            # Accumulate over `batch_mines` mines, then step. This is the
            # mine-level batching of §8 without padding to the batch max.
            if (i + 1) % cfg.batch_mines == 0 or i == len(order) - 1:
                torch.nn.utils.clip_grad_norm_(model.parameters(), cfg.grad_clip)
                opt.step()
                opt.zero_grad(set_to_none=True)
                step += 1

            if cfg.log_every and n_seen and n_seen % cfg.log_every == 0:
                cur = {k: v / n_seen for k, v in epoch_stats.items()}
                print(f"  epoch {epoch} mine {n_seen}/{len(order)} "
                      f"loss={cur.get('loss', 0):.4f} "
                      f"surv={cur.get('survival', 0):.4f} "
                      f"spat={cur.get('spatial', 0):.2e} "
                      f"temp={cur.get('temporal', 0):.2e}")

        train_stats = {k: v / max(n_seen, 1) for k, v in epoch_stats.items()}
        val_stats = evaluate(model, store, splits["val"], cfg, device, step,
                             total_steps)
        dt = time.time() - t0
        val_c = val_stats.get("c_index", float("nan"))
        print(f"epoch {epoch}: train_loss={train_stats.get('loss', 0):.4f} "
              f"val_loss={val_stats.get('loss', float('nan')):.4f} "
              f"val_C={val_c:.4f} "
              f"(pairs={int(val_stats.get('c_index_pairs', 0))}) ({dt:.1f}s)")

        history.append({"epoch": epoch, "train": train_stats, "val": val_stats})
        ck_path = os.path.join(cfg.checkpoint_dir, f"epoch_{epoch:03d}.pt")
        torch.save({"model": model.state_dict(), "optim": opt.state_dict(),
                    "epoch": epoch, "config": asdict(cfg),
                    "train": train_stats, "val": val_stats}, ck_path)

        # Track best by concordance, not loss (see config.early_stop_patience).
        improved = np.isfinite(val_c) and val_c > best_c + cfg.early_stop_min_delta
        if improved:
            best_c, best_epoch, epochs_since_best = val_c, epoch, 0
            best_path = os.path.join(cfg.checkpoint_dir, "best.pt")
            torch.save({"model": model.state_dict(), "optim": opt.state_dict(),
                        "epoch": epoch, "config": asdict(cfg),
                        "train": train_stats, "val": val_stats}, best_path)
            print(f"  new best val_C={best_c:.4f} -> best.pt")
        else:
            epochs_since_best += 1

        with open(os.path.join(cfg.checkpoint_dir, "history.json"), "w") as f:
            json.dump(history, f, indent=2)

        if cfg.early_stop_patience and epochs_since_best >= cfg.early_stop_patience:
            print(f"\nearly stop: no val_C improvement for "
                  f"{cfg.early_stop_patience} epochs "
                  f"(best epoch {best_epoch}, val_C={best_c:.4f})")
            break

    print(f"\ndone. checkpoints in {cfg.checkpoint_dir}")
    if best_epoch >= 0:
        print(f"best epoch: {best_epoch} (val_C={best_c:.4f}) -> "
              f"{os.path.join(cfg.checkpoint_dir, 'best.pt')}")


if __name__ == "__main__":
    main()
