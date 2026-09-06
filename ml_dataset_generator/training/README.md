# Mine Collapse Hazard Model — Training

Implementation of `../trainiging file making/plan_1_patched.md`: an SSM + GNN
discrete-time survival model that predicts, per sensor node per tick, a hazard
curve over future time bins.

**Status: the pipeline is built and verified to train. It has NOT been trained
to convergence.** The smoke runs here exist only to prove the code works
end to end. Doing the real training run is the next person's job — this README
is written for them.

---

## Environment

The repo's existing `.venv` is Python 3.14, and **torch has no wheels for it**.
A separate environment is used for training:

```bash
uv venv --python 3.12 .venv-train
uv pip install --python .venv-train/bin/python torch numpy pandas pyarrow
```

Verified with torch 2.14.0 on macOS (MPS available). Everything below runs with
`.venv-train/bin/python`.

---

## Quick start

```bash
# 1. invariant tests (fast, no data needed)
.venv-train/bin/python -m tests.test_training

# 2. build the cache — start small to sanity-check
.venv-train/bin/python -m training.prepare_cache --limit 6 --stride 50

# 3. smoke run: proves the pipeline trains
.venv-train/bin/python -m training.train --smoke

# 4. the real run (see "Running the real training" below)
.venv-train/bin/python -m training.prepare_cache          # full, stride 1
.venv-train/bin/python -m training.train --epochs 40
```

---

## Architecture

The four stages of plan §7.4 are kept as separate named modules deliberately,
so the architectural split is visible in the code and not just the math:

| Stage | Module | Role |
|---|---|---|
| SSM | `model.SelectiveSSM` | temporal representation per node from sensor history |
| Gate | `model.ComputeGate` | novelty gating, per node per tick |
| GNN | `model.SpatialGNN` | spatial interaction across nodes, per tick |
| Head | `model.HazardHead` | per-bin hazard from the spatially-corrected embedding |

Feedback is **Option A** (plan §5): only the SSM's own state `h` persists across
ticks. The post-GNN `h'` is a pure read-out and is never written back — the
SSM's `forward` signature only accepts `(x, h_prev)`, which makes this
structurally impossible to violate by accident.

---

## How this differs from the plan (and why)

The plan was written before the dataset existed, against an assumed data
contract. Five things differ, and the code resolves each:

1. **Node types.** Plan assumed 2 (`scout`/`geophone`); the data has 6 tiers
   (`1A/1B/1C/2A/2B/3`) across 3 roles. The §2.1 type indicator is therefore a
   6-dim one-hot over tier, not a 1-dim flag.
2. **Labels are per-tick, not per-node.** The plan assumed one
   `(time_to_collapse, censored)` per node. The dataset gives a fresh countdown
   at every tick, with `NaN` when censored. This is strictly better — §6 wants a
   survival target at every tick, and now it has one.
3. **Absent channels are NULL, never 0** (`SCHEMA.md`). The plan said
   zero-pad. Zero-filling alone would make a structurally-absent channel
   indistinguishable from a real zero reading, so each channel also carries a
   presence bit. Feature width `m` = 24 channels + 24 presence + 6 tier = **54**.
4. **100 mines, not 1,000–5,000.** Split is 70/15/15 at the mine level. See
   "Known risks".
5. **Hazard bins are in seconds, not ticks.** Time-to-collapse spans 1.3 h to
   247 h (p50 = 72.9 h ≈ 4,376 ticks), so per-tick bins would all read "not
   yet". K=12 log-spaced bins, narrow early and wide late.

### Leakage exclusion

`readings.parquet` carries four `truth_*` columns (the simulator's noise-free
ground truth) and `labels.parquet` carries `spatial_weight` (distance to the
collapse event — the label in disguise). Plan §7.1 forbids exactly this class
of information: it would give the model a second gradient path that re-teaches
the label instead of forcing it to read real sensor precursors.

All of them are excluded at load, and `tests/test_training.py` asserts it.
**If you add a feature, check `is_leakage_column` in `data.py` first.**

---

## Bugs found and fixed while verifying

These were found by actually running the thing, and are worth knowing about
because each one failed *silently* — no crash, just a model that would not learn.

1. **`decay()` applied to logits instead of probabilities.** Shrinking a logit
   toward 0 drives λ toward **0.5**, i.e. maximum uncertainty — the opposite of
   "risk fades". It is a strong attractor: the loss flattened at 5.69 while a
   trivial constant-hazard baseline scores 0.42. Decay now acts in probability
   space, where it correctly sends λ toward 0.
2. **Novelty score was mis-scaled and the gate never opened.** The score
   divided by an EMA of the same deviation it was measuring, so it
   self-normalised to ~0.3 and never came near `gate_tau = 2.5` — the gate shut
   permanently after warm-up, killing all gradient. Now reduced with **max over
   channels** (a precursor spikes in 2–3 channels while ~20 sit quiet; a mean
   buries it) and restricted to channels the node actually carries.
3. **`hazard_decay = 0.98` compounded to zero.** At a ~9% gate-open rate a node
   sits shut ~11 consecutive ticks, and far longer in quiet stretches. Now
   `0.999`, a near-identity carry.
4. **Hazard head initialised at λ = 0.5 on every bin**, which asserts
   near-certain imminent collapse everywhere — a terrible prior for a dataset
   that is 75% censored. Output bias now initialises to `-5.0` (λ ≈ 0.007).
5. **fp16 cache overflowed on the tilt channels.** The cache stored raw
   readings as float16, but `tilt_x/y_urad` reaches ~8.5e4 µrad — past fp16's
   65504 ceiling — so those became `±inf`, and NaN loss appeared thousands of
   ticks later in **one mine out of ten** with nothing pointing at the cache.
   Now stored fp32, with a finiteness check on both save and load.
6. **Missing normalization stats failed as a warning, not an error.** Raw
   readings span ~1e4 (tilt, µrad) against ~1e-3 (accel, g); training on that
   scale gave a loss ~100x off with no other symptom. Now a hard exit.

Bugs 1, 2 and 4 were found by the loss refusing to descend; bugs 3, 5 and 6
only appeared at the *real* stride-1 configuration and were invisible in the
smoke run. **If you change the data path, re-run at stride 1 before trusting
it** — the smoke config is too small to surface this class of problem.

---

## The gate accuracy/compute tradeoff — READ THIS

This is the most important open item, and it is a genuine tradeoff rather than a
bug.

Measured on a 3-mine smoke setup, after 40 steps:

| `gate_tau` | Hard-gate eval loss | Gate open rate | Compute saved |
|---|---|---|---|
| −99 (always open) | 0.781 | 100% | 0% |
| 1.0 | 0.782 | 84% | 16% |
| **1.5 (default)** | **0.841** | **49%** | **51%** |
| 2.0 | 1.302 | 18% | 82% |
| 2.5 | 2.194 | 5% | 95% |

`gate_tau = 1.5` is the current default: it buys ~51% of the compute for ~7%
loss, where 2.5 costs 3x the loss for the rest.

With the gate always open, soft-train and hard-eval agree closely (0.790 vs
0.781), which confirms the soft-gate relaxation is faithful: the accuracy cost
above is the *gating itself*, not a train/inference mismatch. That is the
tradeoff §3 exists to manage, not a bug to fix.

Two honest readings of this, and it is not yet settled which is right:

- **Undertrained.** 40 steps on 3 mines is far too little for the model to learn
  to place its few open ticks well. A real run may close much of the gap.
- **`tau` is genuinely too aggressive** for this data, and the plan's compute
  savings need to be bought at a lower threshold.

**Recommendation:** re-tune `gate_tau` on validation with a real training
budget, and always report hard-eval loss and open rate together — one without
the other is meaningless. The curve above comes from a deliberately tiny run
(3 mines, 40 steps) and the knee may well move once the model is properly
trained. `gate_tau`, `gate_temp_end` and `gate_warmup_frac` are all config
values.

Also note: a softer `gate_temp_end` trains better (0.92 at 0.3 vs 1.55 at 0.05)
but drifts further from the hard inference behaviour the plan asks the anneal to
converge toward. The default is deliberately left at the plan-faithful end;
raise it only with the hard-eval number in hand.

---

## Running the real training

```bash
# full cache at stride 1 (all 100 mines, ~58M node-ticks) — do this once
.venv-train/bin/python -m training.prepare_cache

# train
.venv-train/bin/python -m training.train --epochs 40

# resume from a checkpoint
.venv-train/bin/python -m training.train --epochs 40 \
    --resume training/checkpoints/epoch_012.pt
```

`tick_stride = 1` keeps the full 60 s resolution. This is only tractable because
of **truncated BPTT**: each mine is processed in `tbptt_len`-tick windows (512
by default), with hidden state carried forward across windows and detached at
each boundary, then hard-reset to zero at every mine boundary per §2.3. The
model still sees the whole sequence; only the gradient path is truncated.

If you hit memory limits, lower `tbptt_len` before raising `tick_stride` —
shortening the gradient window loses less than throwing away ticks.

### Suggested first experiments

1. **`gate_tau` sweep** — the tradeoff above. Highest value for the effort.
2. **`d_model`** (48) and **`gnn_hops`** (2). The plan asks that `k` not default
   to 2 without checking it against node density; scout spacing is ~15 m against
   a 45 m scout-scout radius, so 2 is defensible but unverified against
   validation.
3. **`lambda_spatial` / `lambda_temporal`** (both 0.05). Currently they
   contribute ~1e-4 of the total loss — effectively inactive. Either raise them
   to where they actually regularize, or confirm they are not needed.

---

## Known risks

- **100 mines is small** for a model with this much capacity, and only 15 are in
  validation. Expect overfitting and noisy validation. Watch the train/val gap
  from the first epoch, and consider generating more mines with `minegen/` if it
  opens up early.
- **75% of node-labels are censored** and 39 of 100 mines are *fully* censored.
  This is why the loss is a censored likelihood and not a classifier — but it
  also means a model that predicts "nothing ever collapses" scores deceptively
  well. **Do not judge this model on loss alone.** A **concordance index** is
  now computed on val every epoch (`training/metrics.py`) and printed as
  `val_C` alongside the loss — it ranks only the *observed* events, so a
  "nothing collapses" model cannot game it. Early stopping and `best.pt`
  selection are both driven by `val_C`, not by loss. A time-dependent AUC is
  still worth adding as a second view.
- **The late hazard bins are event-sparse.** With K=12, bin 11 (>264 h) had zero
  events in the mines sampled. Those bins will be poorly trained; consider
  merging the tail if this persists across the full dataset.
- **Early stopping is on `val_C`** with `early_stop_patience = 8` epochs
  (config). Every epoch is still checkpointed; the best-by-`val_C` epoch is
  additionally saved as `checkpoints/best.pt`, and `history.json` records
  train/val loss and `c_index` per epoch. Set `early_stop_patience = 0` to
  disable and pick by hand.

---

## Files

| File | Purpose |
|---|---|
| `config.py` | every tunable; each plan `[OPEN]` choice with its justification |
| `data.py` | parquet → tensors, feature schema, leakage exclusion, windowing |
| `graph.py` | per-mine radius graph, guaranteed self-loops (§4.1) |
| `model.py` | the four stages (§2, §3, §4, §6) |
| `losses.py` | censored survival NLL (§6) + physics regularizers (§7) |
| `metrics.py` | concordance index (measurement only — no gradient) |
| `train.py` | mine-level batching, truncated BPTT, masking (§8), early stop |
| `prepare_cache.py` | one-time parquet → npz preprocessing |
| `../tests/test_training.py` | the plan's stated invariants |

### Invariants under test

1. `expm1_div` finite and ≈1 as x→0, with finite gradients (§2.2)
2. Survival curve non-increasing in k (§7.2a, by construction)
3. Padding × horizon masks combine multiplicatively (§8)
4. Loss and gradients finite when λ saturates, and on all-censored batches (§6)
5. `h'` never flows into the next tick's `h` (§5 Option A)
6. No `truth_*` or `spatial_weight` reaches the feature tensor (§7.1)
7. Every node has a self-loop, including isolated ones (§4.1)
8. Hazard bin assignment ordered and covering
9. Forward/backward runs; all three stages receive gradient
10. Gate warm-up forces open; temperature anneals by global step; inference
    gate is hard 0/1 (§3)
11. Concordance index: perfect ranking → C=1, inverted → C=0, fully censored →
    NaN not a crash, accumulator pools pair counts correctly
