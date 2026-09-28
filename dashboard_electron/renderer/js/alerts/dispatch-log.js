'use strict';

var dispatchLog = (function () {
  var MAX_EVENTS = 30;
  var events = [];
  var containerId = null;

  function init(targetId) {
    containerId = targetId;

    // Local bus events from manual sends and fixture replay
    bus.on('dispatch-event', function (evt) {
      pushEvent(evt);
    });

    // Real-time WS events from the backend for both automatic and manual sends
    bus.on('sms-dispatch', function (evt) {
      pushEvent(evt);
    });

    bus.on('fixture-started', function () {
      events = [];
      render();
    });

    render();
  }

  function pushEvent(evt) {
    events.unshift(evt);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
    render();
  }

  function render() {
    var container = document.getElementById(containerId);
    if (!container) return;

    if (events.length === 0) {
      container.innerHTML = '<div class="empty-state" style="height:auto;padding:12px;">NO DISPATCH EVENTS</div>';
      return;
    }

    var html =
      '<table class="data-table">' +
        '<thead><tr>' +
          '<th>TIME</th>' +
          '<th>CONTACT</th>' +
          '<th>SOURCE</th>' +
          '<th>OUTCOME</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var timeStr = formatTime(e.t);
      var contact = e.contact || e.phone || '—';
      var source = (e.source || 'auto').toUpperCase();
      var outcome = e.outcome || '—';

      var outcomeClass = '';
      if (outcome === 'SENT') outcomeClass = 'fired';
      else if (outcome === 'FAILED') outcomeClass = 'failed';
      else if (outcome === 'SUPPRESSED') outcomeClass = 'pending';

      html +=
        '<tr>' +
          '<td>' + timeStr + '</td>' +
          '<td>' + escHtml(contact) + '</td>' +
          '<td class="mono" style="font-size:10px;">' + source + '</td>' +
          '<td><span class="tier-status ' + outcomeClass + '">' + outcome + '</span></td>' +
        '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  function formatTime(ms) {
    if (!ms) return '—';
    var d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0') + ':' +
           String(d.getSeconds()).padStart(2, '0');
  }

  function escHtml(s) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(s));
    return div.innerHTML;
  }

  return { init: init };
})();
