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

    def publish_zone_alarms(self, zones: list[Any], iso_ts: str) -> list[dict[str, Any]]:
        """Publish an alarm per zone that has *entered* an alarming state.

        Deduplicated on the zone's last published state, so a zone sitting in
        CRITICAL raises one alarm rather than one per tick.

        Returns the alarms it raised. The caller forwards them to the backend so
        they get a row in `alarms` and reach the dashboard's history panel. The
        broker being down must not suppress that: alarm construction and dedup
        happen unconditionally, and only the `_publish` call is skipped when
        MQTT is unavailable. `_publish` is already a no-op when disabled.
        """
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

            lat, lon = geo.xy_to_latlon(float(getattr(z, "cx", 0.0)),
                                        float(getattr(z, "cy", 0.0)))

            alarm = {
                "alarm_id": f"ALM-{zone_id}-{state}",
                "t_utc": iso_ts,
                "panel_id": self.panel_id,
                "zone_id": zone_id,
                "level": level,
                "state": state,
                "centroid": {"lat": round(lat, 6), "lng": round(lon, 6)},
                "max_strain_ue": _clean(float(getattr(z, "last_strain", 0.0))),
                "explanation": f"Zone {zone_id} entered {state}.",
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
        """Forget zone alarm history, so a rewound sim re-raises its alarms."""
        self._last_zone_state = {}
