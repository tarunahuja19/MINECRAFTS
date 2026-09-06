# Training Pipeline — Handoff Report

**For:** the ML engineer taking over training
**Date:** 2026-09-05
**Scope of this pass:** verified the existing `training/` implementation against
the three source-of-truth documents, then resolved the open design items and
closed the two gaps the README flagged as blockers for a real run.

---

## 1. What was checked

The training code was cross-read against all three authoritative documents:

| Document | Role |
|---|---|
| `trainiging file making/plan_1_patched.md` | the implementation plan (SSM + GNN survival model), twice-reviewed |
| `mine_collapse_data_spec.md` | the data-generation spec (6 tiers, Parquet, survival labels, **no PINN**) |
| `SCHEMA.md` | the live-backend schema (channel-per-tier nullability, null ≠ zero) |

Plus the actual dataset (`dataset/mine_000{01..100}/`) to confirm the code's
assumptions match the data that was really generated.

**Result: the implementation is a faithful, literal reading of the plan.**
Every `[SETTLED]` requirement is present and correct, and all 11 invariant
tests pass (`python -m tests.test_training`).

### Plan conformance — spot check

| Plan § | Requirement | Where |
|---|---|---|
| 2.2 | `expm1_div` with explicit small-x Taylor branch (not matrix inverse); double-`where` for autograd NaN safety | `model.py:27` |
| 2.2 | Diagonal `A` **fixed** (not `f(x)`), stored as `log(-a)` so it can't cross zero; only Δ/B/C input-dependent; S4-style scalar-per-channel, no separate `N` | `model.py:46` |
| 2.3 | Hard zero-reset of hidden state at every mine boundary | `model.py:442`, called in `train.py:run_mine` |
| 3 | Gate applied in **training** too; warm-up forces open; soft-gate relaxation after; temperature annealed **by global optimizer step**, not epoch | `model.py:120` |
| 4.1 | Radius graph, per-role-pair radius, **guaranteed self-loop** on every node | `graph.py:37` |
| 4.2 | Softmax-normalized aggregation (weighted **average**, not raw sum); neighbour staleness fed into `w_ij` (plan's option a) | `model.py:211` |
| 5 | Option A — SSM `forward` signature is `(x, h_prev)` only; `h'` never written back | `model.py:87`, `model.py:398` |
| 6 | Discrete-time hazard; censored NLL; clamp before **every** log; per-`(node,t,k)` horizon-truncation mask distinct from padding mask | `losses.py:15`, `data.py:360` |
| 7 | Only simulator-independent structural regularizers; `L_mono` omitted (guaranteed by construction); mean-not-sum normalization; `g_i(t)` gate factor on `L_temporal` | `losses.py:79` |
| 8 | Mine-level batching and split; two masks combined multiplicatively (asserted) | `losses.py:56`, `data.py:254` |

### Leakage exclusion (plan §7.1 / spec "NO PINN")

Confirmed the dataset carries the forbidden columns and that the code excludes
them at the Parquet-read level (so a later refactor iterating columns can't
re-introduce them), with a test asserting it:

- `readings.parquet` → `truth_tilt_x_urad`, `truth_tilt_y_urad`,
  `truth_strain_ue`, `truth_subsidence_m` — **excluded**
- `labels.parquet` → `spatial_weight` (distance to collapse = the label in
  disguise) — **excluded**

---

## 2. Deviations from the plan — all deliberate, all documented

The plan was written before the dataset existed. Five things differ; each is
forced by the real data and is the correct call:

1. **6 tiers, not 2 node types.** The §2.1 type indicator is a 6-dim one-hot
   over tier (`1A/1B/1C/2A/2B/3`), not a 1-dim scout/geophone flag. Matches
   spec §2.
2. **Labels are per-tick, not per-node.** The dataset gives a fresh
   `time_to_collapse_s` + `censored_flag` at every tick (`NaN` ttc when
   censored — verified). This is strictly better: §6 wants a survival target
   at every tick and now has one.
3. **Absent channels carry a presence bit, not just zero-pad.** SCHEMA.md is
   explicit that a channel a tier doesn't carry is `NULL`, never `0`. Feature
   width `m` = 24 channels + 24 presence bits + 6 tier one-hot = **54**.
   Normalization stats and the novelty score both mask on the presence bits so
   a structural zero never behaves like a real reading.
4. **K = 12 hazard bins in *seconds*, log-spaced**, not per-tick. TTC spans
   1.3 h–247 h (p50 ≈ 73 h ≈ 4,376 ticks), so per-tick bins would all read
   "not yet". Edges (hours): `0.5, 1, 2, 3, 6, 9, 12, 24, 48, 96, 168, 264`.
5. **100 mines, not 1,000–5,000.** 70/15/15 split at the mine level. See §4.

### Bugs found and fixed during the original verification pass

(Carried over from the README — all failed *silently*, no crash:)

1. `decay()` was applied to logits → drove λ toward 0.5 (max uncertainty)
   instead of 0. Now acts in probability space.
2. Novelty score self-normalized to ~0.3 and the gate never opened. Now
   reduced with **max over channels** (a precursor spikes in 2–3 channels
   while ~20 sit quiet — a mean buries it), restricted to carried channels.
3. `hazard_decay = 0.98` compounded to zero across the ~11-tick gaps a shut
   gate leaves. Now `0.999`.
4. Hazard head initialized at λ = 0.5 everywhere (asserts imminent collapse).
   Output bias now `-5.0` → λ ≈ 0.007, matching the 75%-censored base rate.
5. fp16 cache overflowed on tilt (`~8.5e4 µrad` > fp16's 65504) → `±inf` →
   NaN loss thousands of ticks later in 1 mine in 10. Cache is now fp32 with
   a finiteness check on save and load.
6. Missing normalization stats was a warning, not an error. Now a hard exit.

---

## 3. Open design items — decisions made this pass

The plan marks several items `[OPEN — CHOOSE AND JUSTIFY]`. Here is where each
landed and why. All are config values, not hardcoded — override freely.

| Item (plan §) | Decision | Rationale |
|---|---|---|
| Gate scope (§3) | **per-node** (`gate_per_node=True`) | nodes sit at different distances from a developing failure and become novel at independent times; a mine-global gate wastes compute on quiet nodes and shuts genuinely novel ones |
| `gate_tau` (§3) | **1.5**, flagged for re-tuning | measured tradeoff on a 3-mine smoke: τ=1.5 buys ~51% compute for ~7% loss; τ=2.5 costs 3× the loss for the rest. **This number is from a tiny run — re-sweep on validation with a real budget.** Always report hard-eval loss *and* open rate together. |
| Edge construction (§4.1) | **radius-based, per-role-pair radius** (`scout-scout 45 m`, `scout-anchor 150 m`, `anchor-anchor 300 m`, `gateway 400 m`) | spec places scouts ~15 m apart but anchors ~126 m apart; one global radius would either isolate anchors or connect every scout to every other |
| `gnn_hops` k (§4.3) | **2**, flagged for validation | scout spacing ~15 m vs 45 m radius → one hop already spans ~3 separations; two lets an anchor's 150 m-radius signal reach scouts not directly in range. Plan says don't default to 2 without checking density — this check was done, but confirm against val. |
| Neighbour staleness (§4.2) | **option (a): feed `g_j(t)` into `w_ij`** | with the gate active, a stale identity-carried `h_j` would otherwise get the same attention weight as a fresh one, silently dominating the aggregate. `g_j(t)` is already computed → one extra input feature. |
| Center-node update (§4.3) | **GRUCell** | lets a node learn to ignore an uninformative neighbourhood; plan allows either MLP or GRU |
| Hazard head form (§6) | **discrete-time hazard** (`λ = sigmoid(MLP)`, `S = Π(1-λ)`) | plan's recommended default; makes monotonicity and non-negativity true *by construction*, so the §7.2(a)/(b) penalties are correctly omitted rather than added as redundant terms |
| `λ_spatial`, `λ_temporal` (§7.3) | **both 0.05** | within the plan's 0.01–0.1 band. **Currently contribute ~1e-4 of total loss — effectively inactive.** Either raise them until they regularize, or confirm they aren't needed. |
| Initial SSM state (§2.3) | **zeros** (not a learned vector) | simplest option the plan allows; hard reset in the training loop, not learned |

### New decisions (not in the plan, needed for a real run)

| Item | Decision | Rationale |
|---|---|---|
| **Model selection metric** | **concordance index on val**, not val loss | see §4 |
| **Early stopping** | on `val_C`, `patience = 8` epochs, `min_delta = 0.002` | README flagged "no early stopping" as a blocker; with 100 mines and 75% censoring the loss is a poor guide |
| `d_model` | 48 | plan suggests 32–64; mid-range. Tune. |
| `tbptt_len` | 512 | plan is silent on windowing; 512 ticks ≈ 8.5 h of 60 s data per gradient window. Lower this before raising `tick_stride` if you hit memory. |

---

## 4. Gaps closed this pass

The README's "Known risks" listed two items as blocking a trustworthy run.
Both are now implemented.

### 4.1 Concordance index (`training/metrics.py`) — NEW

**Why:** 75% of node-labels are censored and 39 of 100 mines are *fully*
censored. A model that predicts "nothing ever collapses" scores deceptively
well on the censored likelihood — the loss cannot tell you whether the model
has learned to rank risk.

**What:** Harrell's C-index over comparable `(node, tick)` pairs, computed on
val every epoch and printed as `val_C` next to the loss.

- Risk score per `(node, tick)` = `1 - S(t+K | t)` (the model's own estimate
  of "collapses within the predicted horizon").
- A pair is *comparable* when one member has an observed event in an earlier
  bin than the other's event-or-censoring bin; *concordant* if the model gave
  the earlier-failing node the higher risk. Ties = 0.5.
- Censored-censored pairs are never comparable (correct — we don't know their
  order).
- `ConcordanceAccumulator` pools raw concordant/comparable **counts** across
  mines and divides once, rather than averaging per-mine C (which would
  over-weight small mines and silently drop fully-censored ones).
- Fully-censored mine → returns `NaN`, `0 pairs`, not a crash.

**Measurement only — no gradient path.** Tested (`test_concordance_index`).

**Read it as:** 0.5 = random ranking, 1.0 = perfect, < 0.5 = inverted. On this
dataset size, expect noisy `val_C` (only 15 val mines, ~61% with any event) —
watch the trend across epochs, not one number.

### 4.2 Early stopping + best-checkpoint (`training/train.py`) — NEW

- Best epoch by `val_C` is saved as `checkpoints/best.pt` (in addition to the
  per-epoch `epoch_NNN.pt`).
- Training stops after `early_stop_patience` (default 8) epochs with no
  `val_C` improvement of at least `early_stop_min_delta` (0.002).
- `history.json` now records `c_index` and `c_index_pairs` per epoch alongside
  the losses.
- Set `early_stop_patience = 0` to disable and pick by hand.

---

## 5. What still needs doing — prioritized

1. **`gate_tau` sweep on validation.** Highest value. The current 1.5 is from a
   3-mine / 40-step run and the knee will move once the model is properly
   trained. Report `val_C`, hard-eval loss, and gate open-rate together for
   each τ.
2. **Decide `λ_spatial` / `λ_temporal`.** They're inert at 0.05. Sweep them up
   (0.1, 0.3, 1.0× the survival-loss scale) and see if `val_C` improves, or
   set both to 0 and drop the terms.
3. **`gnn_hops` against validation.** 2 is defensible on node density but
   unverified on the actual metric. Try 1, 2, 3.
4. **Add a time-dependent AUC** as a second view on top of the C-index — the
   C-index pools all horizons; a per-bin AUC shows *where* the model ranks
   well (the README notes the late bins are event-sparse).
5. **Watch the train/val gap from epoch 1.** 100 mines is small for this
   capacity (`d_model=48`, GRU GNN, ~tens of k params). If it overfits early,
   either shrink the model or generate more mines with `minegen/`.
6. **Late hazard bins (bin 11, > 264 h) may have near-zero events.** If they
   stay untrained across the full dataset, merge the tail (K=10 or 11).
7. **More mines later** (per your note). When the count goes up: rebuild the
   cache (`prepare_cache` with no `--limit`), and the split is seeded
   (`split_seed=1337`) so re-running is deterministic — but adding mines
   *reshuffles* the split, so freeze a `splits.json` if you want continuity
   across dataset versions.

---

## 6. How to run

```bash
# environment (torch has no Python 3.14 wheels; use a 3.12 venv)
uv venv --python 3.12 .venv-train
uv pip install --python .venv-train/bin/python torch numpy pandas pyarrow

# invariant tests (fast, no data)
.venv-train/bin/python -m tests.test_training

# build the full cache once (all 100 mines, stride 1)
.venv-train/bin/python -m training.prepare_cache

# train — early stops on val_C, writes checkpoints/best.pt
.venv-train/bin/python -m training.train --epochs 40

# resume
.venv-train/bin/python -m training.train --epochs 40 \
    --resume training/checkpoints/epoch_012.pt
```

Every tunable is in `training/config.py`, each `[OPEN]` choice annotated with
its justification inline.

---

## 7. File inventory

| File | Purpose | Changed this pass |
|---|---|---|
| `config.py` | every tunable + justification | + early-stop fields |
| `data.py` | parquet → tensors, feature schema, leakage exclusion, windowing | — |
| `graph.py` | per-mine radius graph, guaranteed self-loops | — |
| `model.py` | the four stages (SSM / gate / GNN / head) | — |
| `losses.py` | censored survival NLL + physics regularizers | — |
| `metrics.py` | **concordance index** | **NEW** |
| `train.py` | mine-level batching, truncated BPTT, masking, **early stop** | + C-index eval, early stopping, best.pt |
| `prepare_cache.py` | one-time parquet → npz | — |
| `../tests/test_training.py` | plan invariants (now 11) | + `test_concordance_index` |
| `README.md` | operator-facing notes | updated for metrics + early stop |
