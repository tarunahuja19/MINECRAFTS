'use strict';

var alarmDetail = (function () {
  var container = null;
  var emptyState = null;
  var nodePanel = null;
  var currentAlarm = null;

  function init() {
    container = document.getElementById('panel-alarm-detail');
    emptyState = document.getElementById('panel-empty');
    nodePanel = document.getElementById('panel-node-detail');

    bus.on('alarm-selected', function (alarm) {
      show(alarm);
    });
  }

  function show(alarm) {
    if (!alarm || !container) return;
    currentAlarm = alarm;

    if (emptyState) emptyState.style.display = 'none';
    container.style.display = 'block';

    var projText = '--';
    if (alarm.projection) {
      if (alarm.projection.days_to_level_3 === 0) {
        projText = 'ACTIVE EVENT';
      } else {
        projText = alarm.projection.days_to_level_3 + 'd to L3 (' +
                   Math.round(alarm.projection.confidence * 100) + '%)';
      }
    }

    var blastText = alarm.blast_correlated ? 'YES' : 'NO';
    var zoneText = (alarm.confidence_zone || '--').replace(/_/g, ' ').toUpperCase();

    var affectedHtml = '';
    if (alarm.affected_nodes) {
      for (var i = 0; i < alarm.affected_nodes.length; i++) {
        var nid = alarm.affected_nodes[i];
        var nd = nodeMarkers.getNodeData(nid);
        var st = nd ? nd.state : 'dead';
        affectedHtml += '<span class="state-badge ' + st + '" style="margin:2px;">' + nid + '</span>';
      }
    }

    container.innerHTML =
      '<div class="panel-header">' +
        '<span class="level-badge level-' + alarm.level + '">LEVEL ' + alarm.level + '</span>' +
        '<span style="margin-left:4px;">' + alarm.alarm_id + '</span>' +
        '<button class="btn" id="btn-close-alarm" style="margin-left:auto;padding:2px 6px;font-size:10px;">X</button>' +
      '</div>' +
      '<div class="panel-body" style="overflow-y:auto;">' +
        '<div class="readout-label">TIME</div>' +
        '<div class="readout mono">' + formatAlarmTime(alarm.t_utc) + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">PANEL</div>' +
        '<div class="readout mono">' + (alarm.panel_id || '--') + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">CENTROID</div>' +
        '<div class="readout mono">' + alarm.centroid.lat.toFixed(4) + ', ' + alarm.centroid.lng.toFixed(4) + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">AFFECTED NODES</div>' +
        '<div style="padding:4px 0;">' + affectedHtml + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">TROUGH FIT</div>' +
        '<div class="readout mono">R² = ' + alarm.trough_fit_r2.toFixed(2) + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">PROJECTION</div>' +
        '<div class="readout mono">' + projText + '</div>' +
        '<div class="section-sep"></div>' +

        '<div id="knothe-chart-container" class="panel-inset" style="height:120px;"></div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">BLAST CORRELATED</div>' +
        '<div class="readout mono">' + blastText + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="readout-label">CONFIDENCE ZONE</div>' +
        '<div class="readout mono">' + zoneText + '</div>' +
        '<div class="section-sep"></div>' +

        '<div class="explanation-box">' +
          '<span class="box-label">EXPLANATION</span>' +
          alarm.explanation +
        '</div>' +
        '<div class="section-sep"></div>' +

        '<div id="dispatch-container"></div>' +
        '<div class="section-sep"></div>' +

        '<div id="operator-actions-container"></div>' +
      '</div>';

    document.getElementById('btn-close-alarm').addEventListener('click', hide);

    bus.emit('alarm-detail-opened', alarm);
  }

  function hide() {
    if (container) container.style.display = 'none';
    var nodePanel = document.getElementById('panel-node-detail');
    if (emptyState && (!nodePanel || nodePanel.style.display === 'none')) {
      emptyState.style.display = 'flex';
    }
    currentAlarm = null;
    bus.emit('alarm-detail-closed', null);
  }

  function formatAlarmTime(utcStr) {
    if (!utcStr) return '--';
    var d = new Date(utcStr);
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd + ' ' + hh + ':' + mi + ':' + ss;
  }

  function getCurrentAlarm() { return currentAlarm; }

  return {
    init: init,
    show: show,
    hide: hide,
    getCurrentAlarm: getCurrentAlarm
  };
})();
