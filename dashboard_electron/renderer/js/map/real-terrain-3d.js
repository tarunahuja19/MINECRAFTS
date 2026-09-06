'use strict';

/**
 * Real 3D Satellite Terrain Engine (MapLibre GL 3D Terrain)
 * Multi-Instance Architecture: supports single, 2-split, 3-split, and 4-split quad monitoring views.
 * Renders authentic physical 3D elevation displacement using real global DEM raster tiles
 * and draped high-resolution satellite imagery with 3D camera pitch, bearing, and sector overlays.
 */
var realTerrain3D = (function () {

  // Single source for "all node records, whatever mode we are in".
  function liveNodeRecords() {
    var out = [];
    if (typeof nodeMarkers !== 'undefined' && typeof nodeMarkers.getAllNodes === 'function') {
      var all = nodeMarkers.getAllNodes();
      if (all && all.length) return all;
    }
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

  // Normalizes coordinate pair so latitude (~18.64) and longitude (~79.57) are never inverted
  function normalizeLatLon(latCandidate, lngCandidate) {
    var a = Number(latCandidate);
    var b = Number(lngCandidate);
    if (!isFinite(a) || !isFinite(b)) return null;

    // In this Indian coal mine: lat is ~18.64°N, lng is ~79.57°E
    if (a > 50 && b < 50) {
      return { lat: b, lng: a };
    }
    return { lat: a, lng: b };
  }

  function getNodeLatLng(n) {
    if (!n) return null;

    if (typeof n.lat === 'number' && typeof n.lng === 'number') {
      return normalizeLatLon(n.lat, n.lng);
    }
    if (typeof n.latitude === 'number' && typeof n.longitude === 'number') {
      return normalizeLatLon(n.latitude, n.longitude);
    }
    if (Array.isArray(n.pos) && n.pos.length >= 2) {
      return normalizeLatLon(n.pos[0], n.pos[1]);
    }
    if (typeof n.x === 'number' && typeof n.y === 'number' &&
        typeof mapView !== 'undefined' && typeof mapView.xyToLatLon === 'function') {
      var p = mapView.xyToLatLon(n.x, n.y);
      if (p && isFinite(p[0]) && isFinite(p[1])) {
        return normalizeLatLon(p[0], p[1]);
      }
    }
    return null;
  }

  function getSectorBounds(sector) {
    if (!sector) return null;
    var minLng, maxLng, minLat, maxLat;

    if (sector.lngRange && sector.latRange) {
      var normA = normalizeLatLon(sector.latRange[0], sector.lngRange[0]);
      var normB = normalizeLatLon(sector.latRange[1], sector.lngRange[1]);
      if (normA && normB) {
        minLat = Math.min(normA.lat, normB.lat);
        maxLat = Math.max(normA.lat, normB.lat);
        minLng = Math.min(normA.lng, normB.lng);
        maxLng = Math.max(normA.lng, normB.lng);
      }
    } else if (sector.bounds && Array.isArray(sector.bounds) && sector.bounds.length >= 2) {
      var pt1 = sector.bounds[0];
      var pt2 = sector.bounds[1];
      var norm1 = normalizeLatLon(pt1[0], pt1[1]);
      var norm2 = normalizeLatLon(pt2[0], pt2[1]);
      if (norm1 && norm2) {
        minLat = Math.min(norm1.lat, norm2.lat);
        maxLat = Math.max(norm1.lat, norm2.lat);
        minLng = Math.min(norm1.lng, norm2.lng);
        maxLng = Math.max(norm1.lng, norm2.lng);
      }
    } else if (sector.center) {
      var cNorm = normalizeLatLon(sector.center[0], sector.center[1]);
      var cLat = cNorm ? cNorm.lat : 18.6435;
      var cLng = cNorm ? cNorm.lng : 79.5725;
      minLat = cLat - 0.0022;
      maxLat = cLat + 0.0022;
      minLng = cLng - 0.0022;
      maxLng = cLng + 0.0022;
    } else {
      // Fallback: derive bounds from sector nodes
      var allNodes = liveNodeRecords();
      var nodeMap = {};
      allNodes.forEach(function (n) { if (n && n.node_id) nodeMap[n.node_id] = n; });
      var validCoords = [];
      (sector.nodes || []).forEach(function (nid) {
        var n = nodeMap[nid];
        var pos = getNodeLatLng(n);
        if (pos) validCoords.push(pos);
      });
      if (validCoords.length) {
        minLat = Math.min.apply(null, validCoords.map(function (c) { return c.lat; })) - 0.0008;
        maxLat = Math.max.apply(null, validCoords.map(function (c) { return c.lat; })) + 0.0008;
        minLng = Math.min.apply(null, validCoords.map(function (c) { return c.lng; })) - 0.0008;
        maxLng = Math.max.apply(null, validCoords.map(function (c) { return c.lng; })) + 0.0008;
      } else {
        return null;
      }
    }

    // Ensure valid non-degenerate bounding box
    if (!isFinite(minLat) || !isFinite(maxLat) || !isFinite(minLng) || !isFinite(maxLng)) {
      return null;
    }
    if (minLat === maxLat) { minLat -= 0.001; maxLat += 0.001; }
    if (minLng === maxLng) { minLng -= 0.001; maxLng += 0.001; }

    return {
      minLng: minLng,
      maxLng: maxLng,
      minLat: minLat,
      maxLat: maxLat,
      centerLng: (minLng + maxLng) / 2,
      centerLat: (minLat + maxLat) / 2
    };
  }

  function buildSectorGeoJSON(b, sectorId) {
    if (!b) {
      return {
        type: 'FeatureCollection',
        features: []
      };
    }
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [b.minLng, b.minLat],
              [b.maxLng, b.minLat],
              [b.maxLng, b.maxLat],
              [b.minLng, b.maxLat],
              [b.minLng, b.minLat]
            ]]
          },
          properties: {
            id: sectorId || 'CUSTOM',
            type: 'boundary'
          }
        }
      ]
    };
  }

  var primaryContainerId = 'real-terrain-3d-map';
  var instances = {};
  var isTerrainActive = true;
  var areSensorsActive = true;

  // Tiles come from the dashboard's same-origin proxy (serve.js)
  var TILE_BASE = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) 
    ? (window.location.origin + '/tiles')
    : 'http://127.0.0.1:8085/tiles';
  var DEM_URL = TILE_BASE + '/dem/{z}/{x}/{y}.png';
  var SATELLITE_URL = TILE_BASE + '/satellite/{z}/{x}/{y}.png';

  function getInstance(containerId) {
    var id = containerId || primaryContainerId;
    return instances[id] || null;
  }

  function init(containerId, sectorData) {
    var cId = containerId || primaryContainerId;
    var container = document.getElementById(cId);
    if (!container || typeof maplibregl === 'undefined') return false;

    // Clean up any existing instance on this container
    destroy(cId);

    var b = getSectorBounds(sectorData);
    var centerLng = b ? b.centerLng : 79.5725;
    var centerLat = b ? b.centerLat : 18.6435;
    var defaultExaggeration = 3.0;

    var initialGeoJSON = buildSectorGeoJSON(b, sectorData ? sectorData.id : 'CUSTOM');

    // Clean initial style definition with raster satellite tiles, DEM source, hillshade, draped boundary layers, and atmospheric sky
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
        },
        'sector-boundary': {
          type: 'geojson',
          data: initialGeoJSON
        }
      },
      layers: [
        {
          id: 'satellite-layer',
          type: 'raster',
          source: 'satellite-tiles',
          minzoom: 0,
          maxzoom: 22,
          paint: {
            'raster-opacity': 1.0,
            'raster-fade-duration': 0
          }
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
        },
        {
          id: 'sector-fill',
          type: 'fill',
          source: 'sector-boundary',
          paint: {
            'fill-color': '#00E676',
            'fill-opacity': 0.28
          }
        },
        {
          id: 'sector-line-outer',
          type: 'line',
          source: 'sector-boundary',
          paint: {
            'line-color': '#002611',
            'line-width': 7,
            'line-opacity': 0.85
          }
        },
        {
          id: 'sector-line-glow',
          type: 'line',
          source: 'sector-boundary',
          paint: {
            'line-color': '#00FF88',
            'line-width': 4.5,
            'line-opacity': 0.98
          }
        },
        {
          id: 'sector-line-inner',
          type: 'line',
          source: 'sector-boundary',
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 1.8,
            'line-opacity': 0.95
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

    var mapInstance = new maplibregl.Map({
      container: cId,
      style: styleDef,
      center: [centerLng, centerLat],
      zoom: 16.0,
      pitch: 58,
      bearing: 28,
      maxPitch: 85,
      canvasContextAttributes: { antialias: true }
    });

    mapInstance.addControl(new maplibregl.NavigationControl({
      visualizePitch: true,
      showZoom: true,
      showCompass: true
    }), 'top-right');

    var inst = {
      containerId: cId,
      map: mapInstance,
      currentSector: sectorData,
      currentExaggeration: defaultExaggeration,
      currentPitch: 58,
      currentBearing: 28,
      markerInstances: [],
      markerMap: {},
      cornerMarkers: []
    };
    instances[cId] = inst;

    var setupDone = false;
    function runSetup() {
      if (setupDone || !inst.map) return;
      if (!inst.map.isStyleLoaded()) return;
      setupDone = true;

      try {
        inst.map.resize();
      } catch (e) {
        console.warn('[REAL_TERRAIN_3D] resize skipped in setup:', e.message);
      }

      applyTerrainWhenReady(inst);

      if (inst.currentSector) {
        frameSectorCamera(inst, inst.currentSector, false);
        addSectorOverlay(inst, inst.currentSector);
        addSensorMarkers(inst, inst.currentSector);
      }
    }

    mapInstance.on('load', runSetup);
    mapInstance.on('styledata', runSetup);

    mapInstance.on('error', function (e) {
      var msg = (e && e.error && e.error.message) ? e.error.message : String(e);
      if (!msg.includes('404') && !msg.includes('Failed to fetch')) {
        console.warn('[REAL_TERRAIN_3D] Map Notice:', msg);
      }
    });

    return true;
  }

  function applyTerrainWhenReady(inst) {
    if (!inst || !inst.map || !isTerrainActive) return;

    var attempts = 0;
    function tryAttach() {
      if (!inst || !inst.map || !isTerrainActive) return true;
      try {
        if (!inst.map.isStyleLoaded()) return false;
        if (inst.map.getTerrain && inst.map.getTerrain()) return true;
        if (!inst.map.getSource('terrain-dem')) return false;
        inst.map.setTerrain({ source: 'terrain-dem', exaggeration: inst.currentExaggeration });
        return true;
      } catch (e) {
        return false;
      }
    }

    if (tryAttach()) return;

    function onData(ev) {
      if (ev && ev.sourceId && ev.sourceId !== 'terrain-dem') return;
      attempts++;
      if (tryAttach() || attempts > 50) {
        if (inst.map) inst.map.off('sourcedata', onData);
      }
    }
    inst.map.on('sourcedata', onData);
  }

  function frameSectorCamera(inst, sector, animate) {
    if (!inst || !inst.map || !sector) return;
    var b = getSectorBounds(sector);
    if (!b) return;

    // Calculate dynamic framing zoom level based on bounding box span
    var span = Math.max(b.maxLng - b.minLng, (b.maxLat - b.minLat) * 1.5);
    var targetZoom = 15.8;
    if (span > 0.015) targetZoom = 14.5;
    else if (span > 0.008) targetZoom = 15.0;
    else if (span > 0.004) targetZoom = 15.4;
    else if (span > 0.002) targetZoom = 15.8;
    else targetZoom = 16.2;

    var pitch = (typeof inst.currentPitch === 'number') ? inst.currentPitch : 58;
    var bearing = (typeof inst.currentBearing === 'number') ? inst.currentBearing : 28;

    try {
      inst.map.easeTo({
        center: [b.centerLng, b.centerLat],
        zoom: targetZoom,
        pitch: pitch,
        bearing: bearing,
        duration: animate ? 650 : 0
      });
    } catch (_) {}
  }

  function loadSector(sectorData, containerId) {
    var inst = getInstance(containerId);
    if (!inst || !inst.map) return;
    inst.currentSector = sectorData;

    onResize(inst.containerId);
    frameSectorCamera(inst, sectorData, true);

    addSectorOverlay(inst, sectorData);
    addSensorMarkers(inst, sectorData);
    applyTerrainWhenReady(inst);
  }

  function ensureBoundaryLayers(inst, geojson) {
    if (!inst || !inst.map) return;

    function applyData() {
      if (!inst || !inst.map) return true;
      try {
        var src = inst.map.getSource('sector-boundary');
        if (src && typeof src.setData === 'function') {
          src.setData(geojson);
          return true;
        }
        if (inst.map.isStyleLoaded()) {
          if (!inst.map.getSource('sector-boundary')) {
            inst.map.addSource('sector-boundary', {
              type: 'geojson',
              data: geojson
            });
          }
          if (!inst.map.getLayer('sector-fill')) {
            inst.map.addLayer({
              id: 'sector-fill',
              type: 'fill',
              source: 'sector-boundary',
              paint: {
                'fill-color': '#00E676',
                'fill-opacity': 0.28
              }
            });
          }
          if (!inst.map.getLayer('sector-line-outer')) {
            inst.map.addLayer({
              id: 'sector-line-outer',
              type: 'line',
              source: 'sector-boundary',
              paint: {
                'line-color': '#002611',
                'line-width': 7,
                'line-opacity': 0.85
              }
            });
          }
          if (!inst.map.getLayer('sector-line-glow')) {
            inst.map.addLayer({
              id: 'sector-line-glow',
              type: 'line',
              source: 'sector-boundary',
              paint: {
                'line-color': '#00FF88',
                'line-width': 4.5,
                'line-opacity': 0.98
              }
            });
          }
          if (!inst.map.getLayer('sector-line-inner')) {
            inst.map.addLayer({
              id: 'sector-line-inner',
              type: 'line',
              source: 'sector-boundary',
              paint: {
                'line-color': '#FFFFFF',
                'line-width': 1.8,
                'line-opacity': 0.95
              }
            });
          }
          return true;
        }
      } catch (e) {
        console.warn('[REAL_TERRAIN_3D] ensureBoundaryLayers warning:', e.message);
      }
      return false;
    }

    if (applyData()) return;

    var attempts = 0;
    var timer = setInterval(function () {
      attempts++;
      if (applyData() || attempts > 50) {
        clearInterval(timer);
      }
    }, 50);

    if (inst.map && typeof inst.map.once === 'function') {
      inst.map.once('idle', function () {
        applyData();
      });
    }
  }

  function addSectorOverlay(inst, sector) {
    if (!inst || !inst.map || !sector) return;

    // Clear previous corner markers
    inst.cornerMarkers.forEach(function (m) { m.remove(); });
    inst.cornerMarkers = [];

    var b = getSectorBounds(sector);
    if (!b) return;

    // 1. Tactical Corner Brackets (24x24px bright glowing brackets at vertices)
    var corners = [
      { pos: [b.minLng, b.maxLat], cls: 'tl' },
      { pos: [b.maxLng, b.maxLat], cls: 'tr' },
      { pos: [b.maxLng, b.minLat], cls: 'br' },
      { pos: [b.minLng, b.minLat], cls: 'bl' }
    ];

    corners.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'real-3d-corner-bracket ' + c.cls;
      var m = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat(c.pos)
        .addTo(inst.map);
      inst.cornerMarkers.push(m);
    });

    // 2. Heading badge removed as per user request ("remove this heading selected region that comes above selected region in 3d")

    // 3. Draped GeoJSON Polygon Fill & Bright Perimeter Lines
    var geojson = buildSectorGeoJSON(b, sector.id);
    ensureBoundaryLayers(inst, geojson);
  }

  function addSensorMarkers(inst, sector) {
    if (!inst || !inst.map) return;
    inst.markerInstances.forEach(function (m) { m.remove(); });
    inst.markerInstances = [];
    inst.markerMap = {};

    var allNodes = liveNodeRecords();
    var nodeMap = {};
    allNodes.forEach(function (n) {
      if (n && n.node_id) nodeMap[n.node_id] = n;
    });

    var b = getSectorBounds(sector);
    var targetNodes = [];
    if (sector.nodes && Array.isArray(sector.nodes) && sector.nodes.length > 0) {
      targetNodes = sector.nodes.map(function (nid) { return nodeMap[nid]; }).filter(Boolean);
    } else if (b) {
      allNodes.forEach(function (n) {
        var pos = getNodeLatLng(n);
        if (pos && pos.lat >= b.minLat && pos.lat <= b.maxLat && pos.lng >= b.minLng && pos.lng <= b.maxLng) {
          targetNodes.push(n);
        }
      });
    }

    targetNodes.forEach(function (n) {
      var pos = getNodeLatLng(n);
      if (!pos) return;

      var nodeId = n.node_id || n.id || 'N??';
      var state = n.state || (n.status ? String(n.status).toLowerCase() : 'active');
      var color = '#00E676';
      if (state === 'warning') color = '#FFB300';
      if (state === 'critical') color = '#FF3333';
      if (state === 'lastgasp') color = '#FF5722';
      if (state === 'dead') color = '#607D8B';

      var t = n.lastTelemetry || {};
      var strainVal = (typeof t.strain_ustrain === 'number') ? t.strain_ustrain : (typeof n.strain === 'number' ? n.strain : 142);
      var tiltX = (typeof t.tilt_x_mdeg === 'number') ? t.tilt_x_mdeg : (typeof n.tilt_x === 'number' ? n.tilt_x : -32);

      var wrapper = document.createElement('div');
      wrapper.className = 'real-3d-marker-wrapper';

      var radarRing = document.createElement('div');
      radarRing.className = 'real-3d-marker-ground-radar';
      radarRing.style.borderColor = color;
      radarRing.style.boxShadow = '0 0 10px ' + color;
      wrapper.appendChild(radarRing);

      var pin = document.createElement('div');
      pin.className = 'real-3d-marker-pin';
      pin.setAttribute('data-node-id', nodeId);

      pin.innerHTML =
        '<div class="real-3d-marker-tag" style="border-color:' + color + '; color:#E6EDF2;">' +
          '<span class="real-3d-marker-dot" style="background:' + color + '; box-shadow:0 0 8px ' + color + ';"></span>' +
          '<span style="font-weight:bold; letter-spacing:0.04em;">' + nodeId + '</span>' +
          '<span style="color:#7A9BAA; font-size:8px; margin-left:2px;">| ' + strainVal + 'µε</span>' +
        '</div>' +
        '<div class="real-3d-marker-stem" style="background:linear-gradient(to bottom, ' + color + ', rgba(0,230,118,0.2));"></div>';
      wrapper.appendChild(pin);

      var marker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' })
        .setLngLat([pos.lng, pos.lat])
        .addTo(inst.map);

      var popupHtml =
        '<div style="font-family:\'Courier New\',monospace; font-size:11px; color:#E6EDF2; padding:4px 6px; min-width:130px;">' +
          '<div style="font-weight:bold; color:' + color + '; border-bottom:1px solid #2A3B4A; padding-bottom:3px; margin-bottom:4px; display:flex; justify-content:space-between;">' +
            '<span>SENSOR ' + nodeId + '</span>' +
            '<span style="font-size:9px; text-transform:uppercase;">' + state + '</span>' +
          '</div>' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:#7A9BAA;">Role:</span><b style="color:#D4D8DC;">' + (n.role || 'scout') + '</b></div>' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:#7A9BAA;">Ring:</span><b style="color:#D4D8DC;">' + (n.ring || 'core') + '</b></div>' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:2px;"><span style="color:#7A9BAA;">Strain:</span><b style="color:#A8D8A8;">' + strainVal + ' µε</b></div>' +
          '<div style="display:flex; justify-content:space-between;"><span style="color:#7A9BAA;">Tilt X:</span><b style="color:#A8D8A8;">' + tiltX + ' mdeg</b></div>' +
        '</div>';

      var popup = new maplibregl.Popup({ offset: 20, closeButton: true }).setHTML(popupHtml);
      marker.setPopup(popup);

      inst.markerInstances.push(marker);
      inst.markerMap[nodeId] = marker;
    });
  }

  function setExaggeration(val, containerId) {
    var exag = parseFloat(val) || 3.0;
    var targetInsts = containerId ? [getInstance(containerId)] : Object.values(instances);
    targetInsts.forEach(function (inst) {
      if (!inst || !inst.map || !isTerrainActive) return;
      inst.currentExaggeration = exag;
      try {
        if (inst.map.isStyleLoaded()) {
          inst.map.setTerrain({ source: 'terrain-dem', exaggeration: exag });
        }
      } catch (e) {
        console.warn('[REAL_TERRAIN_3D] setTerrain warning:', e.message);
      }
    });
  }

  function setCameraPreset(preset, containerId) {
    var inst = getInstance(containerId);
    if (!inst || !inst.map || !inst.currentSector) return;
    var b = getSectorBounds(inst.currentSector);
    var centerLng = b ? b.centerLng : 79.5725;
    var centerLat = b ? b.centerLat : 18.6435;

    if (preset === 'iso') {
      inst.currentPitch = 58;
      inst.currentBearing = 28;
      inst.map.easeTo({ center: [centerLng, centerLat], pitch: 58, bearing: 28, duration: 800 });
    } else if (preset === 'top') {
      inst.currentPitch = 0;
      inst.currentBearing = 0;
      inst.map.easeTo({ center: [centerLng, centerLat], pitch: 0, bearing: 0, duration: 800 });
    } else if (preset === 'steep') {
      inst.currentPitch = 74;
      inst.currentBearing = 40;
      inst.map.easeTo({ center: [centerLng, centerLat], pitch: 74, bearing: 40, duration: 800 });
    }
  }

  function onResize(containerId) {
    var resizeMap = function (m, inst) {
      if (!m) return;
      if (!m.isStyleLoaded()) {
        m.once('idle', function () {
          try { m.resize(); } catch (_) {}
        });
        return;
      }
      try {
        m.resize();
        if (inst && inst.currentSector) {
          var z = m.getZoom();
          if (isNaN(z) || z < 10) {
            frameSectorCamera(inst, inst.currentSector, false);
          }
        }
      } catch (_) {}
    };

    if (containerId) {
      var inst = getInstance(containerId);
      if (inst && inst.map) resizeMap(inst.map, inst);
    } else {
      Object.keys(instances).forEach(function (k) {
        if (instances[k] && instances[k].map) {
          resizeMap(instances[k].map, instances[k]);
        }
      });
    }
  }

  function destroy(containerId) {
    if (containerId) {
      var inst = instances[containerId];
      if (inst) {
        inst.cornerMarkers.forEach(function (m) { m.remove(); });
        inst.markerInstances.forEach(function (m) { m.remove(); });
        inst.cornerMarkers = [];
        inst.markerInstances = [];
        inst.markerMap = {};
        if (inst.map) {
          try { inst.map.remove(); } catch (_) {}
        }
        delete instances[containerId];
      }
    } else {
      Object.keys(instances).forEach(function (k) {
        destroy(k);
      });
    }
  }

  // Listen on bus for node selection to highlight marker in 3D
  if (typeof bus !== 'undefined' && bus.on) {
    bus.on('node-selected', function (nodeId) {
      Object.keys(instances).forEach(function (k) {
        var inst = instances[k];
        if (inst && inst.markerMap && inst.markerMap[nodeId]) {
          var m = inst.markerMap[nodeId];
          try {
            m.togglePopup();
          } catch (_) {}
        }
      });
    });
  }

  return {
    init: init,
    loadSector: loadSector,
    setExaggeration: setExaggeration,
    setCameraPreset: setCameraPreset,
    onResize: onResize,
    destroy: destroy,
    getInstance: getInstance,
    getMap: function (cId) {
      var inst = getInstance(cId);
      return inst ? inst.map : null;
    }
  };
})();
