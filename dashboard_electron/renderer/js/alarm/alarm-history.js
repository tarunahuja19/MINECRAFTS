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

  // Deterministic entity key/hash for an alarm
  function getAlarmEntityKey(alarm) {
    if (!alarm) return '';
    if (alarm.zone_id) return 'ZONE:' + alarm.zone_id;
    if (alarm.affected_nodes && alarm.affected_nodes.length > 0) {
      var sorted = alarm.affected_nodes.slice().sort();
      return 'NODES:' + sorted.join(',');
    }
    return 'ID:' + (alarm.alarm_id || '');
  }

  // Check if two alarms share any common affected nodes
  function shareAnyNodes(alarmA, alarmB) {
    if (!alarmA || !alarmB) return false;
    var aNodes = alarmA.affected_nodes || [];
    var bNodes = alarmB.affected_nodes || [];
    for (var i = 0; i < aNodes.length; i++) {
      if (bNodes.indexOf(aNodes[i]) !== -1) return true;
    }
    return false;
  }

  // Time difference in milliseconds between two alarm timestamps
  function timeDiffMs(a, b) {
    var ta = a && a.t_utc ? new Date(a.t_utc).getTime() : 0;
    var tb = b && b.t_utc ? new Date(b.t_utc).getTime() : 0;
    return Math.abs(ta - tb);
  }

  // Process, hash, deduplicate and level-gate an incoming alarm into targetList
  function processOrInsertAlarm(alarm, targetList) {
    if (!alarm || (!alarm.alarm_id && (!alarm.affected_nodes || !alarm.affected_nodes.length))) return;
    targetList = targetList || allAlarms;

    var newLevel = (typeof alarm.level === 'number') ? alarm.level : 1;
    var SIMULTANEOUS_WINDOW_MS = 30000; // 30 seconds

    var matchIndex = -1;

    // 1. Exact ID match
    for (var i = 0; i < targetList.length; i++) {
      if (alarm.alarm_id && targetList[i].alarm_id === alarm.alarm_id) {
        matchIndex = i;
        break;
      }
    }

    // 2. Overlapping affected nodes match
    if (matchIndex === -1) {
      for (var j = 0; j < targetList.length; j++) {
        if (shareAnyNodes(alarm, targetList[j])) {
          matchIndex = j;
          break;
        }
      }
    }

    // 3. Simultaneous trigger coalescing (same level & state within time window)
    if (matchIndex === -1) {
      for (var k = 0; k < targetList.length; k++) {
        var existing = targetList[k];
        if (existing.level === newLevel && (existing.state || '').toUpperCase() === (alarm.state || '').toUpperCase()) {
          if (timeDiffMs(alarm, existing) <= SIMULTANEOUS_WINDOW_MS) {
            matchIndex = k;
            break;
          }
        }
      }
    }

    if (matchIndex !== -1) {
      var target = targetList[matchIndex];
      var oldLevel = (typeof target.level === 'number') ? target.level : 1;

      // Merge affected nodes without duplicate entries
      if (alarm.affected_nodes && alarm.affected_nodes.length > 0) {
        var merged = target.affected_nodes ? target.affected_nodes.slice() : [];
        for (var n = 0; n < alarm.affected_nodes.length; n++) {
          if (merged.indexOf(alarm.affected_nodes[n]) === -1) {
            merged.push(alarm.affected_nodes[n]);
          }
        }
        merged.sort();
        target.affected_nodes = merged;
      }

      // Maximize telemetry metrics
      if (alarm.max_strain_ue != null) {
        target.max_strain_ue = Math.max(target.max_strain_ue || 0, alarm.max_strain_ue);
      }
      if (alarm.trough_fit_r2 != null && (target.trough_fit_r2 == null || alarm.trough_fit_r2 > target.trough_fit_r2)) {
        target.trough_fit_r2 = alarm.trough_fit_r2;
      }

      // Level gating: only escalate if new level is higher ("until and unless the level ups")
      if (newLevel > oldLevel) {
        target.level = newLevel;
        target.state = alarm.state || target.state;
        target.t_utc = alarm.t_utc || target.t_utc;
        target.escalated = true;
        // Move escalated alarm to top of list
        targetList.splice(matchIndex, 1);
        targetList.unshift(target);
      } else {
        // Same or lower level: do not spam new row or bump to top, just update timestamp & metadata
        target.t_utc = alarm.t_utc || target.t_utc;
        if (alarm.centroid && !target.centroid) target.centroid = alarm.centroid;
        if (alarm.explanation && !target.explanation) target.explanation = alarm.explanation;
      }
    } else {
      // New distinct event
      targetList.unshift(Object.assign({}, alarm));
    }
  }

  function init(target) {
    if (Array.isArray(target)) {
      containerIds = target;
    } else if (target) {
      containerIds = [target];
    }

    function dedupeAlarms(list) {
      var result = [];
      for (var i = 0; i < list.length; i++) {
        processOrInsertAlarm(list[i], result);
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
      processOrInsertAlarm(alarm, allAlarms);
      updateBadges();
      render();
    });

    bus.on('alarm-selected', function (alarm) {
      if (alarm && (alarm.alarm_id || (alarm.affected_nodes && alarm.affected_nodes.length))) {
        selectedAlarmId = alarm.alarm_id;
        processOrInsertAlarm(alarm, allAlarms);
        updateBadges();
        render();
        updateSelectedHighlight();
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
      '<table class="data-table" style="table-layout:fixed; width:100%;">' +
        '<thead><tr>' +
          '<th style="width:25%;">ID</th>' +
          '<th style="width:23%;">TIME</th>' +
          '<th style="width:14%; text-align:center;">LVL</th>' +
          '<th style="width:26%;">NODES</th>' +
          '<th style="width:12%; text-align:right;">R²</th>' +
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
        '<tr class="alarm-row' + (isSelected ? ' selected-row' : '') + '" data-alarm-idx="' + (start + i) + '" data-alarm-id="' + a.alarm_id + '" style="cursor:pointer; height:24px;' + (isSelected ? ' background:rgba(46, 74, 90, 0.55);' : '') + '">' +
          '<td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="' + a.alarm_id + '">' + a.alarm_id + '</td>' +
          '<td style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + timeStr + '</td>' +
          '<td style="text-align:center;"><span class="level-badge level-' + a.level + '" style="font-size:10px;padding:1px 4px;">' + a.level + '</span></td>' +
          '<td title="' + nodesTooltip + '" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-family:\'Courier New\', monospace; font-size:10px;">' + nodesStr + '</td>' +
          '<td style="text-align:right;">' + (typeof a.trough_fit_r2 === 'number' ? a.trough_fit_r2.toFixed(2) : '--') + '</td>' +
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
