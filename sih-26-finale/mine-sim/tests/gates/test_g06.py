"""Gate G06 — replaying the delta log reproduces the terrain exactly (np.array_equal)."""

from pathlib import Path

import numpy as np

from minesim.config import load_config
from minesim.sizing import size_network
from minesim.world import Delta, WorldState

STEPS = 2400  # 100 days: long enough for rounding-drift bugs to show


def _replay(z0, deltas):
    z = z0.copy()
    for d in deltas:
        for i, j, dz in d.cells:
            z[i, j] += dz
    return z


def _run(world, steps):
    snaps, deltas = {}, []
    for k in range(1, steps + 1):
        deltas.append(world.step())
        if k in (steps // 2, steps):
            snaps[k] = world.snapshot()
    return snaps, deltas


class FloatAccumulatingWorld(WorldState):
    """The bug G06 exists to catch: accumulate float increments and emit rounded increments."""

    def step(self) -> Delta:
        if not hasattr(self, "_s_float"):
            self._s_float = np.zeros(self.shape)
            self._s_prev = np.zeros(self.shape)
        self._epoch += 1
        s_now = self.model_subsidence_mm(self.t_days)
        dz = -np.rint(s_now - self._s_prev).astype(np.int32)   # round(S_t - S_{t-1})
        self._s_prev = s_now
        self._s_float = s_now
        self._z = -np.rint(self._s_float).astype(np.int32)     # snapshot = rounded float truth
        ii, jj = np.nonzero(dz)
        return Delta(self.t_s, self._epoch, tuple(zip(ii.tolist(), jj.tolist(), dz[ii, jj].tolist())))


def test_g06_full_and_partial_replay_exact():
    cfg = load_config(Path("config/assumptions.yaml"))
    world = WorldState(cfg, size_network(cfg))
    snaps, deltas = _run(world, STEPS)
    assert snaps[STEPS].any(), "terrain must have moved for the gate to mean anything"
    assert np.array_equal(_replay(world.z0_mm, deltas), snaps[STEPS])
    assert np.array_equal(_replay(world.z0_mm, deltas[: STEPS // 2]), snaps[STEPS // 2])


def test_g06_negative_float_accumulation_fails():
    cfg = load_config(Path("config/assumptions.yaml"))
    world = FloatAccumulatingWorld(cfg, size_network(cfg))
    snaps, deltas = _run(world, STEPS)
    assert not np.array_equal(_replay(world.z0_mm, deltas), snaps[STEPS])
