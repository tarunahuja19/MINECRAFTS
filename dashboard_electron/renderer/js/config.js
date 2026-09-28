(function () {
  'use strict';

  var isCloud = typeof window !== 'undefined' && window.location &&
    window.location.hostname &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1');

  var DEFAULT_BACKEND = isCloud ? 'https://minecrafts-backend.onrender.com' : 'http://localhost:8080';
  var DEFAULT_SIM = isCloud ? 'https://minecrafts-simulation.onrender.com' : 'http://localhost:8000';
  var DEFAULT_SANDBOX = isCloud ? 'https://mine-3d-sandbox.onrender.com' : 'http://localhost:5173';
  var DEFAULT_FORGE = isCloud ? 'https://minecrafts-simulation.onrender.com' : 'http://localhost:8020';

  function getQueryParam(name) {
    if (typeof window === 'undefined' || !window.location || !window.location.search) return null;
    var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]+)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var backendUrl = getQueryParam('backend') || window.__BACKEND_URL__ || DEFAULT_BACKEND;
  backendUrl = backendUrl.replace(/\/+$/, '');

  var simUrl = getQueryParam('sim') || window.__SIM_URL__ || DEFAULT_SIM;
  simUrl = simUrl.replace(/\/+$/, '');

  var forgeUrl = getQueryParam('forge_api') || window.__FORGE_API_BASE__ || DEFAULT_FORGE;
  forgeUrl = forgeUrl.replace(/\/+$/, '');

  var wsUrl = backendUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws';

  window.API_BASE = backendUrl;
  window.WS_URL = wsUrl;
  window.SIM_BASE = simUrl;
  window.SANDBOX_UI_URL = DEFAULT_SANDBOX;
  window.__FORGE_API_BASE__ = forgeUrl;

  // Direct public CDN tiles for web/cloud, fallback to proxy for local Electron
  window.TILE_SOURCES = {
    satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    labels: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    dem: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
  };

  // If local Electron with file: protocol and local tile proxy running
  if (typeof window !== 'undefined' && (window.location.protocol === 'file:' || (window.location.hostname === 'localhost' && window.location.port === '8085'))) {
    window.TILE_SOURCES = {
      satellite: 'http://127.0.0.1:8085/tiles/satellite/{z}/{x}/{y}.png',
      labels: 'http://127.0.0.1:8085/tiles/labels/{z}/{x}/{y}.png',
      topo: 'http://127.0.0.1:8085/tiles/topo/{z}/{x}/{y}.png',
      dem: 'http://127.0.0.1:8085/tiles/dem/{z}/{x}/{y}.png'
    };
  }

  window.__API_CONFIG__ = {
    backendUrl: backendUrl,
    simUrl: simUrl,
    wsUrl: wsUrl,
    sandboxUiUrl: DEFAULT_SANDBOX,
    isCloud: isCloud,
    tileSources: window.TILE_SOURCES
  };

  console.log('[config] Loaded API configuration:', window.__API_CONFIG__);
})();
