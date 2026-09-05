'use strict';

var pastAlarms = (function () {
  var container = null;
  var alarms = [];

  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    bus.on('alarms-loaded', function (data) {
      alarms = data || [];
      render();
    });

    bus.on('fixture-started', function () {
      alarms = fixtureProvider.getAlarms() || [];
      render();
    });

    loadAlarms();
  }

  function loadAlarms() {
    var mode = (typeof modeSwitch !== 'undefined') ? modeSwitch.getMode() : 'fixture';
    if (mode === 'fixture') {
      alarms = fixtureProvider.getAlarms() || [];
      render();
    } else {
      if (window.r4 && window.r4.getHistory) {
        window.r4.getHistory({ type: 'alarms' }).then(function (data) {
          alarms = data || [];
          render();
        }).catch(function () {
          alarms = fixtureProvider.getAlarms() || [];
          render();
        });
      } else {
        alarms = fixtureProvider.getAlarms() || [];
        render();
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

  return { init: init };
})();
