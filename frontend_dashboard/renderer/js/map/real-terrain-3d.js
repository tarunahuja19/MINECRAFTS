'use strict';

/**
 * Real 3D Satellite Terrain Engine (MapLibre GL 3D Terrain)
 * Renders authentic physical 3D elevation displacement using real global DEM raster tiles
 * and draped high-resolution satellite imagery with 3D camera pitch, bearing, and sector overlays.
 */
var realTerrain3D = (function () {

  // Single source for "all node records, whatever mode we are in". nodeMarkers
  // holds the live set (with x/y and lat/lon) once nodes-loaded has fired.
  function liveNodeRecords() {
    var out = [];
    if (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData &&
        typeof panelGrid !== 'undefined' && panelGrid.getAllSectors) {
      var sectors = panelGrid.getAllSectors() || {};
      var seen = {};
      Object.keys(sectors).forEach(function (sid) {
        (sectors[sid].nodes || []).forEach(function (nid) {
          if (seen[nid]) return;
          var nd = nodeMarkers.getNodeData(nid);
          if (nd) { seen[nid] = 1; out.push(nd); }
        });
      });
    }
    if (out.length) return out;
    var f = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes)
      ? fixtureProvider.getNodes() : null;
    return Array.isArray(f) ? f : [];
  }
  var map = null;
  var currentSector = null;
  var markerInstances = [];
  var sectorBadgeMarker = null;
  // The terrarium DEM tops out at z15 (~4.5 m/pixel, interpolated from ~30 m
  // SRTM over India), so it carries the site's regional shape but cannot
  // resolve individual benches or the highwall. A sector spans only ~34 m of
  // relief across ~600 m, which reads as dead flat at 1:1. 3.0 lifts that into
  // legible landform without turning the pit into a caricature; the VERT EXAG
  // buttons let an operator drop to 1.0 for true scale or push to 5.0.
  var currentExaggeration = 3.0;
  var isTerrainActive = true;
  var areSensorsActive = true;

  // Tiles come from the dashboard's own proxy (see serve.js) rather than
  // straight from ESRI/AWS. Two reasons: the proxy caches every tile to disk,
  // so imagery is downloaded once instead of on every launch and the window
  // keeps working with no network at all; and it makes tile requests
  // same-origin, which removes the remote-host fetch as a failure mode for
  // this page (Electron serves it from file://).
  var TILE_BASE = 'http://127.0.0.1:8085/tiles';
  var DEM_URL = TILE_BASE + '/dem/{z}/{x}/{y}.png';
  var SATELLITE_URL = TILE_BASE + '/satellite/{z}/{x}/{y}.png';

  function init(containerId, sectorData) {
    var container = document.getElementById(containerId);
    if (!container || typeof maplibregl === 'undefined') return false;

    currentSector = sectorData;
    // Fallback centre is the Adriyala panel origin, matching geo.py/mapView.
    // This still read the old Jharia coordinates, ~1000 km from the modelled
    // site, which would open the 3D window over the wrong ground.
    var centerLng = sectorData ? sectorData.center[1] : 79.5725;
    var centerLat = sectorData ? sectorData.center[0] : 18.6435;

    if (map) {
      map.remove();
      map = null;
    }

    var styleDef = {
      version: 8,
      sources: {
        'satellite-tiles': {
          type: 'raster',
          tiles: [SATELLITE_URL],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'ESRI World Imagery'
        },
        'terrain-dem': {
          type: 'raster-dem',
          tiles: [DEM_URL],
          encoding: 'terrarium',
          tileSize: 256,
          maxzoom: 15
        }
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster',
          source: 'satellite-tiles',
          minzoom: 0,
          maxzoom: 22
        },
        {
          id: 'hills-layer',
          type: 'hillshade',
          source: 'terrain-dem',
          layout: { visibility: 'visible' },
          paint: {
            'hillshade-exaggeration': 0.65,
            'hillshade-shadow-color': '#08121A',
            'hillshade-highlight-color': '#FFFFFF'
          }
        }
      ],
      sky: {
        'sky-color': '#0B1B26',
        'sky-horizon-blend': 0.5,
        'horizon-color': '#163244',
        'horizon-fog-blend': 0.5,
        'fog-color': '#0B151C',
        'fog-ground-blend': 0.5
      }
    };

    map = new maplibregl.Map({
      container: containerId,
      style: styleDef,
      center: [centerLng, centerLat],
      zoom: 16.2,
      pitch: 62,      // 62° 3D tilt
      bearing: 28,    // 28° rotation for perspective depth
      maxPitch: 85,
      canvasContextAttributes: { antialias: true }
    });

    // Add navigation controls
    map.addControl(new maplibregl.NavigationControl({
      visualizePitch: true,
      showZoom: true,
      showCompass: true
    }), 'top-right');

    // Guarded so the setup body runs exactly once even though 'load' and
    // 'styledata' can both reach it (a sector reload re-fires styledata).
    var setupDone = false;

    function runSetup() {
      if (setupDone || !map) return;
      if (!map.isStyleLoaded()) return;
      setupDone = true;

      try {
        map.resize();
      } catch (e) {
        // Cosmetic only - must never abort terrain/marker setup below.
        console.warn('[REAL_TERRAIN_3D] setup resize skipped:', e.message);
      }

      // Attaching terrain needs the DEM source to hold real data, and the DEM
      // legitimately 404s above its z15 coverage, so this retries on source
      // data and gives up quietly: a flat satellite view beats a blank window.
      applyTerrainWhenReady();

      if (currentSector) {
        addSectorBadge(currentSector);
        addSectorOverlay(currentSector);
        addSensorMarkers(currentSector);
      }
    }

    map.on('load', runSetup);
    map.on('styledata', runSetup);

    // Tile failures must stay non-fatal - a DEM 404 above z15 is expected - but
    // they are still reported so a dead proxy or cache miss is visible rather
    // than silently degrading into a flat, textureless view.
    map.on('error', function (e) {
      var msg = (e && e.error && e.error.message) ? e.error.message : String(e);
      console.warn('[REAL_TERRAIN_3D] map error (non-fatal):', msg);
      if (typeof bus !== 'undefined' && bus.emit) {
        bus.emit('tile-error', { source: 'terrain-3d', message: msg });
      }
    });

    return true;
  }

  function loadSector(sectorData) {
    currentSector = sectorData;
    if (!map) return;

    // Route through onResize rather than calling map.resize() directly: this
    // fires while the new sector's style is still loading, and an unguarded
    // resize re-enters MapLibre's render loop and throws "Attempting to run(),
    // but is already running". onResize defers to 'idle' and retries.
    onResize();

    var centerLng = sectorData.center[1];
    var centerLat = sectorData.center[0];

    map.easeTo({
      center: [centerLng, centerLat],
      zoom: 16.2,
      pitch: 62,
      bearing: 28,
      duration: 800
    });

    // Selecting another sector while the style is still loading threw
    // "Style is not done loading" (and, repeated, drove MapLibre into
    // "Attempting to run(), but is already running"). Defer to the style's own
    // load event instead of assuming it is ready.
    applySectorWhenStyleReady(sectorData);
  }

  // Runs the three layer/marker calls once the style can accept them, whether
  // that is now or after the next 'styledata'.
  function applySectorWhenStyleReady(sectorData) {
    if (!map) return;

    function apply() {
      if (!map) return;
      addSectorBadge(sectorData);
      addSectorOverlay(sectorData);
      addSensorMarkers(sectorData);
    }

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    function onStyleData() {
      if (!map || !map.isStyleLoaded()) return;
      map.off('styledata', onStyleData);
      apply();
    }
    map.on('styledata', onStyleData);
  }

  function addSectorBadge(sector) {
    if (sectorBadgeMarker) {
      sectorBadgeMarker.remove();
      sectorBadgeMarker = null;
    }
    if (!map || !sector) return;

    var cLng = sector.center ? sector.center[1] : (sector.lngRange ? (sector.lngRange[0] + sector.lngRange[1]) / 2 : 79.5725);
    var cLat = sector.center ? sector.center[0] : (sector.latRange ? (sector.latRange[0] + sector.latRange[1]) / 2 : 18.6435);

    var el = document.createElement('div');
    el.className = 'real-3d-sector-badge-pin';
    el.innerHTML = 
      '<div style="background:rgba(10,20,30,0.92); border:1.5px solid #00E5FF; border-radius:3px; padding:2px 7px; color:#00E5FF; font-family:\'Courier New\',monospace; font-size:10px; font-weight:bold; letter-spacing:0.08em; box-shadow:0 0 14px rgba(0,229,255,0.7), 0 2px 8px rgba(0,0,0,0.8); white-space:nowrap; pointer-events:none;">' +
        'SECTOR ' + sector.id +
      '</div>';

    sectorBadgeMarker = new maplibregl.Marker({
      element: el,
      anchor: 'center'
    })
    .setLngLat([cLng, cLat])
    .addTo(map);
  }

  function addSectorOverlay(sector) {
    if (!map || !sector) return;

    var minLng, maxLng, minLat, maxLat;
    if (sector.lngRange && sector.latRange) {
      minLng = sector.lngRange[0];
      maxLng = sector.lngRange[1];
      minLat = sector.latRange[0];
      maxLat = sector.latRange[1];
    } else if (sector.bounds) {
      minLat = sector.bounds[0][0];
      minLng = sector.bounds[0][1];
      maxLat = sector.bounds[1][0];
      maxLng = sector.bounds[1][1];
    } else {
      console.warn('[REAL_TERRAIN_3D] Missing bounds or lat/lng range for sector', sector);
      return;
    }

    var coords = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat]
    ];

    var geojson = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coords]
      },
      properties: {
        id: sector.id
      }
    };

    function applyLayers() {
      if (!map) return;
      try {
        var src = map.getSource('sector-boundary');
        if (src) {
          src.setData(geojson);
        } else {
          map.addSource('sector-boundary', {
            type: 'geojson',
            data: geojson
          });
        }

        if (!map.getLayer('sector-fill')) {
          map.addLayer({
            id: 'sector-fill',
            type: 'fill',
            source: 'sector-boundary',
            paint: {
              'fill-color': '#00E5FF',
              'fill-opacity': 0.22
            }
          });
        }

        if (!map.getLayer('sector-line')) {
          map.addLayer({
            id: 'sector-line',
            type: 'line',
            source: 'sector-boundary',
            paint: {
              'line-color': '#00E5FF',
              'line-width': 4.0,
              'line-opacity': 1.0
            }
          });
        }
      } catch (err) {
        console.warn('[REAL_TERRAIN_3D] Error applying sector layers:', err);
      }
    }

    applyLayers();
  }

  function addSensorMarkers(sector) {
    // Clear old markers
    markerInstances.forEach(function (m) { m.remove(); });
    markerInstances = [];

    if (!areSensorsActive || !sector || !sector.nodes || sector.nodes.length === 0) return;

    // In LIVE mode fixtureProvider is loaded but never populated, so getNodes()
    // returns null and the guard above (function exists) is not enough - the
    // .length below then throws. Prefer the live node records the markers are
    // already holding, and fall back to the fixtures only if those are absent.
    var allNodes = liveNodeRecords();
    var nodeMap = {};
    for (var i = 0; i < allNodes.length; i++) nodeMap[allNodes[i].node_id] = allNodes[i];

    sector.nodes.forEach(function (nodeId) {
      var n = nodeMap[nodeId];
      if (!n) return;

      var color = '#00CC44';
      if (n.state === 'warning') color = '#FFA500';
      if (n.state === 'critical') color = '#FF2222';
      if (n.state === 'lastgasp') color = '#FF4400';
      if (n.state === 'dead') color = '#78909C';

      // Custom 3D glowing pin marker
      var el = document.createElement('div');
      el.className = 'real-3d-marker-pin';
      el.innerHTML = 
        '<div style="position:relative; display:flex; flex-direction:column; align-items:center;">' +
          '<div style="background:rgba(10,20,28,0.92); border:1.5px solid ' + color + '; border-radius:2px; padding:1px 5px; font-family:\'Courier New\',monospace; font-size:9.5px; font-weight:bold; color:' + color + '; white-space:nowrap; box-shadow:0 2px 8px rgba(0,0,0,0.7);">' + nodeId + '</div>' +
          '<div style="width:10px; height:10px; border-radius:50%; background:' + color + '; border:1.5px solid #FFF; box-shadow:0 0 10px ' + color + '; margin-top:2px;"></div>' +
          '<div style="width:2px; height:12px; background:' + color + ';"></div>' +
        '</div>';

      // Pin height comes from the node's own `z` - the real DEM elevation
      // written by the simulation (sandbox.dem.elevation_at), not a guess and
      // not the terrain the GPU happens to have loaded. MapLibre already snaps
      // a marker to whatever DEM tile is resident, which is fine for the panel
      // but wrong for the Tier-3 gateway ~1.1 km out: its tile may not be
      // loaded at all, and it sits outside the 600 m window entirely. Passing
      // the stored altitude makes the pin agree with the physics frame either
      // way. Older MapLibre builds ignore the third element and fall back to
      // surface-snapping, so this degrades quietly rather than throwing.
      var hasZ = (typeof n.z === 'number' && isFinite(n.z));
      var lngLat = hasZ ? [n.lng, n.lat, n.z] : [n.lng, n.lat];

      var marker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom'
      })
      .setLngLat(lngLat)
      .addTo(map);

      // Popup
      var t = n.lastTelemetry;
      var strain = t ? t.strain_ustrain + ' µε' : (n.state === 'critical' ? '890 µε' : '142 µε');
      var popup = new maplibregl.Popup({ offset: 25, closeButton: false })
        .setHTML(
          '<div style="font-family:\'Courier New\',monospace; font-size:10px; padding:4px;">' +
            '<b style="color:' + color + ';">NODE ' + nodeId + ' (' + n.state.toUpperCase() + ')</b><br>' +
            'Strain: ' + strain + '<br>' +
            'Ring: ' + (n.ring || 'core') + '<br>' +
            'Elev: ' + (hasZ ? n.z.toFixed(1) + ' m AMSL' : 'n/a') +
          '</div>'
        );
      marker.setPopup(popup);

      markerInstances.push(marker);
    });
  }

  // Attaches the 3D terrain once the DEM source has usable data. The DEM
  // endpoint 404s outside its coverage, so setTerrain is retried on source
  // data rather than assumed to work on the first call, and gives up quietly.
  function applyTerrainWhenReady() {
    if (!map || !isTerrainActive) return;

    var attempts = 0;

    function tryAttach() {
      if (!map || !isTerrainActive) return true;
      try {
        if (map.getTerrain && map.getTerrain()) return true;
        if (!map.getSource('terrain-dem')) return false;
        map.setTerrain({ source: 'terrain-dem', exaggeration: currentExaggeration });
        return true;
      } catch (e) {
        return false;
      }
    }

    if (tryAttach()) return;

    function onData(ev) {
      if (ev && ev.sourceId && ev.sourceId !== 'terrain-dem') return;
      attempts++;
      if (tryAttach() || attempts > 40) {
        map.off('sourcedata', onData);
      }
    }
    map.on('sourcedata', onData);
  }

  function setExaggeration(val) {
    currentExaggeration = parseFloat(val) || 3.0;
    if (!map || !isTerrainActive) return;
    // A click can land before the DEM source exists (terrain attaches
    // asynchronously via applyTerrainWhenReady). setTerrain would throw and
    // take the button handler down with it, so fall back to the retry path -
    // the new exaggeration is already stored and gets picked up on attach.
    try {
      map.setTerrain({
        source: 'terrain-dem',
        exaggeration: currentExaggeration
      });
    } catch (e) {
      applyTerrainWhenReady();
    }
  }

  function setCameraPreset(preset) {
    if (!map || !currentSector) return;
    var centerLng = currentSector.center[1];
    var centerLat = currentSector.center[0];

    if (preset === 'iso') {
      map.easeTo({ center: [centerLng, centerLat], zoom: 16.2, pitch: 62, bearing: 28, duration: 800 });
    } else if (preset === 'top') {
      map.easeTo({ center: [centerLng, centerLat], zoom: 16.2, pitch: 0, bearing: 0, duration: 800 });
    } else if (preset === 'steep') {
      map.easeTo({ center: [centerLng, centerLat], zoom: 16.6, pitch: 78, bearing: 45, duration: 800 });
    }
  }

  var pendingResize = false;

  function onResize() {
    // openSector fires this four times per click (immediately, in rAF, then at
    // 80ms and 250ms) to settle the canvas against the window animation.
    // Calling resize() while the style is still loading re-enters MapLibre's
    // render loop and throws "Attempting to run(), but is already running", so
    // skip those early calls - a later one always lands once the style is up.
    if (!map) return;
    if (!map.isStyleLoaded()) {
      // Don't just drop it: the last timer can land before the style is up, and
      // a skipped resize would leave the canvas mis-sized. Retry once ready.
      if (!pendingResize) {
        pendingResize = true;
        map.once('idle', function () {
          pendingResize = false;
          onResize();
        });
      }
      return;
    }
    try {
      map.resize();
    } catch (e) {
      // A resize is cosmetic; never let it break sector selection.
      console.warn('[REAL_TERRAIN_3D] resize skipped:', e.message);
    }
  }

  function destroy() {
    if (sectorBadgeMarker) {
      sectorBadgeMarker.remove();
      sectorBadgeMarker = null;
    }
    markerInstances.forEach(function (m) { m.remove(); });
    markerInstances = [];
    if (map) {
      map.remove();
      map = null;
    }
  }

  return {
    init: init,
    loadSector: loadSector,
    setExaggeration: setExaggeration,
    setCameraPreset: setCameraPreset,
    onResize: onResize,
    destroy: destroy,
    // Diagnostics only. Exposes the live MapLibre instance so terrain state
    // (attached? what exaggeration? what elevation under a point?) can be
    // inspected from the console or a headless check, instead of being
    // inferred from screenshots. Never used by application code.
    getMap: function () { return map; }
  };
})();
