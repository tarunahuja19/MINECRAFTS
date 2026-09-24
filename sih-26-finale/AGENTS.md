# AGENTS.md

Read this before touching anything in this repository. It applies to every agent — Claude Code, Antigravity, or any other — and to human contributors.

This is the Part 1 simulator for an AI-enabled mine subsidence early-warning system (SIH 2025/26, PS 26025, Coal India / Ministry of Coal). It generates terrain that deforms from real fitted data, simulates a LoRa sensor mesh reading that terrain, and streams provenance-tagged output to a forecasting model (Part 2) and a 3D dashboard (Part 3).

## Documents, in precedence order

1. `11-interface-contracts-v1.md` — signatures and schemas. **Authoritative.**
2. This file — invariants and working rules.
3. `10-build-order-v1.md` — what gets built when, by whom.
4. `work-packages/WP*.md` — your specific package.
5. `09-network-and-layout-baseline-v1.md` — physics, radio and layout rationale.

When two disagree, the higher one wins.

## Eight invariants

Do not reverse these. If your package appears to require reversing one, **stop and escalate to Adarsh** rather than working around it.

1. **The world-state engine owns terrain truth**, including the live Z of every node.
2. **There is no PINN in this build.** Every reference to one in files 00–07 is superseded.
3. **No neural network in the safety path.** The classical Knothe-fit detector is the only thing that raises an alarm.
4. **Exactly one implementation of `S(x,y,t)` exists in the repository** — `src/minesim/physics.py`. Every tilt, curvature, strain and displacement value derives numerically from it.
5. **Node count is an output, never an input.** `size_network` takes one argument: the config.
6. **Every emitted value carries a provenance tag** — `real`, `pinned`, or `synthetic`. No fourth option, no `unknown`.
7. **Synthetic values are generated only from the behaviour of data that exists.** Nothing is invented freely.
8. **The system is mine-independent.** Adriyala is one example input. Swapping `config/mines/*.yaml` swaps mines with no code change.

## Working rules

**Stay in your package.** Each work package lists the files it owns. Do not edit files owned by another package — four lanes run in parallel and a helpful cross-package fix costs more than it saves. Need a change outside your files? Write it down and escalate.

**Contracts are frozen.** If a contract cannot be implemented as written, stop and say why. Do not quietly change a shape and carry on; three other lanes are building against it.

**No magic numbers.** Every value from the assumption register lives in `config/assumptions.yaml` or `config/mines/*.yaml`. A literal `375` or `0.6` or `61.7` in `src/` is a bug. G15 tests this.

**Fail loudly.** Missing pinned parameters raise `UnpinnedParameterError`. Never substitute a plausible default for a parameter that was supposed to come from real data — a wrong parameter that runs is worse than a crash.

**Integer millimetres for terrain.** The delta log accumulates by integer addition so replay is bit-identical. Float accumulation drifts and fails G6 on a 690-day run. Convert to float only at the interpolation boundary.

**Simplest version that works.** Every component defaults to the simplest thing that passes its gates. List upgrades separately rather than building them.

**Tests are gates.** `tests/gates/test_gNN.py`, one file per gate, each runnable alone. If a gate needs three other packages finished before it runs, stub them.

## Things that are not our problem

ML architecture, loss functions and training (Part 2). Alarm thresholds and detector tuning (Part 2). React dashboard and 3D rendering (Part 3). Firmware, PCB and procurement. Operator interventions, environment knobs and InSAR context layers (all v2).

If you notice something that affects Part 2, write it into `notes-for-part2.md` rather than solving it.

## Known traps

Field data has already contradicted two assumptions and three earlier documents. Expect more.

- **Seam thickness and subsidence factor are unpinned.** Measured `S_max / m = 0.195` at Adriyala LW1, which is inconsistent with the old `m = 3.0 m, a = 0.6` pair. Both are `null` in config until WP0 fills them. Do not guess them.
- **Panel geometry is 250 m × 2500 m.** A `750 × 350` appears in earlier documents. It is wrong — that is a board-and-pillar shape, not a longwall panel.
- **Peak subsidence is not `a · m`.** The panel is subcritical: 250 m is narrower than the 187.5 m influence radius, so the trough never reaches full depth.
- **LoRa airtime at SF7/BW125/CR4-5 is 61.7 ms**, not the 90.4 ms in earlier documents.
- **Dedup key is `(node_id, epoch)`.** `seq` resets on reboot and silently merges distinct packets.
- **Emergency sub-slot is `child_index`**, not `node_id % 16`. Under modulo, IDs congruent mod 16 collide — exactly the failure the mechanism exists to survive.
- **The 1% duty cycle is self-imposed**, adopted from LPWAN practice. GSR 564(E) regulates power and bandwidth. Do not write comments claiming Indian law mandates 1%.
- **The Knothe model here is symmetric**; the real Adriyala seam is inclined ~10° with a higher angle of draw on the dip side. Expect a systematic residual on one flank. Report it, do not tune it away.
