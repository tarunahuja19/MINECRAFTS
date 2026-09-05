'use strict';

var mqttLog = (function () {
  var MAX_EVENTS = 10;
  var events = [];
  var containerId = null;

  function init(targetId) {
    containerId = targetId;

    bus.on('mqtt-log-event', function (evt) {
      events.unshift(evt);
      if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
      render();
    });

    render();
  }

  function render() {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (events.length === 0) {
      container.innerHTML = '<div class="empty-state" style="height:auto;padding:12px;">NO MQTT EVENTS</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var timeStr = formatTime(e.t);
      var cls = e.msg.indexOf('CONNECTED') === 0 || e.msg === 'MQTT CONNECTED'
        ? 'connected' : 'disconnected';
      if (e.msg === 'MQTT CONNECTED') cls = 'connected';
      html +=
        '<div class="mqtt-log-entry">' +
          '<span class="mono">' + timeStr + '</span>' +
          '<span class="mqtt-log-sep"> — </span>' +
          '<span class="status-value ' + cls + '">' + e.msg + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  function formatTime(ms) {
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
  }

  return { init: init };
})();
