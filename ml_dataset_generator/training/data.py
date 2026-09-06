"""Dataset loading: parquet -> tensors (plan Sections 1, 2.1, 8).

Responsibilities:
  * read one mine's parquet files into dense arrays
  * build the shared feature schema (channels + presence mask + tier one-hot)
  * drop every leakage column before features are assembled
  * convert per-tick time-to-collapse into per-bin survival targets
  * split at the MINE level, cache to .npz, and iterate truncated-BPTT windows
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import (
    CHANNELS,
    LEAKAGE_COLUMNS,
    LEAKAGE_PREFIXES,
    N_CHANNELS,
    TIER_CHANNELS,
    TIERS,
    Config,
)

TIER_INDEX = {t: i for i, t in enumerate(TIERS)}
CHANNEL_INDEX = {c: i for i, c in enumerate(CHANNELS)}


def is_leakage_column(name: str) -> bool:
    """True if `name` must never reach the feature tensor (plan §7.1).

    Kept as one function so the rule has a single definition, used both by
    the loader and by the test that asserts leakage never gets through.
    """
    if name in LEAKAGE_COLUMNS:
        return True
    return any(name.startswith(p) for p in LEAKAGE_PREFIXES)


# ---------------------------------------------------------------------------
# Per-mine loading
# ---------------------------------------------------------------------------


@dataclass
class Mine:
    """One mine: the full node set over the full tick sequence.

    This is one training example (plan §8 — batch at the mine level).

    Shapes, with N nodes, T ticks, m input width, K hazard bins:
      features    (T, N, m)   float32  channels + presence mask + tier one-hot
      positions   (N, 3)      float32  metres, site-local
      tier_ids    (N,)        int64    index into TIERS
      event_bin   (T, N)      int64    bin index of collapse, -1 if censored
      censored    (T, N)      bool     True where no collapse observed
      valid       (T, N)      bool     node reports at this tick
    """

    mine_id: str
    features: np.ndarray
    positions: np.ndarray
    tier_ids: np.ndarray
    event_bin: np.ndarray
    censored: np.ndarray
    valid: np.ndarray

    @property
    def n_nodes(self) -> int:
        return self.positions.shape[0]

    @property
    def n_ticks(self) -> int:
        return self.features.shape[0]


def _bin_edges_seconds(cfg: Config) -> np.ndarray:
    return np.asarray(cfg.hazard_bin_edges_hours, dtype=np.float64) * 3600.0


def time_to_bin(ttc_seconds: np.ndarray, cfg: Config) -> np.ndarray:
    """Map a time-to-collapse (seconds) to its hazard bin index.

    Bin k covers (edges[k-1], edges[k]], with bin 0 covering [0, edges[0]].
    A time beyond the last edge returns `n_bins` — i.e. "collapses, but later
    than any bin we predict", which the loss treats as censored over the full
    predicted horizon rather than as an event.
    """
    edges = _bin_edges_seconds(cfg)
    return np.searchsorted(edges, ttc_seconds, side="left").astype(np.int64)


def load_mine(mine_dir: str, cfg: Config) -> Mine:
    """Read one mine directory into dense arrays."""
    mine_id = os.path.basename(mine_dir.rstrip("/"))

    nodes = pd.read_parquet(os.path.join(mine_dir, "nodes.parquet"))
    nodes = nodes.sort_values("node_id").reset_index(drop=True)
    node_ids = nodes["node_id"].to_numpy()
    node_pos = {int(nid): i for i, nid in enumerate(node_ids)}
    n_nodes = len(node_ids)

    positions = nodes[["x", "y", "z"]].to_numpy(dtype=np.float32)
    tier_ids = np.array(
        [TIER_INDEX[t] for t in nodes["tier"].astype(str)], dtype=np.int64
    )

    # --- readings -------------------------------------------------------
    # Read only non-leakage columns. Selecting at the parquet level means the
    # truth_* columns are never even materialised, so they cannot be picked
    # up by a later refactor that iterates over the frame's columns.
    wanted = ["node_id", "t_s", *CHANNELS]
    assert not any(is_leakage_column(c) for c in wanted), "leakage column in schema"
    readings = pd.read_parquet(os.path.join(mine_dir, "readings.parquet"), columns=wanted)

    ticks = np.sort(readings["t_s"].unique())
    if cfg.tick_stride > 1:
        ticks = ticks[:: cfg.tick_stride]
    tick_pos = {float(t): i for i, t in enumerate(ticks)}
    n_ticks = len(ticks)

    readings = readings[readings["t_s"].isin(ticks)]
    r_node = readings["node_id"].map(node_pos).to_numpy()
    r_tick = readings["t_s"].map(tick_pos).to_numpy()

    # Dense channel array, NaN where a tier does not carry the channel or the
    # report was lost in the mesh. SCHEMA.md is explicit that absent channels
    # are NULL and never 0, so we must distinguish them from a real zero.
    chan = np.full((n_ticks, n_nodes, N_CHANNELS), np.nan, dtype=np.float32)
    for ci, name in enumerate(CHANNELS):
        chan[r_tick, r_node, ci] = readings[name].to_numpy(dtype=np.float32)

    present = np.isfinite(chan)
    chan = np.nan_to_num(chan, nan=0.0, posinf=0.0, neginf=0.0)

    # A node is "valid" at a tick if it reported anything at all. Missed mesh
    # reports stay missing (SCHEMA.md) and are masked out of the loss.
    valid = present.any(axis=2)

    # --- labels ---------------------------------------------------------
    # spatial_weight is excluded: it encodes distance to the collapse event,
    # which is the label in disguise (plan §7.1).
    lab_cols = ["node_id", "t_s", "time_to_collapse_s", "censored_flag"]
    assert not any(is_leakage_column(c) for c in lab_cols), "leakage column in labels"
    labels = pd.read_parquet(os.path.join(mine_dir, "labels.parquet"), columns=lab_cols)
    labels = labels[labels["t_s"].isin(ticks)]
    l_node = labels["node_id"].map(node_pos).to_numpy()
    l_tick = labels["t_s"].map(tick_pos).to_numpy()

    ttc = np.full((n_ticks, n_nodes), np.nan, dtype=np.float64)
    ttc[l_tick, l_node] = labels["time_to_collapse_s"].to_numpy(dtype=np.float64)
    cens = np.ones((n_ticks, n_nodes), dtype=bool)
    cens[l_tick, l_node] = labels["censored_flag"].to_numpy().astype(bool)

    # Censored rows carry NaN time-to-collapse; treat any non-finite ttc as
    # censored too, so a missing label can never masquerade as an event.
    cens = cens | ~np.isfinite(ttc)

    event_bin = np.full((n_ticks, n_nodes), -1, dtype=np.int64)
    obs = ~cens
    if obs.any():
        binned = time_to_bin(np.nan_to_num(ttc[obs], nan=0.0), cfg)
        # A collapse further out than the last bin edge is not an event we
        # predict; fold it into censoring over the full horizon instead.
        beyond = binned >= cfg.n_bins
        ev = event_bin[obs]
        ev[~beyond] = binned[~beyond]
        event_bin[obs] = ev
        c = cens[obs]
        c[beyond] = True
        cens[obs] = c

    # --- feature assembly ------------------------------------------------
    tier_onehot = np.zeros((n_nodes, len(TIERS)), dtype=np.float32)
    tier_onehot[np.arange(n_nodes), tier_ids] = 1.0
    tier_bcast = np.broadcast_to(tier_onehot, (n_ticks, n_nodes, len(TIERS)))

    parts = [chan]
    if cfg.use_presence_mask:
        parts.append(present.astype(np.float32))
    parts.append(tier_bcast)
    features = np.concatenate(parts, axis=2).astype(np.float32)

    return Mine(
        mine_id=mine_id,
        features=features,
        positions=positions,
        tier_ids=tier_ids,
        event_bin=event_bin,
        censored=cens,
        valid=valid,
    )


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------


def compute_norm_stats(mines: list[Mine]) -> tuple[np.ndarray, np.ndarray]:
    """Per-channel mean/std over the raw sensor block, from TRAIN mines only.

    Only the first N_CHANNELS columns are normalized — the presence mask and
    tier one-hot are already 0/1 indicators and must stay that way, or the
    input projection loses the very signal §2.1 added them for.
    """
    total = np.zeros(N_CHANNELS, dtype=np.float64)
    total_sq = np.zeros(N_CHANNELS, dtype=np.float64)
    count = np.zeros(N_CHANNELS, dtype=np.float64)
    for mine in mines:
        block = mine.features[:, :, :N_CHANNELS].reshape(-1, N_CHANNELS)
        # Structural zeros carry no information about scale; including them
        # would drag every sparse channel's mean toward zero.
        mask = block != 0.0
        total += (block * mask).sum(axis=0)
        total_sq += ((block**2) * mask).sum(axis=0)
        count += mask.sum(axis=0)
    count = np.maximum(count, 1.0)
    mean = total / count
    var = np.maximum(total_sq / count - mean**2, 0.0)
    std = np.sqrt(var)
    std[std < 1e-6] = 1.0
    return mean.astype(np.float32), std.astype(np.float32)


def apply_norm(features: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    out = features.copy()
    block = out[:, :, :N_CHANNELS]
    nonzero = block != 0.0
    out[:, :, :N_CHANNELS] = np.where(nonzero, (block - mean) / std, 0.0)
    return out


# ---------------------------------------------------------------------------
# Caching and splitting
# ---------------------------------------------------------------------------


def list_mines(cfg: Config) -> list[str]:
    entries = sorted(
        d for d in os.listdir(cfg.dataset_dir) if d.startswith("mine_")
    )
    paths = [os.path.join(cfg.dataset_dir, d) for d in entries]
    if cfg.limit_mines is not None:
        paths = paths[: cfg.limit_mines]
    return paths


def split_mines(mine_ids: list[str], cfg: Config) -> dict[str, list[str]]:
    """Split at the MINE level (plan §1, §8) — never node- or tick-level."""
    rng = np.random.default_rng(cfg.split_seed)
    order = rng.permutation(len(mine_ids))
    shuffled = [mine_ids[i] for i in order]
    n = len(shuffled)
    n_train = int(round(cfg.train_frac * n))
    n_val = int(round(cfg.val_frac * n))
    return {
        "train": shuffled[:n_train],
        "val": shuffled[n_train : n_train + n_val],
        "test": shuffled[n_train + n_val :],
    }


def cache_path(cfg: Config, mine_id: str) -> str:
    return os.path.join(cfg.cache_dir, f"{mine_id}_s{cfg.tick_stride}.npz")


def save_mine(mine: Mine, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if not np.isfinite(mine.features).all():
        raise ValueError(f"{mine.mine_id}: non-finite features before save")
    np.savez_compressed(
        path,
        mine_id=mine.mine_id,
        # fp32, NOT fp16. The cache holds RAW (un-normalized) readings, and
        # raw tilt reaches ~8.5e4 urad -- past fp16's 65504 ceiling -- so
        # float16 silently writes +-inf on exactly the channels that carry
        # the collapse precursor. That produced NaN loss on one mine in ten
        # and nothing else flagged it. The compression below recovers most of
        # the size difference anyway.
        features=mine.features.astype(np.float32),
        positions=mine.positions,
        tier_ids=mine.tier_ids,
        event_bin=mine.event_bin,
        censored=mine.censored,
        valid=mine.valid,
    )


def load_cached(path: str) -> Mine:
    z = np.load(path, allow_pickle=False)
    feats = z["features"].astype(np.float32)
    # Guard against a stale or corrupt cache. A silent inf here turns into
    # NaN loss thousands of ticks later, in one mine out of ten, with nothing
    # pointing back to the cache -- so fail loudly at the boundary instead.
    if not np.isfinite(feats).all():
        raise ValueError(
            f"{path}: non-finite cached features -- rebuild with "
            f"training.prepare_cache"
        )
    return Mine(
        mine_id=str(z["mine_id"]),
        features=feats,
        positions=z["positions"],
        tier_ids=z["tier_ids"],
        event_bin=z["event_bin"],
        censored=z["censored"],
        valid=z["valid"],
    )


# ---------------------------------------------------------------------------
# Truncated-BPTT windowing
# ---------------------------------------------------------------------------


@dataclass
class Window:
    """One truncated-BPTT window over a single mine.

    `t_offset` is the window's start tick within the mine, needed so the
    horizon-truncation mask (plan §6) can tell how many real future ticks
    remain — that depends on position in the FULL sequence, not the window.
    """

    mine: Mine
    t_start: int
    t_end: int
    is_first: bool     # -> hard-reset hidden state here (plan §2.3)

    @property
    def features(self) -> np.ndarray:
        return self.mine.features[self.t_start : self.t_end]

    @property
    def event_bin(self) -> np.ndarray:
        return self.mine.event_bin[self.t_start : self.t_end]

    @property
    def censored(self) -> np.ndarray:
        return self.mine.censored[self.t_start : self.t_end]

    @property
    def valid(self) -> np.ndarray:
        return self.mine.valid[self.t_start : self.t_end]


def iter_windows(mine: Mine, cfg: Config):
    """Yield consecutive windows covering the mine's full tick sequence."""
    for start in range(0, mine.n_ticks, cfg.tbptt_len):
        end = min(start + cfg.tbptt_len, mine.n_ticks)
        yield Window(mine=mine, t_start=start, t_end=end, is_first=(start == 0))


def horizon_mask(t_start: int, n_win: int, n_total: int, cfg: Config,
                 seconds_per_tick: float = 60.0) -> np.ndarray:
    """Per-(tick, bin) mask for bins that run past the end of the simulation.

    Plan §6: a bin whose window extends beyond tick T is neither an observed
    collapse nor a legitimately censored non-collapse — the simulation simply
    did not run long enough to say. That is a different kind of missingness
    from ordinary right-censoring, so those bins are masked out entirely
    rather than being counted as "survived".

    Returns (n_win, K) bool.
    """
    edges = _bin_edges_seconds(cfg)
    t_idx = np.arange(t_start, t_start + n_win)
    remaining_s = (n_total - 1 - t_idx) * seconds_per_tick * cfg.tick_stride
    return remaining_s[:, None] >= edges[None, :]
