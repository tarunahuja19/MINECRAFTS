'use strict';

var nodeDetail = (function () {
  var currentNodeId = null;
  var ageTimer = null;
  var container = null;
  var emptyState = null;

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
    var nd = nodeMarkers.getNodeData(nodeId);
    if (!nd) return;

    currentNodeId = nodeId;
    if (emptyState) emptyState.style.display = 'none';
    container.style.display = 'block';

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

    container.innerHTML =
      '<div class="panel-header">' +
        '<span>' + nodeId + '</span>' +
        '<span class="state-badge ' + nd.state + '">' + nd.state.toUpperCase() + '</span>' +
        '<button class="btn" id="btn-close-detail" style="margin-left:auto;padding:2px 6px;font-size:10px;">X</button>' +
      '</div>' +
      '<div class="panel-body" id="detail-body">' +
        '<div class="readout-label">LAST SEEN</div>' +
        '<div class="readout mono" id="detail-last-seen">--</div>' +
        '<div class="section-sep"></div>' +
        '<div class="readout-label">RING</div>' +
        '<div class="readout mono">' + (nd.ring || '--').toUpperCase() + '</div>' +
        '<div class="section-sep"></div>' +
        '<div class="readout-label">STRAIN</div>' +
        '<div class="readout mono" id="detail-strain">' + (t ? t.strain_ustrain + ' ustrain' : '--') + '</div>' +
        '<div class="section-sep"></div>' +
        '<div id="strain-chart-container" class="panel-inset" style="height:140px;"></div>' +
        '<div class="section-sep"></div>' +
        '<div id="tilt-chart-container" class="panel-inset" style="height:140px;"></div>' +
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

    bus.emit('detail-opened', { nodeId: nodeId });
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

  function updateTelemetry(t) {
    var el = document.getElementById('detail-strain');
    if (el) el.textContent = t.strain_ustrain + ' ustrain';

    var nd = nodeMarkers.getNodeData(currentNodeId);
    if (nd) updateLastSeen(nd);
  }

  function updateStateBadge(state) {
    var badge = container.querySelector('.state-badge');
    if (badge) {
      badge.className = 'state-badge ' + state;
      badge.textContent = state.toUpperCase();
    }
  }

  // ISO 8601 local time with offset. Same formatter shape as the health table
  // so the two views cannot disagree about what "last seen" means.
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
    var t = nd.lastTelemetry;
    if (!t || !t.t_epoch_s) { el.textContent = '--'; return; }

    // The absolute timestamp is now shown in every mode. It used to be relative
    // only ("42s AGO"), which loses the actual instant the packet arrived - the
    // thing you need when correlating against a log or an alarm record. The
    // relative age stays alongside it because it answers "is this node alive
    // right now" at a glance.
    var iso = formatIsoLocal(new Date(t.t_epoch_s * 1000));
    var isFixture = (typeof modeSwitch !== 'undefined' && modeSwitch.getMode() === 'fixture');

    if (isFixture) {
      el.textContent = iso + ' (LIVE)';
      return;
    }

    el.textContent = iso + ' (' + formatAge(Math.floor(Date.now() / 1000) - t.t_epoch_s) + ')';
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
