'use strict';

var nodeDetail = (function () {
  var currentNodeId = null;
  var ageTimer = null;
  var container = null;
  var emptyState = null;

  var TIER_INFO = {
    '1A': {
      sensor_name: 'MPU-6050 6-DoF IMU & Vibration Analyzer',
      hardware_tier_desc: 'Tier 1A Scout (Baseline / Interior)',
      channels: 'Tilt X/Y, Accel XYZ, Gyro XYZ, Vibration RMS'
    },
    '1B': {
      sensor_name: 'MPU-6050 IMU + Foil Strain Gauge & Crackmeter',
      hardware_tier_desc: 'Tier 1B Scout (Tension / Shear Band)',
      channels: 'Tilt X/Y, Foil Strain, Crackmeter Fissure, Vibration RMS'
    },
    '1C': {
      sensor_name: 'MPU-6050 IMU + Multipoint Extensometer & Moisture',
      hardware_tier_desc: 'Tier 1C Scout (Fault / Water Corridor)',
      channels: 'Tilt X/Y, MP Extensometer Delta, Soil Moisture, Vibration RMS'
    },
    '2A': {
      sensor_name: 'ADXL355 Ultra-Low-Noise Triaxial Inclinometer',
      hardware_tier_desc: 'Tier 2A Anchor (Mesh Router)',
      channels: 'Ultra-low-noise Inclinometer, Mesh Relay, High-res Tilt X/Y'
    },
    '2B': {
      sensor_name: 'Vibrating Wire Piezometer & Borehole IPI String',
      hardware_tier_desc: 'Tier 2B Anchor (Geotech Borehole)',
      channels: 'Pore Pressure, Multilevel In-Place Inclinometer, Temperature'
    },
    '3': {
      sensor_name: 'High-Precision GNSS / RTK Receiver',
      hardware_tier_desc: 'Tier 3 Gateway (Master Sink)',
      channels: 'Dual-frequency GNSS RTK, Surface Displacement dX/dY/dZ'
    }
  };

  function getTierForNode(nodeId, nd) {
    if (nd && nd.tier && TIER_INFO[nd.tier]) return nd.tier;
    if (nodeId === 'N31') return '3';
    var anchors = { 'N02': '2A', 'N05': '2B', 'N12': '2A', 'N15': '2B', 'N22': '2A', 'N25': '2B' };
    if (anchors[nodeId]) return anchors[nodeId];
    var t1b = { 'N06': '1B', 'N09': '1B', 'N16': '1B', 'N19': '1B', 'N26': '1B', 'N29': '1B' };
    if (t1b[nodeId]) return t1b[nodeId];
    var t1c = { 'N04': '1C', 'N10': '1C', 'N14': '1C', 'N20': '1C', 'N24': '1C', 'N30': '1C' };
    if (t1c[nodeId]) return t1c[nodeId];
    return '1A';
  }

  function init() {
    container = document.getElementById('panel-node-detail');
    emptyState = document.getElementById('panel-empty');

    bus.on('node-selected', function (nodeId) {
      show(nodeId);
    });

    bus.on('telemetry', function (t) {
      var id = t._node_id || t.node_id;
      if (id === currentNodeId) {
        updateTelemetry(t);
      }
    });

    bus.on('node-status-change', function (data) {
      if (data.node_id === currentNodeId) {
        updateStateBadge(data.state);
      }
    });
  }

  function glyphChipOf(nodeId, nd, tierKey) {
    var role = (typeof nodeMarkers !== 'undefined' && nodeMarkers.roleOf) ? nodeMarkers.roleOf(nd || { node_id: nodeId }) : 'scout';
    var letter = (typeof nodeMarkers !== 'undefined' && nodeMarkers.tierLetterOf) ? nodeMarkers.tierLetterOf(nd || { node_id: nodeId }) : 'A';
    if (nodeId === 'N31' || tierKey === '3') { role = 'gateway'; letter = 'G'; }

    var shapeClass = (role === 'gateway') ? 'triangle' : (role === 'anchor' ? 'circle' : 'square');
    var shapeName = (role === 'gateway') ? 'Triangle' : (role === 'anchor' ? 'Circular' : 'Square');
    var roleLabel = (role === 'gateway') ? 'Gateway' : (role === 'anchor' ? 'Anchor' : 'Scout');

    var color = '#00CC44';
    if (nd && nd.state === 'warning') color = '#FFA500';
    if (nd && (nd.state === 'critical' || nd.state === 'lastgasp')) color = '#FF2222';
    if (nd && nd.state === 'dead') color = '#5A6A72';

    return '<span class="node-glyph-chip">' +
             '<span class="node-glyph-icon ' + shapeClass + '" style="background:' + color + ';">' + letter + '</span>' +
             '<span>' + shapeName + ' ' + letter + ' · Tier ' + tierKey + ' ' + roleLabel + '</span>' +
           '</span>';
  }

  function show(nodeId) {
    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(nodeId) : null;
    if (!nd) nd = { node_id: nodeId, state: 'active' };

    currentNodeId = nodeId;
    if (emptyState) emptyState.style.display = 'none';
    container.style.display = 'block';

    var tierKey = getTierForNode(nodeId, nd);

    var t = nd.lastTelemetry;
    if (!t && typeof fixtureProvider !== 'undefined') {
      var allT = fixtureProvider.getTelemetry();
      if (allT) {
        for (var k = allT.length - 1; k >= 0; k--) {
          if (allT[k].node_id === nodeId) {
            t = allT[k];
            nd.lastTelemetry = t;
            break;
          }
        }
      }
    }

    var stateUpper = (nd.state || 'active').toUpperCase();

    container.innerHTML =
      '<div class="panel-header" style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;gap:6px;">' +
        '<div style="display:flex;align-items:center;gap:6px;min-width:0;overflow:hidden;">' +
          '<span style="font-family:monospace;font-size:13px;font-weight:900;color:#FFF;">' + nodeId + '</span>' +
          glyphChipOf(nodeId, nd, tierKey) +
          '<span class="state-badge ' + (nd.state || 'active') + '">' + stateUpper + '</span>' +
        '</div>' +
        '<button class="btn" id="btn-close-detail" style="margin-left:auto;padding:2px 7px;font-size:10px;line-height:1.2;">✕</button>' +
      '</div>' +
      '<div class="panel-body" id="detail-body" style="padding:8px;">' +
        // Compact Status bar: Last Seen
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;margin-bottom:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:4px;">' +
          '<span style="font-size:10px;font-family:monospace;color:#7A9BAA;">TELEMETRY LINK:</span>' +
          '<span class="mono" id="detail-last-seen" style="font-size:10.5px;color:#CAD5DD;">--</span>' +
        '</div>' +

        // Glassmorphic Monitored Telemetry Cards
        '<div id="sensor-readouts"></div>' +

        // Export Action
        '<button class="btn" id="btn-export-csv" style="width:100%;margin-top:6px;padding:6px;font-size:11px;letter-spacing:0.04em;">EXPORT CSV</button>' +
      '</div>';

    document.getElementById('btn-close-detail').addEventListener('click', hide);
    var exportBtn = document.getElementById('btn-export-csv');
    exportBtn.addEventListener('click', function () {
      if (window.r4 && window.r4.exportNodeCSV) {
        exportBtn.textContent = 'EXPORTING...';
        exportBtn.disabled = true;
        window.r4.exportNodeCSV(currentNodeId).then(function () {
          exportBtn.textContent = 'CSV EXPORTED';
          setTimeout(function () {
            exportBtn.textContent = 'EXPORT CSV';
            exportBtn.disabled = false;
          }, 2000);
        }).catch(function () {
          exportBtn.textContent = 'EXPORT CSV';
          exportBtn.disabled = false;
        });
      }
    });

    updateLastSeen(nd);
    startAgeTimer(nd);

    if (typeof nodeSensors !== 'undefined' && nodeSensors.render) {
      nodeSensors.render('sensor-readouts', nodeId, t, nd);
    }

    fetchDbNodeProfile(nodeId);

    bus.emit('detail-opened', { nodeId: nodeId });
  }

  function fetchDbNodeProfile(nodeId) {
    fetch('http://localhost:8080/api/nodes/' + encodeURIComponent(nodeId))
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (dbNode) {
        if (currentNodeId !== nodeId) return;
        applyDbProfile(dbNode);
      })
      .catch(function (err) {
        console.warn('[node-detail] DB fetch notice:', err.message);
      });
  }

  function applyDbProfile(dbNode) {
    if (dbNode.latest_reading) {
      var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(currentNodeId) : null;
      if (nd) {
        nd.lastTelemetry = dbNode.latest_reading;
        updateLastSeen(nd);
      }
      if (typeof nodeSensors !== 'undefined' && nodeSensors.render) {
        nodeSensors.render('sensor-readouts', currentNodeId, dbNode.latest_reading, dbNode);
      }
    }
  }

  function hide() {
    currentNodeId = null;
    container.style.display = 'none';
    var alarmPanel = document.getElementById('panel-alarm-detail');
    if (emptyState && (!alarmPanel || alarmPanel.style.display === 'none')) {
      emptyState.style.display = 'flex';
    }
    if (ageTimer) { clearInterval(ageTimer); ageTimer = null; }
    bus.emit('detail-closed', null);
  }

  // An idle node reports no strain at all: the server sends null (not just
  // undefined), so both must fall back to the em-dash with no unit appended.
  function formatStrain(t) {
    if (!t) return '--';
    var v = (t.strain_ustrain != null) ? t.strain_ustrain
          : (t.strain_ue != null) ? t.strain_ue
          : null;
    return (v == null) ? '--' : v + ' ustrain';
  }

  function updateTelemetry(t) {
    var el = document.getElementById('detail-strain');
    if (el) {
      el.textContent = formatStrain(t);
    }

    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(currentNodeId) : null;
    if (nd) {
      nd.lastTelemetry = t;
      updateLastSeen(nd);
    }
  }

  function updateStateBadge(state) {
    var badge = container.querySelector('.state-badge');
    if (badge) {
      badge.className = 'state-badge ' + state;
      badge.textContent = state.toUpperCase();
    }
  }

  function formatIsoLocal(d) {
    var pad = function (n) { return String(n).padStart(2, '0'); };
    var offMin = -d.getTimezoneOffset();
    var sign = offMin >= 0 ? '+' : '-';
    var abs = Math.abs(offMin);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
           'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
           sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60);
  }

  function formatAge(ageS) {
    if (ageS < 0) ageS = 0;
    if (ageS < 60) return ageS + 's ago';
    if (ageS < 3600) return Math.floor(ageS / 60) + 'm ' + (ageS % 60) + 's ago';
    return Math.floor(ageS / 3600) + 'h ' + Math.floor((ageS % 3600) / 60) + 'm ago';
  }

  function updateLastSeen(nd) {
    var el = document.getElementById('detail-last-seen');
    if (!el) return;
    var t = nd ? nd.lastTelemetry : null;
    if (!t) { el.textContent = '--'; return; }

    var epochS = t.t_epoch_s;
    if (!epochS && t.ts) {
      epochS = Math.floor(new Date(t.ts).getTime() / 1000);
    }
    if (!epochS) { el.textContent = '--'; return; }

    var iso = formatIsoLocal(new Date(epochS * 1000));
    var isFixture = (typeof modeSwitch !== 'undefined' && modeSwitch.getMode() === 'fixture');

    if (isFixture) {
      el.textContent = iso + ' (LIVE)';
      return;
    }

    el.textContent = iso + ' (' + formatAge(Math.floor(Date.now() / 1000) - epochS) + ')';
  }

  function startAgeTimer(nd) {
    if (ageTimer) clearInterval(ageTimer);
    ageTimer = setInterval(function () {
      updateLastSeen(nd);
    }, 1000);
  }

  function getCurrentNodeId() { return currentNodeId; }

  return {
    init: init,
    show: show,
    hide: hide,
    getCurrentNodeId: getCurrentNodeId
  };
})();
