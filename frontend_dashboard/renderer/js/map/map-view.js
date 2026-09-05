'use strict';

var mapView = (function () {
  var map = null;
  var currentBasemap = 'satellite'; // 'satellite' (aerial) or 'dark' (tactical)
  var baseLayers = {};

  var MINE_CENTER = [23.7440, 86.4195];
  var MINE_BOUNDS = [
    [23.7385, 86.4125],
    [23.7495, 86.4265]
  ];

  function init(containerId) {
    try {
      map = L.map(containerId, {
        center: MINE_CENTER,
        zoom: 17,
        minZoom: 13,
        maxZoom: 19,
        maxBounds: [
          [23.7300, 86.4000],
          [23.7600, 86.4400]
        ],
        maxBoundsViscosity: 0.9,
        zoomControl: true,
        attributionControl: false
      });
    } catch (e) {
      return null;
    }

    try {
      // 1. Satellite Basemap (ESRI World Imagery + Reference Overlay)
      var satTiles = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          minZoom: 12,
          maxZoom: 19,
          maxNativeZoom: 19,
          attribution: 'Esri Satellite'
        }
      );
      var satLabels = L.tileLayer(
        'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        {
          minZoom: 12,
          maxZoom: 19,
          opacity: 0.85
        }
      );
      baseLayers.satellite = L.layerGroup([satTiles, satLabels]);

      // 2. Dark SCADA Basemap (Local offline tiles + ESRI Dark Canvas fallback)
      var darkLocal = L.tileLayer(
        '../tiles/{z}/{x}/{y}.png',
        {
          minZoom: 14,
          maxNativeZoom: 16,
          maxZoom: 19,
          errorTileUrl: ''
        }
      );
      darkLocal.on('tileerror', function (err) {
        if (err.tile) err.tile.style.display = 'none';
      });
      baseLayers.dark = L.layerGroup([darkLocal]);

      var savedBasemap = 'satellite';
      setBasemap(savedBasemap);

      // Metric Scale Control (bottom-right)
      L.control.scale({
        position: 'bottomright',
        metric: true,
        imperial: false
      }).addTo(map);

      map.fitBounds(MINE_BOUNDS);

      var placeholder = document.getElementById('map-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      setupSwitcherUI();
    } catch (err) {
      console.error('[MAP_VIEW_ERROR]', err);
    }

    return map;
  }

  function setBasemap(name) {
    try {
      if (!baseLayers[name]) name = 'satellite';
      currentBasemap = name;

      Object.keys(baseLayers).forEach(function (key) {
        if (map && map.hasLayer && map.hasLayer(baseLayers[key])) {
          map.removeLayer(baseLayers[key]);
        }
      });

      if (map && baseLayers[name]) {
        baseLayers[name].addTo(map);
      }

      updateSwitcherButtons();
    } catch (e) {
      console.error('[SET_BASEMAP_ERROR]', e);
    }
  }

  function setupSwitcherUI() {
    var btnSat = document.getElementById('btn-basemap-sat');
    var btnDark = document.getElementById('btn-basemap-dark');

    if (btnSat) btnSat.addEventListener('click', function () { setBasemap('satellite'); });
    if (btnDark) btnDark.addEventListener('click', function () { setBasemap('dark'); });

    updateSwitcherButtons();
  }

  function updateSwitcherButtons() {
    var btnSat = document.getElementById('btn-basemap-sat');
    var btnDark = document.getElementById('btn-basemap-dark');

    if (btnSat) {
      if (currentBasemap === 'satellite') btnSat.classList.add('active');
      else btnSat.classList.remove('active');
    }
    if (btnDark) {
      if (currentBasemap === 'dark') btnDark.classList.add('active');
      else btnDark.classList.remove('active');
    }
  }

  function getMap() { return map; }
  function fitToMine() { if (map) map.fitBounds(MINE_BOUNDS); }
  function panTo(lat, lng, zoom) { if (map) map.setView([lat, lng], zoom || 17); }

  return {
    init: init,
    getMap: getMap,
    setBasemap: setBasemap,
    fitToMine: fitToMine,
    panTo: panTo,
    MINE_CENTER: MINE_CENTER,
    MINE_BOUNDS: MINE_BOUNDS
  };
})();
