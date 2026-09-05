'use strict';

/**
 * Live Provider & Simulation WebSocket Client (§Phase 6 & 7)
 * Connects to the Folder A Backend WebSocket infrastructure (ws://localhost:8080/ws)
 * and automatically fetches 60-second simulation packets via GET /simulation/packets/:packet_id.
 */
var liveProvider = (function () {
  var active = false;
  var ws = null;
  var reconnectTimer = null;
  var knownNodes = {};
  var heartbeatTimers = {};
  var HEARTBEAT_TIMEOUT_MS = 60000;
  var WS_URL = 'ws://' + (window.location.hostname || 'localhost') + ':8080/ws';
  var API_BASE = 'http://' + (window.location.hostname || 'localhost') + ':8080';

  var started = false;

  function start() {
    active = true;

    // mode-switch calls start() twice (once on init, once when it settles on
    // LIVE mode). Registering the window.r4 IPC handlers a second time makes
    // every telemetry / alarm frame fire its bus event twice - which is what
    // put "Applying simulation packet" in the log twice per id and doubled
    // every downstream render and alarm. Wire the handlers exactly once.
    if (started) {
      connectWebSocket();
      return;
    }
    started = true;

    // 1. If running under Electron IPC bridge, register window.r4 handlers
    if (window.r4) {
      window.r4.onTelemetry(function (data) {
        if (!active) return;
        handleTelemetry(data);
      });

      window.r4.onAlarm(function (data) {
        if (!active) return;
        bus.emit('alarm', data);
      });

      window.r4.onStatus(function (data) {
        if (!active) return;
        var nodeId = data._node_id || data.node_id;
        if (nodeId && data.state) {
          bus.emit('node-status-change', { node_id: nodeId, state: data.state });
        }
        bus.emit('node-status', data);
      });

      window.r4.onMqttStatus(function (status) {
        bus.emit('mqtt-status', status);
      });

      window.r4.onGatewayHealth(function (data) {
        bus.emit('gateway-health', data);
      });
    }

    // 2. Connect to the unified Backend WebSocket server
    connectWebSocket();
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.warn('[live-provider] WebSocket connection failed:', e);
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      console.log('[live-provider] Connected to backend WebSocket:', WS_URL);
      bus.emit('mqtt-status', 'connected');
      bus.emit('gateway-health', { status: 'online', offline_queue: 0 });
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = function (event) {
      if (!active) return;
      try {
        var msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (e) {
        console.warn('[live-provider] Non-JSON WS frame:', event.data);
      }
    };

    ws.onclose = function () {
      console.log('[live-provider] WebSocket disconnected');
      bus.emit('mqtt-status', 'disconnected');
      scheduleReconnect();
    };

    ws.onerror = function (err) {
      console.warn('[live-provider] WebSocket error');
      if (ws) ws.close();
    };
  }

  function scheduleReconnect() {
    if (!reconnectTimer && active) {
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        connectWebSocket();
      }, 3000);
    }
  }

  function handleWsMessage(msg) {
    if (!msg) return;

    // React automatically to Phase 6 notification
    if (msg.type === 'packet_available') {
      console.log('[live-provider] New simulation packet available (# ' + msg.packet_id + '), fetching...');
      fetchSimulationPacket(msg.packet_id);
    } else if (msg.type === 'telemetry') {
      handleTelemetry(msg);
    } else if (msg.type === 'alarm') {
      // The backend wraps the alarm: { type:'alarm', alarm:{...} }. Emitting
      // the wrapper left alarm_id undefined, so the history panel's dedup
      // never matched and every frame counted as a new alarm.
      bus.emit('alarm', msg.alarm || msg);
    } else if (msg.type === 'node-status-change') {
      bus.emit('node-status-change', msg);
    }
  }

  function fetchSimulationPacket(packetId) {
    var url = API_BASE + '/simulation/packets/' + packetId;
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (packet) {
        applySimulationPacket(packet);
      })
      .catch(function (err) {
        console.warn('[live-provider] Failed to fetch packet ' + packetId + ':', err.message);
      });
  }

  function applySimulationPacket(packet) {
    console.log('[live-provider] Applying simulation packet #' + packet.packet_id, packet);
    bus.emit('simulation-packet', packet);

    // `start_sim_time` / `end_sim_time` are sim-second OFFSETS from session
    // start, not Unix epochs - feeding them to `new Date(x * 1000)` renders
    // 1970-01-01. The sim now stamps `emitted_wall_s` (real epoch seconds at
    // finalize); fall back to now for older packets.
    var packetEpochS = Math.floor(
      packet.emitted_wall_s || (Date.now() / 1000)
    );

    // 1. Process node telemetry aggregates
    if (Array.isArray(packet.nodes)) {
      packet.nodes.forEach(function (n) {
        var nid = n.node_id != null ? String(n.node_id) : '';
        if (!nid) return;

        // Map integer id (1..33) to N01..N33 if in standard format
        var formattedId = nid.startsWith('N') ? nid : ('N' + (parseInt(nid, 10) < 10 ? '0' : '') + nid);
        var aggs = n.aggregates || {};

        var strain = aggs.max_strain != null ? aggs.max_strain : 0;
        var tiltX = aggs.max_tilt_x != null ? aggs.max_tilt_x : 0;
        var tiltY = aggs.max_tilt_y != null ? aggs.max_tilt_y : 0;

        // Classify node status according to DGMS thresholds
        var status = 'active';
        if (strain > 400 || Math.abs(tiltX) > 500 || Math.abs(tiltY) > 500) {
          status = 'critical';
        } else if (strain > 150 || Math.abs(tiltX) > 200 || Math.abs(tiltY) > 200) {
          status = 'warning';
        }

        var telemetryRow = {
          node_id: formattedId,
          _node_id: formattedId,
          raw_id: nid,
          tier: n.tier || '1A',
          t_epoch_s: packetEpochS,
          strain_ustrain: Math.round(strain),
          tilt_x_mdeg: Math.round(tiltX / 17.4533),
          tilt_y_mdeg: Math.round(tiltY / 17.4533),
          temp_c_x10: Math.round((aggs.max_temperature || 25.0) * 10),
          vib_rms: Math.round((aggs.max_vib_rms || 8) / 10),
          vbat_mv: aggs.min_battery || 3600,
          state: status,
          flags: 0
        };

        handleTelemetry(telemetryRow);
        bus.emit('node-status-change', { node_id: formattedId, state: status });
      });
    }

    // 2. Zone-transition alarms are NOT raised from here. The simulation
    // already publishes them on the MQTT `mine/<panel>/alarm` topic (with a
    // proper centroid, and an alarm_id keyed on zone + state so a zone holds
    // one alarm), and the backend persists them. Re-deriving them from
    // packet.events here produced a second alarm with a different id for the
    // same event - the "same alarm multiple times" the operator saw.

    // 3. Process terrain delta for bowl / trough overlay
    if (packet.terrain) {
      bus.emit('trough-update', packet.terrain);
    }
  }

  function handleTelemetry(data) {
    // MQTT telemetry frames carry `t_utc` (the *simulated* wall clock, which
    // races ahead of real time) but no `t_epoch_s` - the field the charts and
    // the "LAST SEEN" readout key off. For a live monitor the honest value is
    // real arrival time, so stamp that; `t_utc` stays on the frame for anyone
    // who wants the in-world clock.
    if (data && data.t_epoch_s == null) {
      data.t_epoch_s = Math.floor(Date.now() / 1000);
    }

    var nodeId = data._node_id || data.node_id;
    if (nodeId) {
      trackNode(nodeId, data);
      resetHeartbeatTimer(nodeId);
    }
    bus.emit('telemetry', data);
  }

  function trackNode(nodeId, telemetry) {
    if (!knownNodes[nodeId]) {
      knownNodes[nodeId] = {
        node_id: nodeId,
        state: telemetry.state || 'active',
        lastTelemetry: telemetry
      };
    } else {
      knownNodes[nodeId].lastTelemetry = telemetry;
      if (telemetry.state) {
        knownNodes[nodeId].state = telemetry.state;
      } else if (knownNodes[nodeId].state === 'dead') {
        knownNodes[nodeId].state = 'active';
        bus.emit('node-status-change', { node_id: nodeId, state: 'active' });
      }
    }
  }

  function resetHeartbeatTimer(nodeId) {
    if (heartbeatTimers[nodeId]) clearTimeout(heartbeatTimers[nodeId]);
    heartbeatTimers[nodeId] = setTimeout(function () {
      if (!active) return;
      if (knownNodes[nodeId] && knownNodes[nodeId].state !== 'dead') {
        knownNodes[nodeId].state = 'dead';
        bus.emit('node-status-change', { node_id: nodeId, state: 'dead' });
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  function stop() {
    active = false;
    if (ws) {
      ws.close();
      ws = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    Object.keys(heartbeatTimers).forEach(function (id) {
      clearTimeout(heartbeatTimers[id]);
    });
    heartbeatTimers = {};
  }

  function getKnownNodes() { return knownNodes; }

  return {
    start: start,
    stop: stop,
    getKnownNodes: getKnownNodes,
    fetchSimulationPacket: fetchSimulationPacket,
    applySimulationPacket: applySimulationPacket
  };
})();
