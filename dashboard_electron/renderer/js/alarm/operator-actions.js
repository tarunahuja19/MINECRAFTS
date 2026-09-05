'use strict';

var operatorActions = (function () {
  function render(containerId, alarm) {
    var container = document.getElementById(containerId);
    if (!container || !alarm) return;

    container.innerHTML =
      '<div class="readout-label">OPERATOR ACTIONS</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;padding:4px 0;">' +
        '<button class="btn btn-danger" id="btn-ack-alarm">ACK</button>' +
        '<button class="btn" id="btn-silence-siren">SILENCE SIREN</button>' +
        '<button class="btn" id="btn-export-report">EXPORT REPORT</button>' +
      '</div>' +
      '<div class="confirm-row" id="ack-confirm">' +
        '<span>CONFIRM ACKNOWLEDGE?</span>' +
        '<button class="btn btn-danger" id="btn-ack-yes" style="padding:2px 8px;font-size:10px;">YES</button>' +
        '<button class="btn" id="btn-ack-no" style="padding:2px 8px;font-size:10px;">NO</button>' +
      '</div>';

    document.getElementById('btn-ack-alarm').addEventListener('click', function () {
      var row = document.getElementById('ack-confirm');
      if (row) row.classList.add('visible');
    });

    document.getElementById('btn-ack-yes').addEventListener('click', function () {
      bus.emit('alarm-ack', { alarm_id: alarm.alarm_id, t_ack: new Date().toISOString() });
      var row = document.getElementById('ack-confirm');
      if (row) row.classList.remove('visible');
      alarmBanner.hide();
    });

    document.getElementById('btn-ack-no').addEventListener('click', function () {
      var row = document.getElementById('ack-confirm');
      if (row) row.classList.remove('visible');
    });

    document.getElementById('btn-silence-siren').addEventListener('click', function () {
      var btn = document.getElementById('btn-silence-siren');
      if (btn) {
        btn.textContent = 'SIREN SILENCED';
        btn.disabled = true;
        btn.style.opacity = '0.5';
      }
      if (window.r4 && window.r4.sendCommand) {
        window.r4.sendCommand('silence-siren', { alarm_id: alarm.alarm_id });
      }
    });

    document.getElementById('btn-export-report').addEventListener('click', function () {
      bus.emit('export-report', alarm);
    });
  }

  return {
    render: render
  };
})();
