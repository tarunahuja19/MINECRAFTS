'use strict';

var mapView = (function () {
  var map = null;
  var currentBasemap = 'satellite'; // 'satellite' (aerial) or 'topo' (contours)
  var baseLayers = {};

  // Adriyala longwall site, Telangana - the same origin the simulation uses
  // (simulation/sandbox/geo.py ORIGIN_LAT/ORIGIN_LON, dem.py, server.py's
  // dem_lat/dem_lon). The map previously centred on Jharia, ~1000 km away from
  // the ground the physics actually models, so no real node could ever land on
  // it. Do not hand-edit these to a different mine without moving geo.py too.
  var ORIGIN_LAT = 18.6435;
  var ORIGIN_LON = 79.5725;

  // Mirrors geo.py: metres per degree, with longitude scaled by cos(origin lat).
  var M_PER_DEG_LAT = 111320.0;
  var M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN_LAT * Math.PI / 180);

  // Panel-frame metres -> [lat, lon]. Kept here (rather than importing) because
  // this file loads as a plain browser script, but it is the same flat-earth
  // projection as geo.xy_to_latlon with PANEL_BEARING_DEG = 0.
  function xyToLatLon(x, y) {
    return [ORIGIN_LAT + y / M_PER_DEG_LAT, ORIGIN_LON + x / M_PER_DEG_LON];
  }

  // The simulation window is 600 x 600 m centred on the panel centre
  // (constants.WINDOW_SIZE_M), so the visible box is +/-300 m on each axis.
  var WINDOW_HALF_M = 300;

  var MINE_CENTER = [ORIGIN_LAT, ORIGIN_LON];
  var MINE_BOUNDS = [
    xyToLatLon(-WINDOW_HALF_M, -WINDOW_HALF_M),
    xyToLatLon(WINDOW_HALF_M, WINDOW_HALF_M)
  ];

  // Panning room around the window: enough to see the site in context without
  // letting the user drift off to unmodelled ground.
  var PAN_LIMIT_M = 1500;
  var MINE_MAX_BOUNDS = [
    xyToLatLon(-PAN_LIMIT_M, -PAN_LIMIT_M),
    xyToLatLon(PAN_LIMIT_M, PAN_LIMIT_M)
  ];

  function init(containerId) {
    try {
      map = L.map(containerId, {
        center: MINE_CENTER,
        zoom: 17,
        minZoom: 13,
        maxZoom: 19,
        maxBounds: MINE_MAX_BOUNDS,
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
        'http://127.0.0.1:8085/tiles/satellite/{z}/{x}/{y}.png',
        {
          minZoom: 12,
          maxZoom: 19,
          maxNativeZoom: 19,
          attribution: 'Esri Satellite'
        }
      );
      var satLabels = L.tileLayer(
        'http://127.0.0.1:8085/tiles/labels/{z}/{x}/{y}.png',
        {
          minZoom: 12,
          maxZoom: 19,
          opacity: 0.85
        }
      );
      baseLayers.satellite = L.layerGroup([satTiles, satLabels]);

      // 2. Topographic basemap. This replaces the old TACTICAL option, which
      // pointed at '../tiles/{z}/{x}/{y}.png' - a directory that does not exist
      // in this repo, so every tile 404'd and the button produced a blank map.
      // Topo is served (Esri World Topo) and is the genuinely useful second
      // view here: contours show the surface relief the subsidence model acts
      // on, which the aerial imagery flattens out.
      var topoTiles = L.tileLayer(
        'http://127.0.0.1:8085/tiles/topo/{z}/{x}/{y}.png',
        {
          minZoom: 12,
          maxZoom: 19,
          maxNativeZoom: 19,
          attribution: 'Esri Topographic'
        }
      );
      baseLayers.topo = L.layerGroup([topoTiles]);

      var savedBasemap = 'satellite';
      setBasemap(savedBasemap);

      // Eye Legend Control: placed directly under Zoom (+/-) in topleft
      var EyeLegendControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function () {
          var container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-eye');
          var btn = L.DomUtil.create('a', 'leaflet-control-eye-btn', container);
          btn.href = '#';
          btn.id = 'btn-toggle-map-legend';
          btn.title = 'Toggle Map Legend (Active, Warning, Critical & Overlays)';
          btn.setAttribute('role', 'button');
          btn.setAttribute('aria-label', 'Toggle Legend');
          btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                            '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>' +
                            '<circle cx="12" cy="12" r="3"></circle>' +
                          '</svg>';

          L.DomEvent.disableClickPropagation(container);
          L.DomEvent.disableScrollPropagation(container);

          L.DomEvent.on(btn, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            toggleLegend();
          });

          return container;
        }
      });
      new EyeLegendControl().addTo(map);

      var closeLegendBtn = document.getElementById('btn-close-map-legend');
      if (closeLegendBtn) {
        closeLegendBtn.addEventListener('click', function () {
          toggleLegend(false);
        });
      }

      map.fitBounds(MINE_BOUNDS);

      var placeholder = document.getElementById('map-placeholder');
      if (placeholder) placeholder.style.display = 'none';

      setupSwitcherUI();
    } catch (err) {
      console.error('[MAP_VIEW_ERROR]', err);
    }

    return map;
  }

  function toggleLegend(forceState) {
    var legendEl = document.getElementById('map-hud-legend');
    var btn = document.getElementById('btn-toggle-map-legend');
    if (!legendEl) return;

    var willShow = (forceState !== undefined) ? !!forceState : !legendEl.classList.contains('visible');
    if (willShow) {
      legendEl.classList.add('visible');
      if (btn) btn.classList.add('active');
    } else {
      legendEl.classList.remove('visible');
      if (btn) btn.classList.remove('active');
    }
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
    var btnTopo = document.getElementById('btn-basemap-topo');

    if (btnSat) btnSat.addEventListener('click', function () { setBasemap('satellite'); });
    if (btnTopo) btnTopo.addEventListener('click', function () { setBasemap('topo'); });

    updateSwitcherButtons();
  }

  function updateSwitcherButtons() {
    var btnSat = document.getElementById('btn-basemap-sat');
    var btnTopo = document.getElementById('btn-basemap-topo');

    if (btnSat) {
      if (currentBasemap === 'satellite') btnSat.classList.add('active');
      else btnSat.classList.remove('active');
    }
    if (btnTopo) {
      if (currentBasemap === 'topo') btnTopo.classList.add('active');
      else btnTopo.classList.remove('active');
    }
  }

  function getMap() { return map; }
  function fitToMine() { if (map) map.fitBounds(MINE_BOUNDS); }

  // The gateway is deliberately sited outside the angle of draw, and so outside
  // the 600 m simulation window. Fitting to MINE_BOUNDS alone therefore hides
  // it. This fits the window PLUS whatever the markers actually occupy, so
  // every node is on screen at load without widening the window itself - the
  // window stays the physics extent that the sector grid is built on.
  function fitToNodes(bounds) {
    if (!map || !bounds || !bounds.isValid()) return fitToMine();
    map.fitBounds(L.latLngBounds(MINE_BOUNDS).extend(bounds).pad(0.05));
  }
  function panTo(lat, lng, zoom) { if (map) map.setView([lat, lng], zoom || 17); }

  return {
    init: init,
    getMap: getMap,
    setBasemap: setBasemap,
    fitToMine: fitToMine,
    fitToNodes: fitToNodes,
    panTo: panTo,
    toggleLegend: toggleLegend,
    MINE_CENTER: MINE_CENTER,
    MINE_BOUNDS: MINE_BOUNDS,
    // Exposed so map layers (node markers, sector grid) project panel-frame
    // metres through this one function instead of trusting whatever lat/lon a
    // record happens to carry. See geo.py for the authoritative definition.
    xyToLatLon: xyToLatLon,
    WINDOW_HALF_M: WINDOW_HALF_M
  };
})();
