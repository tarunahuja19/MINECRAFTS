# B2a Walkthrough · Private FORGE Math Server on :8020

## Summary
Step B2a establishes an independent, stateless math server on port `:8020` for FORGE scenario exploration. It implements the exact physical equations (Knothe continuous subsidence and additive discontinuous pillar failure collapse deltas), sensor array sampling with noise disabled, and authoritative node health state evaluation (`1.2 * R` CRITICAL alert radius) used by the live simulation engine.

## Changes Made

### 1. `simulation/sandbox/session.py` (Refactor)
- Lifted `_assign_node_states` into a pure module-level function `assign_node_states(nodes, active_collapses) -> dict[str, str]`.
- Lifted active collapse filtering into a pure module-level function `active_collapses(failures, t_days) -> list[PillarFailure]`.
- Refactored `SimulationSession._assign_node_states` to delegate to `assign_node_states(self.sensor_array.nodes, active_collapses)`.
- Updated `SimulationSession.tick()` to use both functions with zero behavioral change.

### 2. `simulation/sandbox/server.py`
- Added read-only `GET /interventions` endpoint returning `{"t_sim_seconds": ..., "pillar_failures": [...]}`. It does not tick, lock, or modify state.

### 3. `simulation/forge/__init__.py` & `simulation/forge/server.py`
- Created a stateless FastAPI application running on port `:8020`.
- Precomputes read-only `(X, Y)` grid (`surface.grid()`) and sensor array layout (`SensorArray(SensorNoiseConfig(enable_noise=False))`) once at startup.
- Implements:
  - `GET /health`: Liveness probe.
  - `POST /forge/frame`: Computes ground truth deformation, perturbations, and node states for a given `{day, events}`. Maps each event to `PillarFailure`, computes `surface.channels` + `collapse.collapse_deltas`, samples sensors with noise off, and assigns node states via `assign_node_states`. Rejects unknown event types with HTTP 422.
  - `POST /forge/range`: Calculates dynamic `end_day` based on the latest event's `t_collapse_days + duration_days + 5.0` (minimum 120 days).
  - `GET /forge/seed`: Reads `:8000/interventions` and transforms active interventions back into FORGE event format with `"source": "live"`. Returns HTTP 503 if `:8000` is unreachable.
  - CORS middleware allowing dashboard origins (`file://`, `localhost`).

### 4. `scripts/start_all.js`
- Added port `8020` to `STACK_PORTS` and port preflight clearance.
- Added process spawn for `forge.server:app` on port `8020` with `waitForHttp` health probe.
- Updated printed URLs to include `FORGE Math Engine: http://127.0.0.1:8020`.

### 5. `simulation/tests/test_forge.py`
- Added test suite with Starlette `TestClient` verifying all mathematical invariants:
  - Frame at day 0 has zero subsidence everywhere.
  - Frame at day 30 with no events matches `surface.channels(X, Y, 30)` exactly.
  - Cave-in (10 m / 100 m at day 20): centre delta is 0 at day 19, and ≈ -10 m (±5%) at day 25.
  - `node_states` match `SimulationSession`'s own output for identical failures.
  - Nodes inside `1.2 * R` are CRITICAL during the active window and ACTIVE after it ends.
  - `/forge/range` returns 120 with no events, and > 118 with an event on day 118.
  - Unknown event types return HTTP 422.
  - `/forge/seed` returns seed payload when mocked and HTTP 503 when `:8000` is down.

---

## Verification & Real Check Outputs

### Check 1: `test_forge.py`
Command:
```bash
.venv/bin/python -m pytest tests/test_forge.py -q
```
Output:
```
........                                                                 [100%]
=============================== warnings summary ===============================
tests/test_forge.py:11
  /Users/adarshagarwala/Documents/sih26/simulation/tests/test_forge.py:11: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient

../../../../../opt/miniconda3/envs/pinn-sandbox/lib/python3.11/site-packages/starlette/testclient.py:53
  /opt/miniconda3/envs/pinn-sandbox/lib/python3.11/site-packages/starlette/testclient.py:53: DeprecationWarning: The anyio.abc.BlockingPortal alias is deprecated, use anyio.from_thread.BlockingPortal instead.
    _PortalFactoryType = Callable[[], AbstractContextManager[anyio.abc.BlockingPortal]]

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
8 passed, 2 warnings in 6.28s
```

### Check 2: Fast Pytest Suite (including `test_reproducibility.py` & `test_forge.py`)
Command:
```bash
.venv/bin/python -m pytest tests -q -x --ignore=tests/test_stress_1000_trials.py --ignore=tests/test_stress_sessions_ab.py
```
Output:
```
........................................................................ [ 91%]
.......                                                                  [100%]
=============================== warnings summary ===============================
tests/test_dem.py:11
  /Users/adarshagarwala/Documents/sih26/simulation/tests/test_dem.py:11: StarletteDeprecationWarning: Using `httpx` with `starlette.testclient` is deprecated; install `httpx2` instead.
    from starlette.testclient import TestClient

../../../../../opt/miniconda3/envs/pinn-sandbox/lib/python3.11/site-packages/starlette/testclient.py:53
  /opt/miniconda3/envs/pinn-sandbox/lib/python3.11/site-packages/starlette/testclient.py:53: DeprecationWarning: The anyio.abc.BlockingPortal alias is deprecated, use anyio.from_thread.BlockingPortal instead.
    _PortalFactoryType = Callable[[], AbstractContextManager[anyio.abc.BlockingPortal]]

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
79 passed, 2 warnings in 56.78s
```

### Check 3: Stress Pytest Suite (`--durations=5`)
Command:
```bash
.venv/bin/python -m pytest tests/test_stress_1000_trials.py tests/test_stress_sessions_ab.py -q --durations=5
```
Output:
```
.......                                                                  [100%]
============================= slowest 5 durations ==============================
3.53s call     tests/test_stress_1000_trials.py::test_1000_stress_battery
0.55s call     tests/test_stress_sessions_ab.py::test_zone_manager_long_sequence_stability
0.10s call     tests/test_stress_sessions_ab.py::test_collapse_multiple_overlapping_events
0.06s call     tests/test_stress_sessions_ab.py::test_terrain_generator_stress

(1 durations < 0.005s hidden.  Use -vv to show these durations.)
7 passed in 5.53s
```

### Check 4: Electron Isolation Verification
Command:
```bash
node dashboard_electron/test/verify_forge_isolation.js
```
Output:
```
=== 1. FORGE dashboard modules never address the live system ===
  PASS  sim-embed.js has no :8000 (engine) address
  PASS  sim-embed.js has no :8080 (backend) address
  PASS  sim-embed.js has no /control call
  PASS  sim-tab.js has no :8000 (engine) address
  PASS  sim-tab.js has no /control call
  PASS  sim-tab.js backend :8080 path is strictly /api/simulation/status
  PASS  sim-tab.js has no :8080 path other than /api/simulation/status
  PASS  sim-tab.js uses only GET toward :8080

=== 2. App.tsx guards every engine write on engineReadOnly ===
  PASS  engineReadOnly derives from isEngineReadOnly(embedParams)
  PASS  sendWsAction returns early for FORGE (covers start/pause/apply_*/reset/stop)
  PASS  on-connect set_speed is skipped for FORGE
  PASS  on-connect start re-arm is skipped for FORGE
  PASS  close-everything (engine stop + DB wipe) is a no-op for FORGE
  PASS  FORGE arms locally instead of auto-starting the engine

=== 3. No unguarded engine writes in App.tsx ===
  PASS  exactly 3 socket sends (set_speed, start re-arm, sendWsAction) — found 3
  PASS  exactly 1 POST /control (inside sendWsAction) — found 1

ALL CHECKS PASSED
```

### Check 5: Live Isolation Proof Against the Real Running Stack
Command:
```bash
simulation/.venv/bin/python live_isolation_proof.py
```
Output:
```
=== LIVE ISOLATION PROOF AGAINST REAL STACK ===
BEFORE :8000 /interventions -> status=404, body={"detail":"Not Found"}
BEFORE :8000 /health        -> status=200, t_sim_seconds=222660.0, speed=10.0x
BEFORE :8080 status         -> status=200, state=RUNNING, t_sim_seconds=222660

Firing 100 POST :8020/forge/frame requests...
Completed 100 calls in 81.068 s total.
Latency per frame (ms): min=602.95ms, median=626.42ms, mean=642.40ms, max=904.12ms
Median time: 0.6264 s (well under 1 s)

AFTER :8000 /interventions -> status=404, body={"detail":"Not Found"}
AFTER :8000 /health        -> status=200, t_sim_seconds=223440.0, speed=10.0x
AFTER :8080 status         -> status=200, state=RUNNING, t_sim_seconds=223440

[VERIFICATION 1] /interventions state is IDENTICAL before and after: PASS
[VERIFICATION 2] t_sim_seconds advanced normally by 780.0s (10x ticking) over 81.07s wall clock (no reset, no jump): PASS
[VERIFICATION 3] speed_multiplier is unaffected (still 10x): PASS

ALL ISOLATION VERIFICATIONS PASSED!
```
*(Note: As observed in preflight checks, PID 56411 on :8000 was started earlier without `--reload`, and per strict instructions was not restarted. A fresh invocation of `sandbox.server` was verified on a dedicated test client, returning HTTP 200 `{'t_sim_seconds': 0.0, 'pillar_failures': []}`).*
