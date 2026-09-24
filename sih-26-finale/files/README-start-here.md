# Start Here — Part 1 Build Plan

> **Current plan (14 Sep 2026 onward):** `BUILD-PLAN.md` is the only build plan (every prompt). `MY-STEPS.md` = Adarsh's decisions + teammate messages. Day-by-day order: `../work-with-tools/` (prompts) and `../work-with-system/` (hands-on). `SIMULATION-IDEA.pdf` = the idea in plain words. `TEAM-BRIEF-V1.md` = brief for ML/backend/hardware teammates. The 10-day schedule below is the original spec record; the sprint dates in `BUILD-PLAN.md` win.

Everything needed to start development, split so four workers run in parallel.

## Files

| File | What it is | Who reads it |
|---|---|---|
| `10-build-order-v1.md` | Master plan: what, when, who, schedule, gates | Everyone, first |
| `11-interface-contracts-v1.md` | **Authoritative.** Every signature and schema | Everyone, constantly |
| `AGENTS.md` | Repo invariants and working rules — goes in the repo root | Every agent, first |
| `work-packages/WPC-contracts-and-skeleton.md` | Scaffolding, D0 | Whoever does D0 |
| `work-packages/WP0-data-pinning.md` | Real data sourcing and fitting | Adarsh + Claude chat |
| `work-packages/WP1-core-physics.md` | `S(x,y,t)` | Claude Code |
| `work-packages/WP2-sizing-algorithm.md` | Node layout and count | Claude Code |
| `work-packages/WP3-world-state-engine.md` | Terrain truth and delta log | Antigravity, Lane C |
| `work-packages/WP4-sensor-models-provenance.md` | Sensors and tagging | Antigravity, Lane C |
| `work-packages/WP5-radio-tdma.md` | LoRa mesh simulation | Antigravity, Lane D |
| `work-packages/WP6-stream-and-output.md` | Files and WebSocket | Antigravity, Lane D |
| `work-packages/WP7-gate-harness.md` | Sixteen gates + integration day | Claude Code |

Every work package is self-contained. Hand one plus `11-interface-contracts-v1.md` to a fresh agent with no other context and it can start.

## Order of operations

1. **D0, together.** Run WP-C. Nothing else starts until the skeleton, config loader and stubs are merged.
2. **D1, split four ways.** Lane A (WP0), Lane B (WP1), Lane C (WP3), Lane D (WP5).
3. **D4.** WP0's G0 gate is the checkpoint. Until it passes, no output from this system goes anywhere near Part 2's training.
4. **D7.** Integration day, everyone, all lanes merged.
5. **D9.** Freeze and hand off.

## Kickoff prompts

Copy these verbatim into a fresh agent session, with the named files attached.

### Claude Code — Lane B

> Attached: `AGENTS.md`, `11-interface-contracts-v1.md`, `WP1-core-physics.md`, `WP2-sizing-algorithm.md`, `WP7-gate-harness.md`.
>
> You own Lane B of a mine subsidence simulator. Build WP1, then WP2, then WP7, in that order. Read `AGENTS.md` first — the eight invariants are not negotiable. `11-interface-contracts-v1.md` is authoritative: if a work package and the contract disagree, the contract wins.
>
> Only edit the files listed under "Files owned" in your work packages. Three other lanes are building in parallel against the same contracts, and a helpful fix outside your files costs more than it saves. If a contract cannot be implemented as written, stop and explain why rather than changing its shape.
>
> Note that the Knothe parameters `subsidence_factor` and `seam_thickness_m` are `null` in the config until WP0 lands. Build against temporary values, but never commit a default that substitutes for them — `load_config()` raising `UnpinnedParameterError` is the intended behaviour, not a bug to work around.
>
> Start with WP1. Show me the physics module and its tests before moving to WP2.

### Antigravity — Lane C

> Attached: `AGENTS.md`, `11-interface-contracts-v1.md`, `WP3-world-state-engine.md`, `WP4-sensor-models-provenance.md`.
>
> You own Lane C of a mine subsidence simulator. Build WP3, then WP4. Read `AGENTS.md` first — the eight invariants are not negotiable. `11-interface-contracts-v1.md` is authoritative.
>
> Only edit the files listed under "Files owned". Lane B owns `physics.py` and `sizing.py` — import them, never edit them. They may still be `NotImplementedError` stubs when you start; build against their signatures and type annotations.
>
> The single most important decision in WP3 is that the accumulating terrain grid is `int32` millimetres, not floats. Gate G6 asserts bit-identical replay over a 690-day run, and float accumulation will fail it.
>
> Start with WP3. Show me `world.py` and the G6 replay test before moving to WP4.

### Antigravity — Lane D

> Attached: `AGENTS.md`, `11-interface-contracts-v1.md`, `WP5-radio-tdma.md`, `WP6-stream-and-output.md`.
>
> You own Lane D of a mine subsidence simulator. Build WP5, then WP6. Read `AGENTS.md` first — the eight invariants are not negotiable. `11-interface-contracts-v1.md` is authoritative.
>
> Only edit the files listed under "Files owned". You depend on Lane B and Lane C only through the `Layout` and `Reading` dataclass shapes, so you can build the entire radio simulation against stubs without waiting for them.
>
> WP5 exists to not have three specific bugs, all documented in the package: the dedup key must be `(node_id, epoch)` and never `seq`; the emergency sub-slot must come from `child_index` and never `node_id % 16`; and per-device ACKs must not exist. Gates G7, G10 and G11 test all three, and G11 is exhaustive over adversarial ID assignments.
>
> Start with WP5. Show me `radio.py` with G7, G10 and G11 passing before moving to WP6.

## Three things that will kill this build if ignored

**Integer millimetres in the terrain grid.** Floats drift over ~16,500 accumulations per cell and G6 fails on the last day, when there is no time to rewrite the world-state engine.

**Contract drift.** Four lanes building against a frozen interface only works while it stays frozen. An agent that quietly adds a dataclass field breaks three other lanes silently and nobody finds out until D7.

**WP0 landing late.** Everything else can be built against defaults, but nothing can be *accepted* until the parameters are real. A measured max subsidence of 1.267 m at 19.5% of seam height is already known to contradict the baseline's `m = 3.0 m, a = 0.6` pair. If WP0 slips, the team is generating training data off a subsidence factor wrong by roughly a factor of three, and will not find out until a judge asks.

## Still open, with defaults so nothing blocks

1. Travelling window vs fixed layout — default travelling, 30 Scouts.
2. Unit costs (A21) — estimates, now informational since the budget cap is deleted.
3. Sensor baselines A8 (10 m rod) and A9 (30 m wire) — practical guesses, they set the strain integration length.
4. GSR 564(E) duty-cycle text — A14 claims the notification regulates power and bandwidth, not duty cycle. Someone should read the actual notification before judging day, because a judge who knows it will ask.
5. Depth conflict — 375 m vs 410 m for Adriyala LW1 across two sources. Using 375; resolve from the JMMF paper's Table 1 in WP0.
