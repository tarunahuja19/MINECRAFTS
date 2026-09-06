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

  function show(nodeId) {
    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(nodeId) : null;
    if (!nd) nd = { node_id: nodeId, state: 'active' };

    currentNodeId = nodeId;
    if (emptyState) emptyState.style.display = 'none';
    container.style.display = 'block';

    var tierKey = getTierForNode(nodeId, nd);
    var tierInfo = TIER_INFO[tierKey] || TIER_INFO['1A'];

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

    var xCoord = (nd.x !== undefined && nd.x !== null) ? Number(nd.x).toFixed(2) + 'm' : '--';
    var yCoord = (nd.y !== undefined && nd.y !== null) ? Number(nd.y).toFixed(2) + 'm' : '--';
    var zCoord = (nd.z !== undefined && nd.z !== null) ? Number(nd.z).toFixed(2) + 'm' : '--';
    var coordsStr = 'X: ' + xCoord + ' · Y: ' + yCoord + ' · Z: ' + zCoord;

    var latVal = (nd.lat !== undefined && nd.lat !== null) ? Number(nd.lat).toFixed(4) + '° N' : '--';
    var lonVal = (nd.lng !== undefined && nd.lng !== null) ? Number(nd.lng).toFixed(4) + '° E' :
                 ((nd.lon !== undefined && nd.lon !== null) ? Number(nd.lon).toFixed(4) + '° E' : '--');
    var geoStr = latVal + ', ' + lonVal;

    var stateUpper = (nd.state || 'active').toUpperCase();
    var ringUpper = (nd.ring || 'INTERIOR').toUpperCase();

    container.innerHTML =
      '<div class="panel-header">' +
        '<span>' + nodeId + '</span>' +
        '<span class="state-badge ' + (nd.state || 'active') + '">' + stateUpper + '</span>' +
        '<button class="btn" id="btn-close-detail" style="margin-left:auto;padding:2px 6px;font-size:10px;">X</button>' +
      '</div>' +
      '<div class="panel-body" id="detail-body">' +
        // Sensor Hardware Identity
        '<div class="panel-inset" style="margin-bottom:8px;">' +
          '<div class="readout-label">HARDWARE IDENTITY</div>' +
          '<div class="readout mono sensor-name" id="detail-sensor-name">' + tierInfo.sensor_name + '</div>' +
          '<div class="sensor-tier-desc" id="detail-sensor-tier">' + tierInfo.hardware_tier_desc + '</div>' +
          '<div style="margin-top:4px;">' +
            '<div class="readout-label">MONITORED CHANNELS</div>' +
            '<div class="mono sensor-channels-list" id="detail-channels">' + tierInfo.channels + '</div>' +
          '</div>' +
        '</div>' +

        // Spatial Deployment Profile
        '<div class="panel-inset" style="margin-bottom:8px;">' +
          '<div class="readout-label" style="margin-bottom:4px;">SPATIAL DEPLOYMENT</div>' +
          '<div class="meta-row">' +
            '<span class="readout-label">SITE</span>' +
            '<span class="readout-val mono" id="detail-site">' + (nd.site_id || 'adriyala_panel_1') + '</span>' +
          '</div>' +
          '<div class="meta-row">' +
            '<span class="readout-label">MINE GRID</span>' +
            '<span class="readout-val mono" id="detail-coords">' + coordsStr + '</span>' +
          '</div>' +
          '<div class="meta-row">' +
            '<span class="readout-label">SURFACE GEODESY</span>' +
            '<span class="readout-val mono" id="detail-geo">' + geoStr + '</span>' +
          '</div>' +
          '<div class="meta-row">' +
            '<span class="readout-label">SUBSIDENCE ZONE</span>' +
            '<span class="readout-val mono" id="detail-ring-status">' + ringUpper + ' ZONE · ' + stateUpper + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="section-sep"></div>' +
        '<div class="readout-label">LAST SEEN</div>' +
        '<div class="readout mono" id="detail-last-seen">--</div>' +
        '<div class="section-sep"></div>' +
        '<div class="readout-label">CURRENT STRAIN</div>' +
        '<div class="readout mono" id="detail-strain">' + formatStrain(t) + '</div>' +
        '<div class="section-sep"></div>' +
        '<div id="strain-chart-container" class="panel-inset" style="height:150px;"></div>' +
        '<div class="section-sep"></div>' +
        '<div id="tilt-chart-container" class="panel-inset" style="height:150px;"></div>' +
        '<div class="section-sep"></div>' +
        '<div id="sensor-readouts"></div>' +
        '<div class="section-sep"></div>' +
        '<button class="btn" id="btn-export-csv" style="width:100%;">EXPORT CSV</button>' +
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

    // Asynchronously fetch complete profile & latest reading directly from PostgreSQL backend
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

    if (dbNode.sensor_name) {
      var nameEl = document.getElementById('detail-sensor-name');
      if (nameEl) nameEl.textContent = dbNode.sensor_name;
    }

    if (dbNode.hardware_tier_desc) {
      var tierEl = document.getElementById('detail-sensor-tier');
      if (tierEl) tierEl.textContent = dbNode.hardware_tier_desc;
    }

    if (dbNode.channels) {
      var chanEl = document.getElementById('detail-channels');
      if (chanEl) {
        chanEl.textContent = Array.isArray(dbNode.channels) ? dbNode.channels.join(', ') : dbNode.channels;
      }
    }

    if (dbNode.site_id) {
      var siteEl = document.getElementById('detail-site');
      if (siteEl) siteEl.textContent = dbNode.site_id;
    }

    if (dbNode.x !== undefined && dbNode.y !== undefined && dbNode.z !== undefined) {
      var coordsEl = document.getElementById('detail-coords');
      if (coordsEl) {
        coordsEl.textContent = 'X: ' + Number(dbNode.x).toFixed(2) + 'm · Y: ' +
                              Number(dbNode.y).toFixed(2) + 'm · Z: ' +
                              Number(dbNode.z).toFixed(2) + 'm';
      }
    }

    if (dbNode.lat !== undefined && dbNode.lon !== undefined) {
      var geoEl = document.getElementById('detail-geo');
      if (geoEl) {
        geoEl.textContent = Number(dbNode.lat).toFixed(4) + '° N, ' + Number(dbNode.lon).toFixed(4) + '° E';
      }
    }

    if (dbNode.latest_reading) {
      var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(currentNodeId) : null;
      if (nd) {
        nd.lastTelemetry = dbNode.latest_reading;
        updateLastSeen(nd);
      }
      updateTelemetry(dbNode.latest_reading);
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
