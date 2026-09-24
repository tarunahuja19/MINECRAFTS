---
title: "Gate G06 — Bit-Identical Terrain Replay"
slug: G06-bit-identical-terrain-replay
type: gate
module: world-state
status: reviewed
tags: [gate, g06, world-state, integer-mm, bit-identical, replay, array-equal]
created: 2026-09-13
updated: 2026-09-13
author: adarsh
last_agent_edit: antigravity
source_file: files/WP3-world-state-engine.md
---

# Gate G06 — Bit-Identical Terrain Replay

| Field | Details |
|---|---|
| **Owning Package** | [[work-packages/WP3-world-state-engine\|WP3]] |
| **Owner** | [[people/antigravity\|Antigravity]] |
| **Verification Target** | Deterministic simulation state & timeline scrub fidelity |
| **Test Script** | `tests/gates/test_g06.py` |

---

## 1. Assertion

Replaying `out/terrain_changes.jsonl` from epoch $0$ to epoch $T$ starting from `out/terrain_state.npz` reproduces the terrain surface at epoch $T$ **bit-identically**. The comparison must pass using `np.array_equal` (zero numerical tolerance; `np.allclose` is strictly prohibited).

---

## 2. Test Implementation

```python
def test_g06_bit_identical_replay(sim_run):
    state_t0 = np.load("out/terrain_state.npz")["elevation_mm"]
    snapshot_T = sim_run.get_snapshot(epoch=100)

    current_grid = state_t0.copy()
    with open("out/terrain_changes.jsonl") as f:
        for line in f:
            data = json.loads(line)
            if data["epoch"] > 100:
                break
            for i, j, dz in data["cells"]:
                current_grid[i, j] += dz

    assert np.array_equal(current_grid, snapshot_T), "Drift detected during integer replay!"
```

---

## 3. Negative Case

Using `float32` or `float64` for grid accumulation introduces rounding drift ($\approx 0.0001\text{ mm}$ per step), causing `np.array_equal` to fail immediately.
