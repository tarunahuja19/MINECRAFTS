'use strict';

var alarmHistory = (function () {
  var allAlarms = [];
  var page = 0;
  var PAGE_SIZE = 10;
  var containerIds = [];
  var selectedAlarmId = null;

  function init(target) {
    if (Array.isArray(target)) {
      containerIds = target;
    } else if (target) {
      containerIds = [target];
    }

    bus.on('alarms-loaded', function (alarms) {
      allAlarms = alarms.slice().sort(function (a, b) {
        return new Date(b.t_utc).getTime() - new Date(a.t_utc).getTime();
      });
      render();
    });

    bus.on('alarm', function (alarm) {
      var exists = false;
      for (var i = 0; i < allAlarms.length; i++) {
        if (allAlarms[i].alarm_id === alarm.alarm_id) { exists = true; break; }
      }
      if (!exists) {
        allAlarms.unshift(alarm);
      }
      alarmBanner.updateBadge(allAlarms.length);
      render();
    });

    bus.on('alarm-selected', function (alarm) {
      if (alarm && alarm.alarm_id) {
        selectedAlarmId = alarm.alarm_id;
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

    var badge = document.getElementById('map-alarm-history-badge');
    if (badge) badge.textContent = allAlarms.length;

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
      var nodesStr = a.affected_nodes ? a.affected_nodes.length : 0;
      var isSelected = (a.alarm_id === selectedAlarmId);

      html +=
        '<tr class="alarm-row' + (isSelected ? ' selected-row' : '') + '" data-alarm-idx="' + (start + i) + '" data-alarm-id="' + a.alarm_id + '" style="cursor:pointer;' + (isSelected ? ' background:rgba(46, 74, 90, 0.55);' : '') + '">' +
          '<td>' + a.alarm_id + '</td>' +
          '<td>' + timeStr + '</td>' +
          '<td><span class="level-badge level-' + a.level + '" style="font-size:10px;padding:1px 4px;">' + a.level + '</span></td>' +
          '<td>' + nodesStr + '</td>' +
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

  return {
    init: init
  };
})();
