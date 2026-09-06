'use strict';

var alarmHistory = (function () {
  var allAlarms = [];
  var page = 0;
  var PAGE_SIZE = 10;
  var containerIds = [];
  var selectedAlarmId = null;
  var acknowledgedAlarmIds = {};

  function getActiveAlarmCount() {
    var latestByEntity = {};
    for (var i = 0; i < allAlarms.length; i++) {
      var a = allAlarms[i];
      if (!a) continue;
      var key = a.zone_id || (a.affected_nodes && a.affected_nodes.length === 1 ? a.affected_nodes[0] : a.alarm_id);
      if (!key) continue;
      // allAlarms is ordered newest-first, so the first entry seen is the current state
      if (!latestByEntity[key]) {
        latestByEntity[key] = a;
      }
    }

    var count = 0;
    var keys = Object.keys(latestByEntity);
    for (var k = 0; k < keys.length; k++) {
      var alarm = latestByEntity[keys[k]];
      if (alarm.alarm_id && acknowledgedAlarmIds[alarm.alarm_id]) continue;
      if (alarm.acknowledged || alarm.t_ack) continue;
      if (alarm.state === 'NORMAL' || alarm.state === 'STABLE' || alarm.state === 'RESOLVED') continue;
      if (alarm.level === 0 || alarm.level == null) continue;
      count++;
    }
    return count;
  }

  function updateBadges() {
    var activeCount = getActiveAlarmCount();
    if (typeof alarmBanner !== 'undefined' && alarmBanner.updateBadge) {
      alarmBanner.updateBadge(activeCount);
    }
    var badge = document.getElementById('map-alarm-history-badge');
    if (badge) badge.textContent = String(activeCount);
  }

  function init(target) {
    if (Array.isArray(target)) {
      containerIds = target;
    } else if (target) {
      containerIds = [target];
    }

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

    bus.on('alarms-loaded', function (alarms) {
      var sorted = (alarms || []).slice().sort(function (a, b) {
        return new Date(b.t_utc).getTime() - new Date(a.t_utc).getTime();
      });
      allAlarms = dedupeAlarms(sorted);
      page = 0;
      selectedAlarmId = null;
      updateBadges();
      render();
    });

    bus.on('system-reset', function () {
      allAlarms = [];
      acknowledgedAlarmIds = {};
      selectedAlarmId = null;
      page = 0;
      updateBadges();
      render();
    });

    bus.on('alarm-ack', function (data) {
      if (data && data.alarm_id) {
        acknowledgedAlarmIds[data.alarm_id] = true;
        for (var i = 0; i < allAlarms.length; i++) {
          if (allAlarms[i].alarm_id === data.alarm_id) {
            allAlarms[i].acknowledged = true;
            allAlarms[i].t_ack = data.t_ack;
          }
        }
        updateBadges();
      }
    });

    bus.on('alarm', function (alarm) {
      if (!alarm || (!alarm.alarm_id && (!alarm.affected_nodes || !alarm.affected_nodes.length))) return;
      var foundIndex = -1;
      var primaryNode = (alarm.affected_nodes && alarm.affected_nodes.length === 1) ? alarm.affected_nodes[0] : null;

      for (var i = 0; i < allAlarms.length; i++) {
        if (alarm.alarm_id && allAlarms[i].alarm_id === alarm.alarm_id) {
          foundIndex = i;
          break;
        }
        if (primaryNode && allAlarms[i].affected_nodes && allAlarms[i].affected_nodes.length === 1 && allAlarms[i].affected_nodes[0] === primaryNode) {
          foundIndex = i;
          break;
        }
      }
      if (foundIndex !== -1) {
        allAlarms[foundIndex] = Object.assign({}, allAlarms[foundIndex], alarm);
      } else {
        allAlarms.unshift(alarm);
      }
      updateBadges();
      render();
    });

    bus.on('alarm-selected', function (alarm) {
      if (alarm && alarm.alarm_id) {
        selectedAlarmId = alarm.alarm_id;
        var exists = false;
        for (var i = 0; i < allAlarms.length; i++) {
          if (allAlarms[i].alarm_id === alarm.alarm_id) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          allAlarms.unshift(alarm);
          updateBadges();
          render();
        } else {
          updateSelectedHighlight();
        }
      }
    });
  }

  function updateSelectedHighlight() {
    containerIds.forEach(function (cId) {
      var container = document.getElementById(cId);
      if (!container) return;
      var rows = container.querySelectorAll('.alarm-row');
      rows.forEach(function (r) {
        var aid = r.dataset.alarmId;
        if (aid === selectedAlarmId) {
          r.classList.add('selected-row');
          r.style.background = 'rgba(46, 74, 90, 0.55)';
        } else {
          r.classList.remove('selected-row');
          r.style.background = '';
        }
      });
    });
  }

  function render() {
    var totalPages = Math.max(1, Math.ceil(allAlarms.length / PAGE_SIZE));
    if (page >= totalPages) page = totalPages - 1;
    var start = page * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, allAlarms.length);
    var slice = allAlarms.slice(start, end);

    var activeCount = getActiveAlarmCount();
    var badge = document.getElementById('map-alarm-history-badge');
    if (badge) badge.textContent = String(activeCount);

    var html =
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>ID</th>' +
          '<th>TIME</th>' +
          '<th>LVL</th>' +
          '<th>NODES</th>' +
          '<th>R²</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < slice.length; i++) {
      var a = slice[i];
      var timeStr = formatShortTime(a.t_utc);
      var nodesStr = '--';
      var nodesTooltip = '';
      if (a.affected_nodes && a.affected_nodes.length > 0) {
        nodesTooltip = 'Nodes: ' + a.affected_nodes.join(', ');
        if (a.affected_nodes.length <= 2) {
          nodesStr = a.affected_nodes.join(', ');
        } else {
          nodesStr = a.affected_nodes[0] + ' (+' + (a.affected_nodes.length - 1) + ')';
        }
      }
      var isSelected = (a.alarm_id === selectedAlarmId);

      html +=
        '<tr class="alarm-row' + (isSelected ? ' selected-row' : '') + '" data-alarm-idx="' + (start + i) + '" data-alarm-id="' + a.alarm_id + '" style="cursor:pointer;' + (isSelected ? ' background:rgba(46, 74, 90, 0.55);' : '') + '">' +
          '<td>' + a.alarm_id + '</td>' +
          '<td>' + timeStr + '</td>' +
          '<td><span class="level-badge level-' + a.level + '" style="font-size:10px;padding:1px 4px;">' + a.level + '</span></td>' +
          '<td title="' + nodesTooltip + '" style="font-family:\'Courier New\', monospace; font-size:10px;">' + nodesStr + '</td>' +
          '<td>' + (typeof a.trough_fit_r2 === 'number' ? a.trough_fit_r2.toFixed(2) : '--') + '</td>' +
        '</tr>';
    }

    if (slice.length === 0) {
      html += '<tr><td colspan="5" style="text-align:center; color:#5A6A72; padding:12px;">NO ALARMS RECORDED</td></tr>';
    }

    html += '</tbody></table>';

    html +=
      '<div class="pagination" style="padding:4px 8px; display:flex; align-items:center; justify-content:space-between; border-top:1px solid #1E2D34; background:rgba(10,18,24,0.4);">' +
        '<button class="btn alarm-btn-prev" ' + (page === 0 ? 'disabled' : '') + ' style="font-size:9.5px; padding:2px 8px;">&lt; PREV</button>' +
        '<span style="font-family:\'Courier New\', monospace; font-size:10px; color:#7A9BAA;">' + (page + 1) + ' / ' + totalPages + '</span>' +
        '<button class="btn alarm-btn-next" ' + (page >= totalPages - 1 ? 'disabled' : '') + ' style="font-size:9.5px; padding:2px 8px;">NEXT &gt;</button>' +
      '</div>';

    containerIds.forEach(function (cId) {
      var container = document.getElementById(cId);
      if (!container) return;

      container.innerHTML = html;

      var prevBtn = container.querySelector('.alarm-btn-prev');
      var nextBtn = container.querySelector('.alarm-btn-next');

      if (prevBtn) prevBtn.addEventListener('click', function () {
        if (page > 0) { page--; render(); }
      });
      if (nextBtn) nextBtn.addEventListener('click', function () {
        if (page < totalPages - 1) { page++; render(); }
      });

      var rows = container.querySelectorAll('.alarm-row');
      for (var j = 0; j < rows.length; j++) {
        rows[j].addEventListener('click', function () {
          var idx = parseInt(this.dataset.alarmIdx, 10);
          if (allAlarms[idx]) {
            selectedAlarmId = allAlarms[idx].alarm_id;
            updateSelectedHighlight();
            bus.emit('alarm-selected', allAlarms[idx]);
          }
        });
      }
    });
  }

  function formatShortTime(utcStr) {
    if (!utcStr) return '--';
    var d = new Date(utcStr);
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    var hh = String(d.getHours()).padStart(2, '0');
    var mi = String(d.getMinutes()).padStart(2, '0');
    return mm + '-' + dd + ' ' + hh + ':' + mi;
  }

  function getAlarms() {
    return allAlarms.slice();
  }

  return {
    init: init,
    getAlarms: getAlarms
  };
})();
