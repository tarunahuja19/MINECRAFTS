# WP3 — World-State Engine

| | |
|---|---|
| **Owner** | Antigravity (Lane C) |
| **Depends on** | WP-C stubs; real behaviour from WP1 and WP2 |
| **Blocks** | WP4 |
| **Days** | D1–D3 |
| **Gates** | G6, G13 |

## Goal

Hold the terrain. Advance it one timestep at a time from fitted parameters. Emit a delta log that replays **bit-identically**.

## Files owned

```
src/minesim/world.py
tests/unit/test_world.py
tests/gates/test_g06.py
tests/gates/test_g13.py
```

## The two rules that define this package

**1. The world-state engine owns terrain truth.** It owns the live Z of every node and every grid cell. No model, no sensor module, no radio module, nothing else writes Z. `z0` in the layout is a **static t=0 reference baseline only** — it is never written after t=0. The ground moves up to 1.6 m, so a static Z diverges from reality; the fix is this engine tracking it, not anything else caching it. That is G13.

**2. Replay is exact, not approximate.** Replaying `terrain_changes` from t=0 to T must reproduce the surface at T bit-identically. That is G6, and it is what makes Part 3's timeline scrubbing possible and Part 2's A/B comparisons fair.

## The integer-millimetre rule

This is the single most important implementation decision in the package.

**The internal grid is `np.int32` millimetres.** Deltas are integer millimetres. Accumulation is integer addition. Convert to float only at the `z_at` bilinear interpolation boundary, and never feed the float back into the grid.

Float accumulation drifts. Over a 690-day run at hourly timesteps that is ~16,500 additions per cell, and the accumulated error will fail G6. Integers do not drift. Take the quantisation hit — sub-millimetre terrain precision is meaningless against a 10 mm detection threshold and a 32.6 mm sampling error.

## Interface

Exactly as in `11-interface-contracts-v1.md` §4.

```python
class WorldState:
    def __init__(self, cfg: Config, layout: Layout) -> None: ...
    def step(self) -> Delta: ...
    def z_at(self, x_m: float, y_m: float) -> float: ...
    def snapshot(self) -> np.ndarray: ...
    @property
    def epoch(self) -> int: ...
```

## Work

### Grid

Cell size from `cfg.sim.grid_cell_m`, default 5.0 m. Extent covers the full deformation footprint: `width + 2r` transversely by the panel length plus margins. At 5 m cells over 625 × 2875 m that is 125 × 575 cells — small, so do not optimise it prematurely.

Store origin, cell size and shape alongside the array. Everything downstream converts between world metres and cell indices through this one place.

### Step

Each call to `step()`:

1. Advance the clock by `cfg.sim.timestep_s`.
2. Compute the target surface across the whole grid from `physics.subsidence` at the new time, vectorised — one call, not a Python loop over cells.
3. Round to integer millimetres.
4. Delta is `new_grid - old_grid`, in integer mm.
5. Emit only cells where `dz_mm != 0`.
6. Commit the new grid.

A timestep where nothing moved emits a `Delta` with an **empty `cells` tuple, not no delta at all.** Epoch numbering stays dense; a gap in epochs is indistinguishable from a dropped write.

### `z_at`

Bilinear interpolation from the four surrounding cells. Returns float mm. This is what WP4's sensors sample and it must handle arbitrary node positions, including ones between cells.

### No operator control

Deformation is driven by data and fitted parameters. **There is no click-to-subside.** A client may start, pause and seek; it may not deform the ground. Do not add a `trigger_collapse`, `inject_blast` or `kill_node` method — those are v2 and adding them now puts an operator in the physics path.

## Tests

| Test | Assertion |
|---|---|
| t=0 flat | Initial grid is all zeros; `snapshot()` at epoch 0 matches `terrain_state` |
| Monotone | No cell ever moves upward; every `dz_mm ≤ 0` |
| Dense epochs | Epoch numbers increment by exactly 1, no gaps, including on zero-motion steps |
| Integer grid | `snapshot().dtype == np.int32` |
| Interpolation | `z_at` at an exact cell centre equals that cell's value |
| Interpolation bounds | `z_at` between two cells lies between their values |
| Travelling front | Peak subsidence location tracks `physics.face_position` over time |
| Performance | 690 days at hourly steps completes in under 60 s |

### `tests/gates/test_g06.py` — the replay test

Run 100 timesteps. Capture `snapshot()` at step 100. Independently: start from `terrain_state` at t=0, apply every logged delta in order, compare with `np.array_equal` — **exact equality, not `allclose`**. A tolerance-based assertion here is a broken gate; it would pass while drifting.

Also test a partial replay: replay to step 50, compare against a snapshot taken at step 50.

### `tests/gates/test_g13.py`

Assert `Node.z0_mm` is unchanged between epoch 0 and the end of a run. Since `Node` is a frozen dataclass this is partly structural, but test it at runtime anyway — the realistic failure is a module caching `z0` and treating it as live Z, which is why the gate exists.

## Definition of done

- [ ] All tests pass
- [ ] G6 passes with exact equality on both full and partial replay
- [ ] G13 passes
- [ ] Grid is `int32` millimetres throughout
- [ ] 690-day run completes in under 60 s
- [ ] `terrain_changes.jsonl` written in the contract's format
- [ ] No numeric constant from the assumption register in the file

## Do not

- Use floats for the accumulating grid.
- Skip emitting a delta on a zero-motion timestep.
- Let any other module write Z, or cache `z0` as if it were live.
- Add operator interventions — node kill, blast injection, collapse trigger. All v2.
- Add rainfall, temperature or seasonality modifiers. All v2; they layer on top of this loop as modifiers and the loop does not change to accommodate them.
- Reimplement the subsidence formula. Call `physics.subsidence`. Invariant 4.
