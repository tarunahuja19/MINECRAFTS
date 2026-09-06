'use strict';

var alarmBanner = (function () {
  var el = null;
  var currentAlarm = null;

  function init() {
    el = document.getElementById('alarm-banner');

    bus.on('alarm', function (alarm) {
      show(alarm);
    });

    bus.on('alarm-ack', function () {
      hide();
    });

    bus.on('replay-started', function () {
      hide();
    });

    bus.on('system-reset', function () {
      hide();
      updateBadge(0);
    });
  }

  function show(alarm) {
    if (!el) return;
    currentAlarm = alarm;

    var levelText = 'LEVEL ' + alarm.level;
    var nodesText = alarm.affected_nodes ? alarm.affected_nodes.join(', ') : '';
    var r2Text = alarm.trough_fit_r2 ? ('R²=' + alarm.trough_fit_r2.toFixed(2)) : '';

    el.textContent = '';

    var levelSpan = document.createElement('span');
    levelSpan.className = 'level-badge level-' + alarm.level;
    levelSpan.textContent = levelText;

    var msgSpan = document.createElement('span');
    msgSpan.style.cssText = 'margin:0 12px;';
    msgSpan.textContent = alarm.alarm_id + ' — ' + nodesText + ' — ' + r2Text;

    var viewBtn = document.createElement('button');
    viewBtn.className = 'btn';
    viewBtn.style.cssText = 'margin-left:12px;padding:2px 10px;font-size:10px;';
    viewBtn.textContent = 'VIEW';
    viewBtn.addEventListener('click', function () {
      bus.emit('alarm-selected', currentAlarm);
    });

    el.appendChild(levelSpan);
    el.appendChild(msgSpan);
    el.appendChild(viewBtn);
    el.classList.add('visible');

    updateBadge(1);
  }

  function hide() {
    if (!el) return;
    el.classList.remove('visible');
    currentAlarm = null;
  }

  function updateBadge(count) {
    var badge = document.getElementById('alarm-badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = String(count);
      badge.classList.add('visible');
    } else {
      badge.classList.remove('visible');
    }
  }

  function getCurrentAlarm() { return currentAlarm; }

  return {
    init: init,
    show: show,
    hide: hide,
    getCurrentAlarm: getCurrentAlarm,
    updateBadge: updateBadge
  };
})();
