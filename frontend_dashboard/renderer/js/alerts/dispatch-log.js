'use strict';

var dispatchLog = (function () {
  var MAX_EVENTS = 10;
  var events = [];
  var containerId = null;

  var fixtureEvents = [
    { t: Date.now() - 120000, tier: 1, outcome: 'SENT' },
    { t: Date.now() - 118000, tier: 2, outcome: 'SENT' },
    { t: Date.now() - 115000, tier: 3, outcome: 'SENT' },
    { t: Date.now() - 60000,  tier: 1, outcome: 'SENT' },
    { t: Date.now() - 58000,  tier: 2, outcome: 'FAILED' },
    { t: Date.now() - 30000,  tier: 1, outcome: 'SUPPRESSED' }
  ];

  function init(targetId) {
    containerId = targetId;

    bus.on('dispatch-event', function (evt) {
      events.unshift(evt);
      if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
      render();
    });

    bus.on('fixture-started', function () {
      events = fixtureEvents.slice();
      render();
    });

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
          '<th>TIER</th>' +
          '<th>OUTCOME</th>' +
        '</tr></thead>' +
        '<tbody>';

    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var timeStr = formatTime(e.t);
      var outcomeClass = '';
      if (e.outcome === 'SENT') outcomeClass = 'fired';
      else if (e.outcome === 'FAILED') outcomeClass = 'failed';
      else if (e.outcome === 'SUPPRESSED') outcomeClass = 'pending';

      html +=
        '<tr>' +
          '<td>' + timeStr + '</td>' +
          '<td>TIER ' + e.tier + '</td>' +
          '<td><span class="tier-status ' + outcomeClass + '">' + e.outcome + '</span></td>' +
        '</tr>';
    }

    html += '</tbody></table>';
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
