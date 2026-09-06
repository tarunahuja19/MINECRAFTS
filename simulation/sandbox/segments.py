"""
Zone segmentation and ground-truth state machine for the mine sandbox.

Segments the 600x600 m simulation window into a 6x6 grid of 36 zones
(Z-01 to Z-36, each 100x100 m).

State machine states:
    STABLE   : No significant subsidence or strain (S < 0.05 m, strains low).
    SETTLING : Uniform subsidence underway (S >= 0.05 m), strains below warning.
    TENSION  : Elevated tensile or compressive strain / curvature approaching limits
               (eps_t >= 4.0 mm/m or eps_c <= -5.0 mm/m or kappa >= 1.0e-4 /m).
    CRITICAL : Limit exceeded (eps_t >= 5.3 mm/m or eps_c <= -6.6 mm/m or kappa >= 1.5e-4 /m).
               Fissure formation predicted.
    FAILED   : Sudden pillar breach / void collapse (step discontinuity Delta_S >= 0.3 m
               or severe curvature spike kappa >= 4.0e-4 /m).

INVARIANT:
- Evaluates TRUTH fields only (never sensor readings or corrupted data).
- When a zone changes state, emits a formatted transition event and invokes
  registered callbacks (for console logging and Session C events.csv writer).
- Gate T50 (was T37): A scripted pillar collapse must transition through
  CRITICAL before reaching FAILED, preserving the warning window.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Sequence

import numpy as np

from sandbox.constants import (
    EPS_COMPRESS_LIMIT,
    EPS_TENSILE_LIMIT,
    WINDOW_SIZE_M,
)


class SegmentState(Enum):
    STABLE = "STABLE"
    SETTLING = "SETTLING"
    TENSION = "TENSION"
    CRITICAL = "CRITICAL"
    FAILED = "FAILED"


# Severity order for comparison
_STATE_SEVERITY = {
    SegmentState.STABLE: 0,
    SegmentState.SETTLING: 1,
    SegmentState.TENSION: 2,
    SegmentState.CRITICAL: 3,
    SegmentState.FAILED: 4,
}

# Grid definitions: 6x6 = 36 zones over 600x600 m
GRID_ZONES_PER_AXIS = 6
ZONE_SIZE_M = WINDOW_SIZE_M / GRID_ZONES_PER_AXIS  # 100.0 m


@dataclass
class ZoneInfo:
    zone_id: str
    ix: int
    iy: int
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    cx: float
    cy: float
    slice_x: slice = field(default_factory=lambda: slice(0, 0))
    slice_y: slice = field(default_factory=lambda: slice(0, 0))
    state: SegmentState = SegmentState.STABLE
    prev_state: SegmentState = SegmentState.STABLE
    t_entered_state: float = 0.0
    last_s: float = 0.0
    last_strain: float = 0.0
    last_kappa: float = 0.0


@dataclass
class TransitionEvent:
    t_days: float
    zone_id: str
    from_state: SegmentState
    to_state: SegmentState
    s_m: float
    eps_mm_per_m: float
    kappa_per_m: float
    message: str


def generate_zones() -> list[ZoneInfo]:
    """Generate the 36 ZoneInfo objects (Z-01 to Z-36) covering the 600x600 m window."""
    zones = []
    half = WINDOW_SIZE_M / 2.0
    zone_num = 1
    cells_per_zone = 40  # (241 - 1) // 6 = 40 cells per zone on the 241x241 grid

    for iy in range(GRID_ZONES_PER_AXIS):
        y_lo = -half + iy * ZONE_SIZE_M
        y_hi = y_lo + ZONE_SIZE_M
        s_y = slice(iy * cells_per_zone, (iy + 1) * cells_per_zone + 1)

        for ix in range(GRID_ZONES_PER_AXIS):
            x_lo = -half + ix * ZONE_SIZE_M
            x_hi = x_lo + ZONE_SIZE_M
            s_x = slice(ix * cells_per_zone, (ix + 1) * cells_per_zone + 1)

            z_id = f"Z-{zone_num:02d}"
            zones.append(
                ZoneInfo(
                    zone_id=z_id,
                    ix=ix,
                    iy=iy,
                    x_min=x_lo,
                    x_max=x_hi,
                    y_min=y_lo,
                    y_max=y_hi,
                    cx=0.5 * (x_lo + x_hi),
                    cy=0.5 * (y_lo + y_hi),
                    slice_x=s_x,
                    slice_y=s_y,
                )
            )
            zone_num += 1
    return zones


def format_transition_line(event: TransitionEvent) -> str:
    """Format a transition event for console output per §5 Session B spec."""
    t_str = f"t=+{event.t_days:6.1f}d"
    z_str = f"{event.zone_id:4s}"
    st_str = f"{event.to_state.value:<8s}"

    if event.to_state == SegmentState.SETTLING:
        metric_str = f"S={event.s_m:.2f}m"
    elif event.to_state in (SegmentState.TENSION, SegmentState.CRITICAL):
        sign = "+" if event.eps_mm_per_m >= 0 else ""
        metric_str = f"ε={sign}{event.eps_mm_per_m:.1f}mm/m  κ={event.kappa_per_m:.1e}"
    else:  # FAILED or STABLE
        sign = "+" if event.eps_mm_per_m >= 0 else ""
        metric_str = f"S={event.s_m:.2f}m  ε={sign}{event.eps_mm_per_m:.1f}mm/m"

    return f"{t_str}  {z_str}  {st_str}  {metric_str:<26s}  {event.message}"


class ZoneManager:
    """Manages zone state evaluations and transitions across the simulation window."""

    def __init__(self, log_to_console: bool = True):
        self.zones: list[ZoneInfo] = generate_zones()
        self.zone_map: dict[str, ZoneInfo] = {z.zone_id: z for z in self.zones}
        self.log_to_console = log_to_console
        self.transition_history: list[TransitionEvent] = []
        self._listeners: list[Callable[[TransitionEvent], None]] = []

    def add_listener(self, callback: Callable[[TransitionEvent], None]) -> None:
        """Register a callback to receive transition events."""
        self._listeners.append(callback)

    def evaluate(
        self,
        X: np.ndarray,
        Y: np.ndarray,
        t: float,
        truth_channels: dict[str, np.ndarray],
        collapse_step: np.ndarray | None = None,
    ) -> list[TransitionEvent]:
        """Evaluate zone states across the window given current truth field channels.

        Parameters
        ----------
        X, Y : np.ndarray
            Grid coordinates (metres).
        t : float
            Current sim-time in days.
        truth_channels : dict[str, np.ndarray]
            Truth channel arrays ('s', 'strain_x', 'strain_y', 'curvature_x', 'curvature_y').
        collapse_step : np.ndarray | None
            Optional step subsidence delta array from collapse.py to detect sudden failure.

        Returns
        -------
        list of TransitionEvent emitted in this evaluation tick.
        """
        s_grid = truth_channels["s"]
        strain_x_mm = truth_channels["strain_x"] * 1000.0  # fraction -> mm/m
        curv_x = np.abs(truth_channels["curvature_x"])
        curv_y = np.abs(truth_channels.get("curvature_y", np.zeros_like(curv_x)))
        curv_mag = np.maximum(curv_x, curv_y)

        events_this_tick = []

        for zone in self.zones:
            s_sub = s_grid[zone.slice_y, zone.slice_x]
            strain_x_sub = strain_x_mm[zone.slice_y, zone.slice_x]
            curv_mag_sub = curv_mag[zone.slice_y, zone.slice_x]

            max_s = float(np.max(s_sub))
            max_tensile = float(np.max(strain_x_sub))
            min_compressive = float(np.min(strain_x_sub))
            max_kappa = float(np.max(curv_mag_sub))

            step_val = 0.0
            if collapse_step is not None:
                step_val = float(np.max(collapse_step[zone.slice_y, zone.slice_x]))

            # Representative strain for reporting
            rep_strain = max_tensile if abs(max_tensile) >= abs(min_compressive) else min_compressive

            # Determine new state based on truth criteria
            new_state = self._determine_state(
                max_s=max_s,
                max_tensile=max_tensile,
                min_compressive=min_compressive,
                max_kappa=max_kappa,
                step_val=step_val,
                current_state=zone.state,
            )

            # Severity latch. Subsidence and the strain it induces are
            # physically irreversible on the sim's timescale (Knothe is
            # monotonic), but the per-tick truth criteria are noisy near a
            # threshold, so a zone would flip CRITICAL -> FAILED -> CRITICAL and
            # raise a fresh alarm on every bounce. A zone never de-escalates on
            # its own; only ZoneManager.reset() (a sim rewind) clears it.
            if _STATE_SEVERITY[new_state] < _STATE_SEVERITY[zone.state]:
                new_state = zone.state

            if new_state != zone.state:
                msg = self._transition_message(zone.state, new_state, rep_strain, max_kappa, max_s)
                ev = TransitionEvent(
                    t_days=t,
                    zone_id=zone.zone_id,
                    from_state=zone.state,
                    to_state=new_state,
                    s_m=max_s,
                    eps_mm_per_m=rep_strain,
                    kappa_per_m=max_kappa,
                    message=msg,
                )
                zone.prev_state = zone.state
                zone.state = new_state
                zone.t_entered_state = t
                zone.last_s = max_s
                zone.last_strain = rep_strain
                zone.last_kappa = max_kappa

                events_this_tick.append(ev)
                self.transition_history.append(ev)

                if self.log_to_console:
                    print(format_transition_line(ev))

                for listener in self._listeners:
                    listener(ev)

        return events_this_tick

    def _determine_state(
        self,
        max_s: float,
        max_tensile: float,
        min_compressive: float,
        max_kappa: float,
        step_val: float,
        current_state: SegmentState,
    ) -> SegmentState:
        # 1. FAILED condition: sudden collapse step >= 0.3 m or severe curvature spike.
        # Gate T50 / T37 Invariant: A zone must visit CRITICAL before reaching FAILED.
        # If sudden failure conditions are met from an earlier state, enforce CRITICAL first.
        if step_val >= 0.30 or (step_val >= 0.15 and max_kappa >= 3.0e-4):
            if current_state == SegmentState.CRITICAL:
                return SegmentState.FAILED
            return SegmentState.CRITICAL

        # 2. CRITICAL condition: tensile or compressive limit exceeded, high curvature, or pre-collapse yield
        if (
            max_tensile >= EPS_TENSILE_LIMIT
            or min_compressive <= -EPS_COMPRESS_LIMIT
            or max_kappa >= 1.5e-4
            or step_val >= 0.03
        ):
            return SegmentState.CRITICAL

        # 3. TENSION condition: approaching tensile threshold or elevated curvature
        if (
            max_tensile >= 4.0
            or min_compressive <= -5.0
            or max_kappa >= 0.9e-4
            or step_val >= 0.02
        ):
            return SegmentState.TENSION

        # 4. SETTLING condition: measurable vertical displacement
        if max_s >= 0.05:
            return SegmentState.SETTLING

        # 5. STABLE
        return SegmentState.STABLE

    def _transition_message(
        self,
        from_st: SegmentState,
        to_st: SegmentState,
        eps: float,
        kappa: float,
        s: float,
    ) -> str:
        if to_st == SegmentState.FAILED:
            return "✖ pillar failure collapsed"
        elif to_st == SegmentState.CRITICAL:
            return "← fissure predicted"
        elif to_st == SegmentState.TENSION:
            return "⚠ approaching threshold"
        elif to_st == SegmentState.SETTLING:
            return "↓ regional subsidence active"
        else:
            return "✓ stable baseline"
