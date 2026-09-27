(function () {
  'use strict';

  var isCloud = typeof window !== 'undefined' && window.location &&
    window.location.hostname &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1');

  var DEFAULT_BACKEND = isCloud ? 'https://minecrafts-backend.onrender.com' : 'http://localhost:8080';
  var DEFAULT_SIM = isCloud ? 'https://minecrafts-simulation.onrender.com' : 'http://localhost:8000';
  var DEFAULT_SANDBOX = isCloud ? 'https://mine-3d-sandbox.onrender.com' : 'http://localhost:5173';

  function getQueryParam(name) {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var backendUrl = getQueryParam('backend') || window.__BACKEND_URL__ || DEFAULT_BACKEND;
  backendUrl = backendUrl.replace(/\/+$/, '');

  var simUrl = getQueryParam('sim') || window.__SIM_URL__ || DEFAULT_SIM;
  simUrl = simUrl.replace(/\/+$/, '');

  var wsUrl = backendUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws';

  window.API_BASE = backendUrl;
  window.WS_URL = wsUrl;
  window.SIM_BASE = simUrl;
  window.SANDBOX_UI_URL = DEFAULT_SANDBOX;

  window.__API_CONFIG__ = {
    backendUrl: backendUrl,
    simUrl: simUrl,
    wsUrl: wsUrl,
    sandboxUiUrl: DEFAULT_SANDBOX,
    isCloud: isCloud
  };

  console.log('[config] Loaded API configuration:', window.__API_CONFIG__);
})();
