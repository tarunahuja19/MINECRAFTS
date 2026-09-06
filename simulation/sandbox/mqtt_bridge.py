"""MQTT bridge: publish the simulation's per-tick telemetry on the real topics.

The Electron dashboard (`frontend_dashboard/main/mqtt-client.js`) already
subscribes to the production topic tree. Until now nothing published to it, so
the dashboard's MQTT indicator went green off the *backend WebSocket* opening
rather than off a broker connection. This module closes that gap: every sim
tick becomes real MQTT traffic on

    mine/<panel>/node/<node>/telemetry
    mine/<panel>/node/<node>/status
    mine/<panel>/alarm
    mine/<panel>/gateway/health

Design notes
------------
* Publishing is fire-and-forget at QoS 0. Telemetry is a continuous stream; a
  dropped tick is replaced by the next one 60 sim-seconds later, and blocking
  the simulation loop to guarantee delivery would be strictly worse.
* paho's `loop_start()` runs the network loop on its own thread, so
  `publish()` only enqueues — the async tick loop never blocks on socket I/O.
* The bridge is entirely optional. If the broker is down or paho is missing,
  every call is a silent no-op and the simulation runs exactly as before;
  MQTT is an output, never a dependency.
* Node ids are formatted `N01`..`N31` to match what `db.py` writes, so a node
  arriving over MQTT and the same node read back from PostgreSQL agree.
"""

from __future__ import annotations

import json
import math
import threading
from typing import Any

from sandbox import geo

try:
    import paho.mqtt.client as mqtt

    _PAHO_AVAILABLE = True
except ImportError:  # pragma: no cover - exercised only in stripped installs
    _PAHO_AVAILABLE = False


#: Matches `site_id` in the nodes table, so MQTT and PostgreSQL name the same
#: panel. `mqtt-client.js` splits it out of the topic as `_panel_id`.
DEFAULT_PANEL_ID = "adriyala_panel_1"

#: Zone state -> dashboard alarm level. STABLE/SETTLING are normal operation
#: and never raise an alarm; only tension and beyond do.
_STATE_TO_LEVEL = {
    "TENSION": 1,
    "CRITICAL": 2,
    "FAILED": 3,
}


def _node_topic_id(node_id: Any) -> str:
    """Format a sim node id the way `db.py` does: 1 -> "N01"."""
    if isinstance(node_id, int) or str(node_id).isdigit():
        return f"N{int(node_id):02d}"
    return str(node_id)


def _clean(value: Any) -> Any:
    """JSON-safe scalar. NaN/Inf become None so the dashboard sees a gap.

    A channel a tier does not carry is already None and stays None: the null
    rule from `sensors.py` survives onto the wire, because `null` and `0` mean
    categorically different things to the operator.
    """
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, 4)
    return value


class MqttBridge:
    """Publishes simulation output to an MQTT broker.

    Every method is safe to call whether or not the broker is reachable.
    """

    def __init__(
        self,
        broker_host: str = "127.0.0.1",
        broker_port: int = 1883,
        panel_id: str = DEFAULT_PANEL_ID,
        enabled: bool = True,
    ) -> None:
        self.broker_host = broker_host
        self.broker_port = broker_port
        self.panel_id = panel_id
        self.enabled = enabled and _PAHO_AVAILABLE
        self.connected = False
        self.published_count = 0

        self._client: Any = None
        self._lock = threading.Lock()
        #: Last state published per zone, so an alarm goes out on the
        #: transition rather than repeating every tick.
        self._last_zone_state: dict[str, str] = {}
        #: Last state published per node to avoid spamming repeated node alarms.
        self._last_node_state: dict[str, str] = {}

        if enabled and not _PAHO_AVAILABLE:
            print("[MQTT] paho-mqtt not installed - MQTT publishing disabled")

    # ------------------------------------------------------------ lifecycle --

    def connect(self) -> bool:
        """Connect to the broker. Returns True once the network loop is up.

        Uses `connect_async` + `loop_start`, so a broker that is not yet
        listening does not stall simulation startup — paho retries in the
        background and telemetry starts flowing when the broker appears.
        """
        if not self.enabled:
            return False

        try:
            self._client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"r4-sim-bridge-{id(self)}",
            )
            self._client.on_connect = self._on_connect
            self._client.on_disconnect = self._on_disconnect
            # Tell subscribers the publisher died if the sim is killed.
            self._client.will_set(
                f"mine/{self.panel_id}/gateway/health",
                json.dumps({"status": "offline", "reason": "publisher lost"}),
                qos=0,
                retain=True,
            )
            self._client.connect_async(self.broker_host, self.broker_port, keepalive=30)
            self._client.loop_start()
            print(f"[MQTT] bridge connecting to {self.broker_host}:{self.broker_port}")
            return True
        except Exception as e:
            print(f"[MQTT] bridge could not start: {e}")
            self.enabled = False
            return False

    def _on_connect(self, _client, _userdata, _flags, reason_code, _properties=None):
        if reason_code == 0:
            self.connected = True
            print(f"[MQTT] bridge connected to {self.broker_host}:{self.broker_port}")
            self.publish_gateway_health(online=True)
        else:
            self.connected = False
            print(f"[MQTT] bridge connect failed (reason {reason_code})")

    def _on_disconnect(self, _client, _userdata, _flags, reason_code, _properties=None):
        self.connected = False
        if reason_code != 0:
            print(f"[MQTT] bridge disconnected unexpectedly (reason {reason_code})")

    def close(self) -> None:
        """Stop the network loop, announcing a clean shutdown first."""
        if not self._client:
            return
        try:
            self.publish_gateway_health(online=False)
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            pass
        finally:
            self.connected = False
            self._client = None

    # ------------------------------------------------------------ publishing --

    def _publish(self, topic: str, payload: dict[str, Any], retain: bool = False) -> None:
        """Enqueue one message. Never raises: MQTT must not break the sim."""
        if not self.enabled or not self._client:
            return
        try:
            self._client.publish(topic, json.dumps(payload), qos=0, retain=retain)
            with self._lock:
                self.published_count += 1
        except Exception as e:
            print(f"[MQTT] publish failed on {topic}: {e}")

    def publish_simulation_status(self, is_running: bool, is_paused: bool = False) -> None:
        """Publish simulation run status to mine/<panel>/simulation/status."""
        state = "RUNNING" if is_running and not is_paused else ("PAUSED" if is_paused else "STOPPED")
        topic = f"mine/{self.panel_id}/simulation/status"
        self._publish(topic, {"state": state, "is_running": is_running, "is_paused": is_paused}, retain=True)

    def publish_tick(self, readings: list[Any], iso_ts: str) -> int:
        """Publish one telemetry message per node for a single tick.

        Channel names match what `mqtt-client.js` forwards to the renderer and
        what the readings table stores, so a value means the same thing
        regardless of which path it arrived by.
        """
        if not self.enabled:
            return 0

        count = 0
        for r in readings:
            node_id = _node_topic_id(getattr(r, "node_id", None))
            channels = getattr(r, "channels", {}) or {}

            payload: dict[str, Any] = {
                "node_id": node_id,
                "t_utc": iso_ts,
                "tier": getattr(r, "tier", None),
                "seq": getattr(r, "seq", None),
                "alive": getattr(r, "alive", 1),
                "vbat_mv": getattr(r, "vbat_mv", None),
                "rssi_dbm": getattr(r, "rssi_dbm", None),
                "snr_db": _clean(getattr(r, "snr_db", None)),
                "hops": getattr(r, "hops", None),
                "crack_flags": getattr(r, "crack_flags", None),
                # Channels a tier does not carry stay absent -> null, not 0.
                "tilt_x_urad": _clean(channels.get("tilt_x_urad")),
                "tilt_y_urad": _clean(channels.get("tilt_y_urad")),
                "strain_ue": _clean(channels.get("strain_ue")),
                "ext_delta_mm": _clean(channels.get("ext_delta_mm")),
                "vib_rms_x100": _clean(channels.get("vib_rms_x100")),
                "vib_peak_x100": _clean(channels.get("vib_peak_x100")),
                "vib_fdom_hz": _clean(channels.get("vib_fdom_hz")),
                "die_temp_dc": _clean(channels.get("die_temp_dc")),
            }

            self._publish(
                f"mine/{self.panel_id}/node/{node_id}/telemetry", payload
            )
            count += 1

            # A node that stops reporting is a status change, not telemetry:
            # publish it separately so the dashboard can grey the marker.
            if getattr(r, "alive", 1) == 0:
                self._publish(
                    f"mine/{self.panel_id}/node/{node_id}/status",
                    {"node_id": node_id, "state": "offline", "t_utc": iso_ts},
                )

        return count

    def publish_zone_alarms(
        self,
        zones: list[Any],
        iso_ts: str,
        sensor_nodes: list[Any] | None = None,
        active_collapses: list[Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Publish an alarm for each zone that changed state on this tick.

        Only active collapse events trigger zone alarms. Without an active collapse,
        continuous Knothe extraction represents normal baseline settling (0 alarms).
        """
        if not active_collapses:
            return []

        raised = []
        for z in zones:
            zone_id = getattr(z, "zone_id", None)
            state = getattr(getattr(z, "state", None), "value", None)
            if zone_id is None or state is None:
                continue

            if self._last_zone_state.get(zone_id) == state:
                continue
            self._last_zone_state[zone_id] = state

            level = _STATE_TO_LEVEL.get(state)
            if level is None:
                continue  # STABLE / SETTLING are normal operation.

            # Check if this zone is within 1.2x alert radius of any active collapse
            z_cx = float(getattr(z, "cx", 0.0))
            z_cy = float(getattr(z, "cy", 0.0))
            in_alert = False
            for pf in active_collapses:
                alert_r = float(getattr(pf, "radius_m", 60.0)) * 1.2
                p_cx = float(getattr(pf, "cx", 0.0))
                p_cy = float(getattr(pf, "cy", 0.0))
                if math.hypot(z_cx - p_cx, z_cy - p_cy) <= alert_r + 50.0:
                    in_alert = True
                    break
            if not in_alert:
                continue

            lat, lon = geo.xy_to_latlon(z_cx, z_cy)

            affected_nodes: list[str] = []
            if sensor_nodes:
                z_xmin = float(getattr(z, "x_min", -99999.0))
                z_xmax = float(getattr(z, "x_max", 99999.0))
                z_ymin = float(getattr(z, "y_min", -99999.0))
                z_ymax = float(getattr(z, "y_max", 99999.0))
                for node in sensor_nodes:
                    nx = getattr(node, "x_m", None)
                    ny = getattr(node, "y_m", None)
                    if nx is not None and ny is not None:
                        if (z_xmin <= nx <= z_xmax) and (z_ymin <= ny <= z_ymax):
                            affected_nodes.append(_node_topic_id(getattr(node, "node_id", "")))

            alarm = {
                "alarm_id": f"ALM-{zone_id}-{state}",
                "t_utc": iso_ts,
                "panel_id": self.panel_id,
                "zone_id": zone_id,
                "level": level,
                "state": state,
                "centroid": {"lat": round(lat, 6), "lng": round(lon, 6)},
                "affected_nodes": affected_nodes,
                "max_strain_ue": _clean(float(getattr(z, "last_strain", 0.0))),
                "trough_fit_r2": 0.94 if level >= 2 else 0.88,
                "confidence_zone": "high_confidence" if level >= 2 else "medium_warning",
                "blast_correlated": False,
                "projection": {
                    "days_to_level_3": 0 if level >= 3 else 3.5,
                    "confidence": 0.92,
                },
                "explanation": f"Zone {zone_id} entered {state}.",
            }
            self._publish(f"mine/{self.panel_id}/alarm", alarm)
            raised.append(alarm)

        return raised

    def publish_node_alarms(
        self,
        readings: list[Any],
        iso_ts: str,
        sensor_nodes: list[Any] | None = None,
        active_collapses: list[Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Publish an alarm for any node in an elevated strain, tilt, or failure state.

        Only active collapse events trigger alarms. Nodes within 1.2x of the collapse
        radius are evaluated. Normal continuous subsidence produces zero alarms.
        """
        if not active_collapses:
            return []

        node_pos_map: dict[str, tuple[float, float]] = {}
        if sensor_nodes:
            for n in sensor_nodes:
                nid = _node_topic_id(getattr(n, "node_id", ""))
                nx = getattr(n, "x_m", None)
                ny = getattr(n, "y_m", None)
                if nx is not None and ny is not None:
                    node_pos_map[nid] = (float(nx), float(ny))

        alert_nodes = set()
        for pf in active_collapses:
            alert_r = float(getattr(pf, "radius_m", 60.0)) * 1.2
            cx = float(getattr(pf, "cx", 0.0))
            cy = float(getattr(pf, "cy", 0.0))
            for nid, (nx, ny) in node_pos_map.items():
                if math.hypot(nx - cx, ny - cy) <= alert_r:
                    alert_nodes.add(nid)

        raised = []
        for r in readings:
            raw_id = getattr(r, "node_id", "")
            node_id_str = _node_topic_id(raw_id)

            if node_id_str not in alert_nodes:
                continue

            alive = getattr(r, "alive", 1)
            crack_flags = getattr(r, "crack_flags", 0) or 0
            channels = getattr(r, "channels", {}) or {}
            strain_ue = channels.get("strain_ue")
            tilt_x = channels.get("tilt_x_urad")
            tilt_y = channels.get("tilt_y_urad")
            tilt_mag = max(abs(tilt_x or 0), abs(tilt_y or 0))

            level = None
            state = "NORMAL"

            if alive == 0:
                level = 3
                state = "FAILED"
            elif (crack_flags & 1) or (strain_ue is not None and strain_ue >= 5300) or tilt_mag >= 3500:
                level = 3
                state = "CRITICAL"
            elif (strain_ue is not None and strain_ue >= 4000) or tilt_mag >= 1750:
                level = 2
                state = "TENSION"

            if level is None:
                if self._last_node_state.get(node_id_str) not in (None, "NORMAL"):
                    self._last_node_state[node_id_str] = "NORMAL"
                continue

            if self._last_node_state.get(node_id_str) == state:
                continue
            self._last_node_state[node_id_str] = state

            # Find coordinates
            if node_id_str in node_pos_map:
                nx, ny = node_pos_map[node_id_str]
                lat, lon = geo.xy_to_latlon(nx, ny)
            else:
                lat, lon = geo.xy_to_latlon(0.0, 0.0)

            alarm = {
                "alarm_id": f"ALM-{node_id_str}",
                "t_utc": iso_ts,
                "panel_id": self.panel_id,
                "level": level,
                "state": state,
                "centroid": {"lat": round(lat, 6), "lng": round(lon, 6)},
                "affected_nodes": [node_id_str],
                "max_strain_ue": _clean(float(strain_ue if strain_ue is not None else 0.0)),
                "trough_fit_r2": 0.95 if level == 3 else 0.88,
                "confidence_zone": "high_confidence" if level == 3 else "medium_warning",
                "blast_correlated": False,
                "projection": {
                    "days_to_level_3": 0 if level == 3 else 3.0,
                    "confidence": 0.92,
                },
                "explanation": (
                    f"Sensor node {node_id_str} triggered Level {level} alarm "
                    f"(state: {state}, strain: {strain_ue or 0} µε)."
                ),
            }
            self._publish(f"mine/{self.panel_id}/alarm", alarm)
            raised.append(alarm)

        return raised

    def publish_gateway_health(self, online: bool = True, queue_depth: int = 0) -> None:
        """Publish gateway liveness. Retained, so a dashboard that connects
        late learns the current state instead of waiting for the next tick."""
        self._publish(
            f"mine/{self.panel_id}/gateway/health",
            {
                "status": "online" if online else "offline",
                "offline_queue": queue_depth,
                "published": self.published_count,
            },
            retain=True,
        )

    def reset(self) -> None:
        """Forget zone and node alarm history, so a rewound sim re-raises its alarms."""
        self._last_zone_state = {}
        self._last_node_state = {}
