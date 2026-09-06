"""Configuration for the mine ground-collapse hazard model.

Every tunable lives here as a named field. Per the implementation plan
(`trainiging file making/plan_1_patched.md`), each [OPEN — CHOOSE AND JUSTIFY]
item is exposed as an explicit config value rather than a hardcoded magic
number, with the justification recorded alongside it.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace

# ---------------------------------------------------------------------------
# Data schema (Section 2.1)
# ---------------------------------------------------------------------------

# The 24 sensor channels carried across all six tiers. Order is fixed and
# load-bearing: it defines column order in the feature tensor, so never
# reorder without rebuilding the cache.
CHANNELS: tuple[str, ...] = (
    "tilt_x_urad",
    "tilt_y_urad",
    "accel_x_g",
    "accel_y_g",
    "accel_z_g",
    "gyro_x_dps",
    "gyro_y_dps",
    "gyro_z_dps",
    "vib_rms_mm_s",
    "vib_peak_mm_s",
    "vib_fdom_hz",
    "die_temp_c",
    "fissure_mm",
    "strain_ue",
    "moisture_pct",
    "ext_delta_mm",
    "pore_pressure_kpa",
    "borehole_tilt_d1_urad",
    "borehole_tilt_d2_urad",
    "borehole_tilt_d3_urad",
    "borehole_tilt_d4_urad",
    "gps_dx_mm",
    "gps_dy_mm",
    "gps_dz_mm",
)

# Plan §2.1 assumed two node types (scout/geophone). The real dataset has six
# tiers across three roles, so the "node-type indicator" is a 6-dim one-hot
# over tier rather than the 1-dim flag the plan sketched. Same purpose: let
# the input projection tell a structurally-absent channel apart from a real
# near-zero reading.
TIERS: tuple[str, ...] = ("1A", "1B", "1C", "2A", "2B", "3")

# Which channels each tier actually carries, from metadata.json["tier_channels"].
# Channels outside a tier's set are NULL in the parquet (never 0, per SCHEMA.md)
# and are zero-filled with their presence-mask bit cleared.
TIER_CHANNELS: dict[str, tuple[str, ...]] = {
    "1A": (
        "tilt_x_urad", "tilt_y_urad",
        "accel_x_g", "accel_y_g", "accel_z_g",
        "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
        "vib_rms_mm_s", "vib_peak_mm_s", "vib_fdom_hz",
        "die_temp_c",
    ),
    "1B": (
        "tilt_x_urad", "tilt_y_urad",
        "accel_x_g", "accel_y_g", "accel_z_g",
        "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
        "vib_rms_mm_s", "vib_peak_mm_s", "vib_fdom_hz",
        "die_temp_c", "fissure_mm", "strain_ue",
    ),
    "1C": (
        "tilt_x_urad", "tilt_y_urad",
        "accel_x_g", "accel_y_g", "accel_z_g",
        "gyro_x_dps", "gyro_y_dps", "gyro_z_dps",
        "vib_rms_mm_s", "vib_peak_mm_s", "vib_fdom_hz",
        "die_temp_c", "moisture_pct", "ext_delta_mm",
    ),
    "2A": ("tilt_x_urad", "tilt_y_urad", "die_temp_c"),
    "2B": (
        "pore_pressure_kpa",
        "borehole_tilt_d1_urad", "borehole_tilt_d2_urad",
        "borehole_tilt_d3_urad", "borehole_tilt_d4_urad",
        "die_temp_c",
    ),
    "3": ("gps_dx_mm", "gps_dy_mm", "gps_dz_mm", "die_temp_c"),
}

# Columns that must NEVER reach the feature tensor.
#
# Plan §7.1 forbids the model any access to the simulator's own governing
# state or to mine-specific physical parameters — doing so gives it a second
# gradient path that re-teaches the label instead of forcing it to read real
# sensor precursors. `truth_*` are the simulator's noise-free ground truth;
# `spatial_weight` encodes distance to the collapse event, which is the label
# in disguise. Both are dropped at load and asserted absent in tests.
LEAKAGE_PREFIXES: tuple[str, ...] = ("truth_",)
LEAKAGE_COLUMNS: tuple[str, ...] = ("spatial_weight",)

# Feature width = 24 channels + 24 presence bits + 6 tier one-hot = 54.
# Computed rather than hardcoded so it stays correct if CHANNELS changes.
N_CHANNELS = len(CHANNELS)
N_TIERS = len(TIERS)


def feature_width(use_presence_mask: bool = True) -> int:
    """Input width `m` seen by the SSM's input projection (plan §2.1)."""
    width = N_CHANNELS + N_TIERS
    if use_presence_mask:
        width += N_CHANNELS
    return width


# ---------------------------------------------------------------------------
# Hazard bins (Section 6)
# ---------------------------------------------------------------------------

# Plan §6 fixes K bins over "future time" but assumed bins map onto ticks.
# In this dataset time-to-collapse spans 1.3 h to 247 h (p50 = 72.9 h), so
# per-tick 60 s bins are useless — they would all be "not yet". Bins are
# therefore defined in SECONDS, log-spaced: narrow early (where a warning is
# actionable) and wide late (to cover the ~11 day tail without spending
# capacity on it).
#
# K=12 chosen by the user. Note for whoever runs the real training: with only
# 100 mines, the later bins are event-sparse — see training/README.md.
HAZARD_BIN_EDGES_HOURS: tuple[float, ...] = (
    0.5, 1.0, 2.0, 3.0, 6.0, 9.0, 12.0, 24.0, 48.0, 96.0, 168.0, 264.0,
)


@dataclass(frozen=True)
class Config:
    """All hyperparameters and tunable choices for one training run."""

    # -- paths -------------------------------------------------------------
    dataset_dir: str = "dataset"
    cache_dir: str = "training/cache"
    checkpoint_dir: str = "training/checkpoints"

    # -- data (Sections 1, 8) ---------------------------------------------
    # Stride 1 = full 60 s resolution, no downsampling (user decision).
    # Tractable only because of truncated BPTT below; the smoke run overrides
    # this to something coarse purely so it finishes quickly.
    tick_stride: int = 1
    use_presence_mask: bool = True

    # Split at the MINE level (plan §1, §8) — never node- or tick-level, so
    # no mine's nodes appear in more than one split.
    train_frac: float = 0.70
    val_frac: float = 0.15
    # test_frac is the remainder (0.15)
    split_seed: int = 1337

    # -- SSM (Section 2.2) -------------------------------------------------
    d_model: int = 48                # state width d, plan suggests 32-64
    # Diagonal A initialized negative-real (HiPPO-style) so exp(dt*A) stays
    # bounded for all dt > 0.
    a_init_min: float = -0.5
    a_init_max: float = -0.001
    expm1_div_eps: float = 1e-4      # small-|x| Taylor branch threshold (§2.2)

    # -- compute gate (Section 3) -----------------------------------------
    # [OPEN — CHOSEN] gating is PER-NODE, not global across the mine.
    # Justification: nodes sit at different distances from a developing
    # failure and become novel at independent times; a mine-global gate would
    # force a quiet node to burn compute whenever any other node was active,
    # and would shut a genuinely novel node just because the mine was calm
    # on average. Per-node is the defensible default the plan names.
    gate_per_node: bool = True
    # Novelty threshold, in robust z-score units (see ComputeGate.novelty).
    # MEASURED tradeoff on a smoke setup (hard-gate eval loss vs open rate):
    #     tau=-99 (always open)  0.781   100% open
    #     tau=1.0               0.782    84% open
    #     tau=1.5               0.841    49% open   <- chosen
    #     tau=2.0               1.302    18% open
    #     tau=2.5               2.194     5% open
    # 1.5 buys ~51% of the compute saving for ~7% loss, where 2.5 costs 3x the
    # loss for the remaining fraction. Re-tune this on validation with a real
    # training budget -- these numbers come from a deliberately tiny run, and
    # always report hard-eval loss and open rate together.
    gate_tau: float = 1.5
    gate_baseline_momentum: float = 0.01   # rolling baseline EMA rate
    # Warm-up: force the gate fully open early so the SSM learns real dynamics
    # (and a meaningful baseline) before any gating starves its gradient (§3).
    gate_warmup_frac: float = 0.08   # ~8% of total steps, plan suggests 5-10%
    # Soft-gate temperature annealed by GLOBAL OPTIMIZER STEP, never by epoch
    # (§3) — an epoch-indexed schedule would make a mine's effective
    # temperature depend on batch ordering, a silent reproducibility hazard.
    gate_temp_start: float = 1.0
    gate_temp_end: float = 0.05
    # decay() applied to the carried-over hazard on gated-shut ticks (§3).
    # This COMPOUNDS: with a ~9% gate-open rate a node sits shut for ~11
    # consecutive ticks on average, and far longer during quiet stretches, so
    # a value like 0.98 collapses lambda to ~0 between openings and the model
    # can never recover (a shut gate also blocks the head from running). Near
    # 1.0 means "carry the last estimate forward, ageing it only slightly",
    # which is what §3's identity-carry is actually for.
    hazard_decay: float = 0.999

    # -- graph (Section 4.1) ----------------------------------------------
    # [OPEN — CHOSEN] radius-based, with a per-tier-pair radius.
    # Justification: the data spec places scouts ~15 m apart but anchors
    # ~126 m apart (metadata.json placement), so a single k-NN would either
    # bury each scout among only its immediate scout neighbours or connect
    # anchors to half the mine. Radius per tier-pair matches the physical
    # sensing-footprint asymmetry directly.
    radius_scout_scout_m: float = 45.0
    radius_scout_anchor_m: float = 150.0
    radius_anchor_anchor_m: float = 300.0
    radius_gateway_m: float = 400.0   # gateway sees widely but is one node
    max_degree: int = 16              # cap neighbours to bound memory
    # Self-loops are ALWAYS added regardless of radius (§4.1, required):
    # radius construction can isolate a node, which would make the §4.2
    # softmax undefined over an empty neighbour set. With a self-loop an
    # isolated node cleanly reduces to "no spatial info this tick".

    # -- GNN (Sections 4.2, 4.3) ------------------------------------------
    # [OPEN — CHOSEN] k = 2 hops.
    # Justification: with scout spacing ~15 m and a 45 m scout-scout radius,
    # one hop already spans ~3 scout separations; two hops lets an anchor's
    # signal (150 m radius) reach scouts that are not directly in range.
    # Because feedback is Option A (§5), cross-node info does not accumulate
    # across ticks, so k is the ONLY lever for spatial reach — exposed here
    # for validation tuning rather than fixed.
    gnn_hops: int = 2
    gnn_edge_hidden: int = 32        # width of the learned w_ij MLP
    # [OPEN — CHOSEN] option (a): feed neighbour staleness into w_ij.
    # Justification: with the compute gate active a large fraction of ticks
    # may be gated shut, so a stale identity-carried h_j would otherwise get
    # exactly the same attention weight as a fresh one, silently dominating
    # the aggregate with old information. The soft-gate value g_j(t) is
    # already computed, so this costs one extra input feature.
    gnn_use_staleness: bool = True
    # v2 extension (§4.4), deliberately OFF: down-weighting a node whose
    # embedding disagrees with its neighbourhood. Not required for v1 —
    # flagged so it is neither silently skipped nor silently assumed done.
    gnn_fault_robust: bool = False

    # -- hazard head (Section 6) ------------------------------------------
    # [OPEN — CHOSEN] discrete-time hazard, the plan's recommended default.
    # Justification: survival = prod(1 - lambda) with lambda = sigmoid(.) makes
    # monotonicity and non-negativity true BY CONSTRUCTION, so the §7.2(a)/(b)
    # penalties are correctly omitted rather than added as redundant terms.
    hazard_hidden: int = 64
    # Initial bias on the hazard output layer. sigmoid(-5) ~ 0.0067, a low
    # base rate matching a dataset where most node-ticks are censored. Without
    # it every bin starts at lambda = 0.5 and the model must climb off a flat,
    # badly-scaled plateau before it can learn anything.
    hazard_bias_init: float = -5.0
    hazard_bin_edges_hours: tuple[float, ...] = HAZARD_BIN_EDGES_HOURS
    log_eps: float = 1e-7            # clamp before every log (§6, required)

    # -- physics regularization (Section 7.3) ------------------------------
    # [OPEN — CHOSEN] small weights: these are regularizers, not the primary
    # signal, and must not be allowed to dominate L_survival. Start at 0.05
    # (within the plan's suggested 0.01-0.1 band) and tune on validation.
    lambda_spatial: float = 0.05
    lambda_temporal: float = 0.05
    # L_mono is NOT included: guaranteed structurally by the head above (§7.2a).

    # -- training loop (Section 8) ----------------------------------------
    batch_mines: int = 2             # one example = one mine (§8)
    # Truncated BPTT. The SSM recurrence is sequential, so backprop across
    # all ~20k ticks of a long mine would blow up memory. State carries
    # FORWARD across windows (detached at the boundary) and is hard-reset to
    # zero at mine boundaries per §2.3 — the model still sees the full
    # sequence, gradients just don't flow the whole way back.
    tbptt_len: int = 512
    epochs: int = 20
    lr: float = 1e-3
    weight_decay: float = 1e-4
    grad_clip: float = 1.0
    device: str = "auto"             # auto -> mps, else cuda, else cpu
    seed: int = 0

    # -- early stopping -------------------------------------------------------
    # README "Known risks": with 100 mines (15 in val) and 75% censoring, the
    # loss alone is a poor guide and there is no early stopping. Stop on the
    # concordance index (a rank metric over OBSERVED events only, so a
    # "nothing collapses" model cannot game it) rather than on val loss.
    # `early_stop_patience` epochs without a new best C -> stop; the best
    # checkpoint is symlinked as best.pt. Set patience to 0 to disable.
    early_stop_patience: int = 8
    early_stop_min_delta: float = 0.002   # C improvement that counts as "better"
    num_workers: int = 0
    log_every: int = 10
    limit_mines: int | None = None   # cap mine count (debug/smoke)

    @property
    def n_bins(self) -> int:
        """K, the number of future hazard bins."""
        return len(self.hazard_bin_edges_hours)

    @property
    def input_width(self) -> int:
        """m, the input width seen by the SSM (plan §2.1)."""
        return feature_width(self.use_presence_mask)


def smoke_config(base: Config | None = None) -> Config:
    """Tiny, fast config used to prove the pipeline runs end to end.

    Deliberately NOT representative of a real run: coarse stride, short
    windows and a small model so it finishes in seconds. The handoff run uses
    the defaults in `Config`.
    """
    base = base or Config()
    return replace(
        base,
        tick_stride=50,
        tbptt_len=64,
        d_model=16,
        hazard_hidden=16,
        gnn_edge_hidden=16,
        batch_mines=2,
        epochs=2,
        limit_mines=4,
        log_every=1,
    )
