"""
Simulation session manager, tick loop, and CSV logging engine (§5 Session C).

Features:
1. Deterministic sim-time tick loop (1 tick = 60 simulated seconds).
2. SNR detectability boot gate (Gate T48 / T34): computes reference signal detectability
   margin on startup and refuses to run if margin < 3.0.
3. Live streaming writers for `nodes.csv` (tiered observation telemetry) and
   `events.csv` (external disturbances and zone transitions).
4. Auto-snapping speed control: snaps to 10x during collapse/critical events (§2.1).
5. Ground-truth intervention routing (§4): modifies ground model, never sensors directly.
6. Compact wire protocol payload builder for WebSocket broadcasting (~2 KB/tick).
"""

import asyncio
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

from sandbox import collapse, constants, gates, layout, segments, surface
from sandbox.collapse import PillarFailure
from sandbox.constants import (
    COLLAPSE_SNAP_SPEED_MULTIPLIER,
    DEFAULT_SPEED_MULTIPLIER,
    SIGMA_STRAIN_UE,
    TICK_SIM_SECONDS,
)
from sandbox.db import db_manager
from sandbox.debug_writer import DebugPacketWriter
from sandbox.ml_hook import process_simulation_packet
from sandbox.mqtt_bridge import MqttBridge
from sandbox.packet import PacketAggregator
from sandbox.sensors import CHANNEL_COLUMNS, CSV_COLUMNS, SensorArray, SensorNoiseConfig, SensorReading


@dataclass
class SessionConfig:
    """Configuration for a simulation run."""

    out_dir: Path = field(default_factory=lambda: Path("out"))
    t_start_seconds: float = 0.0
    tick_duration_sim_s: float = TICK_SIM_SECONDS
    default_speed: float = DEFAULT_SPEED_MULTIPLIER
    # Empty => anchor the simulation clock to wall-clock UTC at session
    # construction. Every reading's `ts` is then genuinely new, so a fresh run
    # actually persists rows into Postgres instead of colliding (ON CONFLICT
    # (node_id, ts) DO NOTHING) with an identical replay from a previous run.
    # Set an explicit ISO string only for deterministic offline replays.
    base_iso_time: str = ""
    noise_config: SensorNoiseConfig = field(default_factory=SensorNoiseConfig)
    scenario_name: str = "adriyala_sandbox"
    seed: int = 42
    save_packet_json: bool = True


class SimulationSession:
    """Manages the full lifecycle of a simulation session."""

    def __init__(self, config: SessionConfig | None = None):
        self.config = config or SessionConfig()
        self.out_dir = Path(self.config.out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)

        # ------------------------------------------------------------------
        # Gate T48 (was T34) SNR self-check on boot
        # ------------------------------------------------------------------
        self.snr_margin = self._verify_boot_snr()

        # Coordinates and state
        self.X, self.Y = surface.grid()
        self.t_sim_seconds: float = self.config.t_start_seconds
        self.tick_index: int = 0
        self.speed_multiplier: float = self.config.default_speed
        self.is_running: bool = False
        self.is_paused: bool = False

        # Physics and instrumentation components
        self.zone_manager = segments.ZoneManager(log_to_console=False)
        self.sensor_array = SensorArray(self.config.noise_config)

        # Interventions & active disturbances
        self.pillar_failures: list[PillarFailure] = []
        self.vibration_transient: float = 0.0
        self.active_vibration_end_t: float = 0.0

        # Base timestamp reference. Wall-clock now when unset (see SessionConfig).
        if self.config.base_iso_time:
            self.base_dt = datetime.fromisoformat(
                self.config.base_iso_time.replace("Z", "+00:00")
            )
        else:
            self.base_dt = datetime.now(timezone.utc).replace(microsecond=0)

        # CSV File handles
        self.nodes_csv_path = self.out_dir / "nodes.csv"
        self.events_csv_path = self.out_dir / "events.csv"
        self._nodes_file = None
        self._events_file = None
        self.last_readings: list[SensorReading] = []

        # 60-sim-second window packet aggregator & debug writer (§Phase 1 & Phase 2)
        self.packet_aggregator = PacketAggregator(
            session_id=self.config.scenario_name,
            grid_id="G8",
            window_duration_sim_s=60.0,
        )
        self.debug_writer = DebugPacketWriter(
            output_dir=self.out_dir / "simulation_packets",
            enabled=self.config.save_packet_json,
        )
        self.on_packet_finalized: list[Callable[[dict[str, Any]], Any]] = []
        self.last_finalized_packet: dict[str, Any] | None = None

        # Publishes each tick to the real MQTT topic tree the Electron
        # dashboard subscribes to. Optional by construction: if the broker is
        # down every call is a no-op and the simulation is unaffected.
        self.mqtt_bridge = MqttBridge(
            broker_host=os.environ.get("R4_BROKER_HOST", "127.0.0.1"),
            broker_port=int(os.environ.get("R4_BROKER_PORT", "1883")),
            enabled=os.environ.get("R4_MQTT_ENABLED", "1") != "0",
        )

    @property
    def session_id(self) -> str:
        """Simulation session identifier."""
        return self.packet_aggregator.session_id

    def register_packet_callback(self, callback: Callable[[dict[str, Any]], Any]) -> None:
        """Register a callback invoked whenever a 60s packet is finalized."""
        if callback not in self.on_packet_finalized:
            self.on_packet_finalized.append(callback)

    def _verify_boot_snr(self) -> float:
        """Evaluate SNR detectability margin at boot. Refuses to start if < 3.0."""
        n_samples = 40
        c_knothe = 0.01414
        strain_peak_compressive = 9.006
        delta_signal = c_knothe * strain_peak_compressive * n_samples

        margin = gates.snr_margin(
            sigma=self.config.noise_config.sigma_strain_ue,
            delta_signal=delta_signal,
            n=n_samples,
        )
        print(f"[BOOT] SNR detectability margin = {margin:.2f} (threshold = {gates.MARGIN_THRESHOLD})")

        if margin < gates.MARGIN_THRESHOLD:
            raise RuntimeError(
                f"Gate T48 Boot Refusal: SNR margin {margin:.2f} is below required threshold "
                f"{gates.MARGIN_THRESHOLD}. Configured noise budget makes reference signal undetectable."
            )
        return margin

    def _write_nodes_header(self, fh) -> None:
        """Write nodes.csv's provenance comment and column header.

        Shared by `start()` and `reset()` so a truncated file and a freshly
        opened one cannot drift apart in what they claim their columns are.
        """
        fh.write(
            f"# GENERATED BY SIMULATOR v1.0 scenario={self.config.scenario_name} seed={self.config.seed}\n"
        )
        fh.write(",".join(CSV_COLUMNS) + "\n")
        fh.flush()

    def _write_events_header(self, fh) -> None:
        """Write events.csv's column header. See `_write_nodes_header`."""
        fh.write("t_iso,kind,x_m,y_m,charge_kg,duration_s,note\n")
        fh.flush()

    def start(self) -> None:
        """Begin (or resume) streaming. Safe to call on an already-open session.

        This is idempotent by design. The UI's PAUSE/START pair sends `pause`
        then `start`, and `start` used to unconditionally reopen both CSVs in
        mode "w" -- so pressing START after a PAUSE silently truncated the run's
        telemetry while `t_sim_seconds` kept climbing. Measured: 3 ticks wrote
        231 data rows, and pressing START discarded every one of them, leaving a
        file whose first row claimed t=+180s. The clock and the file disagreed
        from that point on.

        Rewinding the clock is `reset()`'s job, so resuming a live session only
        re-arms the flags and keeps the open handles. Files are opened (and
        headers written) only when there is no live stream to resume.
        """
        already_streaming = (
            self._nodes_file is not None and not self._nodes_file.closed
        )

        self.is_running = True
        self.is_paused = False

        if already_streaming:
            return

        self._nodes_file = open(self.nodes_csv_path, "w", encoding="utf-8")
        self._write_nodes_header(self._nodes_file)

        self._events_file = open(self.events_csv_path, "w", encoding="utf-8")
        self._write_events_header(self._events_file)

    def get_iso_time(self, t_sim_seconds: float) -> str:
        """Convert sim-seconds to ISO UTC timestamp string."""
        current_dt = self.base_dt + timedelta(seconds=t_sim_seconds)
        return current_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    def tick(self) -> dict[str, Any]:
        """Execute one simulation tick (60 sim-seconds).

        Returns
        -------
        dict
            Wire protocol JSON payload (~2 KB) for WebSocket broadcasting.
        """
        if not self.is_running:
            self.start()

        t_sim_days = self.t_sim_seconds / 86400.0
        iso_ts = self.get_iso_time(self.t_sim_seconds)

        # 1. Evaluate base Knothe ground truth
        base_ch = surface.channels(self.X, self.Y, t_sim_days)

        # 2. Evaluate additive discontinuous collapse deltas
        deltas = collapse.collapse_deltas(self.X, self.Y, t_sim_days, self.pillar_failures)

        # 3. Combine total ground truth fields
        total_channels = {
            "s": base_ch["s"] + deltas["delta_s"],
            "tilt_x": base_ch["tilt_x"] + deltas["delta_tilt_x"],
            "tilt_y": base_ch["tilt_y"] + deltas["delta_tilt_y"],
            "curvature_x": base_ch["curvature_x"] + deltas["delta_curvature_x"],
            "curvature_y": base_ch["curvature_y"] + deltas["delta_curvature_y"],
            "displacement_x": base_ch["displacement_x"] + deltas["delta_displacement_x"],
            "displacement_y": base_ch["displacement_y"] + deltas["delta_displacement_y"],
            "strain_x": base_ch["strain_x"] + deltas["delta_strain_x"],
            "strain_y": base_ch["strain_y"] + deltas["delta_strain_y"],
        }

        # 4. Evaluate segmentation state machine on TRUTH fields only
        transitions = self.zone_manager.evaluate(
            self.X,
            self.Y,
            t_sim_days,
            total_channels,
            collapse_step=deltas["delta_s"],
        )

        # 5. Handle transitions and log to events.csv
        for tr in transitions:
            line = f"{iso_ts},zone_transition,{tr.zone_id},,,0,{tr.from_state.value}->{tr.to_state.value} {tr.message}\n"
            if self._events_file:
                self._events_file.write(line)

            # Auto-snap speed to 10x on collapse / critical warning (§2.1)
            if tr.to_state in (segments.SegmentState.CRITICAL, segments.SegmentState.FAILED):
                self.speed_multiplier = min(self.speed_multiplier, COLLAPSE_SNAP_SPEED_MULTIPLIER)

        if transitions and self._events_file:
            self._events_file.flush()

        # 6. Check vibration transient
        current_vib = self.vibration_transient if self.t_sim_seconds < self.active_vibration_end_t else 0.0

        # 7. Sample sensor array and corrupt telemetry
        readings = self.sensor_array.sample_tick(
            t_sim_days=t_sim_days,
            t_sim_seconds=self.t_sim_seconds,
            iso_timestamp=iso_ts,
            truth_channels=total_channels,
            vibration_transient=current_vib,
        )

        # 8. Write one row per node to nodes.csv
        if self._nodes_file:
            for r in readings:
                self._nodes_file.write(r.to_csv_row() + "\n")
            self._nodes_file.flush()

        # Asynchronously persist readings batch to PostgreSQL without blocking
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(db_manager.save_readings(readings, iso_ts))
        except RuntimeError:
            pass

        # Publish the same tick to MQTT. paho queues on its own thread, so this
        # returns immediately and a broker outage cannot stall the tick loop.
        self.mqtt_bridge.publish_tick(readings, iso_ts)

        # A zone entering TENSION/CRITICAL/FAILED is an alarm. MQTT carries it
        # to the live banner; the backend gives it a row in `alarms` so it also
        # survives into the operator's history panel. Fire-and-forget for the
        # same reason the readings batch is: the tick loop never waits on I/O.
        for alarm in self.mqtt_bridge.publish_zone_alarms(self.zone_manager.zones, iso_ts):
            try:
                asyncio.get_running_loop().create_task(
                    db_manager.post_alarm_to_backend(alarm)
                )
            except RuntimeError:
                pass

        # Terminal Live Logging (§3.1)
        if self.tick_index % 10 == 0 or transitions or current_vib > 0:
            s_peak = float(np.max(total_channels["s"]))
            eps_max = float(np.max(total_channels["strain_x"]))
            print(
                f"[SIM TICK #{self.tick_index:05d}] {iso_ts} (+{t_sim_days:5.2f}d) | "
                f"+{len(readings)} rows -> out/nodes.csv (total {self.tick_index * len(readings)} rows) | "
                f"S_max={s_peak:.3f}m | ε_max={eps_max:+.2f}mm/m | "
                f"PPV={current_vib:.1f}mm/s | speed={int(self.speed_multiplier)}x"
            )

        # 9. Construct wire protocol message (~2 KB)
        time_scalar = float(1.0 - np.exp(-constants.C_KNOTHE * t_sim_days)) if t_sim_days > 0 else 0.0

        perturbations = []
        for pf in self.pillar_failures:
            step_frac, yield_frac, _ = collapse._time_evolution(
                t_sim_days, pf.t_init_days, pf.t_collapse_days, pf.duration_days
            )
            if t_sim_days >= pf.t_init_days:
                perturbations.append(
                    {
                        "cx": pf.cx,
                        "cy": pf.cy,
                        "radius_m": pf.radius_m,
                        "amp": float(pf.magnitude_m * step_frac),
                        "yield": float(yield_frac),
                    }
                )

        # Store latest full readings for detailed on-demand inspection
        self.last_readings = readings

        # Ingest tick into 60-sim-second PacketAggregator (§Phase 1 & Phase 2)
        ev_dicts: list[dict[str, Any]] = [
            {
                "time": iso_ts,
                "kind": "zone_transition",
                "zone_id": tr.zone_id,
                "from": tr.from_state.value,
                "to": tr.to_state.value,
                "msg": tr.message,
            }
            for tr in transitions
        ]
        if current_vib > 0.0:
            ev_dicts.append({
                "time": iso_ts,
                "kind": "vibration_transient",
                "magnitude_ppv": float(current_vib),
            })

        s_peak = float(np.max(total_channels["s"]))
        finalized_packet = self.packet_aggregator.add_tick(
            t_sim_seconds=self.t_sim_seconds,
            tick_duration_s=self.config.tick_duration_sim_s,
            readings=readings,
            events=ev_dicts,
            perturbations=perturbations,
            max_subsidence_m=s_peak,
        )

        if finalized_packet:
            # Stamp the packet with real wall-clock time at the moment it was
            # finalized, plus the simulated ISO instant for the window end.
            # `start_sim_time` / `end_sim_time` are *offsets in sim-seconds* from
            # session start - the dashboard must not treat them as Unix epochs
            # (that renders 1970-01-01). `emitted_wall_s` is what "last seen"
            # and chart x-axes should key off; `end_sim_iso` is the in-world
            # clock for display.
            finalized_packet["emitted_wall_s"] = time.time()
            finalized_packet["end_sim_iso"] = self.get_iso_time(
                finalized_packet["end_sim_time"]
            )
            self.last_finalized_packet = finalized_packet
            print(
                f"[PACKET] finalized packet #{finalized_packet['packet_id']} "
                f"(sim_time {finalized_packet['start_sim_time']}s - {finalized_packet['end_sim_time']}s)"
            )
            self.debug_writer.write_packet(finalized_packet)
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(db_manager.save_packet(finalized_packet))
            except RuntimeError:
                pass
            try:
                process_simulation_packet(finalized_packet)
            except Exception as e:
                print(f"[ML] Warning: process_simulation_packet failed: {e}")

            for cb in self.on_packet_finalized:
                try:
                    cb(finalized_packet)
                except Exception as e:
                    print(f"[PACKET] Warning: packet listener error: {e}")

        payload = {
            "t_sim": int(self.t_sim_seconds),
            "t_days": round(float(t_sim_days), 4),
            "time_scalar": round(time_scalar, 5),
            "speed_multiplier": float(self.speed_multiplier),
            "vibration_active": current_vib > 0.0,
            "vibration_ppv": float(current_vib),
            "perturbations": perturbations,
            "packet_available": (
                {
                    "type": "packet_available",
                    "packet_id": finalized_packet["packet_id"],
                    "session_id": finalized_packet["session_id"],
                    "grid_id": finalized_packet["grid_id"],
                    "start_sim_time": finalized_packet["start_sim_time"],
                    "end_sim_time": finalized_packet["end_sim_time"],
                }
                if finalized_packet
                else None
            ),
            # Per-tick wire payload. Channel values are passed through
            # AS-IS, including None: a tier that carries no strain gauge
            # sends `strain: null`, which is categorically different from
            # `strain: 0` and must survive the wire intact.
            #
            # Only values that CHANGE per tick belong here. `tier`, `hops`
            # and the rest of the topology are static and are sent once in
            # the init frame — repeating them every 60 s would be the
            # "mesh leaking into the tick payload" this budget guards.
            "nodes": [
                {
                    "id": r.node_id,
                    "tilt_x": r.get("tilt_x_urad"),
                    "tilt_y": r.get("tilt_y_urad"),
                    "strain": r.get("strain_ue"),
                    "vib_rms": r.get("vib_rms_x100"),
                    "vib_peak": r.get("vib_peak_x100"),
                    "vib_fdom": r.get("vib_fdom_hz"),
                    "rssi": r.rssi_dbm,
                    "snr": r.snr_db,
                    "alive": r.alive,
                }
                for r in readings
            ],
            "segments": [
                {
                    "id": z.zone_id,
                    "state": z.state.value,
                    "eps": round(float(z.last_strain), 2),
                    "kappa": round(float(z.last_kappa), 6),
                }
                for z in self.zone_manager.zones
            ],
        }

        # Advance sim-time
        self.t_sim_seconds += self.config.tick_duration_sim_s
        self.tick_index += 1

        return payload

    def apply_collapse(
        self,
        cx: float,
        cy: float,
        radius_m: float = 60.0,
        magnitude_m: float = 0.75,
        duration_hours: float = 4.8,
        warning_hours: float = 8.0,
    ) -> PillarFailure:
        """Trigger a discontinuous pillar failure intervention."""
        t_current_days = self.t_sim_seconds / 86400.0
        t_init = t_current_days
        t_collapse = t_init + (warning_hours / 24.0)
        duration_days = duration_hours / 24.0

        pf = PillarFailure(
            cx=cx,
            cy=cy,
            radius_m=radius_m,
            t_init_days=t_init,
            t_collapse_days=t_collapse,
            duration_days=duration_days,
            magnitude_m=magnitude_m,
        )
        self.pillar_failures.append(pf)

        iso_ts = self.get_iso_time(self.t_sim_seconds)
        if self._events_file:
            self._events_file.write(
                f"{iso_ts},collapse,{cx:.1f},{cy:.1f},,{int(duration_hours * 3600)},"
                f"pillar_failure mag={magnitude_m:.2f}m radius={radius_m:.1f}m\n"
            )
            self._events_file.flush()

        return pf

    def apply_vibration(
        self,
        magnitude_ppv: float = 12.0,
        duration_s: float = 60.0,
        kind: str = "blast",
        note: str = "DGMS blast simulation",
    ) -> None:
        """Trigger a transient vibration without affecting ground subsidence S(x,y,t)."""
        self.vibration_transient = magnitude_ppv
        self.active_vibration_end_t = self.t_sim_seconds + duration_s

        iso_ts = self.get_iso_time(self.t_sim_seconds)
        if self._events_file:
            self._events_file.write(
                f"{iso_ts},{kind},0,0,120,{int(duration_s)},{note}\n"
            )
            self._events_file.flush()

    def set_speed(self, multiplier: float) -> None:
        """Set simulation speed multiplier."""
        self.speed_multiplier = max(1.0, float(multiplier))

    def stop(self) -> None:
        """Stop session and close files."""
        self.is_running = False
        if self._nodes_file and not self._nodes_file.closed:
            self._nodes_file.flush()
            self._nodes_file.close()
        if self._events_file and not self._events_file.closed:
            self._events_file.flush()
            self._events_file.close()

    def reset(self) -> None:
        """Return the session to its initial state, discarding all interventions.

        Closes any open CSV handles, rewinds sim-time to the configured start,
        and clears every accumulated intervention and derived state. The
        coordinate grid and the boot SNR margin are preserved: the grid is
        immutable and re-running the boot gate would repeat a check that
        already passed for this configuration.
        """
        self.stop()

        self.t_sim_seconds = self.config.t_start_seconds
        self.tick_index = 0
        self.speed_multiplier = self.config.default_speed
        self.is_paused = False

        # Interventions and transient disturbances
        self.pillar_failures = []
        self.vibration_transient = 0.0
        self.active_vibration_end_t = 0.0

        # Derived state accumulated during a run
        self.last_readings = []
        self._nodes_file = None
        self._events_file = None

        # Truncate both CSVs to their headers NOW, rather than waiting for the
        # next start() to reopen them with mode "w". `stop()` above only closed
        # the handles, so the previous run's rows stayed on disk and stayed
        # downloadable through /data/nodes.csv — a reset that visibly cleared
        # the panel while still serving the old telemetry. Measured: 5 ticks
        # wrote 167 lines, and every one of them survived the reset.
        with open(self.nodes_csv_path, "w", encoding="utf-8") as fh:
            self._write_nodes_header(fh)
        with open(self.events_csv_path, "w", encoding="utf-8") as fh:
            self._write_events_header(fh)

        # Zone state machine and sensor noise stream are stateful across ticks
        # and must not carry a previous run's history into a new one.
        self.zone_manager = segments.ZoneManager(log_to_console=False)
        self.sensor_array = SensorArray(self.config.noise_config)
        self.packet_aggregator.reset(self.config.t_start_seconds)
        self.last_finalized_packet = None
        self.mqtt_bridge.reset()

    def get_node_telemetry(self, node_id: int) -> dict[str, Any] | None:
        """Return the full telemetry reading for a specific node.

        Every channel this node's tier carries is included; every channel
        it does not is `None`. This method used to substitute defaults for
        missing values (temp 28.5, rssi -85, hops 1), which made a node
        that never reported a channel indistinguishable from one that
        reported a plausible value. Under the tier system that is not a
        cosmetic issue: most nodes legitimately lack most channels, and a
        default here would manufacture readings from hardware that does
        not exist. Nulls are passed through untouched.
        """
        for r in self.last_readings:
            if r.node_id == node_id:
                out: dict[str, Any] = {
                    "node_id": r.node_id,
                    "tier": r.tier,
                    "t_iso": r.t_iso,
                    "seq": r.seq,
                    "vbat_mv": r.vbat_mv,
                    "crack_flags": r.crack_flags,
                    "rssi_dbm": r.rssi_dbm,
                    "snr_db": r.snr_db,
                    "hops": r.hops,
                    "tx_dbm": r.tx_dbm,
                    "alive": r.alive,
                }
                out.update({c: r.get(c) for c in CHANNEL_COLUMNS})

                # Convenience conversions, null-preserving.
                ext = r.get("ext_delta_10um")
                out["ext_delta_mm"] = (ext * 0.01) if ext is not None else None
                die = r.get("die_temp_dc")
                out["temp_c"] = (die / 10.0) if die is not None else None
                return out
        return None
