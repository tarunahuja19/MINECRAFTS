'use strict';

var syncIndicator = (function () {
  var el = null;
  var offlineQueue = 0;
  var isConnected = false;

  function init() {
    el = document.getElementById('queue-count');

    bus.on('gateway-health', function (data) {
      if (typeof data.offline_queue === 'number') {
        offlineQueue = data.offline_queue;
      }
      update();
    });

    bus.on('mqtt-status', function (status) {
      isConnected = status === 'connected';
      update();
    });

    bus.on('fixture-started', function () {
      isConnected = true;
      offlineQueue = 0;
      update();
    });
  }

  function update() {
    if (!el) return;
    if (offlineQueue > 0 && !isConnected) {
      el.textContent = offlineQueue + ' ROWS — SYNCING ON RECONNECT';
      el.className = 'status-value disconnected';
    } else if (offlineQueue > 0) {
      el.textContent = offlineQueue + ' ROWS';
      el.className = 'status-value warning';
    } else {
      el.textContent = '0 ROWS';
      el.className = 'status-value';
    }
  }

  return { init: init };
})();
