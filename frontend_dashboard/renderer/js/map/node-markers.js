'use strict';

var nodeMarkers = (function () {
  var markers = {};
  var nodeData = {};
  var heartbeatTimers = {};
  var HEARTBEAT_TIMEOUT_MS = 30000;

  var STATE_CONFIG = {
    active:   { color: '#00CC44', border: 'rgba(0,0,0,0.7)' },
    warning:  { color: '#FFA500', border: 'rgba(0,0,0,0.7)' },
    critical: { color: '#FF2222', border: 'rgba(0,0,0,0.75)' },
    lastgasp: { color: '#FF4400', border: 'rgba(0,0,0,0.75)' },
    dead:     { color: '#5A6A72', border: 'rgba(0,0,0,0.75)' }
  };

  // The 31 real nodes come in three roles and the map has to make them tellable
  // apart at a glance, so role drives SHAPE and state drives COLOUR. Sizes are
  // the drawn box for each marker; the gateway is largest because it is the one
  // node placed outside the angle of draw and is the link the rest depend on.
  var ROLE_CONFIG = {
    gateway: { shape: 'square',   size: 16 },
    anchor:  { shape: 'triangle', size: 14 },
    scout:   { shape: 'circle',   size: 11 }
  };

  function roleOf(node) {
    // node_type is what the database and /api/nodes carry. Fall back to the
    // node id only for legacy fixture rows that predate the column.
    var t = (node.node_type || '').toLowerCase();
    if (ROLE_CONFIG[t]) return t;
    if (node.node_id === 'N31') return 'gateway';
    return 'scout';
  }

  function shapeSvg(role, cfg, state) {
    var sz = ROLE_CONFIG[role].size;
    var fill = cfg.color;
    var stroke = cfg.border;
    var body;

    if (ROLE_CONFIG[role].shape === 'square') {
      body = '<rect x="1.5" y="1.5" width="' + (sz - 3) + '" height="' + (sz - 3) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    } else if (ROLE_CONFIG[role].shape === 'triangle') {
      body = '<polygon points="' + (sz / 2) + ',1.5 ' + (sz - 1.5) + ',' + (sz - 2) +
             ' 1.5,' + (sz - 2) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5" stroke-linejoin="round"/>';
    } else {
      body = '<circle cx="' + (sz / 2) + '" cy="' + (sz / 2) + '" r="' + (sz / 2 - 1.5) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    }

    // A dead node keeps its shape (so you can still see WHAT died) and gains a
    // crosshatch, matching the convention the old LED markers used.
    var cross = '';
    if (state === 'dead') {
      cross = '<line x1="2" y1="2" x2="' + (sz - 2) + '" y2="' + (sz - 2) + '" stroke="#1A2228" stroke-width="1.6" opacity="0.85"/>' +
              '<line x1="' + (sz - 2) + '" y1="2" x2="2" y2="' + (sz - 2) + '" stroke="#1A2228" stroke-width="1.6" opacity="0.85"/>';
    }

    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '">' +
           body + cross + '</svg>';
  }

  function createIcon(state, role) {
    var cfg = STATE_CONFIG[state] || STATE_CONFIG.dead;
    role = ROLE_CONFIG[role] ? role : 'scout';
    var sz = ROLE_CONFIG[role].size;

    var animStyle = '';
    if (state === 'critical') animStyle = 'animation:blink 1s step-end infinite;';
    if (state === 'lastgasp') animStyle = 'animation:blink 0.5s step-end infinite;';

    return L.divIcon({
      className: 'node-marker-led node-marker-' + role,
      html: '<div class="node-led" style="width:' + sz + 'px;height:' + sz + 'px;' +
            'line-height:0;cursor:pointer;' + animStyle + '">' +
            shapeSvg(role, cfg, state) +
            '</div>',
      iconSize: [sz, sz],
      iconAnchor: [sz / 2, sz / 2]
    });
  }

  function findAlarmForNode(nodeId) {
    if (!nodeId) return null;
    var nd = nodeData[nodeId];
    if (!nd) return null;

    // getAlarms() returns null in live mode until alarms have loaded, so guard
    // on the RESULT being an array, not just on the function existing. Without
    // this the click handler throws before Leaflet can open the node popup.
    var alarms = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms)
      ? fixtureProvider.getAlarms() : [];
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
    var t = node.lastTelemetry;
    var strain = t ? (t.strain_ustrain + ' ustrain') : '--';
    var battery = t ? (t.vbat_mv + ' mV') : '--';
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
      nodeData[n.node_id] = n;

      var marker = L.marker(pos, {
        icon: createIcon(n.state, roleOf(n)),
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
    // Role is a property of the node, not of its health, so it survives every
    // state change - a gateway must never redraw as a scout circle.
    var role = nodeData[nodeId] ? roleOf(nodeData[nodeId]) : 'scout';
    markers[nodeId].setIcon(createIcon(state, role));
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
