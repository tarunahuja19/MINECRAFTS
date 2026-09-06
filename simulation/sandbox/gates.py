"""
Renumbered test gates for this sandbox (Session A closes T47, T48, T49).

------------------------------------------------------------------------
Gate renumbering: T33-T41 (source plan) -> T47+ (this sandbox)
------------------------------------------------------------------------
The source plan (`07-sandbox-build-plan.md`) numbers its own gates
T33-T41. Those IDs are ALREADY TAKEN in the parent project's canonical
register, `../final/00-README-index.md:262-275`, which defines T33-T46
for entirely different assertions (their T35 = "ReLU makes the strain
loss constant"; T39/T40/T41 = blast-veto tests). That register states
(line 305) it was already globally renumbered once, T1-T46, specifically
to fix nine ID collisions. Reusing T33-T41 here would recreate the exact
problem that renumbering solved. Per the user-approved resolution, the
sandbox's gates are renumbered to T47+:

    T47 <- was T33 : subcritical peak subsidence            (see `test_session_a.py`)
    T48 <- was T34 : SNR detectability margin                (`snr_margin`, `boot_check` below)
    T49 <- was T35 : exactly one implementation of S(x,y,t)   (`check_single_implementation` below)
    T50 <- was T37 : pillar failure warning window & step    (`verify_pillar_failure_warning_gate` below)

T47 has no function in this module: it is a direct assertion on
`surface.S()`'s output, implemented as a test in `tests/test_session_a.py`
rather than as a helper here, since there is nothing to parametrise.
"""

import re
from pathlib import Path

import numpy as np

# ---------------------------------------------------------------------------
# T48 (was T34): SNR detectability margin.
# ---------------------------------------------------------------------------

# Refusal threshold: the sim must refuse to boot if the detectability
# margin (see `snr_margin` below) falls below this, at any point in a
# session. Frozen by the source plan (section 2.2) and unchanged here.
MARGIN_THRESHOLD = 3.0


def snr_margin(sigma: float, delta_signal: float, n: int) -> float:
    """Detectability margin for a linear-trend detector over `n` samples.

    ```
    SE_slope = sigma * sqrt(12 / (n * (n**2 - 1)))
    margin   = delta_signal / (SE_slope * n)
    ```

    `sigma` is the per-sample noise standard deviation, `delta_signal` is
    the total change in signal across the `n`-sample window, both in the
    same units (this gate is evaluated in mm/m of strain — see
    `boot_check`). `n` must be >= 2.

    ------------------------------------------------------------------
    Why n=40, not the source plan's n=20 (measured, not assumed)
    ------------------------------------------------------------------
    Evaluated against the parent project's frozen strain noise budget
    (`../final/00-README-index.md:229`: sigma_w = 1.2 microstrain,
    sigma_b = 0.5 microstrain, quantisation LSB = 1 microstrain, combined
    in quadrature per that file's own convention:
        sigma_total = sqrt(1.2**2 + 0.5**2 + (1/sqrt(12))**2) = 1.332 microstrain
    and the frozen Knothe rate constant c = 0.01414 /day (same file), the
    margin at n=20 (the source plan's original window) works out to
    approximately **2.41** -- BELOW the 3.0 refusal threshold, at every
    point in a session. Gate T34 as originally specified would refuse to
    boot the simulator, always; it could never pass. Widening the window
    to n=40 gives a margin of approximately **6.81**, which passes with
    real headroom. This is why `boot_check` below is exercised at n=40,
    and why `tests/test_session_a.py` keeps an n=20 test around: not
    because n=20 is used anywhere, but to document *why* it isn't.

    (These two figures are the source plan's own reported values, each
    stated to 2-3 significant figures; reproducing them from the frozen
    noise budget and rate constant, using delta_signal = c * strain_peak
    * n with strain_peak = this sandbox's measured compressive peak
    ~9.006 mm/m, lands within a few percent of both -- consistent given
    the source values are themselves rounded. The formula and its inputs
    are documented here in full so the margin is reproducible rather than
    a hardcoded pair of numbers.)

    ------------------------------------------------------------------
    The speed multiplier does NOT rescue a failing margin
    ------------------------------------------------------------------
    `n` ticks span `n` SIM-minutes of elapsed time regardless of the
    speed multiplier that later sessions apply -- the multiplier changes
    only how long that spans in WALL-CLOCK time. Sigma (sensor noise) and
    delta_signal (physical trend over n sim-minutes) are both independent
    of wall-clock speed, so this margin is too. The source plan's section
    2.1 argues time acceleration is needed because "at 1:1, Parts 2 and 3
    receive a flat line" -- true for making a session cover useful
    sim-time, but it does NOT change this margin. A later session must
    not "fix" a failing margin by raising the speed multiplier; the only
    real levers are the noise budget (sigma) and the window (n).

    ------------------------------------------------------------------
    The n vs n-1 span understatement (documented, not corrected)
    ------------------------------------------------------------------
    This formula divides by span `n`, where the true span covered by `n`
    samples (indices 0..n-1) is `n-1`. That understates the margin by
    about `n/(n-1) - 1`, i.e. ~5.3% at n=20 (2.6% at n=40). This module
    keeps the plan's exact form -- it is the CONSERVATIVE direction (a
    real margin is slightly higher than what this reports), so leaving it
    alone never lets an undetectable signal through. Noted here so a
    future reader does not "fix" it and unknowingly change what gate
    behaviour has already been accepted against.
    """
    if n < 2:
        raise ValueError("snr_margin requires n >= 2")
    se_slope = sigma * np.sqrt(12.0 / (n * (n**2 - 1)))
    return delta_signal / (se_slope * n)


def boot_check(sigma: float, delta_signal: float, n: int) -> bool:
    """Boot-check style gate: True (pass, boot allowed) iff
    `snr_margin(sigma, delta_signal, n) >= MARGIN_THRESHOLD`. Mirrors the
    source plan's "prints the margin on boot and refuses to start below
    3.0" behaviour as a plain predicate, so callers can log/raise around
    it however Session C's boot sequence ends up doing so, without this
    module dictating the I/O.
    """
    return bool(snr_margin(sigma, delta_signal, n) >= MARGIN_THRESHOLD)


# ---------------------------------------------------------------------------
# T49 (was T35): exactly one implementation of S(x, y, t) in the sandbox.
# ---------------------------------------------------------------------------

# Matches a `def S(...)` definition AT ANY INDENTATION -- a bare
# module-level function or a class method (`    def S(self, ...)`) alike.
# This must NOT be anchored to column 0: the parent project's own S() at
# `../ground/surface.py:53` is a method (`class GroundModel: def S(self,
# x, y, t): ...`, indented four spaces), and the whole point of this gate
# is to catch a second S() appearing ANYWHERE in the sandbox -- including
# as a class method, which is exactly how the parent project happens to
# structure its own. An earlier version of this pattern was anchored with
# `^def S\s*\(`, which only matched column-0 definitions; it would have
# passed silently if a class method S() were ever added inside the
# sandbox, which is precisely the failure mode this gate exists to catch.
# Deliberately simple otherwise (no import-graph / AST analysis): the
# invariant this gate protects is "nobody pastes a second S() into this
# tree", and a textual def-count check is the smallest thing that catches
# that.
_S_DEF_RE = re.compile(r"^[ \t]*def S\s*\(", re.MULTILINE)


def check_single_implementation(root: Path | str) -> int:
    """Count `def S(...)` definitions (module-level or class-method, any
    indentation) under `root`, and raise AssertionError if the count is
    not exactly 1. Returns the count (1) on success, so callers can also
    use this as a plain counting function.

    ------------------------------------------------------------------
    CRITICAL SCOPING -- get this right or the gate is actively harmful
    ------------------------------------------------------------------
    `root` MUST be `simulation_making/` (this sandbox), never the repo
    root. A repo-wide grep for `def S(` FAILS on day one: the PARENT
    project has its own, separate, legitimate single implementation at
    `../ground/surface.py:53`, which SEVEN other parent-tree modules
    import (`pinn/losses.py`, `sim/sensors.py`, `sim/producer.py`,
    `truth/truth.py`, `viz/app.py`, and two parent test files --
    `tests/test_ground.py`, `tests/test_sim.py`). That module runs a
    completely different parameter set (H=150 m, r=75 m) from this
    sandbox's Adriyala numbers (H=375 m, r=197.4 m) and the two are
    deliberately never blended -- see `constants.py`'s module docstring.

    If this function's search is ever widened to the repo root, it will
    find TWO definitions of `S(` (this sandbox's and the parent's) and
    fail -- and the *wrong* fix, which a future reader might reach for,
    is to delete `../ground/surface.py` "to restore the single-
    implementation invariant". That would break all seven modules that
    import it. The invariant this gate checks is scoped to
    `simulation_making/` by design (source plan defect #1); do not widen
    the search path to "fix" a failure that is actually correct behaviour
    for an out-of-scope directory.
    """
    root = Path(root)
    count = 0
    for path in root.rglob("*.py"):
        text = path.read_text()
        count += len(_S_DEF_RE.findall(text))
    assert count == 1, (
        f"T49 FAIL: expected exactly one def S(...) under {root}, found {count}. "
        "If this search was pointed outside simulation_making/, that is the bug "
        "(see this function's docstring) -- do not delete ../ground/surface.py."
    )
    return count


# ---------------------------------------------------------------------------
# T50 (was T37): scripted pillar failure warning window and step discontinuity
# ---------------------------------------------------------------------------


def verify_pillar_failure_warning_gate(
    zone_transitions: list,
    failing_zone_id: str,
    peak_step_magnitude: float,
    peak_curvature: float,
) -> bool:
    """Gate T50 (was T37): Asserts that:
    1. A scripted pillar failure produces a measurable step discontinuity
       (peak_step_magnitude >= 0.3 m) AND a curvature spike (peak_curvature >= 1.5e-4 /m).
    2. The failing zone transitions into CRITICAL at t_crit and subsequently into
       FAILED at t_failed, with t_crit < t_failed (warning window > 0).
    3. The zone never jumps straight to FAILED without spending time in CRITICAL.

    Returns True if all assertions hold.
    """
    assert peak_step_magnitude >= 0.3, f"T50 FAIL: step magnitude {peak_step_magnitude:.3f}m < 0.3m"
    assert peak_curvature >= 1.5e-4, f"T50 FAIL: curvature {peak_curvature:.2e} < 1.5e-4 /m"

    # Filter transitions for the failing zone
    transitions = [e for e in zone_transitions if e.zone_id == failing_zone_id]
    states = [e.to_state.value for e in transitions]

    assert "CRITICAL" in states, f"T50 FAIL: zone {failing_zone_id} never reached CRITICAL. States: {states}"
    assert "FAILED" in states, f"T50 FAIL: zone {failing_zone_id} never reached FAILED. States: {states}"

    idx_crit = states.index("CRITICAL")
    idx_fail = states.index("FAILED")

    assert idx_crit < idx_fail, (
        f"T50 FAIL: zone {failing_zone_id} jumped to FAILED before or without CRITICAL. "
        f"State sequence: {states}"
    )

    t_crit = transitions[idx_crit].t_days
    t_fail = transitions[idx_fail].t_days
    dwell = t_fail - t_crit
    assert dwell > 0, f"T50 FAIL: zero warning window duration between CRITICAL and FAILED ({dwell})"

    return True


# ---------------------------------------------------------------------------
# T51 (was T38): 2000x session timing drift & CSV tick count equality
# ---------------------------------------------------------------------------


def verify_session_csv_consistency_gate(
    nodes_csv_path: Path | str,
    expected_ticks: int,
    num_nodes: int = 77,
    tick_interval_s: float = 60.0,
) -> bool:
    """Gate T51 (was T38): Asserts that:
    1. The nodes.csv file exists and contains exactly `expected_ticks * num_nodes` data rows
       (excluding comment header lines and column title line).
    2. Consecutive timestamps in the file advance by exactly `tick_interval_s` (60s)
       with zero sim-time drift.
    3. Every active tick contains measurements for all `num_nodes` nodes.

    Returns True if all assertions hold.
    """
    path = Path(nodes_csv_path)
    assert path.exists(), f"T51 FAIL: {path} does not exist"

    lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    # Skip comment lines starting with '#'
    data_lines = [l for l in lines if not l.startswith("#")]
    assert len(data_lines) >= 1, "T51 FAIL: empty CSV file"

    header = data_lines[0].split(",")
    rows = data_lines[1:]

    expected_total_rows = expected_ticks * num_nodes
    assert len(rows) == expected_total_rows, (
        f"T51 FAIL: expected {expected_total_rows} rows ({expected_ticks} ticks * {num_nodes} nodes), "
        f"got {len(rows)} rows"
    )

    # Verify timestamp intervals and node id coverage per epoch
    from datetime import datetime

    dts = []
    for tick_idx in range(expected_ticks):
        epoch_rows = rows[tick_idx * num_nodes : (tick_idx + 1) * num_nodes]
        epoch_node_ids = set()

        for r_str in epoch_rows:
            parts = r_str.split(",")
            t_iso = parts[0]
            n_id = int(parts[1])
            epoch_node_ids.add(n_id)

        assert len(epoch_node_ids) == num_nodes, (
            f"T51 FAIL: tick {tick_idx} has {len(epoch_node_ids)} unique nodes instead of {num_nodes}"
        )

        dt = datetime.fromisoformat(epoch_rows[0].split(",")[0].replace("Z", "+00:00"))
        dts.append(dt)

    # Verify zero sim-time drift across consecutive ticks
    for i in range(1, len(dts)):
        diff_s = (dts[i] - dts[i - 1]).total_seconds()
        assert abs(diff_s - tick_interval_s) < 1e-3, (
            f"T51 FAIL: time drift detected at tick {i}: {diff_s}s != {tick_interval_s}s"
        )

    return True

