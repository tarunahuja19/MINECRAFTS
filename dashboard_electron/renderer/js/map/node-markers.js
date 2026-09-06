'use strict';

var nodeMarkers = (function () {
  var markers = {};
  var nodeData = {};
  var heartbeatTimers = {};
  var HEARTBEAT_TIMEOUT_MS = 30000;
  var simState = 'STOPPED';

  var STATE_CONFIG = {
    active:   { color: '#00CC44', border: 'rgba(0,0,0,0.7)' },
    warning:  { color: '#FFA500', border: 'rgba(0,0,0,0.7)' },
    critical: { color: '#FF2222', border: 'rgba(0,0,0,0.75)' },
    lastgasp: { color: '#FF4400', border: 'rgba(0,0,0,0.75)' },
    dead:     { color: '#5A6A72', border: 'rgba(0,0,0,0.75)' }
  };

  // The 31 real nodes come in three roles and the map has to make them tellable
  // apart at a glance, so role drives SHAPE and state drives COLOUR. Sizes are
  // Role defines SHAPE, tier defines GLYPH LETTER, state defines COLOUR:
  // - Scout: Square A, Square B, Square C
  // - Anchor: Circular A, Circular B, Circular C
  // - Gateway: Triangle G
  var ROLE_CONFIG = {
    scout:   { shape: 'square',   size: 20 },
    anchor:  { shape: 'circle',   size: 20 },
    gateway: { shape: 'triangle', size: 22 }
  };

  function roleOf(node) {
    var t = (node.node_type || '').toLowerCase();
    if (ROLE_CONFIG[t]) return t;
    if (node.node_id === 'N31' || node.tier === '3') return 'gateway';
    if (t.indexOf('anchor') !== -1 || node.tier === '2A' || node.tier === '2B') return 'anchor';
    return 'scout';
  }

  function tierLetterOf(node) {
    if (!node) return 'A';
    var r = roleOf(node);
    if (r === 'gateway') return 'G';
    var tier = (node.tier || '').toUpperCase();
    if (tier.endsWith('A')) return 'A';
    if (tier.endsWith('B')) return 'B';
    if (tier.endsWith('C')) return 'C';
    var nid = parseInt(String(node.node_id || '').replace(/\D/g, ''), 10);
    if (nid >= 1 && nid <= 9) return 'A';
    if (nid >= 10 && nid <= 19) return 'B';
    if (nid >= 20 && nid <= 25) return 'C';
    if (nid >= 26 && nid <= 28) return 'A';
    if (nid >= 29 && nid <= 30) return 'B';
    if (nid === 31) return 'G';
    return 'A';
  }

  function shapeSvg(role, cfg, state, letter) {
    var sz = ROLE_CONFIG[role].size;
    var fill = cfg.color;
    var stroke = cfg.border;
    var body = '';
    var textEl = '';
    var textColor = (state === 'active' || state === 'warning') ? '#0B1318' : '#FFFFFF';

    if (ROLE_CONFIG[role].shape === 'square') {
      body = '<rect x="1.5" y="1.5" width="' + (sz - 3) + '" height="' + (sz - 3) + '" rx="2.5" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
      textEl = '<text x="' + (sz / 2) + '" y="' + (sz / 2 + 3.8) + '" text-anchor="middle" ' +
               'font-size="10.5" font-family="Consolas, monospace, sans-serif" font-weight="900" fill="' + textColor + '">' + letter + '</text>';
    } else if (ROLE_CONFIG[role].shape === 'triangle') {
      body = '<polygon points="' + (sz / 2) + ',1.5 ' + (sz - 1.5) + ',' + (sz - 2) +
             ' 1.5,' + (sz - 2) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/>';
      textEl = '<text x="' + (sz / 2) + '" y="' + (sz / 2 + 6.2) + '" text-anchor="middle" ' +
               'font-size="10" font-family="Consolas, monospace, sans-serif" font-weight="900" fill="' + textColor + '">G</text>';
    } else {
      body = '<circle cx="' + (sz / 2) + '" cy="' + (sz / 2) + '" r="' + (sz / 2 - 1.5) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
      textEl = '<text x="' + (sz / 2) + '" y="' + (sz / 2 + 3.8) + '" text-anchor="middle" ' +
               'font-size="10.5" font-family="Consolas, monospace, sans-serif" font-weight="900" fill="' + textColor + '">' + letter + '</text>';
    }

    var cross = '';
    if (state === 'dead') {
      cross = '<line x1="2" y1="2" x2="' + (sz - 2) + '" y2="' + (sz - 2) + '" stroke="#1A2228" stroke-width="1.8" opacity="0.85"/>' +
              '<line x1="' + (sz - 2) + '" y1="2" x2="2" y2="' + (sz - 2) + '" stroke="#1A2228" stroke-width="1.8" opacity="0.85"/>';
    }

    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '">' +
           body + textEl + cross + '</svg>';
  }

  function createIcon(state, role, letter) {
    var cfg = STATE_CONFIG[state] || STATE_CONFIG.dead;
    role = ROLE_CONFIG[role] ? role : 'scout';
    letter = letter || 'A';
    var sz = ROLE_CONFIG[role].size;

    // NO BLINKING on affected nodes: solid, readable glyph with expanding concentric circles instead
    return L.divIcon({
      className: 'node-marker-led node-marker-' + role,
      html: '<div class="node-led" style="width:' + sz + 'px;height:' + sz + 'px;' +
            'line-height:0;cursor:pointer;">' +
            shapeSvg(role, cfg, state, letter) +
            '</div>',
      iconSize: [sz, sz],
      iconAnchor: [sz / 2, sz / 2]
    });
  }

  function findAlarmForNode(nodeId) {
    if (!nodeId) return null;
    var nd = nodeData[nodeId];
    if (!nd) return null;

    // Normal green/active nodes do not have active alarms
    if (nd.state !== 'critical' && nd.state !== 'warning' && nd.state !== 'lastgasp') {
      return null;
    }

    // Check alarmHistory first, then fallback to fixtureProvider
    var alarms = [];
    if (typeof alarmHistory !== 'undefined' && alarmHistory.getAlarms) {
      alarms = alarmHistory.getAlarms();
    }
    if ((!alarms || alarms.length === 0) && typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms) {
      alarms = fixtureProvider.getAlarms() || [];
    }
    if (!alarms || typeof alarms.length !== 'number') alarms = [];

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

    // No server alarm covers this node - return nothing. The renderer does not
    // invent alarms; the simulation is the only alarm producer.
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

  var ROLE_LABEL = { gateway: 'Gateway', anchor: 'Anchor', scout: 'Scout' };

  // Leaflet's default popup is white, which leaves the HMI-toned popup text
  // nearly invisible. Style the popup chrome to match the dark console theme.
  (function injectPopupStyle() {
    if (typeof document === 'undefined' || document.getElementById('node-popup-style')) return;
    var st = document.createElement('style');
    st.id = 'node-popup-style';
    st.textContent =
      '.node-popup .leaflet-popup-content-wrapper{background:#111A20;border:1px solid #2A3841;' +
      'border-radius:3px;box-shadow:0 4px 14px rgba(0,0,0,0.55);}' +
      '.node-popup .leaflet-popup-content{margin:9px 11px;}' +
      '.node-popup .leaflet-popup-tip{background:#111A20;border:1px solid #2A3841;}' +
      '.node-popup a.leaflet-popup-close-button{color:#8AA0AC;}';
    document.head.appendChild(st);
  })();

  function buildPopup(node) {
    var role = roleOf(node);
    function row(k, v) {
      return '<div style="display:flex;gap:10px;justify-content:space-between;">' +
             '<span style="color:#8AA0AC;">' + k + '</span>' +
             '<span style="color:#E6EDF2;font-variant-numeric:tabular-nums;">' + v + '</span></div>';
    }
    var xm = (typeof node.x === 'number') ? node.x.toFixed(1) + ' m' : '--';
    var ym = (typeof node.y === 'number') ? node.y.toFixed(1) + ' m' : '--';
    var lat = (typeof node.lat === 'number') ? node.lat.toFixed(6) : '--';
    var lng = (typeof node.lng === 'number') ? node.lng.toFixed(6) : '--';

    return '<div style="font:11px ui-monospace,Menlo,monospace;min-width:190px;">' +
           '<div style="font-size:12px;font-weight:600;color:#E6EDF2;margin-bottom:6px;">' +
           node.node_id + '</div>' +
           row('Role', ROLE_LABEL[role] || role) +
           row('Tier', node.tier || '--') +
           row('State', (node.state || 'unknown').toUpperCase()) +
           '<div style="height:1px;background:#2A3841;margin:6px 0;"></div>' +
           row('x (panel)', xm) +
           row('y (panel)', ym) +
           row('lat', lat) +
           row('lon', lng) +
           '</div>';
  }

  function buildTooltip(node) {
    if (simState === 'STOPPED') {
      return node.node_id + ' [OFFLINE]\nSIMULATION: STOPPED\nWaiting for simulation start...';
    }
    var t = node.lastTelemetry;
    var strain = (t && t.strain_ustrain != null) ? (t.strain_ustrain + ' ustrain') : '--';
    var battery = (t && t.vbat_mv != null) ? (t.vbat_mv + ' mV') : '--';
    var ts = t ? formatTimestamp(t.t_epoch_s) : '--:--:--';
    return node.node_id + '\n' +
           'Strain: ' + strain + '\n' +
           'Battery: ' + battery + '\n' +
           'Last: ' + ts;
  }

  // Where a node is drawn. x/y (panel-frame metres) are the physics truth, so
  // they are projected through the map's single converter whenever present.
  // A record's own lat/lng is used only as a fallback for legacy rows that
  // carry no x/y - the static fixtures still hold pre-alignment Jharia
  // coordinates, and trusting those would scatter markers 1000 km off the site.
  function latLngFor(n) {
    if (typeof n.x === 'number' && typeof n.y === 'number' &&
        typeof mapView !== 'undefined' && mapView.xyToLatLon) {
      return mapView.xyToLatLon(n.x, n.y);
    }
    if (typeof n.lat === 'number' && typeof n.lng === 'number') {
      return [n.lat, n.lng];
    }
    return null;
  }

  function init(map, nodes) {
    var drawn = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];

      var pos = latLngFor(n);
      if (!pos) {
        console.warn('[node-markers] Skipping ' + n.node_id + ': no usable position');
        continue;
      }
      // Keep the drawn position on the record so popups and any later
      // consumer report the same place the marker sits.
      n.lat = pos[0];
      n.lng = pos[1];
      n.state = (simState === 'RUNNING') ? (n.state || 'active') : 'dead';
      nodeData[n.node_id] = n;

      var marker = L.marker(pos, {
        icon: createIcon(n.state, roleOf(n), tierLetterOf(n)),
        title: n.node_id
      });

      marker._nodeId = n.node_id;
      marker.on('click', function () {
        var nodeId = this._nodeId;
        var nd = nodeData[nodeId];
        var isAlarming = nd && (nd.state === 'critical' || nd.state === 'warning' || nd.state === 'lastgasp');

        if (isAlarming) {
          var alarm = findAlarmForNode(nodeId);
          if (alarm) {
            bus.emit('alarm-selected', alarm);
          }
          bus.emit('node-selected', nodeId);
        } else {
          // Normal green node: ensure alarm details panel is closed, show only node sensor details
          if (typeof alarmDetail !== 'undefined' && alarmDetail.hide) {
            alarmDetail.hide();
          }
          bus.emit('node-selected', nodeId);
        }
      });

      marker.bindPopup(buildPopup(n), { className: 'node-popup', closeButton: true });

      marker.bindTooltip(buildTooltip(n), {
        className: 'node-tooltip',
        direction: 'top',
        offset: [0, -10],
        opacity: 0.95
      });

      marker.addTo(map);
      markers[n.node_id] = marker;
      drawn.push(pos);
    }

    // Frame the real node set (the gateway sits outside the 600 m window).
    if (drawn.length && typeof mapView !== 'undefined' && mapView.fitToNodes) {
      mapView.fitToNodes(L.latLngBounds(drawn));
    }

    bus.on('node-status-change', function (data) {
      updateState(data.node_id, data.state);
    });

    bus.on('simulation-status', function (data) {
      var newState = data.state || (data.is_running ? 'RUNNING' : 'STOPPED');
      if (newState === simState) return;
      simState = newState;
      console.log('[node-markers] Simulation state transitioned to: ' + simState);

      var ids = Object.keys(nodeData);
      if (simState === 'STOPPED') {
        // When simulation is stopped, all nodes become dead and offline
        for (var k = 0; k < ids.length; k++) {
          var sid = ids[k];
          nodeData[sid].state = 'dead';
          if (markers[sid]) {
            markers[sid].setIcon(createIcon('dead', roleOf(nodeData[sid]), tierLetterOf(nodeData[sid])));
            markers[sid].setTooltipContent(buildTooltip(nodeData[sid]));
          }
        }
      } else if (simState === 'RUNNING') {
        // When simulation is started, nodes revive to active baseline
        for (var k = 0; k < ids.length; k++) {
          var rid = ids[k];
          nodeData[rid].state = 'active';
          if (markers[rid]) {
            markers[rid].setIcon(createIcon('active', roleOf(nodeData[rid]), tierLetterOf(nodeData[rid])));
            markers[rid].setTooltipContent(buildTooltip(nodeData[rid]));
          }
        }
      }
      updateNodeCount();
    });

    bus.on('replay-started', function () {
      simState = 'RUNNING';
      var ids = Object.keys(nodeData);
      for (var k = 0; k < ids.length; k++) {
        nodeData[ids[k]].lastTelemetry = null;
        updateState(ids[k], 'active');
      }
      updateNodeCount();
    });

    bus.on('system-reset', function () {
      simState = 'STOPPED';
      var ids = Object.keys(nodeData);
      for (var k = 0; k < ids.length; k++) {
        nodeData[ids[k]].lastTelemetry = null;
        nodeData[ids[k]].state = 'dead';
        if (markers[ids[k]]) {
          markers[ids[k]].setIcon(createIcon('dead', roleOf(nodeData[ids[k]]), tierLetterOf(nodeData[ids[k]])));
          markers[ids[k]].setTooltipContent(buildTooltip(nodeData[ids[k]]));
        }
      }
      updateNodeCount();
    });

    bus.on('telemetry', function (t) {
      var nodeId = t._node_id || t.node_id;
      if (!nodeId) return;

      if (nodeData[nodeId]) {
        nodeData[nodeId].lastTelemetry = t;

        // The server assigns node state (session.py:_assign_node_states) and
        // ships it on the telemetry row as `t.state`. The UI obeys it and never
        // re-derives state from strain/tilt. A genuine last-gasp packet is a
        // real device event (PACKET_FLAG_LAST_GASP = 1).
        if (t.flags & 1) {
          updateState(nodeId, 'lastgasp');
        } else {
          updateState(nodeId, t.state || 'active');
        }

        if (markers[nodeId]) {
          markers[nodeId].setTooltipContent(buildTooltip(nodeData[nodeId]));
        }
      }

      resetHeartbeatTimer(nodeId);
    });

    bus.on('alarm', function (alarm) {
      if (alarm.affected_nodes) {
        var targetState = (alarm.level === 3) ? 'critical' : (alarm.level === 2 ? 'warning' : 'warning');
        for (var j = 0; j < alarm.affected_nodes.length; j++) {
          updateState(alarm.affected_nodes[j], targetState);
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
    // No-op when the state has not actually changed. The live provider
    // re-asserts every node's status on every 60-s packet; without this guard
    // each packet redraws all 31 marker icons and re-runs the alarm hooks,
    // which is what made settled nodes appear to "go red again and again".
    if (nodeData[nodeId] && nodeData[nodeId].state === state) return;
    if (nodeData[nodeId]) nodeData[nodeId].state = state;
    // Role is a property of the node, not of its health, so it survives every
    // state change - a gateway must never redraw as a scout circle.
    var role = nodeData[nodeId] ? roleOf(nodeData[nodeId]) : 'scout';
    var letter = nodeData[nodeId] ? tierLetterOf(nodeData[nodeId]) : 'A';
    markers[nodeId].setIcon(createIcon(state, role, letter));
    updateNodeCount();

    if (state === 'critical' || state === 'lastgasp' || state === 'warning') {
      if (typeof lastgaspMarker !== 'undefined' && lastgaspMarker.showPulse) {
        lastgaspMarker.showPulse(nodeId, state);
      }
    } else {
      if (typeof lastgaspMarker !== 'undefined' && lastgaspMarker.removePulse) {
        lastgaspMarker.removePulse(nodeId);
      }
    }
    // The renderer never synthesizes alarms or POSTs to /api/alarms. The
    // simulation publishes real alarms on the MQTT alarm topic and the backend
    // persists them; the map only paints node state.
  }

  function updateNodeCount() {
    var ids = Object.keys(nodeData);
    var el = document.getElementById('node-count');
    if (!el) return;
    if (simState === 'STOPPED') {
      el.textContent = '0/' + ids.length + ' ACTIVE (SIM STOPPED)';
    } else {
      var active = 0;
      for (var i = 0; i < ids.length; i++) {
        if (nodeData[ids[i]].state !== 'dead') active++;
      }
      el.textContent = active + '/' + ids.length + ' ACTIVE';
    }
  }

  function getMarker(nodeId) { return markers[nodeId]; }
  function getNodeData(nodeId) { return nodeData[nodeId]; }
  function getAllNodes() {
    return Object.keys(nodeData).map(function (k) { return nodeData[k]; });
  }

  return {
    init: init,
    updateState: updateState,
    getMarker: getMarker,
    getNodeData: getNodeData,
    getAllNodes: getAllNodes,
    roleOf: roleOf,
    tierLetterOf: tierLetterOf
  };
})();
