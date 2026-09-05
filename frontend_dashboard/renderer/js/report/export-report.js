'use strict';

var exportReport = (function () {
  function init() {
    bus.on('export-report', function (alarm) {
      generateAndExport(alarm);
    });

    if (window.r4 && window.r4.onMenuExportReport) {
      window.r4.onMenuExportReport(function () {
        generateAndExport(null);
      });
    }
  }

  function generateAndExport(alarm) {
    var html = buildReportHTML(alarm);
    if (window.r4 && window.r4.exportReport) {
      window.r4.exportReport(html).then(function (result) {
        if (result && result.success) {
          bus.emit('status-message', 'Report saved: ' + result.path);
        }
      });
    } else {
      var blob = new Blob([html], { type: 'text/html' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'R4-Subsidence-Report.html';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  }

  function buildReportHTML(alarm) {
    var now = new Date();
    var ts = now.toISOString().replace('T', ' ').substring(0, 19) + 'Z';

    var nodeStates = collectNodeStates();
    var alarms = collectAlarms();

    var html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
      '<title>R4 Subsidence Report — ' + ts + '</title>' +
      '<style>' +
        'body { font-family: Tahoma, Geneva, sans-serif; font-size: 12px; color: #1a1a1a; background: #fff; margin: 20px; }' +
        'h1 { font-size: 16px; border-bottom: 2px solid #1E2830; padding-bottom: 4px; margin: 0 0 12px 0; }' +
        'h2 { font-size: 13px; color: #2A3A42; margin: 16px 0 6px 0; border-bottom: 1px solid #ccc; padding-bottom: 2px; }' +
        'table { border-collapse: collapse; width: 100%; margin: 6px 0 12px 0; }' +
        'th, td { border: 1px solid #bbb; padding: 3px 6px; text-align: left; font-size: 11px; }' +
        'th { background: #e8e8e8; font-weight: bold; }' +
        'td.mono { font-family: "Courier New", monospace; }' +
        '.level-3 { background: #FFE0E0; }' +
        '.level-2 { background: #FFF3D0; }' +
        '.header-meta { font-size: 11px; color: #555; margin-bottom: 16px; }' +
        '.header-meta span { margin-right: 20px; }' +
      '</style></head><body>';

    html += '<h1>R4 MINE SUBSIDENCE EARLY-WARNING REPORT</h1>';
    html += '<div class="header-meta">';
    html += '<span>Generated: ' + ts + '</span>';
    html += '<span>Nodes: ' + nodeStates.length + '</span>';
    html += '<span>Active Alarms: ' + alarms.length + '</span>';
    html += '</div>';

    if (alarm) {
      html += '<h2>TRIGGERED ALARM</h2>';
      html += '<table>';
      html += '<tr><th>Alarm ID</th><td class="mono">' + esc(alarm.alarm_id) + '</td></tr>';
      html += '<tr><th>Timestamp</th><td class="mono">' + esc(alarm.t_utc) + '</td></tr>';
      html += '<tr><th>Level</th><td>L' + alarm.level + '</td></tr>';
      html += '<tr><th>Panel</th><td>' + esc(alarm.panel_id) + '</td></tr>';
      html += '<tr><th>Affected Nodes</th><td class="mono">' + esc((alarm.affected_nodes || []).join(', ')) + '</td></tr>';
      html += '<tr><th>Trough R²</th><td class="mono">' + (alarm.trough_fit_r2 || '--') + '</td></tr>';
      html += '<tr><th>Description</th><td>' + esc(alarm.description || '') + '</td></tr>';
      html += '</table>';
    }

    if (nodeStates.length > 0) {
      html += '<h2>NODE STATUS SNAPSHOT</h2>';
      html += '<table>';
      html += '<thead><tr><th>Node ID</th><th>Strain (mm/m)</th><th>Tilt X</th><th>Tilt Y</th><th>Battery (V)</th><th>RSSI (dBm)</th><th>Temp (C)</th><th>Status</th></tr></thead>';
      html += '<tbody>';
      for (var i = 0; i < nodeStates.length; i++) {
        var n = nodeStates[i];
        html += '<tr>';
        html += '<td class="mono">' + esc(n.node_id) + '</td>';
        html += '<td class="mono">' + fmt(n.strain_mm_m) + '</td>';
        html += '<td class="mono">' + fmt(n.tilt_x) + '</td>';
        html += '<td class="mono">' + fmt(n.tilt_y) + '</td>';
        html += '<td class="mono">' + fmt(n.battery_v) + '</td>';
        html += '<td class="mono">' + fmt(n.rssi_dbm) + '</td>';
        html += '<td class="mono">' + fmt(n.temp_c) + '</td>';
        html += '<td>' + esc(n.status || 'ACTIVE') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    if (alarms.length > 0) {
      html += '<h2>ALARM HISTORY</h2>';
      html += '<table>';
      html += '<thead><tr><th>Alarm ID</th><th>Timestamp</th><th>Level</th><th>Panel</th><th>Affected Nodes</th><th>R²</th></tr></thead>';
      html += '<tbody>';
      for (var j = 0; j < alarms.length; j++) {
        var a = alarms[j];
        var rowClass = a.level === 3 ? ' class="level-3"' : (a.level === 2 ? ' class="level-2"' : '');
        html += '<tr' + rowClass + '>';
        html += '<td class="mono">' + esc(a.alarm_id) + '</td>';
        html += '<td class="mono">' + esc(a.t_utc) + '</td>';
        html += '<td>L' + a.level + '</td>';
        html += '<td>' + esc(a.panel_id) + '</td>';
        html += '<td class="mono">' + esc((a.affected_nodes || []).join(', ')) + '</td>';
        html += '<td class="mono">' + (a.trough_fit_r2 || '--') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
    }

    html += '<div style="margin-top:20px; font-size:10px; color:#888; border-top:1px solid #ccc; padding-top:4px;">';
    html += 'R4 Mine Subsidence Early-Warning System — SIH Smart India Hackathon';
    html += '</div>';

    html += '</body></html>';
    return html;
  }

  function collectNodeStates() {
    var nodes = [];
    if (typeof fixtureProvider !== 'undefined') {
      var raw = fixtureProvider.getNodes();
      if (raw && Array.isArray(raw)) {
        return raw;
      }
      if (raw && typeof raw === 'object') {
        var keys = Object.keys(raw);
        for (var i = 0; i < keys.length; i++) {
          nodes.push(raw[keys[i]]);
        }
        return nodes;
      }
    }
    return nodes;
  }

  function collectAlarms() {
    if (typeof fixtureProvider !== 'undefined') {
      return fixtureProvider.getAlarms() || [];
    }
    return [];
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt(val) {
    if (val === null || val === undefined) return '--';
    if (typeof val === 'number') return val.toFixed(3);
    return String(val);
  }

  return { init: init };
})();
