'use strict';

var tierConfig = (function () {
  var containerId = null;

  var tiers = [
    {
      tier: 1,
      label: 'LOCAL SIREN',
      enabled: true,
      detail: 'GPIO12 — Relay Wired'
    },
    {
      tier: 2,
      label: 'GSM SMS',
      enabled: true,
      detail: 'SIM800L — 2 contacts configured'
    },
    {
      tier: 3,
      label: 'EMAIL/PUSH',
      enabled: true,
      detail: '3 recipients — last test: 13:41'
    }
  ];

  function init(targetId) {
    containerId = targetId;
    render();
  }

  function render() {
    var container = document.getElementById(containerId);
    if (!container) return;

    var html = '';
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var statusClass = t.enabled ? 'connected' : 'disconnected';
      var statusText = t.enabled ? 'ENABLED' : 'DISABLED';
      html +=
        '<div class="tier-config-row">' +
          '<span class="tier-config-num">TIER ' + t.tier + '</span>' +
          '<span class="tier-config-label">' + t.label + '</span>' +
          '<span class="status-value ' + statusClass + '">[' + statusText + ']</span>' +
          '<span class="tier-config-detail mono">' + t.detail + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
  }

  return { init: init };
})();
