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
    lastgasp: { color: '#FF2222', border: 'rgba(0,0,0,0.75)' },
    dead:     { color: '#5A6A72', border: 'rgba(0,0,0,0.75)' }
  };

  // Role defines SHAPE, tier defines GLYPH LETTER, state defines COLOUR:
  // - Scout: Circular A, Circular B, Circular C
  // - Anchor: Concentric Circular A, Circular B, Circular C
  // - Gateway: Triangle G
  var ROLE_CONFIG = {
    scout:   { shape: 'circle',   size: 20 },
    anchor:  { shape: 'circle',   size: 22 },
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

    if (ROLE_CONFIG[role].shape === 'triangle') {
      body = '<polygon points="' + (sz / 2) + ',1.5 ' + (sz - 1.5) + ',' + (sz - 2) +
             ' 1.5,' + (sz - 2) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6" stroke-linejoin="round"/>';
      textEl = '<text x="' + (sz / 2) + '" y="' + (sz / 2 + 6.2) + '" text-anchor="middle" ' +
               'font-size="10" font-family="Consolas, monospace, sans-serif" font-weight="900" fill="' + textColor + '">G</text>';
    } else if (role === 'anchor') {
      // Anchor: concentric dual ring circle with tier letter inside
      body = '<circle cx="' + (sz / 2) + '" cy="' + (sz / 2) + '" r="' + (sz / 2 - 1.5) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="2"/>' +
             '<circle cx="' + (sz / 2) + '" cy="' + (sz / 2) + '" r="' + (sz / 2 - 3.8) + '" ' +
             'fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.9"/>';
      textEl = '<text x="' + (sz / 2) + '" y="' + (sz / 2 + 3.8) + '" text-anchor="middle" ' +
               'font-size="10.5" font-family="Consolas, monospace, sans-serif" font-weight="900" fill="' + textColor + '">' + letter + '</text>';
    } else {
      // Scout: clean single-stroke circle with tier letter inside (no square overlaid)
      body = '<circle cx="' + (sz / 2) + '" cy="' + (sz / 2) + '" r="' + (sz / 2 - 1.5) + '" ' +
             'fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.6"/>';
      textEl = '<text x="' + (sz / 2) + '" y="' + (sz / 2 + 3.8) + '" text-anchor="middle" ' +
               'font-size="10.5" font-family="Consolas, monospace, sans-serif" font-weight="900" fill="' + textColor + '">' + letter + '</text>';
    }

    var cross = '';
    if (state === 'dead') {
      cross = '<line x1="3" y1="3" x2="' + (sz - 3) + '" y2="' + (sz - 3) + '" stroke="#1A2228" stroke-width="1.8" opacity="0.85"/>' +
              '<line x1="' + (sz - 3) + '" y1="3" x2="3" y2="' + (sz - 3) + '" stroke="#1A2228" stroke-width="1.8" opacity="0.85"/>';
    }

    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 ' + sz + ' ' + sz + '" style="display:block;">' +
           body + textEl + cross + '</svg>';
  }

  function createIcon(state, role, letter) {
    var cfg = STATE_CONFIG[state] || STATE_CONFIG.dead;
    role = ROLE_CONFIG[role] ? role : 'scout';
    letter = letter || 'A';
    var sz = ROLE_CONFIG[role].size;

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
      return '<div style="display:flex;gap:10px;justify-content:space-between;margin-top:2px;">' +
             '<span style="color:#8AA0AC;">' + k + '</span>' +
             '<span style="color:#E6EDF2;font-variant-numeric:tabular-nums;font-weight:600;">' + v + '</span></div>';
    }
    var xm = (typeof node.x === 'number') ? node.x.toFixed(1) + ' m' : '--';
    var ym = (typeof node.y === 'number') ? node.y.toFixed(1) + ' m' : '--';
    var lat = (typeof node.lat === 'number') ? node.lat.toFixed(6) : '--';
    var lng = (typeof node.lng === 'number') ? node.lng.toFixed(6) : '--';

    var t = node.lastTelemetry;
    var strainVal = (t && t.strain_ustrain != null) ? (t.strain_ustrain + ' µε')
                  : (t && t.strain_ue != null) ? (t.strain_ue + ' µε')
                  : (t && t.strain != null) ? (t.strain + ' µε') : '--';
    var vbatVal = (t && t.vbat_mv != null) ? (t.vbat_mv + ' mV')
                : (t && t.channels && t.channels.vbat_mv != null) ? (t.channels.vbat_mv + ' mV') : '--';
    var tx = (t && t.tilt_x_mdeg != null) ? t.tilt_x_mdeg : (t && t.tilt_x != null ? t.tilt_x : null);
    var ty = (t && t.tilt_y_mdeg != null) ? t.tilt_y_mdeg : (t && t.tilt_y != null ? t.tilt_y : null);
    var tiltVal = (tx != null && ty != null) ? Math.hypot(tx, ty).toFixed(0) + ' mdeg' : '--';
    var tempVal = (t && t.temp_c != null) ? (t.temp_c + ' °C')
                : (t && t.channels && t.channels.temperature_c != null) ? (t.channels.temperature_c + ' °C') : '--';

    var stateColor = '#00CC44';
    if (node.state === 'warning') stateColor = '#FFA500';
    else if (node.state === 'critical' || node.state === 'lastgasp') stateColor = '#FF2222';
    else if (node.state === 'dead') stateColor = '#5A6A72';

    return '<div style="font:11px ui-monospace,Menlo,monospace;min-width:210px;padding:2px 0;">' +
           '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
             '<span style="font-size:13px;font-weight:900;color:#FFF;">' + node.node_id + '</span>' +
             '<span style="padding:1px 6px;border-radius:3px;font-size:10px;font-weight:700;background:' + stateColor + ';color:#0B1318;">' +
               (node.state || 'unknown').toUpperCase() +
             '</span>' +
           '</div>' +
           row('Role / Tier', (ROLE_LABEL[role] || role) + ' (' + (node.tier || tierLetterOf(node)) + ')') +
           '<div style="height:1px;background:#2A3841;margin:6px 0;"></div>' +
           row('Strain (Gauge)', strainVal) +
           row('Tilt Magnitude', tiltVal) +
           row('Battery (Vbat)', vbatVal) +
           row('Temperature', tempVal) +
           '<div style="height:1px;background:#2A3841;margin:6px 0;"></div>' +
           row('Grid (X / Y)', xm + ', ' + ym) +
           row('GPS (Lat/Lon)', lat + ', ' + lng) +
           '</div>';
  }

  function buildTooltip(node) {
    if (simState === 'STOPPED') {
      return node.node_id + ' [OFFLINE]\nSIMULATION: STOPPED\nWaiting for simulation start...';
    }
    var t = node.lastTelemetry;
    var strain = (t && t.strain_ustrain != null) ? (t.strain_ustrain + ' µε')
               : (t && t.strain_ue != null) ? (t.strain_ue + ' µε')
               : (t && t.strain != null) ? (t.strain + ' µε') : '--';
    var battery = (t && t.vbat_mv != null) ? (t.vbat_mv + ' mV')
                : (t && t.channels && t.channels.vbat_mv != null) ? (t.channels.vbat_mv + ' mV') : '--';
    var tx = (t && t.tilt_x_mdeg != null) ? t.tilt_x_mdeg : (t && t.tilt_x != null ? t.tilt_x : null);
    var ty = (t && t.tilt_y_mdeg != null) ? t.tilt_y_mdeg : (t && t.tilt_y != null ? t.tilt_y : null);
    var tiltStr = (tx != null && ty != null) ? Math.hypot(tx, ty).toFixed(0) + ' mdeg' : '--';
    var ts = t ? formatTimestamp(t.t_epoch_s) : '--:--:--';
    return node.node_id + ' [' + (node.state || 'active').toUpperCase() + ']\n' +
           'Role: ' + (ROLE_LABEL[roleOf(node)] || 'Scout') + ' (Tier ' + tierLetterOf(node) + ')\n' +
           'Strain: ' + strain + '\n' +
           'Tilt: ' + tiltStr + '\n' +
           'Battery: ' + battery + '\n' +
           'Last: ' + ts;
  }

  // Where a node is drawn. x/y (panel-frame metres) are the physics truth, so
  // they are projected through the map's single converter whenever present.
  // A record's own lat/lng is used only as a fallback for legacy rows that
  // carry no x/y - the static fixtures still hold pre-alignment Jharia
  // coordinates, and trusting those would scatter markers 1000 km off the site.
  var forgeNodeStates = {};
  var busListenersWired = false;

  function normalizeNodeId(id) {
    if (id == null) return '';
    var s = String(id).trim().toUpperCase();
    if (/^N\d+$/.test(s)) {
      var num = parseInt(s.substring(1), 10);
      return 'N' + String(num).padStart(2, '0');
    }
    if (/^\d+$/.test(s)) {
      var num2 = parseInt(s, 10);
      return 'N' + String(num2).padStart(2, '0');
    }
    return s;
  }

  function resolveMarker(nodeId) {
    if (!nodeId) return null;
    var norm = normalizeNodeId(nodeId);
    if (markers[norm]) return markers[norm];
    if (markers[nodeId]) return markers[nodeId];
    var digits = String(nodeId).replace(/\D/g, '');
    if (digits) {
      var num = parseInt(digits, 10);
      if (markers[num]) return markers[num];
      if (markers[String(num)]) return markers[String(num)];
      var pad = 'N' + String(num).padStart(2, '0');
      if (markers[pad]) return markers[pad];
    }
    return null;
  }

  function resolveNodeData(nodeId) {
    if (!nodeId) return null;
    var norm = normalizeNodeId(nodeId);
    if (nodeData[norm]) return nodeData[norm];
    if (nodeData[nodeId]) return nodeData[nodeId];
    var digits = String(nodeId).replace(/\D/g, '');
    if (digits) {
      var num = parseInt(digits, 10);
      if (nodeData[num]) return nodeData[num];
      if (nodeData[String(num)]) return nodeData[String(num)];
      var pad = 'N' + String(num).padStart(2, '0');
      if (nodeData[pad]) return nodeData[pad];
    }
    return null;
  }

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
    // Clean up any existing markers from the Leaflet layer
    Object.keys(markers).forEach(function (k) {
      if (markers[k] && map && map.hasLayer && map.hasLayer(markers[k])) {
        map.removeLayer(markers[k]);
      }
    });
    markers = {};
    nodeData = {};

    var drawn = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];

      var pos = latLngFor(n);
      if (!pos) {
        console.warn('[node-markers] Skipping ' + n.node_id + ': no usable position');
        continue;
      }
      n.lat = pos[0];
      n.lng = pos[1];
      var normId = normalizeNodeId(n.node_id);
      var currentSt = forgeNodeStates[normId] || (simState === 'RUNNING' && window.__SIM_PLAYING__ ? (n.state || 'active') : 'dead');
      n.state = currentSt;

      var marker = L.marker(pos, {
        icon: createIcon(n.state, roleOf(n), tierLetterOf(n)),
        title: n.node_id
      });

      marker._nodeId = n.node_id;
      marker._normId = normId;
      marker.on('click', function () {
        var nodeId = this._normId || this._nodeId;
        var nd = resolveNodeData(nodeId);
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

      // Index under all variants so any caller finds it immediately
      markers[n.node_id] = marker;
      markers[normId] = marker;
      nodeData[n.node_id] = n;
      nodeData[normId] = n;
      var num = parseInt(normId.replace(/\D/g, ''), 10);
      if (!isNaN(num)) {
        markers[num] = marker;
        markers[String(num)] = marker;
        nodeData[num] = n;
        nodeData[String(num)] = n;
      }

      drawn.push(pos);
    }

    // Frame the real node set (the gateway sits outside the 600 m window).
    if (drawn.length && typeof mapView !== 'undefined' && mapView.fitToNodes) {
      mapView.fitToNodes(L.latLngBounds(drawn));
    }

    if (!busListenersWired) {
      busListenersWired = true;
      setupBusListeners();
    }

    updateNodeCount();
  }

  function setupBusListeners() {
    bus.on('node-status-change', function (data) {
      if (!data || !data.node_id) return;
      var nid = normalizeNodeId(data.node_id);
      var st = (data.state || 'active').toLowerCase();
      updateState(nid, st);
    });

    bus.on('forge-node-states', function (states) {
      if (!states) return;
      Object.keys(states).forEach(function (rawId) {
        var nid = normalizeNodeId(rawId);
        var st = (states[rawId] || 'ACTIVE').toLowerCase();
        forgeNodeStates[nid] = st;
        updateState(nid, st);
      });
    });

    bus.on('forge-collapse', function (data) {
      if (!data) return;
      var cx = Number(data.cx) || 0;
      var cy = Number(data.cy) || 0;
      var r = Number(data.radiusM) || 75;
      var rWhite = r * 1.2;
      var rRed = r * 1.5;
      var all = getAllNodes();
      var critNodes = [];
      var warnNodes = [];
      all.forEach(function (n) {
        if (!n) return;
        var nx = Number(n.x);
        var ny = Number(n.y);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
          if (typeof mapView !== 'undefined' && mapView.latLonToXY && n.lat != null && n.lng != null) {
            var xy = mapView.latLonToXY(n.lat, n.lng);
            nx = xy[0];
            ny = xy[1];
          } else {
            nx = 0;
            ny = 0;
          }
        }
        var dist = Math.hypot(nx - cx, ny - cy);
        var nid = normalizeNodeId(n.node_id);
        if (dist <= rWhite) {
          forgeNodeStates[nid] = 'critical';
          updateState(nid, 'critical');
          critNodes.push(nid);
        } else if (dist <= rRed) {
          if (forgeNodeStates[nid] !== 'critical') {
            forgeNodeStates[nid] = 'warning';
            updateState(nid, 'warning');
            warnNodes.push(nid);
          }
        }
      });
      console.log('[node-markers] forge-collapse at (' + cx + ',' + cy + '): ' +
        critNodes.length + ' critical nodes: [' + critNodes.join(',') + '], ' +
        warnNodes.length + ' warning nodes: [' + warnNodes.join(',') + ']');
      if (critNodes.length > 0 && typeof bus !== 'undefined' && bus.emit) {
        bus.emit('alarm', {
          alarm_id: 'ALM-CAVEIN-' + Math.round(cx) + '_' + Math.round(cy),
          level: 3,
          affected_nodes: critNodes,
          t_utc: new Date().toISOString(),
          trough_fit_r2: 0.98,
          description: 'Pillar failure & ground subsidence detected at (' + Math.round(cx) + 'm, ' + Math.round(cy) + 'm)'
        });
      }
    });

    bus.on('forge-reset', function () {
      forgeNodeStates = {};
      var all = getAllNodes();
      for (var k = 0; k < all.length; k++) {
        updateState(all[k].node_id, 'active');
      }
    });

    bus.on('simulation-play', function () {
      simState = 'RUNNING';
      var all = getAllNodes();
      for (var k = 0; k < all.length; k++) {
        var nid = normalizeNodeId(all[k].node_id);
        var st = forgeNodeStates[nid] || 'active';
        updateState(nid, st);
      }
      updateNodeCount();
    });

    bus.on('simulation-stop', function () {
      simState = 'PAUSED';
      updateNodeCount();
    });

    bus.on('simulation-status', function (data) {
      var newState = data.state || (data.is_running ? 'RUNNING' : 'STOPPED');
      if (!window.__SIM_PLAYING__) {
        newState = (newState === 'PAUSED' || simState === 'PAUSED') ? 'PAUSED' : 'STOPPED';
      }
      if (newState === simState) return;
      simState = newState;
      console.log('[node-markers] Simulation state transitioned to: ' + simState);

      var all = getAllNodes();
      if (simState === 'STOPPED') {
        // When simulation is stopped, all nodes become dead and offline
        for (var k = 0; k < all.length; k++) {
          var sid = normalizeNodeId(all[k].node_id);
          var nd = resolveNodeData(sid);
          if (nd) {
            nd.state = 'dead';
            nd.lastTelemetry = null;
          }
          var m = resolveMarker(sid);
          if (m && nd) {
            m.setIcon(createIcon('dead', roleOf(nd), tierLetterOf(nd)));
            m.setTooltipContent(buildTooltip(nd));
          }
        }
      } else if (simState === 'RUNNING') {
        // When simulation is started, nodes revive to active baseline or FORGE state
        for (var j = 0; j < all.length; j++) {
          var rid = normalizeNodeId(all[j].node_id);
          var st = forgeNodeStates[rid] || 'active';
          updateState(rid, st);
        }
      }
      updateNodeCount();
    });

    bus.on('replay-started', function () {
      simState = 'RUNNING';
      var all = getAllNodes();
      for (var k = 0; k < all.length; k++) {
        var nd = resolveNodeData(all[k].node_id);
        if (nd) nd.lastTelemetry = null;
        updateState(all[k].node_id, 'active');
      }
      updateNodeCount();
    });

    bus.on('system-reset', function () {
      simState = 'STOPPED';
      forgeNodeStates = {};
      var all = getAllNodes();
      for (var k = 0; k < all.length; k++) {
        var sid = normalizeNodeId(all[k].node_id);
        var nd = resolveNodeData(sid);
        if (nd) {
          nd.lastTelemetry = null;
          nd.state = 'dead';
        }
        var m = resolveMarker(sid);
        if (m && nd) {
          m.setIcon(createIcon('dead', roleOf(nd), tierLetterOf(nd)));
          m.setTooltipContent(buildTooltip(nd));
        }
      }
      updateNodeCount();
    });

    bus.on('telemetry', function (t) {
      if (!window.__SIM_PLAYING__) return;
      var rawId = t._node_id || t.node_id;
      if (!rawId) return;
      var normId = normalizeNodeId(rawId);
      var nd = resolveNodeData(normId);

      if (nd) {
        nd.lastTelemetry = t;

        // The server assigns node state (session.py:_assign_node_states) and
        // ships it on the telemetry row as `t.state`. A genuine last-gasp packet
        // is a real device event (PACKET_FLAG_LAST_GASP = 1).
        if (t.flags & 1) {
          updateState(normId, 'critical');
        } else if (t.state) {
          var s = String(t.state).toLowerCase();
          if (s === 'lastgasp') s = 'critical';
          // If this node is currently under a FORGE collapse / hazard event,
          // do NOT let routine ambient telemetry downgrade it to active.
          if (s === 'active' && forgeNodeStates[normId] && forgeNodeStates[normId] !== 'active') {
            s = forgeNodeStates[normId];
          }
          updateState(normId, s);
        } else if (forgeNodeStates[normId]) {
          // No explicit state property in packet: retain FORGE state
          updateState(normId, forgeNodeStates[normId]);
        }

        var m = resolveMarker(normId);
        if (m) {
          m.setTooltipContent(buildTooltip(nd));
          if (m.setPopupContent) {
            m.setPopupContent(buildPopup(nd));
          }
        }
      }

      resetHeartbeatTimer(normId);
    });

    bus.on('alarm', function (alarm) {
      if (alarm.affected_nodes) {
        var targetState = (alarm.level === 3) ? 'critical' : (alarm.level === 2 ? 'warning' : 'warning');
        for (var j = 0; j < alarm.affected_nodes.length; j++) {
          var nid = normalizeNodeId(alarm.affected_nodes[j]);
          forgeNodeStates[nid] = targetState;
          updateState(nid, targetState);
        }
      }
    });
  }

  function resetHeartbeatTimer(nodeId) {
    if (heartbeatTimers[nodeId]) clearTimeout(heartbeatTimers[nodeId]);

    // Only apply the 30s heartbeat watchdog in LIVE MQTT mode.
    // In fixture mode, replay completes after ~35s and retains the final simulation state.
    if (typeof modeSwitch !== 'undefined' && modeSwitch.getMode() === 'fixture') {
      return;
    }

    heartbeatTimers[nodeId] = setTimeout(function () {
      var nd = resolveNodeData(nodeId);
      if (nd && nd.state !== 'dead') {
        updateState(nodeId, 'dead');
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  function updateState(nodeId, state) {
    var targetMarker = resolveMarker(nodeId);
    if (!targetMarker) return;
    var normId = normalizeNodeId(nodeId);
    var targetData = resolveNodeData(nodeId);

    if (state === 'lastgasp') state = 'critical';
    state = (state || 'active').toLowerCase();

    // No-op when the state has not actually changed.
    if (targetData && targetData.state === state) return;
    if (targetData) targetData.state = state;

    var role = targetData ? roleOf(targetData) : 'scout';
    var letter = targetData ? tierLetterOf(targetData) : 'A';
    targetMarker.setIcon(createIcon(state, role, letter));
    if (targetMarker.setPopupContent && targetData) {
      targetMarker.setPopupContent(buildPopup(targetData));
    }
    if (targetMarker.setTooltipContent && targetData) {
      targetMarker.setTooltipContent(buildTooltip(targetData));
    }
    updateNodeCount();

    if (state === 'critical' || state === 'lastgasp' || state === 'warning') {
      if (typeof lastgaspMarker !== 'undefined' && lastgaspMarker.showPulse) {
        lastgaspMarker.showPulse(normId, state);
      }
    } else {
      if (typeof lastgaspMarker !== 'undefined' && lastgaspMarker.removePulse) {
        lastgaspMarker.removePulse(normId);
      }
    }
  }

  function updateNodeCount() {
    var all = getAllNodes();
    var el = document.getElementById('node-count');
    if (!el) return;
    if (simState === 'STOPPED') {
      el.textContent = '0/' + all.length + ' ACTIVE (SIM STOPPED)';
    } else {
      var active = 0;
      for (var i = 0; i < all.length; i++) {
        if (all[i].state !== 'dead') active++;
      }
      el.textContent = active + '/' + all.length + ' ACTIVE';
    }
  }

  function syncWithForge() {
    if (typeof simTab !== 'undefined' && simTab.getForgeFrame) {
      var frame = simTab.getForgeFrame();
      if (frame && frame.node_states) {
        Object.keys(frame.node_states).forEach(function (rawId) {
          var nid = normalizeNodeId(rawId);
          var st = (frame.node_states[rawId] || 'ACTIVE').toLowerCase();
          forgeNodeStates[nid] = st;
          updateState(nid, st);
        });
        return;
      }
    }
    Object.keys(forgeNodeStates).forEach(function (nid) {
      updateState(nid, forgeNodeStates[nid]);
    });
  }

  function getMarker(nodeId) { return resolveMarker(nodeId); }
  function getNodeData(nodeId) { return resolveNodeData(nodeId); }
  function getAllNodes() {
    var seen = {};
    var list = [];
    Object.keys(nodeData).forEach(function (k) {
      var n = nodeData[k];
      if (n && n.node_id && !seen[n.node_id]) {
        seen[n.node_id] = true;
        list.push(n);
      }
    });
    return list;
  }

  return {
    init: init,
    updateState: updateState,
    getMarker: getMarker,
    getNodeData: getNodeData,
    getAllNodes: getAllNodes,
    roleOf: roleOf,
    tierLetterOf: tierLetterOf,
    createIcon: createIcon,
    normalizeNodeId: normalizeNodeId,
    syncWithForge: syncWithForge
  };
})();
