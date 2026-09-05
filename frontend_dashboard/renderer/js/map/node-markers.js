'use strict';

var nodeMarkers = (function () {
  var markers = {};
  var nodeData = {};
  var heartbeatTimers = {};
  var HEARTBEAT_TIMEOUT_MS = 30000;

  var STATE_CONFIG = {
    active:   { color: '#00CC44', border: '1px solid rgba(0,0,0,0.7)' },
    warning:  { color: '#FFA500', border: '1px solid rgba(0,0,0,0.7)' },
    critical: { color: '#FF2222', border: '1px solid rgba(0,0,0,0.75)' },
    lastgasp: { color: '#FF4400', border: '1px solid rgba(0,0,0,0.75)' },
    dead:     { color: '#5A6A72', border: '1px solid rgba(0,0,0,0.75)' }
  };

  function createIcon(state) {
    var cfg = STATE_CONFIG[state] || STATE_CONFIG.dead;
    var animStyle = '';
    if (state === 'critical') animStyle = 'animation:blink 1s step-end infinite;';
    if (state === 'lastgasp') animStyle = 'animation:blink 0.5s step-end infinite;';

    var crosshatch = '';
    if (state === 'dead') {
      crosshatch = '<svg style="position:absolute;top:0;left:0;pointer-events:none;" width="12" height="12">' +
        '<line x1="1" y1="1" x2="11" y2="11" stroke="#1A2228" stroke-width="1.6" opacity="0.85"/>' +
        '<line x1="11" y1="1" x2="1" y2="11" stroke="#1A2228" stroke-width="1.6" opacity="0.85"/>' +
        '</svg>';
    }

    return L.divIcon({
      className: 'node-marker-led',
      html: '<div class="node-led" style="' +
            'width:12px;height:12px;border-radius:50%;' +
            'background:' + cfg.color + ';' +
            'border:' + cfg.border + ';' +
            'box-shadow:inset 0 1px 2px rgba(255,255,255,0.25);' +
            'position:relative;cursor:pointer;' +
            'box-sizing:border-box;' + animStyle + '">' +
            crosshatch +
            '</div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6]
    });
  }

  function findAlarmForNode(nodeId) {
    if (!nodeId) return null;
    var nd = nodeData[nodeId];
    if (!nd) return null;

    var alarms = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms)
      ? fixtureProvider.getAlarms() : [];

    // 1. Check for an alarm specifically titled for this node: ALM-<nodeId>
    for (var i = 0; i < alarms.length; i++) {
      if (alarms[i].alarm_id === 'ALM-' + nodeId) {
        return alarms[i];
      }
    }

    // 2. Check for an alarm where this node is the primary trigger (affected_nodes[0] === nodeId)
    for (var j = 0; j < alarms.length; j++) {
      if (alarms[j].affected_nodes && alarms[j].affected_nodes[0] === nodeId) {
        return alarms[j];
      }
    }

    // 3. Check if node is listed in any alarm's affected_nodes
    for (var k = 0; k < alarms.length; k++) {
      if (alarms[k].affected_nodes && alarms[k].affected_nodes.indexOf(nodeId) !== -1) {
        return alarms[k];
      }
    }

    // 4. If node is in critical/warning/lastgasp state, dynamically synthesize a unique alarm
    if (nd.state === 'critical' || nd.state === 'warning' || nd.state === 'lastgasp') {
      var isCrit = (nd.state === 'critical' || nd.state === 'lastgasp');
      var t = nd.lastTelemetry;
      var strainVal = t ? t.strain_ustrain : (isCrit ? 850 : 490);
      var r2Val = isCrit ? 0.96 : 0.85;

      return {
        alarm_id: 'ALM-' + nodeId,
        t_utc: new Date().toISOString(),
        panel_id: 'PNL-A-' + (nd.ring || 'SECTOR').toUpperCase(),
        level: isCrit ? 3 : 2,
        centroid: { lat: nd.lat, lng: nd.lng },
        affected_nodes: [nodeId],
        trough_fit_r2: r2Val,
        projection: { days_to_level_3: isCrit ? 0 : 4.5, confidence: isCrit ? 0.95 : 0.83 },
        blast_correlated: false,
        confidence_zone: isCrit ? 'high_confidence' : 'medium_warning',
        explanation: (isCrit ? 'CRITICAL LEVEL 3' : 'LEVEL 2 WARNING') +
          ': Sensor ' + nodeId + ' in ' + (nd.ring || 'inner') +
          ' ring indicates acute subsidence deviation (strain: ' + strainVal +
          ' ustrain). Local displacement exceeds safety threshold for this sector.'
      };
    }

    return null;
  }

  function formatTimestamp(epochS) {
    if (!epochS) return '--:--:--';
    var d = new Date(epochS * 1000);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  function buildTooltip(node) {
    var t = node.lastTelemetry;
    var strain = t ? (t.strain_ustrain + ' ustrain') : '--';
    var battery = t ? (t.vbat_mv + ' mV') : '--';
    var ts = t ? formatTimestamp(t.t_epoch_s) : '--:--:--';
    return node.node_id + '\n' +
           'Strain: ' + strain + '\n' +
           'Battery: ' + battery + '\n' +
           'Last: ' + ts;
  }

  function init(map, nodes) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      nodeData[n.node_id] = n;

      var marker = L.marker([n.lat, n.lng], {
        icon: createIcon(n.state),
        title: n.node_id
      });

      marker._nodeId = n.node_id;
      marker.on('click', function () {
        var nodeId = this._nodeId;
        var alarm = findAlarmForNode(nodeId);
        if (alarm) {
          // Show BOTH alarm details AND node details!
          bus.emit('alarm-selected', alarm);
          bus.emit('node-selected', nodeId);
        } else {
          // Normal node: close alarm details, show node details
          if (typeof alarmDetail !== 'undefined' && alarmDetail.hide) {
            alarmDetail.hide();
          }
          bus.emit('node-selected', nodeId);
        }
      });

      marker.bindTooltip(buildTooltip(n), {
        className: 'node-tooltip',
        direction: 'top',
        offset: [0, -10],
        opacity: 0.95
      });

      marker.addTo(map);
      markers[n.node_id] = marker;
    }

    bus.on('node-status-change', function (data) {
      updateState(data.node_id, data.state);
    });

    bus.on('replay-started', function () {
      var ids = Object.keys(nodeData);
      for (var k = 0; k < ids.length; k++) {
        nodeData[ids[k]].lastTelemetry = null;
        updateState(ids[k], 'active');
      }
    });

    bus.on('telemetry', function (t) {
      var nodeId = t._node_id || t.node_id;
      if (!nodeId) return;

      if (nodeData[nodeId]) {
        nodeData[nodeId].lastTelemetry = t;

        var strain = t.strain_ustrain || 0;
        var tiltMag = Math.max(Math.abs(t.tilt_x_mdeg || 0), Math.abs(t.tilt_y_mdeg || 0));

        if (t.flags & 1) {
          updateState(nodeId, 'lastgasp');
        } else if (strain >= 600 || tiltMag >= 200) {
          updateState(nodeId, 'critical');
        } else if (strain >= 400 || tiltMag >= 100) {
          updateState(nodeId, 'warning');
        } else if (nodeData[nodeId].state !== 'active' && nodeData[nodeId].state !== 'lastgasp') {
          updateState(nodeId, 'active');
        }

        if (markers[nodeId]) {
          markers[nodeId].setTooltipContent(buildTooltip(nodeData[nodeId]));
        }
      }

      resetHeartbeatTimer(nodeId);
    });

    bus.on('alarm', function (alarm) {
      if (alarm.affected_nodes) {
        for (var j = 0; j < alarm.affected_nodes.length; j++) {
          updateState(alarm.affected_nodes[j], 'critical');
        }
      }
    });

    updateNodeCount();
  }

  function resetHeartbeatTimer(nodeId) {
    if (heartbeatTimers[nodeId]) clearTimeout(heartbeatTimers[nodeId]);

    // Only apply the 30s heartbeat watchdog in LIVE MQTT mode.
    // In fixture mode, replay completes after ~35s and retains the final simulation state.
    if (typeof modeSwitch !== 'undefined' && modeSwitch.getMode() === 'fixture') {
      return;
    }

    heartbeatTimers[nodeId] = setTimeout(function () {
      if (nodeData[nodeId] && nodeData[nodeId].state !== 'dead') {
        updateState(nodeId, 'dead');
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  function updateState(nodeId, state) {
    if (!markers[nodeId]) return;
    if (nodeData[nodeId]) nodeData[nodeId].state = state;
    markers[nodeId].setIcon(createIcon(state));
    updateNodeCount();
  }

  function updateNodeCount() {
    var ids = Object.keys(nodeData);
    var active = 0;
    for (var i = 0; i < ids.length; i++) {
      if (nodeData[ids[i]].state !== 'dead') active++;
    }
    var el = document.getElementById('node-count');
    if (el) el.textContent = active + '/' + ids.length + ' ACTIVE';
  }

  function getMarker(nodeId) { return markers[nodeId]; }
  function getNodeData(nodeId) { return nodeData[nodeId]; }

  return {
    init: init,
    updateState: updateState,
    getMarker: getMarker,
    getNodeData: getNodeData
  };
})();
