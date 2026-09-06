'use strict';

var pastAlarms = (function () {
  var container = null;
  var alarms = [];

  function dedupeAlarms(list) {
    var result = [];
    var seenIds = {};
    var seenNodes = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a) continue;
      var aid = a.alarm_id;
      var pNode = (a.affected_nodes && a.affected_nodes.length === 1) ? a.affected_nodes[0] : null;
      if (aid && seenIds[aid]) continue;
      if (pNode && seenNodes[pNode]) continue;
      if (aid) seenIds[aid] = true;
      if (pNode) seenNodes[pNode] = true;
      result.push(a);
    }
    return result;
  }

  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    bus.on('alarms-loaded', function (data) {
      alarms = dedupeAlarms(data || []);
      render();
    });

    bus.on('system-reset', function () {
      alarms = [];
      render();
    });

    bus.on('alarm', function (alarm) {
      if (!alarm || (!alarm.alarm_id && (!alarm.affected_nodes || !alarm.affected_nodes.length))) return;
      var primaryNode = (alarm.affected_nodes && alarm.affected_nodes.length === 1) ? alarm.affected_nodes[0] : null;
      var foundIndex = -1;
      for (var i = 0; i < alarms.length; i++) {
        if (alarm.alarm_id && alarms[i].alarm_id === alarm.alarm_id) {
          foundIndex = i;
          break;
        }
        if (primaryNode && alarms[i].affected_nodes && alarms[i].affected_nodes.length === 1 && alarms[i].affected_nodes[0] === primaryNode) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex !== -1) {
        alarms[foundIndex] = Object.assign({}, alarms[foundIndex], alarm);
      } else {
        alarms.unshift(alarm);
      }
      render();
    });

    bus.on('fixture-started', function () {
      alarms = dedupeAlarms(fixtureProvider.getAlarms() || []);
      render();
    });

    loadAlarms();
  }

  function loadAlarms() {
    var mode = (typeof modeSwitch !== 'undefined') ? modeSwitch.getMode() : 'fixture';
    if (mode === 'fixture') {
      alarms = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms) ? (fixtureProvider.getAlarms() || []) : [];
      render();
    } else {
      if (window.r4 && window.r4.getHistory) {
        window.r4.getHistory({ type: 'alarms' }).then(function (data) {
          alarms = Array.isArray(data) ? data : [];
          render();
        }).catch(function () {
          alarms = [];
          render();
        });
      } else {
        fetch('http://localhost:8080/api/alarms')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            alarms = Array.isArray(data) ? data : [];
            render();
          })
          .catch(function () {
            alarms = [];
            render();
          });
      }
    }
  }

  function render() {
    if (!container) return;
    if (!alarms || alarms.length === 0) {
      container.innerHTML = '<div class="empty-state">NO PAST ALARMS</div>';
      return;
    }

    var sorted = alarms.slice().sort(function (a, b) {
      return new Date(b.t_utc).getTime() - new Date(a.t_utc).getTime();
    });

    var html =
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>ALARM ID</th>' +
          '<th>TIMESTAMP</th>' +
          '<th>LEVEL</th>' +
          '<th>PANEL</th>' +
          '<th>NODES</th>' +
          '<th>R2</th>' +
          '<th>ACTION</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      var dt = new Date(a.t_utc);
      var ts = dt.toISOString().replace('T', ' ').substring(0, 19) + 'Z';
      var lvlClass = a.level === 3 ? 'level-critical' : (a.level === 2 ? 'level-warning' : 'level-info');

      html +=
        '<tr>' +
          '<td class="mono">' + a.alarm_id + '</td>' +
          '<td class="mono">' + ts + '</td>' +
          '<td><span class="level-badge ' + lvlClass + '">L' + a.level + '</span></td>' +
          '<td>' + a.panel_id + '</td>' +
          '<td class="mono">' + a.affected_nodes.join(', ') + '</td>' +
          '<td class="mono">' + (a.trough_fit_r2 || '--') + '</td>' +
          '<td><button class="btn btn-sm past-alarm-replay" data-alarm-idx="' + i + '">REPLAY</button></td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    container.querySelectorAll('.past-alarm-replay').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.alarmIdx, 10);
        var alarm = sorted[idx];
        if (!alarm) return;

        bus.emit('alarm', alarm);
        bus.emit('alarm-replay', alarm);

        var mapBtn = document.querySelector('.tab-btn[data-tab="map"]');
        if (mapBtn) mapBtn.click();
      });
    });
  }

  return { init: init, load: loadAlarms };
})();
