"""
Simulation Packet schema and 60-second window PacketAggregator (§Phase 1 & Phase 2).

Standardized simulation packet representing ONE 60-SIMULATION-SECOND WINDOW.
Features:
1. Configurable channel aggregation rules (MAX, MIN, AVG, LAST, MAX_MAGNITUDE).
2. Sim-time boundary tracking:
     0 <= sim_time < 60   -> packet 0
     60 <= sim_time < 120 -> packet 1
3. Terrain delta tracking and event harvesting per window.
4. Non-blocking buffer handover: packet N is finalized and packet N+1 starts
   immediately with zero lost readings.
"""

from dataclasses import dataclass, field
from enum import Enum
import math
from typing import Any


class AggregationFunc(str, Enum):
    MAX = "MAX"
    MIN = "MIN"
    AVG = "AVG"
    LAST = "LAST"
    MAX_MAGNITUDE = "MAX_MAGNITUDE"


DEFAULT_CHANNEL_RULES: dict[str, AggregationFunc] = {
    # Strain aggregates with signed MAX (tensile peak): positive is tensile, negative is compressive.
    # We do NOT use MAX_MAGNITUDE here to prevent large compressive negative strains from tripping tensile thresholds.
    "strain": AggregationFunc.MAX,
    "strain_ue": AggregationFunc.MAX,
    "tilt_x": AggregationFunc.MAX_MAGNITUDE,
    "tilt_x_urad": AggregationFunc.MAX_MAGNITUDE,
    "tilt_y": AggregationFunc.MAX_MAGNITUDE,
    "tilt_y_urad": AggregationFunc.MAX_MAGNITUDE,
    "tilt_magnitude": AggregationFunc.MAX,
    "displacement": AggregationFunc.MAX,
    "ext_delta_10um": AggregationFunc.MAX,
    "ext_delta_mm": AggregationFunc.MAX,
    "temperature": AggregationFunc.MAX,
    "temp_c": AggregationFunc.MAX,
    "die_temp_dc": AggregationFunc.MAX,
    "battery": AggregationFunc.MIN,
    "vbat_mv": AggregationFunc.MIN,
    "vib_rms": AggregationFunc.MAX,
    "vib_rms_x100": AggregationFunc.MAX,
    "vib_peak": AggregationFunc.MAX,
    "vib_peak_x100": AggregationFunc.MAX,
    "vib_fdom": AggregationFunc.LAST,
    "vib_fdom_hz": AggregationFunc.LAST,
    "rssi": AggregationFunc.AVG,
    "rssi_dbm": AggregationFunc.AVG,
    "snr": AggregationFunc.AVG,
    "snr_db": AggregationFunc.AVG,
    "alive": AggregationFunc.LAST,
    "seq": AggregationFunc.LAST,
    "crack_flags": AggregationFunc.MAX,
}


@dataclass
class NodeAccumulator:
    """Accumulates raw sensor readings for a single node across one window."""

    node_id: int
    tier: str
    values: dict[str, list[float | int]] = field(default_factory=dict)
    last_reading_dict: dict[str, Any] = field(default_factory=dict)
    reading_count: int = 0

    def add_reading(self, reading_dict: dict[str, Any]) -> None:
        self.reading_count += 1
        self.last_reading_dict = reading_dict.copy()

        for key, val in reading_dict.items():
            if val is not None and isinstance(val, (int, float)):
                if key not in self.values:
                    self.values[key] = []
                self.values[key].append(val)

    def finalize(self, rules: dict[str, AggregationFunc]) -> dict[str, Any]:
        """Compute aggregates according to configured aggregation rules."""
        aggregates: dict[str, Any] = {}

        # 1. Evaluate specified or default rules
        for key, raw_list in self.values.items():
            if not raw_list:
                aggregates[key] = None
                continue

            rule = rules.get(key, AggregationFunc.LAST)
            if rule == AggregationFunc.MAX:
                aggregates[key] = max(raw_list)
            elif rule == AggregationFunc.MIN:
                aggregates[key] = min(raw_list)
            elif rule == AggregationFunc.AVG:
                aggregates[key] = round(sum(raw_list) / len(raw_list), 3)
            elif rule == AggregationFunc.LAST:
                aggregates[key] = raw_list[-1]
            elif rule == AggregationFunc.MAX_MAGNITUDE:
                aggregates[key] = max(raw_list, key=lambda x: abs(x))

        # 2. Standardized normalized aggregate names for common metrics
        # Tilt magnitude in urad
        tx = aggregates.get("tilt_x_urad", aggregates.get("tilt_x", 0.0))
        ty = aggregates.get("tilt_y_urad", aggregates.get("tilt_y", 0.0))
        if tx is not None and ty is not None:
            max_tilt_mag = round(math.hypot(float(tx), float(ty)), 2)
        else:
            max_tilt_mag = 0.0

        # Temperature in Celsius
        temp_val = aggregates.get("temp_c")
        if temp_val is None and aggregates.get("die_temp_dc") is not None:
            temp_val = round(aggregates["die_temp_dc"] / 10.0, 2)

        # Displacement in mm
        disp_val = aggregates.get("ext_delta_mm")
        if disp_val is None and aggregates.get("ext_delta_10um") is not None:
            disp_val = round(aggregates["ext_delta_10um"] * 0.01, 3)

        standard_aggregates = {
            "max_strain": aggregates.get("strain_ue", aggregates.get("strain")),
            "max_tilt_x": aggregates.get("tilt_x_urad", aggregates.get("tilt_x")),
            "max_tilt_y": aggregates.get("tilt_y_urad", aggregates.get("tilt_y")),
            "max_tilt_magnitude": max_tilt_mag,
            "max_displacement": disp_val,
            "max_temperature": temp_val,
            "min_battery": aggregates.get("vbat_mv", aggregates.get("battery")),
            "max_vib_peak": aggregates.get("vib_peak_x100", aggregates.get("vib_peak")),
            "max_vib_rms": aggregates.get("vib_rms_x100", aggregates.get("vib_rms")),
            "last_alive": aggregates.get("alive", 1),
            "last_seq": aggregates.get("seq", 0),
            # The state the simulation assigned this node. Dashboards colour
            # by this and nothing else. It is a string, so it never enters
            # `values` / `aggregates` - read it off the last reading instead.
            "node_state": self.last_reading_dict.get("node_state", "ACTIVE"),
        }

        return {
            "node_id": self.node_id,
            "tier": self.tier,
            "aggregates": standard_aggregates,
            "raw_aggregates": aggregates,
            "reading_count": self.reading_count,
            "last_reading": self.last_reading_dict,
        }


class PacketAggregator:
    """Manages 60-sim-second aggregation windows for the simulation session."""

    def __init__(
        self,
        session_id: str = "SIM001",
        grid_id: str = "G8",
        window_duration_sim_s: float = 60.0,
        rules: dict[str, AggregationFunc] | None = None,
        packet_id_base: int | None = None,
    ):
        self.session_id = session_id
        self.grid_id = grid_id
        self.window_duration_sim_s = window_duration_sim_s
        self.rules = dict(DEFAULT_CHANNEL_RULES)
        if rules:
            self.rules.update(rules)

        # packet_id is the PRIMARY KEY of simulation_packets. Seeding it from a
        # millisecond wall-clock base rather than a fixed 1 keeps ids strictly
        # monotonic and unique across runs even when several runs start within
        # the same second, so a new run's packets are INSERTed rather than
        # upserted onto (and hidden behind) a previous run's rows.
        import time as _time
        self._packet_id_base = (
            packet_id_base
            if packet_id_base is not None
            else int(_time.time() * 1000)
        )
        self.current_packet_id: int = self._packet_id_base + 1
        self.window_start_sim_s: float = 0.0
        self.window_end_sim_s: float = window_duration_sim_s

        # Window buffers
        self._node_accumulators: dict[int, NodeAccumulator] = {}
        self._events: list[dict[str, Any]] = []
        self._terrain_deltas: list[dict[str, Any]] = []
        self._max_subsidence_m: float = 0.0
        self._terrain_changed: bool = False

        # Storage of completed packets (recent history buffer)
        self.completed_packets: list[dict[str, Any]] = []
        self._latest_packet: dict[str, Any] | None = None

    def configure_rule(self, channel: str, rule: AggregationFunc | str) -> None:
        """Update aggregation rule for a channel."""
        if isinstance(rule, str):
            rule = AggregationFunc(rule.upper())
        self.rules[channel] = rule

    def add_tick(
        self,
        t_sim_seconds: float,
        tick_duration_s: float,
        readings: list[Any],
        events: list[dict[str, Any]] | None = None,
        perturbations: list[dict[str, Any]] | None = None,
        max_subsidence_m: float = 0.0,
    ) -> dict[str, Any] | None:
        """Ingest one simulation tick.

        If the tick completes the current 60s window, finalizes the packet,
        resets for the next window, and returns the finalized packet.
        Otherwise returns None.
        """
        # 1. Accumulate readings
        for r in readings:
            if hasattr(r, "node_id"):
                nid = r.node_id
                tier = getattr(r, "tier", "1A")
                if nid not in self._node_accumulators:
                    self._node_accumulators[nid] = NodeAccumulator(node_id=nid, tier=tier)

                r_dict: dict[str, Any] = {
                    "node_id": r.node_id,
                    "tier": tier,
                    "seq": getattr(r, "seq", 0),
                    "vbat_mv": getattr(r, "vbat_mv", None),
                    "crack_flags": getattr(r, "crack_flags", None),
                    "rssi_dbm": getattr(r, "rssi_dbm", None),
                    "snr_db": getattr(r, "snr_db", None),
                    "hops": getattr(r, "hops", None),
                    "alive": getattr(r, "alive", 1),
                    "node_state": getattr(r, "node_state", "ACTIVE"),
                }
                channels = getattr(r, "channels", {})
                r_dict.update(channels)
                self._node_accumulators[nid].add_reading(r_dict)
            elif isinstance(r, dict):
                nid = r.get("id", r.get("node_id", 0))
                tier = r.get("tier", "1A")
                if nid not in self._node_accumulators:
                    self._node_accumulators[nid] = NodeAccumulator(node_id=nid, tier=tier)
                self._node_accumulators[nid].add_reading(r)

        # 2. Accumulate events
        if events:
            self._events.extend(events)

        # 3. Track terrain changes
        if perturbations:
            self._terrain_changed = True
            for p in perturbations:
                if p not in self._terrain_deltas:
                    self._terrain_deltas.append(p)
        if max_subsidence_m > self._max_subsidence_m:
            self._max_subsidence_m = max_subsidence_m
            if max_subsidence_m > 0.01:
                self._terrain_changed = True

        # 4. Check window boundary
        tick_end_sim = t_sim_seconds + tick_duration_s
        if tick_end_sim >= self.window_end_sim_s:
            finalized = self._finalize_packet()
            # Advance to next window
            self.current_packet_id += 1
            self.window_start_sim_s = self.window_end_sim_s
            self.window_end_sim_s = self.window_start_sim_s + self.window_duration_sim_s
            # Reset buffers
            self._node_accumulators = {}
            self._events = []
            self._terrain_deltas = []
            self._terrain_changed = False
            return finalized

        return None

    def _finalize_packet(self) -> dict[str, Any]:
        """Assemble the completed packet."""
        nodes_list = [
            acc.finalize(self.rules)
            for acc in sorted(self._node_accumulators.values(), key=lambda a: a.node_id)
        ]

        packet: dict[str, Any] = {
            "packet_id": self.current_packet_id,
            "session_id": self.session_id,
            "grid_id": self.grid_id,
            "start_sim_time": round(float(self.window_start_sim_s), 2),
            "end_sim_time": round(float(self.window_end_sim_s), 2),
            "nodes": nodes_list,
            "terrain": {
                "changed": self._terrain_changed,
                "max_subsidence_m": round(float(self._max_subsidence_m), 4),
                "changes": list(self._terrain_deltas),
            },
            "events": list(self._events),
        }

        self._latest_packet = packet
        self.completed_packets.append(packet)
        # Keep last 100 packets in memory ring buffer
        if len(self.completed_packets) > 100:
            self.completed_packets.pop(0)

        return packet

    def get_latest_packet(self) -> dict[str, Any] | None:
        return self._latest_packet

    def get_packet_by_id(self, packet_id: int) -> dict[str, Any] | None:
        for p in reversed(self.completed_packets):
            if p["packet_id"] == packet_id:
                return p
        return None

    def reset(self, t_start_sim_s: float = 0.0) -> None:
        """Reset aggregator state on simulation rewind."""
        import time as _time
        self._packet_id_base = int(_time.time() * 1000)
        self.current_packet_id = self._packet_id_base + 1
        self.window_start_sim_s = t_start_sim_s
        self.window_end_sim_s = t_start_sim_s + self.window_duration_sim_s
        self._node_accumulators = {}
        self._events = []
        self._terrain_deltas = []
        self._terrain_changed = False
        self.completed_packets = []
        self._latest_packet = None
