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

      if (window.r4.onSimulationStatus) {
        window.r4.onSimulationStatus(function (data) {
          handleSimulationStatus(data);
        });
      }
    }

    // 2. Connect to the unified Backend WebSocket server
    connectWebSocket();

    // 3. Start background simulation status monitoring
    startSimHealthPoll();
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
    } else if (msg.type === 'simulation_status') {
      handleSimulationStatus(msg);
    } else if (msg.type === 'system_reset') {
      console.log('[live-provider] System reset event received from backend');
      handleSimulationStatus({ is_running: false, is_paused: false, state: 'STOPPED' });
      Object.keys(knownNodes).forEach(function (k) { delete knownNodes[k]; });
      Object.keys(heartbeatTimers).forEach(function (id) { clearTimeout(heartbeatTimers[id]); });
      heartbeatTimers = {};
      bus.emit('system-reset', msg);
      bus.emit('alarms-loaded', []);
      if (typeof alarmBanner !== 'undefined') {
        alarmBanner.hide();
        if (alarmBanner.updateBadge) alarmBanner.updateBadge(0);
      }
    }
  }

  var currentSimState = 'STOPPED';
  var simPollTimer = null;

  function handleSimulationStatus(data) {
    if (!data) return;
    var isRunning = Boolean(data.is_running);
    var isPaused = Boolean(data.is_paused);
    var state = data.state || (isRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED');
    if (state !== currentSimState) {
      console.log('[live-provider] Simulation state transition: ' + currentSimState + ' -> ' + state);
      currentSimState = state;
    }
    bus.emit('simulation-status', {
      is_running: isRunning,
      is_paused: isPaused,
      state: state,
      t_sim_seconds: data.t_sim_seconds || 0
    });
  }

  function startSimHealthPoll() {
    if (simPollTimer) return;
    function poll() {
      if (!active) return;
      var simUrl = 'http://127.0.0.1:8000/health';
      fetch(simUrl, { cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (data) {
          handleSimulationStatus(data);
        })
        .catch(function () {
          fetch(API_BASE + '/api/simulation/status', { cache: 'no-store' })
            .then(function (r2) { return r2.json(); })
            .then(function (data2) {
              handleSimulationStatus(data2);
            })
            .catch(function () {
              handleSimulationStatus({ is_running: false, is_paused: false, state: 'STOPPED' });
            });
        });
    }

    poll();
    simPollTimer = setInterval(poll, 1200);
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

        var strain = aggs.max_strain != null ? aggs.max_strain : null;
        var tiltX = aggs.max_tilt_x != null ? aggs.max_tilt_x : null;
        var tiltY = aggs.max_tilt_y != null ? aggs.max_tilt_y : null;

        // The simulation is the single source of node health state. It assigns
        // each node's state by carve geometry (session.py:_assign_node_states)
        // and ships it as `aggregates.node_state`. The UI only paints what the
        // server sent - it must never re-derive state from strain/tilt.
        var status = 'active';
        if (currentSimState !== 'STOPPED' && aggs.node_state) {
          status = String(aggs.node_state).toLowerCase();
        }

        var telemetryRow = {
          node_id: formattedId,
          _node_id: formattedId,
          raw_id: nid,
          tier: n.tier || '1A',
          t_epoch_s: packetEpochS,
          strain_ustrain: strain != null ? Math.round(strain) : null,
          tilt_x_mdeg: tiltX != null ? Math.round(tiltX / 17.4533) : null,
          tilt_y_mdeg: tiltY != null ? Math.round(tiltY / 17.4533) : null,
          temp_c_x10: aggs.max_temperature != null ? Math.round(aggs.max_temperature * 10) : null,
          vib_rms: aggs.max_vib_rms != null ? Math.round(aggs.max_vib_rms / 10) : null,
          vbat_mv: aggs.min_battery != null ? aggs.min_battery : null,
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

    // The simulation is the single source of node state. Raw MQTT telemetry
    // frames carry it as `node_state` (uppercase enum); the renderer keys off
    // lowercase `state`. Normalize here so the UI paints only what the server
    // sent and never re-derives state from strain/tilt.
    if (data && data.state == null && data.node_state) {
      data.state = String(data.node_state).toLowerCase();
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
