'use strict';

var tierConfig = (function () {
  var containerId = null;

  // Derive API base the same way live-provider.js does
  function getApiBase() {
    if (typeof liveProvider !== 'undefined' && typeof liveProvider.getApiBase === 'function') {
      return liveProvider.getApiBase();
    }
    var port = '8080';
    if (typeof window !== 'undefined') {
      if (window.__TEST_BACKEND_PORT__) port = window.__TEST_BACKEND_PORT__;
      else if (window.__BACKEND_PORT__) port = window.__BACKEND_PORT__;
      else if (window.location && window.location.search) {
        var match = window.location.search.match(/[?&]backend_port=(\d+)/);
        if (match) port = match[1];
      }
    }
    var host = (typeof window !== 'undefined' && window.location && window.location.hostname) || 'localhost';
    return 'http://' + host + ':' + port;
  }

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
      detail: 'Loading contact count…'
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
    fetchContactCount();
  }

  function fetchContactCount() {
    fetch(getApiBase() + '/api/sms-contacts/count')
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var count = (data && typeof data.count === 'number') ? data.count : 0;
        tiers[1].detail = 'Twilio — ' + count + ' auto-alert contact' + (count !== 1 ? 's' : '') + ' configured';
        render();
      })
      .catch(function () {
        tiers[1].detail = 'Twilio — contact count unavailable';
        render();
      });
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

  return { init: init, refresh: fetchContactCount };
})();
