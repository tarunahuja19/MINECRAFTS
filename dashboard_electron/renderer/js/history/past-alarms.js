'use strict';

var pastAlarms = (function () {
  var container = null;
  var alarms = [];
  var renderPending = false;
  var SIMULTANEOUS_WINDOW_MS = 30000;

  function shareAnyNodes(alarmA, alarmB) {
    if (!alarmA || !alarmB) return false;
    var aNodes = alarmA.affected_nodes || [];
    var bNodes = alarmB.affected_nodes || [];
    for (var i = 0; i < aNodes.length; i++) {
      if (bNodes.indexOf(aNodes[i]) !== -1) return true;
    }
    return false;
  }

  function timeDiffMs(a, b) {
    var ta = a && a.t_utc ? new Date(a.t_utc).getTime() : 0;
    var tb = b && b.t_utc ? new Date(b.t_utc).getTime() : 0;
    return Math.abs(ta - tb);
  }

  function dedupeAlarms(list) {
    var result = [];
    if (!Array.isArray(list)) return result;
    for (var i = 0; i < list.length; i++) {
      insertOrUpdateAlarm(list[i], result, true);
    }
    return result;
  }

  function insertOrUpdateAlarm(alarm, targetList, skipSchedule) {
    if (!alarm || (!alarm.alarm_id && (!alarm.affected_nodes || !alarm.affected_nodes.length))) return;
    targetList = targetList || alarms;

    var matchIndex = -1;

    // 1. Exact ID match
    if (alarm.alarm_id) {
      for (var i = 0; i < targetList.length; i++) {
        if (targetList[i].alarm_id === alarm.alarm_id) {
          matchIndex = i;
          break;
        }
      }
    }

    // 2. Overlapping nodes within 30s window
    if (matchIndex === -1) {
      for (var j = 0; j < targetList.length; j++) {
        var existing = targetList[j];
        if (shareAnyNodes(alarm, existing) && timeDiffMs(alarm, existing) <= SIMULTANEOUS_WINDOW_MS) {
          matchIndex = j;
          break;
        }
      }
    }

    if (matchIndex !== -1) {
      var current = targetList[matchIndex];
      var highestLevel = Math.max(current.level || 1, alarm.level || 1);
      var mergedNodes = (current.affected_nodes || []).slice();
      var newNodes = alarm.affected_nodes || [];
      for (var n = 0; n < newNodes.length; n++) {
        if (mergedNodes.indexOf(newNodes[n]) === -1) mergedNodes.push(newNodes[n]);
      }

      targetList[matchIndex] = Object.assign({}, current, alarm, {
        level: highestLevel,
        affected_nodes: mergedNodes,
        t_utc: (new Date(alarm.t_utc).getTime() > new Date(current.t_utc).getTime()) ? alarm.t_utc : current.t_utc
      });
    } else {
      targetList.unshift(alarm);
      // Cap at 150 entries to keep 100x replay ultra responsive
      if (targetList.length > 150) {
        targetList.length = 150;
      }
    }

    if (!skipSchedule) {
      scheduleRender();
    }
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(function () {
      renderPending = false;
      render();
    });
  }

  function init(containerId) {
    container = document.getElementById(containerId);
    if (!container) return;

    bus.on('alarms-loaded', function (data) {
      alarms = dedupeAlarms(data || []);
      scheduleRender();
    });

    bus.on('system-reset', function () {
      alarms = [];
      scheduleRender();
    });

    bus.on('alarm', function (alarm) {
      insertOrUpdateAlarm(alarm, alarms, false);
    });

    bus.on('fixture-started', function () {
      alarms = dedupeAlarms(fixtureProvider.getAlarms() || []);
      scheduleRender();
    });

    loadAlarms();
  }

  function loadAlarms() {
    var mode = (typeof modeSwitch !== 'undefined') ? modeSwitch.getMode() : 'fixture';
    if (mode === 'fixture') {
      alarms = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getAlarms) ? dedupeAlarms(fixtureProvider.getAlarms() || []) : [];
      scheduleRender();
    } else {
      if (window.r4 && window.r4.getHistory) {
        window.r4.getHistory({ type: 'alarms' }).then(function (data) {
          alarms = dedupeAlarms(Array.isArray(data) ? data : []);
          scheduleRender();
        }).catch(function () {
          alarms = [];
          scheduleRender();
        });
      } else {
        fetch('http://localhost:8080/api/alarms')
          .then(function (r) { return r.json(); })
          .then(function (data) {
            alarms = dedupeAlarms(Array.isArray(data) ? data : []);
            scheduleRender();
          })
          .catch(function () {
            alarms = [];
            scheduleRender();
          });
      }
    }
  }

  function render() {
    if (!container) return;
    if (!alarms || alarms.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:24px 12px; text-align:center; color:#5A6E7C; font-family:monospace; font-size:11px;">NO PAST ALARMS RECORDED</div>';
      return;
    }

    var sorted = alarms.slice().sort(function (a, b) {
      return new Date(b.t_utc).getTime() - new Date(a.t_utc).getTime();
    });

    var html =
      '<div style="width:100%; overflow-x:auto;">' +
      '<table class="data-table" style="table-layout:fixed; width:100%; min-width:480px;">' +
        '<colgroup>' +
          '<col style="width:20%;">' +
          '<col style="width:24%;">' +
          '<col style="width:12%;">' +
          '<col style="width:14%;">' +
          '<col style="width:18%;">' +
          '<col style="width:12%;">' +
        '</colgroup>' +
        '<thead><tr>' +
          '<th>ALARM ID</th>' +
          '<th>TIMESTAMP</th>' +
          '<th>LVL</th>' +
          '<th>PANEL</th>' +
          '<th>NODES</th>' +
          '<th style="text-align:right;">ACTION</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < sorted.length; i++) {
      var a = sorted[i];
      var dt = new Date(a.t_utc);
      var ts = dt.toISOString().replace('T', ' ').substring(0, 19) + 'Z';
      var lvlClass = a.level === 3 ? 'level-critical' : (a.level === 2 ? 'level-warning' : 'level-info');
      var nodesStr = (a.affected_nodes && a.affected_nodes.length) ? a.affected_nodes.join(', ') : '--';

      html +=
        '<tr>' +
          '<td class="mono" style="overflow:hidden; text-overflow:ellipsis;" title="' + (a.alarm_id || '') + '">' + (a.alarm_id || '--') + '</td>' +
          '<td class="mono" style="font-size:10px;">' + ts + '</td>' +
          '<td><span class="level-badge ' + lvlClass + '" style="font-size:9.5px; padding:1px 5px;">L' + (a.level || 1) + '</span></td>' +
          '<td style="overflow:hidden; text-overflow:ellipsis;">' + (a.panel_id || 'P1') + '</td>' +
          '<td class="mono" style="overflow:hidden; text-overflow:ellipsis;" title="' + nodesStr + '">' + nodesStr + '</td>' +
          '<td style="text-align:right;"><button class="btn btn-sm past-alarm-replay" data-alarm-idx="' + i + '" style="padding:1px 5px; font-size:9.5px;">VIEW</button></td>' +
        '</tr>';
    }

    html += '</tbody></table></div>';
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
