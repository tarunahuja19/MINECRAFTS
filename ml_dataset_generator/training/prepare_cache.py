"""One-time preprocessing: parquet -> normalized .npz cache.

Reading 100 mines of parquet and re-deriving the feature schema every epoch
is wasteful, so this runs once and writes dense arrays the training loop can
memory-map cheaply.

Normalization statistics are computed from TRAIN mines only and stored
alongside the cache, so val/test never influence the scaling.

Usage:
    .venv-train/bin/python -m training.prepare_cache --limit 6
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import replace

import numpy as np

from .config import Config
from .data import (
    apply_norm,
    cache_path,
    compute_norm_stats,
    list_mines,
    load_mine,
    save_mine,
    split_mines,
)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--limit", type=int, default=None,
                    help="only process the first N mines (debug)")
    ap.add_argument("--stride", type=int, default=None,
                    help="tick stride; default is the config value (1)")
    ap.add_argument("--dataset-dir", default=None)
    ap.add_argument("--cache-dir", default=None)
    args = ap.parse_args()

    overrides = {}
    if args.limit is not None:
        overrides["limit_mines"] = args.limit
    if args.stride is not None:
        overrides["tick_stride"] = args.stride
    if args.dataset_dir:
        overrides["dataset_dir"] = args.dataset_dir
    if args.cache_dir:
        overrides["cache_dir"] = args.cache_dir
    cfg = replace(Config(), **overrides)

    paths = list_mines(cfg)
    mine_ids = [os.path.basename(p) for p in paths]
    splits = split_mines(mine_ids, cfg)
    train_set = set(splits["train"])
    print(f"{len(paths)} mines | stride {cfg.tick_stride} | "
          f"train {len(splits['train'])} val {len(splits['val'])} "
          f"test {len(splits['test'])}")

    os.makedirs(cfg.cache_dir, exist_ok=True)

    # Pass 1: load and cache raw (unnormalized) features, collecting the
    # train-only statistics as we go.
    train_mines = []
    for i, path in enumerate(paths, 1):
        mine = load_mine(path, cfg)
        save_mine(mine, cache_path(cfg, mine.mine_id))
        if mine.mine_id in train_set:
            train_mines.append(mine)
        n_events = int((~mine.censored & mine.valid).any(axis=0).sum())
        print(f"  [{i}/{len(paths)}] {mine.mine_id}: "
              f"N={mine.n_nodes} T={mine.n_ticks} "
              f"features={mine.features.shape} nodes_with_event={n_events}")

    if not train_mines:
        raise SystemExit("no train mines — cannot compute normalization stats")

    mean, std = compute_norm_stats(train_mines)
    np.savez(os.path.join(cfg.cache_dir, f"norm_s{cfg.tick_stride}.npz"),
             mean=mean, std=std)

    with open(os.path.join(cfg.cache_dir, f"splits_s{cfg.tick_stride}.json"),
              "w") as f:
        json.dump(splits, f, indent=2)

    print(f"\nnorm stats from {len(train_mines)} train mines")
    print(f"  mean[:4] = {np.round(mean[:4], 4)}")
    print(f"  std[:4]  = {np.round(std[:4], 4)}")
    print(f"cache written to {cfg.cache_dir}")


if __name__ == "__main__":
    main()
