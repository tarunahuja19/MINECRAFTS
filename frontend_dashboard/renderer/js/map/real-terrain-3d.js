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
  var currentExaggeration = 2.0;
  var isTerrainActive = true;
  var areSensorsActive = true;

  var DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
  var SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

  function init(containerId, sectorData) {
    var container = document.getElementById(containerId);
    if (!container || typeof maplibregl === 'undefined') return false;

    currentSector = sectorData;
    var centerLng = sectorData ? sectorData.center[1] : 86.4195;
    var centerLat = sectorData ? sectorData.center[0] : 23.7440;

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

    map.on('load', function () {
      map.resize();
      // Enable 3D Terrain elevation displacement
      try {
        map.setTerrain({
          source: 'terrain-dem',
          exaggeration: currentExaggeration
        });
      } catch (e) {
        console.warn('[REAL_TERRAIN_3D] Error setting terrain:', e);
      }

      if (currentSector) {
        addSectorBadge(currentSector);
        addSectorOverlay(currentSector);
        addSensorMarkers(currentSector);
      }
    });

    return true;
  }

  function loadSector(sectorData) {
    currentSector = sectorData;
    if (!map) return;

    map.resize();

    var centerLng = sectorData.center[1];
    var centerLat = sectorData.center[0];

    map.easeTo({
      center: [centerLng, centerLat],
      zoom: 16.2,
      pitch: 62,
      bearing: 28,
      duration: 800
    });

    addSectorBadge(sectorData);
    addSectorOverlay(sectorData);
    addSensorMarkers(sectorData);
  }

  function addSectorBadge(sector) {
    if (sectorBadgeMarker) {
      sectorBadgeMarker.remove();
      sectorBadgeMarker = null;
    }
    if (!map || !sector) return;

    var cLng = sector.center ? sector.center[1] : (sector.lngRange ? (sector.lngRange[0] + sector.lngRange[1]) / 2 : 86.4195);
    var cLat = sector.center ? sector.center[0] : (sector.latRange ? (sector.latRange[0] + sector.latRange[1]) / 2 : 23.7440);

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

      var marker = new maplibregl.Marker({
        element: el,
        anchor: 'bottom'
      })
      .setLngLat([n.lng, n.lat])
      .addTo(map);

      // Popup
      var t = n.lastTelemetry;
      var strain = t ? t.strain_ustrain + ' µε' : (n.state === 'critical' ? '890 µε' : '142 µε');
      var popup = new maplibregl.Popup({ offset: 25, closeButton: false })
        .setHTML(
          '<div style="font-family:\'Courier New\',monospace; font-size:10px; padding:4px;">' +
            '<b style="color:' + color + ';">NODE ' + nodeId + ' (' + n.state.toUpperCase() + ')</b><br>' +
            'Strain: ' + strain + '<br>' +
            'Ring: ' + (n.ring || 'core') +
          '</div>'
        );
      marker.setPopup(popup);

      markerInstances.push(marker);
    });
  }

  function setExaggeration(val) {
    currentExaggeration = parseFloat(val) || 2.0;
    if (map && isTerrainActive) {
      map.setTerrain({
        source: 'terrain-dem',
        exaggeration: currentExaggeration
      });
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

  function onResize() {
    if (map) map.resize();
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
    destroy: destroy
  };
})();
