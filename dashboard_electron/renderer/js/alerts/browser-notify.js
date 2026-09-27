'use strict';

var browserNotify = (function () {
  var notifiedAlarms = new Map();

  function init() {
    if (typeof window === 'undefined' || !window.Notification) {
      return;
    }

    if (Notification.permission === 'default') {
      try {
        Notification.requestPermission();
      } catch (_) {}
    }

    bus.on('alarm', function (alarm) {
      if (!alarm) return;

      var level = parseInt(alarm.level, 10);
      if (isNaN(level) || level < 2) {
        return;
      }

      var alarmId = alarm.alarm_id != null ? String(alarm.alarm_id) : null;
      if (!alarmId) {
        return;
      }

      var lastNotifiedLevel = notifiedAlarms.get(alarmId);
      if (lastNotifiedLevel !== undefined && level <= lastNotifiedLevel) {
        return;
      }

      notifiedAlarms.set(alarmId, level);

      if (Notification.permission === 'granted') {
        try {
          var notification = new Notification('Alarm — Zone ' + alarm.zone_id, {
            body: alarm.explanation || ('Level ' + alarm.level),
            tag: alarm.alarm_id
          });

          notification.onclick = function () {
            if (window.focus) {
              window.focus();
            }
            bus.emit('alarm-selected', alarm);
          };
        } catch (e) {
          console.warn('[browser-notify] Failed to create notification:', e);
        }
      }
    });
  }

  return {
    init: init
  };
})();
