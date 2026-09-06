# Mine Ground-Collapse Hazard Model — Implementation Plan

> **Revision note**: this version patches six issues found in review before implementation (two severe, four real-but-narrower):
> 1. §2.2 — the ZOH formula for `B̄(t)` as originally written required inverting `A`, which is singular whenever a diagonal entry is near zero (a state HiPPO init doesn't preclude and training can reach) — **replaced with a numerically stable `expm1`-based form** with an explicit small-`x` branch.
> 2. §3 — hard gating applied identically at training time starves gradient to the SSM's own recurrence, especially early in training — **added a warm-up period plus a differentiable soft-gate relaxation for training**, hardening to the original threshold at inference.
> 3. §4.2 — softmax neighbor aggregation didn't distinguish fresh from gate-stale neighbor state — **flagged as an explicit open decision** (add a staleness feature to `w_ij`, or justify why not).
> 4. §6 — the censored-likelihood loss didn't specify what happens when a mine's remaining horizon is shorter than the fixed bin count `K` — **added an explicit per-bin horizon-truncation mask**, distinct from the batch-padding mask in §8.
> 5. §7.2(d) — `L_temporal` was computed even on gated-shut ticks, where it's either redundant with or fights the gate's own `decay()` — **added a `g_i(t)` gate-openness factor** so it only applies when the model made a free choice.
> 6. §2.1 — added a low-severity comment flagging that the type indicator needs to survive the input projection, not get summed away.
>
> **Second review pass — implementation-contract completeness (six further patches, applied below):**
> 7. §2.2 — `B(t)`/`C(t)` shape was ambiguous — **pinned down as S4-style, `B(t), C(t) ∈ ℝ^d`, elementwise per-channel**, not a separate expanded state dimension `N`.
> 8. §3 — added an explicit requirement to **anneal `temperature` by global optimizer step, not by epoch**, to avoid a batch-ordering-dependent reproducibility hazard.
> 9. §4.2 — added a **required self-loop on every node** in graph construction (§4.1), so the softmax aggregation is never undefined over an empty neighbor set for isolated nodes.
> 10. §6 — added an **explicit clamp on `λ` (and `1−λ`) before every log term** in the censored log-likelihood, to prevent silent `NaN` loss from float32 sigmoid saturation.
> 11. §7.2(c) — **normalized `L_spatial` and `L_temporal` by edge count / node-tick count** (mean, not sum) per mine, so mine-size variation doesn't distort the effective regularization weight batch-to-batch.
> 12. §8 — stated explicitly that the **batch-padding mask and horizon-truncation mask are safe to combine multiplicatively**, since they mask disjoint failure modes.


**Audience**: this document is written for an LLM coding agent (Opus) to implement from directly. It assumes no other context — everything settled during architecture design is restated here. Do not re-derive or second-guess any decision marked **[SETTLED]**; only the sections marked **[OPEN — CHOOSE AND JUSTIFY]** require a judgment call during implementation, and any choice made there should be recorded in a comment at the point of implementation.

Two companion documents exist and should be treated as authoritative for what they cover:
- A data-generation spec (MATLAB simulation of many mines, sensors, labels) — this plan assumes that data exists in the format it describes and does not repeat it, beyond the summary in Section 1.
- An SSM+GNN architecture-notes doc — this plan is the direct continuation of that doc into an implementable design. Where this plan adds precision or corrects notation from that doc (e.g. the SSM discretization), this plan's version is the one to implement.

Framework is not chosen yet — write this in whatever framework you are instructed to use (JAX/Flax, PyTorch, or PyTorch Geometric + PyTorch), but implement every block and shape exactly as specified below regardless of framework.

---

## 1. Problem statement and data contract [SETTLED]

This is a **survival-analysis / discrete-time hazard estimation** problem, not binary classification. For every sensor node, at every tick, the model outputs a hazard vector over future time bins, from which a survival curve is derived. Training labels are time-to-collapse values with censoring (mines that never collapse within the simulated horizon are censored, not negative examples).

**Per-mine data contract** (one training example = one simulated mine):
- `N` nodes, `N` varies per mine (irregular placement, not fixed across the dataset).
- Each node has a fixed 3D position and a type: `scout` or `geophone`.
- Each node emits a DSP feature vector `x_i(t) ∈ ℝ^m` at every 60-second tick `t`, for `t = 1 … T` (T = mine-specific sequence length).
- `m` is a **shared feature schema across both node types** — see Section 2.1, this is a real constraint, not a simplification.
- Label per node: `(time_to_collapse_i, censored_i)` — a single time-to-event pair per node per mine (censoring flag = 1 if this node's local risk never resolved to collapse within the simulated horizon).
- Graph: fixed per mine, built once from node positions/types (edge construction, Section 4).

Dataset size: ~1,000–5,000 independently simulated mines, split at the **mine level** (not node or tick level) into train/val/test, so no mine's nodes appear in more than one split.

---

## 2. Per-node SSM — temporal encoder [SETTLED]

### 2.1 Input schema (real constraint, do not skip)

Scout nodes and geophone nodes have different native DSP feature counts (geophone nodes carry extra geophone-derived features). Because the SSM has **literally shared weights across both node types**, its input projection has a fixed shape, so:

- Define one shared feature schema of width `m = max(m_scout, m_geophone)`.
- Scout node feature vectors are zero-padded to width `m`.
- Add a 1-dimensional (or one-hot, 2-dim) **node-type indicator** to every feature vector, concatenated on — so the model can tell a zero-padded scout apart from a geophone that happens to read near-zero on those channels. This indicator is part of `x_i(t)` from here on; update `m` accordingly.

Implement this as a preprocessing step, not inside the SSM module.

**Minor note (low severity, worth a code comment)**: a genuinely zero-valued real geophone reading is indistinguishable, in the padded channels, from a scout's structural zero-pad — this is fine in principle (scouts never populate those channels, geophones do), but only holds if the input projection can actually learn to route on the type indicator before those channels get mixed by an early linear layer that treats all `m` input dims symmetrically. Add a one-line comment at the input projection noting that the type indicator should not be trivially summed away.

### 2.2 Recurrence — selective SSM (Mamba/S4-style), corrected notation

**[SETTLED — this corrects a notational error from the architecture-notes doc; implement as written here]**

Do NOT implement `A` as a function of `x(t)`. In real selective SSMs (Mamba), `A` is a **fixed, structured, learned parameter** (initialize diagonal, negative real part — HiPPO-style init is the standard choice) so that the discretized `Ā = exp(Δ·A)` stays bounded for all `Δ > 0`. Only `Δ`, `B`, and `C` are input-dependent, computed by small learned projections of `x(t)`:

```
Δ(t) = softplus(W_Δ · x(t) + b_Δ)          # per-channel, ∈ ℝ^d, > 0
B(t) = W_B · x(t)                            # per-channel, ∈ ℝ^d
C(t) = W_C · x(t)                            # readout projection, ∈ ℝ^d, if y(t) is used

Ā(t) = exp(Δ(t) · A)                         # zero-order hold discretization
B̄(t) = expm1_div(Δ(t) · A) · Δ(t)·B(t)       # ZOH for B; see stable formula below

h_i(t) = Ā(t) · h_i(t-1) + B̄(t) · x_i(t)     # h_i(t) ∈ ℝ^d, d = 32–64 (hyperparameter)
```

**[SETTLED — shape clarification, do not infer a different convention]**: this is **S4-style with scalar-per-channel state**, not full S6 with a separate expanded state dimension `N`. Since `A ∈ ℝ^{d×d}` diagonal (per §2.2 below), `B(t)` and `C(t)` are **`d`-dimensional vectors** (`B(t), C(t) ∈ ℝ^d`), one scalar per channel, matching `A`'s diagonal elementwise — there is no separate `N`. `Δ(t)` is likewise per-channel (`∈ ℝ^d`), not a single shared scalar. Every product above (`Δ(t)·A`, `Ā(t)·h_i(t-1)`, `B̄(t)·x_i(t)`) is an elementwise (Hadamard) product over the `d` channels, never a matrix-vector product against a non-diagonal matrix. Implement `W_Δ, W_B, W_C` as linear projections from the input width `m` to `d`. Do not implement a version with a separate state-expansion size `N ≠ d` — that is a different (S6/full-Mamba) parameterization and is explicitly not what this plan specifies.

**[SETTLED — numerical fix, do not implement the naive matrix-inverse form]**: writing `B̄(t) = (Δ(t)·A)^{-1}(exp(Δ(t)·A) − I) · Δ(t)·B(t)` is **dimensionally correct but numerically unsafe** — it requires `A` invertible, and with diagonal HiPPO-style `A` some channels start (or drift during training) near zero, making `(Δ·A)^{-1}` blow up or produce NaN. `expm1_div(x)` above denotes the elementwise function `(exp(x) − 1) / x`, evaluated with a numerically stable implementation (e.g. a Taylor-series fallback near `x = 0`, or the standard library `expm1(x)/x` with an explicit branch for small `|x|` rather than direct division). Concretely, per diagonal channel `a` of `A`:

```
x = Δ(t) · a
expm1_div(x) = expm1(x) / x            if |x| > eps (e.g. 1e-4)
             = 1 + x/2 + x²/6 + ...    (2–3 term Taylor expansion) otherwise
```

This must be implemented as an explicit elementwise function with the small-`x` branch — do not rely on `(exp(x)-1)/x` alone, since that still divides by (near-)zero, and do not rely on an unqualified phrase like "softplus-stabilized" as a stand-in for this; softplus on `Δ` keeps `Δ > 0` but does nothing to protect against `A` near zero, which is the actual singularity. If a deep-learning framework's built-in `expm1` isn't batched/elementwise-friendly, implement the branch with a `where`/`select` op so it stays differentiable and vectorized.

- `A ∈ ℝ^{d×d}`, structured (diagonal is the standard simplification — implement diagonal `A` unless there is a specific reason not to; it makes the `exp` and the `expm1_div` above elementwise and cheap).
- Weights (`A`, `W_Δ`, `W_B`, `W_C`, and biases) are **shared across every node in every mine** — this is one instance of the module, called once per node per tick; it is not `N` separate models.
- `h_i(t)` is the sole persistent state. See Section 5 for exactly what carries across ticks (Option A — resolved, do not revisit).

### 2.3 Sequence boundary [SETTLED]

At the start of every mine's sequence (`t = 0`), initialize `h_i(0) = 0` (or a small learned initial-state vector shared across all nodes — either is acceptable, pick one and note it) for every node `i` in that mine. Never carry hidden state across mine boundaries. This falls directly out of "shared weights, no memorized node identities" — implement it as a hard reset in the training loop's batching logic, not something the model needs to learn.

---

## 3. Compute gate [SETTLED]

A non-learned, non-differentiable gate sits in front of the SSM+GNN forward pass:

```
score_i(t) = deviation(x_i(t), rolling_baseline_i)     # e.g. Mahalanobis or simple z-score distance
if score_i(t) < tau:
    h_i(t) = h_i(t-1)                                    # identity carry, skip SSM+GNN this tick
    hazard_i(t) = decay(hazard_i(t-1))                   # reuse/decay last output
else:
    run full SSM -> GNN -> hazard head forward pass for this tick
```

**Critical implementation requirement**: apply this identical gating rule during **training**, not just inference. If the model is trained on every tick densely but gated sparsely at inference, it will have learned dynamics for a different update cadence than it will see in production. Implement the gate as part of the training-time forward pass, applied per-node per-tick, exactly as it will run at inference.

**[SETTLED — training-dynamics fix, required, not optional]**: a hard `if/else` gate at training time creates two problems that "identical gating in train and inference" does not by itself solve. First, on any tick where the gate is shut, no SSM/GNN forward pass runs, so **no gradient reaches `A, W_Δ, W_B, W_C` (or the GNN/hazard-head weights) from that tick at all** — the learned dynamics only ever get gradient signal from gated-open ticks. Second, and worse, `rolling_baseline_i` and `score_i(t)` are computed from a model that hasn't learned anything useful yet early in training, so with a poorly-tuned `tau` the gate can shut on most ticks before the SSM has learned any real notion of "novelty" — starving the model of gradient on its own recurrence from the very start, with no crash, just stalled or degenerate convergence. This must be addressed with **both** of the following:

1. **Warm-up**: for the first `N_warmup` epochs (config value, tune on validation; start around 5–10% of total training epochs as a default to justify or override), force the gate fully open (run the full SSM→GNN→hazard forward pass on every tick regardless of `score_i(t)`) so the model first learns real dynamics and a meaningful `rolling_baseline_i` before any gating is applied.
2. **Soft gate during training**: after warm-up, replace the hard threshold with a differentiable relaxation for training only — e.g. `g_i(t) = sigmoid((score_i(t) − tau) / temperature)`, then `h_i(t) = g_i(t) · SSM(x_i(t), h_i(t-1)) + (1 − g_i(t)) · h_i(t-1)` (and similarly blend `hazard_i(t)` with `decay(hazard_i(t-1))`) — with `temperature` annealed toward a small value over training so the soft gate converges toward the hard inference-time behavior by the end of training, while still passing gradient through the low-side branch throughout. At inference, always use the hard threshold as originally specified in this section (no soft blending at inference — the compute savings depend on the hard skip).

Implement `N_warmup` and the temperature-annealing schedule as explicit config values, not hardcoded constants, and note in a code comment that this exists specifically to prevent gradient starvation through the gate.

**[SETTLED — scheduling fix, required]**: anneal `temperature` by **global optimizer step**, not by epoch. Because hidden states reset to zero at every mine boundary (§2.3) and mine sequence length `T` varies per mine, an epoch-indexed schedule makes the effective `temperature` a given mine sees depend on where in the epoch (and which batch-ordering) it happened to fall — mines processed later in an epoch, or in a batch with many long-`T` mines ahead of them, would see a different annealing progress than otherwise-identical mines processed earlier. This is a silent reproducibility hazard, not a crash, so it will not surface as an error — implement the schedule as a pure function of global optimizer step count from the start.

`tau` and whether gating is global (all nodes at once) or per-node is an **[OPEN — CHOOSE AND JUSTIFY]** item — per-node is the more defensible default since nodes can have independent novelty at independent times; note the choice in a config comment.

---

## 4. Spatiotemporal GNN [SETTLED]

### 4.1 Graph construction (per mine, computed once)

- Edges: k-NN or radius-based over 3D node positions — **[OPEN — CHOOSE AND JUSTIFY]** which, and whether scout-scout / geophone-geophone / scout-geophone edges get different radii or k. A reasonable default to start from: radius-based, with geophone nodes' effective radius larger than scout nodes' (consistent with the sensing-radius asymmetry in the data spec) — implement radius per node-type-pair as a config dict, not a hardcoded constant.
- **[SETTLED — degenerate-input fix, required]**: always include a self-loop (`i` as its own neighbor) in the edge set constructed here, for every node, regardless of which edge-construction rule is chosen above. Radius-based construction can leave a node with zero neighbors within radius of everything else (isolated by sparse placement), which makes the softmax normalization in §4.2 undefined over an empty set. A guaranteed self-loop means every node always has at least one edge (to itself), so `a_ij = softmax_j(w_ij)` is always well-defined, and an isolated node's message reduces cleanly to attending only to its own state — "no spatial info this tick" — rather than requiring a separate fallback branch in the aggregation code.
- Edge weight `w_ij`: a function of distance (closer = higher) and node-type pair. Implement as a small learned function of `(distance_ij, type_i, type_j)`, not a fixed hand-picked formula — this lets training adjust how much a geophone neighbor should matter relative to a scout neighbor, per the architecture notes' point about geophone influence radius.

### 4.2 Message passing — corrected: normalized aggregation (real fix, not optional)

**[SETTLED — this corrects a missing-normalization bug in the architecture-notes doc; implement as written here]**

Raw weighted sums (`m_i(t) = Σ w_ij · h_j(t)`) make the message magnitude depend on how many neighbors node `i` has — which breaks generalization across mines with different node densities, directly undermining the stated cross-mine generalization goal. Normalize:

```
a_ij = softmax_j( w_ij )     # normalized over all neighbors j of node i, sums to 1
m_i(t) = Σ_j a_ij · h_j(t)   # weighted average, not raw sum — scale-invariant to neighbor count
```

Implement this as an attention-style softmax over each node's neighborhood, computed fresh per tick (since `h_j(t)` changes every tick even though the neighbor *set* is fixed per mine).

**[OPEN — CHOOSE AND JUSTIFY, do not silently skip]**: because of the compute gate (Section 3), a gated-shut neighbor `j` contributes a stale, identity-carried `h_j(t)` to this softmax with exactly the same weight it would get if it were fresh — `w_ij` is a function of distance/type only and has no notion of neighbor staleness. This means a node whose neighborhood is mostly gated-shut this tick gets an aggregated message silently dominated by old information, with no signal anywhere in the model that this happened. Either (a) add a staleness feature as an input to `w_ij` (e.g. ticks-since-last-gated-open for node `j`, or the gate value `g_j(t)` itself if the soft-gate relaxation from Section 3 is used), so the learned attention can down-weight stale neighbors, or (b) explicitly justify in a code comment why this is acceptable as-is (e.g. if `tau` is tuned low enough that staleness is rare/short-lived in practice). Do not leave this unaddressed by default.

### 4.3 Hops [SETTLED framework, OPEN value]

Run `k` rounds of message passing per tick, `k ≥ 2` as a starting point (per the sparse-geophone / dense-scout layout requiring at least 2 hops for geophone info to reach non-adjacent scouts). Because the feedback path is Option A (Section 5) — cross-node information does **not** persist in memory across ticks — `k` is the *only* lever for per-tick spatial reach; there is no slow multi-tick accumulation fallback. Size `k` with this in mind: it should be large enough that a geophone's signal can reach every scout node within its physical sensing radius within a single tick's message passing, given the mine's typical node density. **[OPEN — CHOOSE AND JUSTIFY]**: treat `k` as a hyperparameter to tune against validation performance, but do not default to `k=2` without checking it against typical node-density/radius numbers from the data spec.

Center-node update after `k` hops:
```
h'_i(t) = update( h_i(t), m_i^{(k)}(t) )     # MLP or GRU-style gated combine — [OPEN, either is fine]
```

### 4.4 Fault-robustness (optional extension, not required for v1) [OPEN]

If implementing outlier down-weighting (a node whose embedding disagrees with its neighborhood gets down-weighted): fold this into the same softmax attention in 4.2 by learning `w_ij` as a function that can also depend on `‖h_i(t) − h_j(t)‖` or similar disagreement measure, rather than only on static distance/type. Not required for the first working version — flag clearly in code as a v2 extension so it isn't silently skipped or silently assumed done.

---

## 5. Feedback path — Option A [SETTLED, do not revisit]

Only `h_i(t)` (the SSM's own state, pre-GNN) persists as next tick's `h_i(t-1)`. `h'_i(t)` (post-GNN) is a **pure read-out** — it feeds the hazard head (Section 6) and is discarded; it is never written back into the SSM's recurrent state.

Implication for implementation: the SSM module's recurrence is self-contained and only ever sees `(h_i(t-1), x_i(t))` — it must never take `h'_i(t-1)` as an input. Keep these as clearly separate variables/tensors in code (e.g. `h` vs `h_prime`) so this isn't accidentally conflated during implementation.

---

## 6. Hazard / survival output head [OPEN — CHOOSE AND JUSTIFY, but constrained as below]

Input: `h'_i(t) ∈ ℝ^d'` for node `i` at tick `t`. Output: a discrete-time hazard representation from which `S_i(t' | t)` (probability node `i` has not collapsed by future time `t'`, given information up to `t`) can be derived.

Two standard formulations, either is acceptable — choose one and implement consistently:

**Discrete-time hazard model** (recommended default — simpler to make numerically well-behaved and easier to combine with the physics loss in Section 7):
```
λ_i(t, k) = sigmoid( MLP(h'_i(t))_k )     # hazard rate in future bin k, k = 1 … K bins, λ ∈ (0, 1)
S_i(t' = t+k | t) = Π_{j=1}^{k} (1 − λ_i(t, j))     # cumulative survival — product of per-bin non-collapse
```

**Cox-style (proportional hazards)**: `h'_i(t)` produces a risk score multiplying a shared learned baseline hazard. More standard in classical survival analysis but more awkward to enforce boundedness on within a neural pipeline — only choose this if there's a specific reason to prefer it.

**Loss (both formulations)**: use the standard discrete-time survival log-likelihood with censoring — for an observed collapse at bin `k*`: maximize `log λ(t,k*) + Σ_{j<k*} log(1−λ(t,j))`; for a censored observation (no collapse by the end of the observed horizon `K`): maximize `Σ_{j=1}^{K} log(1−λ(t,j))` only (no hazard term, since we never observed the event). This is the standard discrete-time hazard / Cox partial-likelihood-style loss — implement it exactly this way, do not substitute a simple regression loss on time-to-collapse (that would silently discard the censoring information the whole framing was chosen to preserve, per Section 1).

**[SETTLED — numerical fix, required, same class of bug as the `expm1` fix in §2.2]**: `λ_i(t,k) = sigmoid(...)` will saturate to exactly `0` or `1` in float32 well before it is mathematically supposed to, and both `log λ` and `log(1−λ)` above will then produce `log(0) = -inf`, which is the single most common way this class of survival model silently emits `NaN` loss partway through training. Clamp before taking the log — e.g. `log(clamp(λ, eps, 1−eps))` and `log(clamp(1−λ, eps, 1−eps))`, with `eps ~ 1e-7` — for every log term in this section's log-likelihood, not just the ones that look most at risk. Implement this as an explicit clamp at the point the log is taken, do not rely on the sigmoid's own smoothness to keep values away from the boundary — training dynamics (large logits, confident predictions late in training) routinely push it there anyway.

**[SETTLED — masking fix, required]**: `K` (the number of future bins predicted at every tick) is fixed globally across mines and ticks — do not let it vary per mine. However, mines have different `T`, so near the end of a mine's sequence the remaining horizon `T − t` can be shorter than `K`. Bins `k` with `t + k > T` are **neither an observed collapse nor a legitimately censored non-collapse** — the simulation simply didn't run long enough to say anything about them, which is a different kind of missingness than ordinary right-censoring. Handle this with an explicit per-bin mask, analogous to the batch padding mask in Section 8: for a given `(node, t)`, only include bins `k = 1 … min(K, T − t)` in that tick's log-likelihood term. If `T − t < K` and the node is uncensored with `k* ≤ T − t`, compute the loss normally up to `k*`. If the node is censored (or `k* > T − t`, i.e. collapse would have happened beyond what was simulated), treat it as censored over the truncated range `1 … (T − t)` only — do not extend the "no collapse" assumption into bins beyond `T`. Implement this as a per-`(node, t, k)` mask multiplied into the log-likelihood sum before reduction, computed alongside (not instead of) the sequence-length padding mask from Section 8, since they mask different things (padding = mine doesn't have this tick at all; horizon-truncation = mine has this tick but not enough future ticks to fill all `K` bins).

---

## 7. Physics-informed regularization loss [SETTLED — design intent below is the correct one; do not implement a simpler/different version without flagging it]

### 7.1 Why this is NOT a physics loss on the SSM, and NOT a re-encoding of the simulator's equations

Two explicit decisions constrain this section:
1. **No physics loss on the SSM specifically.** `h_i(t)` should learn temporal structure from data alone; do not add any loss term that references `h_i(t)` directly against a physical equation.
2. **The physics loss must not use the same governing equations that generated the labels.** If the training labels come from `simulator(mine_params) → time_to_collapse`, and the physics loss is `residual(hazard_output, mine_params)` derived from that same simulator's equations, the model gets a second gradient path that just re-teaches the label — worse, it can learn to shortcut-match simulator structure (e.g. inferring mine geometry from the label distribution) rather than reading actual sensor precursors, which defeats the entire cross-mine generalization goal from Section 1. **Do not implement any loss term that requires knowledge of a specific mine's physical parameters or the simulator's governing equations.** If a proposed physics term needs mine-specific physical constants to evaluate, reject it and use one of the constraints below instead.

### 7.2 The correct class of physics constraints: simulator-independent structural properties of any valid hazard function

These are true by the definition of survival analysis / physical continuity, for *any* mine, regardless of which simulator instance generated it — so they cannot be satisfied by shortcut-matching a specific simulator's internals:

**(a) Monotonicity of survival curve** — `S_i(t' | t)` must be non-increasing in `t'`, for every node, always. This is a mathematical property of any valid survival function, not a fact about mine mechanics.
```
L_mono = Σ_i Σ_k max(0, S_i(t, k) − S_i(t, k−1))     # penalize any increase in survival with increasing k
```
Note: if the hazard-head formulation in Section 6 is implemented exactly as written (product of `(1−λ)` terms with `λ ∈ (0,1)`), monotonicity is **already guaranteed by construction** and this loss term is redundant — only add it if a different output parameterization is chosen that doesn't structurally guarantee monotonicity.

**(b) Hazard non-negativity** — `λ_i(t,k) ≥ 0` for all bins. Also guaranteed by construction if `λ` is a sigmoid output as in Section 6; only relevant if a different parameterization is used.

**(c) Spatial smoothness prior** — physically adjacent nodes (per the fixed graph from Section 4) should not have wildly discontinuous hazard predictions absent an actual anomalous reading. Implement as a soft penalty on the difference in predicted hazard between graph-connected neighbors, scaled inversely by edge distance:
```
L_spatial = (1 / |edges|) · Σ_{(i,j) ∈ edges} (1 / (1 + dist_ij)) · ‖λ_i(t,·) − λ_j(t,·)‖²
```
This uses only fixed graph structure (positions, already known at inference) — never mine-specific physical parameters — so it does not leak simulator-specific information into training.

**[SETTLED — scale-conflation fix, required]**: normalize by edge count (`|edges|`, mean not sum) as shown above, computed per-mine before combining into the batch loss. Section 1 states `N` varies per mine, so edge count varies substantially across mines in the same batch; an unnormalized sum makes a large mine's `L_spatial` dominate the batch total purely from having more edges, disproportionately to `L_survival` (which is already per-(node,tick) averaged per §6/§8's masked-loss handling). Left unnormalized, `λ_spatial`'s effective influence would shift unpredictably batch-to-batch depending on which mine sizes happened to co-occur, rather than behaving as a stable regularization weight. Apply the same mean-not-sum treatment to `L_temporal` below, normalizing by the count of (node, tick) pairs it sums over.

**(d) Temporal smoothness prior** — hazard predictions should not oscillate tick-to-tick without new evidence justifying it. This is partly enforced already by the compute gate (Section 3 forces identity-carry — or, with the soft-gate training relaxation, a blend toward `decay(hazard_i(t-1))` — on low-novelty ticks), but a soft penalty can be added for gated-open ticks too:
```
L_temporal = (1 / |node-tick pairs|) · Σ_i Σ_t g_i(t) · (1 − novelty_i(t)) · ‖λ_i(t,·) − λ_i(t−1,·)‖²
```
using the same novelty score computed for the compute gate (Section 3) as the down-weighting factor — high novelty ticks are allowed to move the prediction a lot, low novelty ticks are penalized for moving it much. As with `L_spatial` above, normalize by the count of (node, tick) pairs summed over (mean, not sum), per mine, before combining into the batch loss — for the same reason: mines have different `N` and `T` (Section 1), so an unnormalized sum lets larger mines dominate this term's contribution disproportionately to `L_survival`.

**[SETTLED — fix for a redundant/conflicting term]**: the `g_i(t)` factor above (the gate's own openness — 1 if gated open, 0 if gated shut, or the soft-gate value during training) is required and was missing from the original formulation. Without it, `L_temporal` is computed on gated-shut ticks too, where `hazard_i(t)` is already forced to equal `decay(hazard_i(t-1))` by the gate's own construction — so `‖λ_i(t) − λ_i(t-1)‖²` there is either already ~0 (if `decay` is near-identity), making the term wasted compute, or actively fights the `decay()` function (if `decay` applies real shrinkage, `L_temporal`'s "don't change" target directly opposes the intentional decay). Multiplying by `g_i(t)` restricts `L_temporal` to ticks where the SSM/GNN/hazard-head actually ran and made a free choice about how much to move — which is the only case this regularizer is meant to constrain.

### 7.3 Combined loss

```
L_total = L_survival (Section 6, primary supervised loss)
        + λ_spatial · L_spatial
        + λ_temporal · L_temporal
        [+ λ_mono · L_mono   only if hazard head parameterization doesn't guarantee it structurally]
```

`λ_spatial`, `λ_temporal` are small regularization weights — **[OPEN — CHOOSE AND JUSTIFY]**, tune on validation; start small (e.g. 0.01–0.1× the scale of `L_survival`) since these are regularizers, not the primary training signal, and should not be allowed to dominate the supervised loss.

### 7.4 Architectural summary of the four-stage split (for reference in code comments)

```
SSM (Section 2)  →  learns temporal representation, per-node, from raw sensor history alone
GNN (Section 4)  →  learns spatial interaction, per-tick, from current SSM states across nodes
Hazard head (Section 6)  →  learns failure risk, per-node, from the spatially-corrected embedding
Physics loss (Section 7)  →  regularizes the hazard head's OUTPUT for physical plausibility,
                              using only simulator-independent structural constraints —
                              never fed back into the SSM or GNN internals, never derived
                              from the same equations that generated the training labels
```
Keep these four stages implemented as separate, clearly-named modules/functions in code, matching this separation exactly — this is a deliberate architectural choice (favored over making `h(t)` itself "physics-aware") and should be visible in the code structure, not just the math.

---

## 8. Training loop structure [SETTLED]

- Batch at the **mine level**: one training example = one mine's full node set + full tick sequence. Mines have different `N` and `T` — batching requires padding/masking across mines (pad node count and sequence length to batch max, mask losses on padding).
- Hidden states reset to zero (Section 2.3) at the start of every mine in the batch — never carried across mines, never across batches unless explicitly re-processing the same mine's continuation.
- Apply the compute gate identically in training and inference (Section 3) — this is not optional.
- Loss is computed and summed across all (node, tick) pairs within a mine that are not padding, then averaged appropriately across the batch (standard masked-loss handling).
- Train/val/test split at the **mine level**, never node- or tick-level, to avoid leakage (a mine's nodes must not appear split across train and val).

**[SETTLED — mask-combination invariant, state explicitly, do not leave implicit]**: two independent masks exist and must both be applied — the batch-padding mask defined here (mine doesn't have this node/tick at all, because it was padded to the batch's max `N`/`T`) and the horizon-truncation mask from Section 6 (mine has this node/tick, but fewer than `K` future bins remain to fill the hazard prediction). These are safe to combine by multiplying together, since they mask disjoint failure modes — node-doesn't-exist-this-tick vs. node-exists-but-insufficient-future — and neither implies or subsumes the other. Apply both masks (multiplicatively) to every relevant loss term before reduction. This invariant should be checked by an assertion or test, not left as something a future refactor of the loss function has to rediscover.

---

## 9. Summary of what to implement, in order

1. Preprocessing: shared feature schema + zero-padding + node-type indicator (Section 2.1).
2. SSM module: fixed structured `A`, input-dependent `Δ, B, C`, ZOH discretization, shared weights (Section 2.2–2.3).
3. Compute gate: novelty score + threshold, identical in train/inference (Section 3).
4. Graph construction: per-mine, fixed, from positions/types (Section 4.1).
5. GNN module: learned edge weights, **normalized (softmax) aggregation**, k hops, center-node update (Section 4.2–4.3).
6. Hazard head: discrete-time hazard MLP + survival product, censored log-likelihood loss (Section 6).
7. Physics regularization losses: spatial smoothness, temporal smoothness, monotonicity-if-needed — using only fixed graph/novelty info, never mine physical parameters (Section 7).
8. Training loop: mine-level batching, masking, hidden-state reset, combined loss (Section 8).

Every **[OPEN]** item above should be implemented with a clear, isolated config value or comment marking it as a tunable choice — not buried as a hardcoded magic number.
