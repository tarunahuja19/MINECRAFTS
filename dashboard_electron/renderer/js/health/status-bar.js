'use strict';

var statusBar = (function () {
  var mqttLed, mqttStatus, gatewayLed, gatewayStatus, queueCount, lastSync, nodeCount;
  var simLed, simStatus, simHudBadge, simHudText;
  var currentSimState = 'STOPPED';
  var mqttConnected = false;
  var gatewayOnline = false;
  var offlineQueue = 0;
  var lastSyncTime = null;

  function init() {
    mqttLed = document.getElementById('mqtt-led');
    mqttStatus = document.getElementById('mqtt-status');
    gatewayLed = document.getElementById('gateway-led');
    gatewayStatus = document.getElementById('gateway-status');
    queueCount = document.getElementById('queue-count');
    lastSync = document.getElementById('last-sync');
    nodeCount = document.getElementById('node-count');
    simLed = document.getElementById('sim-led');
    simStatus = document.getElementById('sim-status');
    simHudBadge = document.getElementById('sim-status-hud');
    simHudText = document.getElementById('sim-hud-text');

    updateSimulationIndicator();

    bus.on('simulation-status', function (data) {
      currentSimState = data.state || (data.is_running ? 'RUNNING' : 'STOPPED');
      updateSimulationIndicator();
    });

    bus.on('system-reset', function () {
      currentSimState = 'STOPPED';
      updateSimulationIndicator();
    });

    bus.on('mqtt-status', function (status) {
      mqttConnected = status === 'connected';
      updateMqtt();
      bus.emit('mqtt-log-event', {
        t: Date.now(),
        msg: mqttConnected ? 'MQTT CONNECTED' : 'MQTT DISCONNECTED (timeout)'
      });
    });

    bus.on('gateway-health', function (data) {
      gatewayOnline = data.status === 'online';
      updateGateway();
      if (typeof data.offline_queue === 'number') {
        offlineQueue = data.offline_queue;
        updateQueue();
      }
      lastSyncTime = Date.now();
      updateLastSync();
    });

    bus.on('telemetry', function () {
      lastSyncTime = Date.now();
      updateLastSync();
    });

    bus.on('nodes-loaded', function (nodes) {
      updateNodeSummary(nodes);
    });

    bus.on('node-status-change', function () {
      updateNodeSummaryFromMarkers();
    });

    setInterval(function () {
      updateLastSync();
    }, 1000);

    if (typeof modeSwitch !== 'undefined') {
      bus.on('fixture-started', function () {
        mqttConnected = true;
        gatewayOnline = true;
        offlineQueue = 0;
        lastSyncTime = Date.now();
        updateMqtt();
        updateGateway();
        updateQueue();
        updateLastSync();
        bus.emit('mqtt-log-event', { t: Date.now(), msg: 'MQTT CONNECTED' });
      });
    }
  }

  function updateMqtt() {
    if (!mqttLed || !mqttStatus) return;
    if (mqttConnected) {
      mqttLed.className = 'led led-active';
      mqttStatus.textContent = 'CONNECTED';
      mqttStatus.className = 'status-value connected';
    } else {
      mqttLed.className = 'led led-critical';
      mqttStatus.textContent = 'DISCONNECTED';
      mqttStatus.className = 'status-value disconnected';
    }
  }

  function updateGateway() {
    if (!gatewayLed || !gatewayStatus) return;
    if (gatewayOnline) {
      gatewayLed.className = 'led led-active';
      gatewayStatus.textContent = 'ONLINE';
      gatewayStatus.className = 'status-value connected';
    } else {
      gatewayLed.className = 'led led-dead';
      gatewayStatus.textContent = 'OFFLINE';
      gatewayStatus.className = 'status-value';
    }
  }

  function updateQueue() {
    if (!queueCount) return;
    queueCount.textContent = offlineQueue + ' ROWS';
    if (offlineQueue > 0 && mqttConnected) {
      queueCount.className = 'status-value warning';
    } else if (offlineQueue > 0 && !mqttConnected) {
      queueCount.className = 'status-value disconnected';
    } else {
      queueCount.className = 'status-value';
    }
  }

  function updateLastSync() {
    if (!lastSync) return;
    if (!lastSyncTime) {
      lastSync.textContent = '--:--:--';
      return;
    }
    var d = new Date(lastSyncTime);
    lastSync.textContent =
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }

  function updateNodeSummary(nodes) {
    if (!nodeCount || !nodes) return;
    var counts = { active: 0, warning: 0, critical: 0, dead: 0, lastgasp: 0 };
    for (var i = 0; i < nodes.length; i++) {
      var s = nodes[i].state || 'active';
      if (counts[s] !== undefined) counts[s]++;
    }
    renderNodeCount(counts, nodes.length);
  }

  function updateNodeSummaryFromMarkers() {
    if (!nodeCount || typeof nodeMarkers === 'undefined') return;
    var allNodes = [];
    var ids = Object.keys(nodeMarkers);
    for (var i = 0; i < ids.length; i++) {
      var nd = nodeMarkers.getNodeData(ids[i]);
      if (nd) allNodes.push(nd);
    }
    if (allNodes.length === 0) return;
    updateNodeSummary(allNodes);
  }

  function updateSimulationIndicator() {
    if (simLed && simStatus) {
      if (currentSimState === 'RUNNING') {
        simLed.className = 'led led-active';
        simStatus.textContent = 'RUNNING';
        simStatus.className = 'status-value connected';
      } else if (currentSimState === 'PAUSED') {
        simLed.className = 'led led-warning';
        simStatus.textContent = 'PAUSED';
        simStatus.className = 'status-value warning';
      } else {
        simLed.className = 'led led-dead';
        simStatus.textContent = 'STOPPED';
        simStatus.className = 'status-value disconnected';
      }
    }

    if (simHudBadge && simHudText) {
      if (currentSimState === 'RUNNING') {
        simHudBadge.className = 'sim-hud-badge status-running';
        simHudText.textContent = 'SIMULATION: RUNNING';
      } else if (currentSimState === 'PAUSED') {
        simHudBadge.className = 'sim-hud-badge status-paused';
        simHudText.textContent = 'SIMULATION: PAUSED';
      } else {
        simHudBadge.className = 'sim-hud-badge status-stopped';
        simHudText.textContent = 'SIMULATION: STOPPED';
      }
    }
  }

  function renderNodeCount(counts, total) {
    if (!nodeCount) return;
    if (currentSimState === 'STOPPED') {
      nodeCount.textContent = '0/' + total + ' ACTIVE (SIM STOPPED)';
    } else {
      var active = counts.active + counts.warning + counts.critical + counts.lastgasp;
      nodeCount.textContent = active + '/' + total + ' ACTIVE';
    }
    bus.emit('node-count-updated', counts);
  }

  return { init: init };
})();
