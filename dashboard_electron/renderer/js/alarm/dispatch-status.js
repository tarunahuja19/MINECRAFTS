'use strict';

var dispatchStatus = (function () {
  var TIERS = [
    { label: 'TIER 1', method: 'CONTROL ROOM ALERT', delay: 0 },
    { label: 'TIER 2', method: 'SMS TO SAFETY OFFICER', delay: 30 },
    { label: 'TIER 3', method: 'SIREN + PA SYSTEM', delay: 120 }
  ];

  function render(containerId, alarm) {
    var container = document.getElementById(containerId);
    if (!container || !alarm) return;

    var html = '<div class="readout-label">DISPATCH STATUS</div>';

    for (var i = 0; i < TIERS.length; i++) {
      var tier = TIERS[i];
      var status = getDispatchState(alarm, i);
      var statusClass = status.toLowerCase();

      html +=
        '<div class="dispatch-row">' +
          '<span class="tier-label">' + tier.label + '</span>' +
          '<span class="tier-method">' + tier.method + '</span>' +
          '<span class="tier-status ' + statusClass + '">' + status + '</span>' +
        '</div>';
    }

    container.innerHTML = html;
  }

  function getDispatchState(alarm, tierIndex) {
    if (alarm.level >= 3) {
      return 'FIRED';
    }
    if (alarm.level >= 2) {
      return tierIndex <= 1 ? 'FIRED' : 'PENDING';
    }
    return tierIndex === 0 ? 'FIRED' : 'PENDING';
  }

  return {
    render: render
  };
})();
