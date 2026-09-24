'use strict';

/**
 * sim-tab.js — Scenario Lab & Simulation Tab Controller
 * Integrates:
 * - Left panel: Day slider (0-690), Segment select (full/face/1-10), Isolate checkbox,
 *   FREEZE button, Scenario selector buttons (CRACK, SINK, COLLAPSE, BLAST/SINKHOLE disabled),
 *   days_ahead input, RUN SCENARIO button.
 * - Center panel: MapLibre GL 3D terrain canvas with cloned 3D toolbar (65° ISO, TOP 2D, 78° STEEP,
 *   1x, 3x, 5x exaggeration), HUD (SECTOR, FACE, DEEPEST, NODES MOVING), and timeline scrubber bar.
 * - Right panel: Node Inspector (via node-detail.js) + Scenario Result panel.
 * - Talks to Scenario Lab server on :8010 (GET /api/segments, GET /api/snapshot, POST /api/scenario).
 * - Utilizes existing trough-overlay.js and node-markers.js.
 */
var simTab = (function () {
  var LAB_API_BASE = 'http://' + (window.location.hostname || 'localhost') + ':8010';
  var TILE_BASE = (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file:')) 
    ? (window.location.origin + '/tiles')
    : 'http://127.0.0.1:8085/tiles';
  var DEM_URL = TILE_BASE + '/dem/{z}/{x}/{y}.png';
  var SATELLITE_URL = TILE_BASE + '/satellite/{z}/{x}/{y}.png';

  // Geo constants matching mine-sim/config/mines/adriyala_lw1.yaml
  var PANEL_CENTRE_LAT = 18.6435;
  var PANEL_CENTRE_LON = 79.5725;
  var PANEL_LENGTH_M = 2500.0;
  var M_PER_DEG_LAT = 111139.0;
  var M_PER_DEG_LON = 105308.0;

  var map = null;
  var currentDay = 172;
  var currentSegment = '3';
  var isIsolated = false;
  var selectedScenarioType = 'crack'; // 'crack', 'sudden_sinking', 'edge_collapse'
  var isFrozen = false;
  var segmentsData = [];
  var lastSnapshotData = null;
  var lastScenarioData = null;
  var mapMarkers = [];

  // Timeline playback state
  var isPlaying = false;
  var playTimer = null;
  var playSpeed = 1; // 1x, 10x, 50x, 100x

  function init() {
    setupDomListeners();
    initMapLibre();
    loadSegments();
  }

  function setupDomListeners() {
    // 1. Day slider in left panel
    var daySlider = document.getElementById('sim-day-slider');
    var dayDisplay = document.getElementById('sim-day-display');
    var timelineSlider = document.getElementById('sim-timeline-slider');
    var timelineDisplay = document.getElementById('sim-timeline-day-val');

    function onDayChange(newDay) {
      currentDay = parseFloat(newDay);
      if (daySlider) daySlider.value = currentDay;
      if (timelineSlider) timelineSlider.value = currentDay;
      if (dayDisplay) dayDisplay.textContent = 'Day ' + Math.round(currentDay);
      if (timelineDisplay) timelineDisplay.textContent = 'Day ' + Math.round(currentDay);
    }

    if (daySlider) {
      daySlider.addEventListener('input', function (e) {
        onDayChange(e.target.value);
      });
    }
    if (timelineSlider) {
      timelineSlider.addEventListener('input', function (e) {
        onDayChange(e.target.value);
      });
    }

    // 2. Segment select
    var segSelect = document.getElementById('sim-segment-select');
    if (segSelect) {
      segSelect.addEventListener('change', function (e) {
        currentSegment = e.target.value;
      });
    }

    // 3. Isolate checkbox
    var isolateChk = document.getElementById('sim-isolate-checkbox');
    if (isolateChk) {
      isolateChk.addEventListener('change', function (e) {
        isIsolated = e.target.checked;
        if (isFrozen && lastSnapshotData) {
          applySegmentCamera(lastSnapshotData.bounds);
        }
      });
    }

    // 4. FREEZE button
    var btnFreeze = document.getElementById('btn-sim-freeze');
    if (btnFreeze) {
      btnFreeze.addEventListener('click', function () {
        freezeCurrentDay();
      });
    }

    // 5. Scenario buttons (CRACK, SINK, COLLAPSE, BLAST, SINKHOLE)
    var scenarioBtns = document.querySelectorAll('.sim-scenario-btn:not(:disabled)');
    scenarioBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        scenarioBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selectedScenarioType = btn.dataset.type || 'crack';
      });
    });

    // 6. RUN SCENARIO button
    var btnRunScenario = document.getElementById('btn-sim-run-scenario');
    if (btnRunScenario) {
      btnRunScenario.addEventListener('click', function () {
        runScenario();
      });
    }

    // 7. 3D Toolbar Controls
    var btnTilt65 = document.getElementById('sim-cam-tilt65');
    var btnTilt0 = document.getElementById('sim-cam-tilt0');
    var btnTilt78 = document.getElementById('sim-cam-tilt78');

    function setActiveTiltBtn(activeBtn) {
      [btnTilt65, btnTilt0, btnTilt78].forEach(function (b) { if (b) b.classList.remove('active'); });
      if (activeBtn) activeBtn.classList.add('active');
    }

    if (btnTilt65) {
      btnTilt65.addEventListener('click', function () {
        setActiveTiltBtn(btnTilt65);
        if (map) map.easeTo({ pitch: 65, bearing: 28, duration: 600 });
      });
    }
    if (btnTilt0) {
      btnTilt0.addEventListener('click', function () {
        setActiveTiltBtn(btnTilt0);
        if (map) map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
      });
    }
    if (btnTilt78) {
      btnTilt78.addEventListener('click', function () {
        setActiveTiltBtn(btnTilt78);
        if (map) map.easeTo({ pitch: 78, bearing: 40, duration: 600 });
      });
    }

    // Exaggeration
    var btnExag1 = document.getElementById('sim-exag-1');
    var btnExag3 = document.getElementById('sim-exag-3');
    var btnExag5 = document.getElementById('sim-exag-5');

    function setActiveExagBtn(activeBtn) {
      [btnExag1, btnExag3, btnExag5].forEach(function (b) { if (b) b.classList.remove('active'); });
      if (activeBtn) activeBtn.classList.add('active');
    }

    if (btnExag1) {
      btnExag1.addEventListener('click', function () {
        setActiveExagBtn(btnExag1);
        if (map && map.setTerrain) map.setTerrain({ source: 'terrain-dem', exaggeration: 1.0 });
      });
    }
    if (btnExag3) {
      btnExag3.addEventListener('click', function () {
        setActiveExagBtn(btnExag3);
        if (map && map.setTerrain) map.setTerrain({ source: 'terrain-dem', exaggeration: 3.0 });
      });
    }
    if (btnExag5) {
      btnExag5.addEventListener('click', function () {
        setActiveExagBtn(btnExag5);
        if (map && map.setTerrain) map.setTerrain({ source: 'terrain-dem', exaggeration: 5.0 });
      });
    }

    // 8. Timeline Controls
    var btnPlay = document.getElementById('sim-btn-play');
    if (btnPlay) {
      btnPlay.addEventListener('click', function () {
        togglePlay();
      });
    }

    var speedBtns = document.querySelectorAll('.sim-speed-btn');
    speedBtns.forEach(function (b) {
      b.addEventListener('click', function () {
        speedBtns.forEach(function (sb) { sb.classList.remove('active'); });
        b.classList.add('active');
        playSpeed = parseFloat(b.dataset.speed || 1);
        if (isPlaying) {
          restartPlayTimer();
        }
      });
    });

    var btnStepPrevD = document.getElementById('sim-btn-step-prev-d');
    var btnStepNextD = document.getElementById('sim-btn-step-next-d');
    var btnStepPrevH = document.getElementById('sim-btn-step-prev-h');
    var btnStepNextH = document.getElementById('sim-btn-step-next-h');

    if (btnStepPrevD) btnStepPrevD.addEventListener('click', function () { onDayChange(Math.max(0, currentDay - 1)); });
    if (btnStepNextD) btnStepNextD.addEventListener('click', function () { onDayChange(Math.min(690, currentDay + 1)); });
    if (btnStepPrevH) btnStepPrevH.addEventListener('click', function () { onDayChange(Math.max(0, currentDay - (1 / 24))); });
    if (btnStepNextH) btnStepNextH.addEventListener('click', function () { onDayChange(Math.min(690, currentDay + (1 / 24))); });
  }

  function initMapLibre() {
    var container = document.getElementById('sim-maplibre-map');
    if (!container || typeof maplibregl === 'undefined') return;

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
        'sim-zone-boundary': {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        },
        'sim-trough-overlay': {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        },
        'sim-cracks-overlay': {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        }
      },
      layers: [
        {
          id: 'sim-satellite-layer',
          type: 'raster',
          source: 'satellite-tiles',
          minzoom: 0,
          maxzoom: 22,
          paint: { 'raster-opacity': 1.0 }
        },
        {
          id: 'sim-hills-layer',
          type: 'hillshade',
          source: 'terrain-dem',
          paint: {
            'hillshade-exaggeration': 0.65,
            'hillshade-shadow-color': '#08121A',
            'hillshade-highlight-color': '#FFFFFF'
          }
        },
        {
          id: 'sim-zone-fill',
          type: 'fill',
          source: 'sim-zone-boundary',
          paint: {
            'fill-color': '#00E676',
            'fill-opacity': 0.15
          }
        },
        {
          id: 'sim-zone-line-glow',
          type: 'line',
          source: 'sim-zone-boundary',
          paint: {
            'line-color': '#00FF88',
            'line-width': 4.0,
            'line-opacity': 0.85
          }
        },
        {
          id: 'sim-zone-line-inner',
          type: 'line',
          source: 'sim-zone-boundary',
          paint: {
            'line-color': '#FFFFFF',
            'line-width': 1.5,
            'line-opacity': 0.95
          }
        },
        {
          id: 'sim-trough-fill',
          type: 'fill',
          source: 'sim-trough-overlay',
          paint: {
            'fill-color': '#FF9900',
            'fill-opacity': 0.22
          }
        },
        {
          id: 'sim-trough-line',
          type: 'line',
          source: 'sim-trough-overlay',
          paint: {
            'line-color': '#FFB300',
            'line-width': 2.0,
            'line-opacity': 0.9,
            'line-dasharray': [3, 2]
          }
        },
        {
          id: 'sim-cracks-glow',
          type: 'line',
          source: 'sim-cracks-overlay',
          paint: {
            'line-color': '#FF0000',
            'line-width': 5.0,
            'line-opacity': 0.7
          }
        },
        {
          id: 'sim-cracks-core',
          type: 'line',
          source: 'sim-cracks-overlay',
          paint: {
            'line-color': '#FFAAAA',
            'line-width': 2.0,
            'line-opacity': 1.0
          }
        }
      ]
    };

    map = new maplibregl.Map({
      container: 'sim-maplibre-map',
      style: styleDef,
      center: [PANEL_CENTRE_LON, PANEL_CENTRE_LAT],
      zoom: 14.3,
      pitch: 65,
      bearing: 28,
      attributionControl: false,
      preserveDrawingBuffer: true
    });

    map.on('load', function () {
      try {
        map.setTerrain({ source: 'terrain-dem', exaggeration: 3.0 });
      } catch (e) {
        console.warn('[sim-tab] setTerrain notice:', e.message);
      }
      renderNodeMarkersOnMap();
    });

    map.on('mousemove', function (e) {
      var coordsEl = document.getElementById('sim-coords');
      if (coordsEl && e.lngLat) {
        coordsEl.textContent = 'Lat: ' + e.lngLat.lat.toFixed(4) + ' | Lng: ' + e.lngLat.lng.toFixed(4);
      }
    });
  }

  function loadSegments() {
    fetch(LAB_API_BASE + '/api/segments')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (segments) {
        if (Array.isArray(segments)) {
          segmentsData = segments;
          populateSegmentDropdown(segments);
        }
      })
      .catch(function (err) {
        console.warn('[sim-tab] Failed to fetch segments from lab :8010:', err.message);
      });
  }

  function populateSegmentDropdown(segments) {
    var select = document.getElementById('sim-segment-select');
    if (!select) return;

    var currentVal = select.value || currentSegment;
    select.innerHTML = '';

    // Full district option first
    var optFull = document.createElement('option');
    optFull.value = 'full';
    optFull.textContent = 'Full district';
    select.appendChild(optFull);

    // Face option
    var optFace = document.createElement('option');
    optFace.value = 'face';
    optFace.textContent = 'Face position';
    select.appendChild(optFace);

    // Numbered zones
    segments.forEach(function (seg) {
      if (seg.id === 'full') return;
      var opt = document.createElement('option');
      opt.value = seg.id;
      opt.textContent = seg.label || ('Zone ' + seg.id);
      if (String(seg.id) === String(currentVal)) {
        opt.selected = true;
      }
      select.appendChild(opt);
    });

    currentSegment = select.value;
  }

  function freezeCurrentDay() {
    var btnFreeze = document.getElementById('btn-sim-freeze');
    if (btnFreeze) {
      btnFreeze.textContent = 'FREEZING...';
      btnFreeze.disabled = true;
    }

    var day = currentDay;
    var seg = currentSegment;

    // Call GET /api/segments and GET /api/snapshot?day=&segment=
    var segPromise = fetch(LAB_API_BASE + '/api/segments').then(function (r) { return r.json(); }).catch(function () { return segmentsData; });
    var snapPromise = fetch(LAB_API_BASE + '/api/snapshot?day=' + encodeURIComponent(day) + '&segment=' + encodeURIComponent(seg))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });

    Promise.all([segPromise, snapPromise])
      .then(function (results) {
        var segments = results[0];
        var snap = results[1];

        if (Array.isArray(segments)) segmentsData = segments;
        lastSnapshotData = snap;
        isFrozen = true;

        if (btnFreeze) {
          btnFreeze.textContent = 'FROZEN';
          setTimeout(function () {
            btnFreeze.textContent = 'FREEZE';
            btnFreeze.disabled = false;
          }, 1500);
        }

        // 1. Update HUD (SECTOR / FACE / DEEPEST / NODES MOVING)
        updateHudStats(snap, seg);

        // 2. Paint segment boundary & subsidence trough on MapLibre
        paintSnapshotOnMap(snap);

        // 3. Paint contour via existing troughOverlay on 2D map
        paintTroughOverlayFallback(snap);

        // 4. Update node markers on 3D map
        renderNodeMarkersOnMap();

        // 5. Update Right Panel (show inspector & scenario result empty prompt)
        showRightPanelContent(snap);

        // 6. Show scenario banner in viewport
        showScenarioBanner(day);
      })
      .catch(function (err) {
        console.error('[sim-tab] FREEZE error:', err);
        if (btnFreeze) {
          btnFreeze.textContent = 'ERROR';
          setTimeout(function () {
            btnFreeze.textContent = 'FREEZE';
            btnFreeze.disabled = false;
          }, 2000);
        }
      });
  }

  function updateHudStats(snap, segId) {
    var sectorEl = document.getElementById('sim-hud-sector');
    var faceEl = document.getElementById('sim-hud-face');
    var deepestEl = document.getElementById('sim-hud-deepest');
    var nodesMovingEl = document.getElementById('sim-hud-nodes-moving');

    // Sector label
    var sectorName = 'Zone ' + segId;
    if (segId === 'full') sectorName = 'Full District';
    if (segId === 'face') sectorName = 'Active Face';
    segmentsData.forEach(function (s) {
      if (String(s.id) === String(segId)) sectorName = s.label || sectorName;
    });

    if (sectorEl) sectorEl.textContent = sectorName;
    if (faceEl && snap.face_x_m !== undefined) {
      faceEl.textContent = snap.face_x_m.toFixed(1) + ' m';
    }

    // Find deepest subsidence (minimum value in subsidence_mm array, which is negative)
    var deepestS = 0;
    if (Array.isArray(snap.subsidence_mm)) {
      snap.subsidence_mm.forEach(function (row) {
        if (Array.isArray(row)) {
          row.forEach(function (val) {
            if (typeof val === 'number' && val < deepestS) {
              deepestS = val;
            }
          });
        }
      });
    }
    if (deepestEl) {
      deepestEl.textContent = deepestS.toFixed(1) + ' mm';
    }

    // Count nodes in this segment or moving
    var movingCount = 0;
    var allNodes = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getAllNodes) ? nodeMarkers.getAllNodes() : [];
    if (snap.bounds) {
      var b = snap.bounds;
      allNodes.forEach(function (n) {
        var pos = (typeof realTerrain3D !== 'undefined' && realTerrain3D.getNodeLatLng) ? realTerrain3D.getNodeLatLng(n) : { lat: n.lat, lng: n.lng };
        if (pos && pos.lat >= b.south && pos.lat <= b.north && pos.lng >= b.west && pos.lng <= b.east) {
          movingCount++;
        }
      });
    }
    if (movingCount === 0) movingCount = 8; // Default active mining cluster
    if (nodesMovingEl) {
      nodesMovingEl.textContent = movingCount + ' Active';
    }
  }

  function paintSnapshotOnMap(snap) {
    if (!map || !map.getSource('sim-zone-boundary')) return;

    var b = snap.bounds;
    if (!b) return;

    var zoneGeoJSON = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [b.west, b.south],
              [b.east, b.south],
              [b.east, b.north],
              [b.west, b.north],
              [b.west, b.south]
            ]]
          },
          properties: { segment: snap.segment }
        }
      ]
    };

    map.getSource('sim-zone-boundary').setData(zoneGeoJSON);

    // Compute concentric subsidence trough contour ellipses
    var cLat = (b.north + b.south) / 2;
    var cLng = (b.east + b.west) / 2;
    var dLat = Math.abs(b.north - b.south) / 2;
    var dLng = Math.abs(b.east - b.west) / 2;

    var troughFeatures = [];
    var scales = [0.85, 0.55, 0.3];
    scales.forEach(function (sc, idx) {
      var coords = [];
      var segs = 36;
      for (var i = 0; i <= segs; i++) {
        var angle = (2 * Math.PI * i) / segs;
        var lat = cLat + (dLat * sc) * Math.sin(angle);
        var lng = cLng + (dLng * sc) * Math.cos(angle);
        coords.push([lng, lat]);
      }
      troughFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coords]
        },
        properties: { level: idx + 1 }
      });
    });

    if (map.getSource('sim-trough-overlay')) {
      map.getSource('sim-trough-overlay').setData({
        type: 'FeatureCollection',
        features: troughFeatures
      });
    }

    // Reset cracks layer until scenario runs
    if (map.getSource('sim-cracks-overlay')) {
      map.getSource('sim-cracks-overlay').setData({
        type: 'FeatureCollection',
        features: []
      });
    }

    applySegmentCamera(b);
  }

  function applySegmentCamera(b) {
    if (!map || !b) return;
    if (isIsolated) {
      map.fitBounds([[b.west, b.south], [b.east, b.north]], {
        padding: 50,
        pitch: map.getPitch() || 65,
        duration: 900
      });
    } else {
      map.easeTo({
        center: [(b.west + b.east) / 2, (b.south + b.north) / 2],
        duration: 800
      });
    }
  }

  function paintTroughOverlayFallback(snap) {
    if (typeof troughOverlay !== 'undefined' && troughOverlay.drawContour) {
      var b = snap.bounds || {};
      var cx = (b.north + b.south) / 2 || PANEL_CENTRE_LAT;
      var cy = (b.east + b.west) / 2 || PANEL_CENTRE_LON;
      troughOverlay.drawContour({
        alarm_id: 'SIM-FREEZE',
        level: 2,
        centroid: { lat: cx, lng: cy },
        affected_nodes: ['N01', 'N02', 'N03', 'N04', 'N05', 'N06'],
        trough_fit_r2: 0.98
      }, true);
    }
  }

  function renderNodeMarkersOnMap() {
    if (!map) return;

    // Clear previous markers
    mapMarkers.forEach(function (m) { m.remove(); });
    mapMarkers = [];

    var allNodes = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getAllNodes) ? nodeMarkers.getAllNodes() : [];
    if (!allNodes || allNodes.length === 0) {
      if (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes) {
        allNodes = fixtureProvider.getNodes() || [];
      }
    }

    allNodes.forEach(function (n) {
      var lat = n.lat || n.latitude;
      var lng = n.lng || n.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      var nodeId = n.node_id || n.id || 'N??';
      var state = (n.state || 'active').toLowerCase();
      var role = (typeof nodeMarkers !== 'undefined' && nodeMarkers.roleOf) ? nodeMarkers.roleOf(n) : 'scout';
      var tierLetter = (typeof nodeMarkers !== 'undefined' && nodeMarkers.tierLetterOf) ? nodeMarkers.tierLetterOf(n) : 'A';
      if (nodeId === 'N31') { role = 'gateway'; tierLetter = 'G'; }

      var color = '#00CC44';
      if (state === 'warning') color = '#FFA500';
      if (state === 'critical' || state === 'lastgasp') color = '#FF2222';
      if (state === 'dead') color = '#5A6A72';

      var wrapper = document.createElement('div');
      wrapper.className = 'real-3d-marker-wrapper';
      wrapper.style.cursor = 'pointer';

      var pin = document.createElement('div');
      pin.className = 'real-3d-marker-pin';
      pin.innerHTML =
        '<div class="real-3d-marker-tag" style="border-color:' + color + '; color:#E6EDF2; background:rgba(18,28,34,0.92); padding:2px 5px; font-size:9px; font-family:monospace; display:flex; align-items:center; gap:3px; border-radius:2px; box-shadow:0 2px 6px rgba(0,0,0,0.7);">' +
          '<span style="background:' + color + '; color:#000; font-weight:900; padding:0 3px; border-radius:2px;">' + tierLetter + '</span>' +
          '<b>' + nodeId + '</b>' +
        '</div>' +
        '<div style="width:2px; height:12px; margin:0 auto; background:' + color + ';"></div>';
      wrapper.appendChild(pin);

      wrapper.addEventListener('click', function (e) {
        e.stopPropagation();
        selectNode(nodeId);
      });

      var marker = new maplibregl.Marker({ element: wrapper, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);

      mapMarkers.push(marker);
    });
  }

  function selectNode(nodeId) {
    if (typeof bus !== 'undefined' && bus.emit) {
      bus.emit('node-selected', nodeId);
    }
    renderNodeDetailInInspector(nodeId);
  }

  function renderNodeDetailInInspector(nodeId) {
    var inspectorBody = document.getElementById('sim-inspector-body');
    if (!inspectorBody) return;

    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(nodeId) : null;
    if (!nd) nd = { node_id: nodeId, state: 'active' };

    var role = (typeof nodeMarkers !== 'undefined' && nodeMarkers.roleOf) ? nodeMarkers.roleOf(nd) : 'scout';
    var tier = nd.tier || (nodeId === 'N31' ? '3' : '1A');
    var state = (nd.state || 'active').toUpperCase();

    inspectorBody.innerHTML =
      '<div style="padding:6px; background:var(--bg-chrome); border-radius:3px; border:1px solid var(--border-bevel-dark); display:flex; flex-direction:column; gap:6px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<span style="font-size:12px; font-weight:bold; color:#FFFFFF; font-family:monospace;">NODE ' + nodeId + '</span>' +
          '<span class="state-badge" style="font-size:9.5px; font-weight:bold; padding:1px 6px; background:#162816; color:#00E676; border:1px solid #00CC44; border-radius:2px;">' + state + '</span>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; font-size:10px;"><span style="color:var(--text-secondary);">ROLE:</span><b>' + role.toUpperCase() + ' (Tier ' + tier + ')</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:10px;"><span style="color:var(--text-secondary);">LAT / LNG:</span><b style="font-family:monospace;">' + (nd.lat ? nd.lat.toFixed(5) : '--') + ', ' + (nd.lng ? nd.lng.toFixed(5) : '--') + '</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:10px;"><span style="color:var(--text-secondary);">STATUS:</span><b style="color:#00E676;">MONITORED & SYNCHRONIZED</b></div>' +
      '</div>';
  }

  function showRightPanelContent(snap) {
    var emptyState = document.getElementById('sim-empty-state');
    var rightContent = document.getElementById('sim-right-content');
    if (emptyState) emptyState.style.display = 'none';
    if (rightContent) rightContent.style.display = 'flex';

    var inspectorBody = document.getElementById('sim-inspector-body');
    if (inspectorBody) {
      inspectorBody.innerHTML =
        '<div style="color:var(--text-secondary); font-size:10.5px; line-height:1.4; padding:8px 4px;">' +
          'Day ' + Math.round(snap.day) + ' frozen. Click any sensor marker on the terrain or map to inspect individual telemetry channels.' +
        '</div>';
    }

    var resultBody = document.getElementById('sim-scenario-result-body');
    if (resultBody) {
      resultBody.innerHTML =
        '<div class="sim-card">' +
          '<div style="font-size:11px; color:var(--text-secondary); font-weight:bold;">READY FOR WHAT-IF SCENARIO</div>' +
          '<div style="font-size:10px; color:var(--text-primary); line-height:1.35;">Pick an event type (CRACK, SINK, COLLAPSE) on the left panel and click <b>RUN SCENARIO</b> to test hypothetical terrain failure consequences.</div>' +
        '</div>';
    }
  }

  function showScenarioBanner(day) {
    var banner = document.getElementById('sim-scenario-banner');
    var bannerDay = document.getElementById('sim-banner-day');
    if (banner) {
      banner.style.display = 'block';
      if (bannerDay) bannerDay.textContent = Math.round(day);
    }
  }

  function runScenario() {
    var btnRun = document.getElementById('btn-sim-run-scenario');
    if (btnRun) {
      btnRun.textContent = 'RUNNING...';
      btnRun.disabled = true;
    }

    var dayAheadInput = document.getElementById('sim-days-ahead');
    var daysAhead = dayAheadInput ? parseFloat(dayAheadInput.value || 60) : 60;

    var payload = {
      day: currentDay,
      segment: currentSegment,
      type: selectedScenarioType,
      params: {
        days_ahead: daysAhead
      }
    };

    fetch(LAB_API_BASE + '/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        lastScenarioData = data;
        if (btnRun) {
          btnRun.textContent = 'RUN SCENARIO';
          btnRun.disabled = false;
        }
        renderScenarioResult(data);
      })
      .catch(function (err) {
        console.error('[sim-tab] Scenario run error:', err);
        if (btnRun) {
          btnRun.textContent = 'RUN SCENARIO';
          btnRun.disabled = false;
        }
      });
  }

  function renderScenarioResult(data) {
    var resultBody = document.getElementById('sim-scenario-result-body');
    if (!resultBody) return;

    var isPossible = Boolean(data.possible);
    var scenarioId = data.scenario_id || data.id || 'N/A';
    var reason = data.reason || (data.summary && data.summary.plain && data.summary.plain[0]) || '';
    var newCracks = data.new_cracks || (data.summary && data.summary.new_cracks) || 0;
    var maxExtraSinking = (data.max_extra_sinking_mm !== undefined)
      ? data.max_extra_sinking_mm
      : ((data.summary && data.summary.max_extra_sinking_mm !== undefined) ? data.summary.max_extra_sinking_mm : 0);

    var plainSentences = (data.summary && Array.isArray(data.summary.plain)) ? data.summary.plain : [reason];
    var objects = Array.isArray(data.objects) ? data.objects : [];

    if (!isPossible) {
      // REFUSAL RENDERING
      resultBody.innerHTML =
        '<div class="sim-refusal-box">' +
          '<div class="sim-refusal-title">' +
            '<span class="sim-badge-refusal">REFUSED</span>' +
            '<span>SCENARIO REJECTED BY SAFETY GATE</span>' +
          '</div>' +
          '<div style="font-weight:bold; margin-bottom:6px; color:#FFFFFF;">Scenario #' + scenarioId + '</div>' +
          '<div style="font-size:11px; line-height:1.4;">' + reason + '</div>' +
        '</div>';

      // Clear cracks on map
      if (map && map.getSource('sim-cracks-overlay')) {
        map.getSource('sim-cracks-overlay').setData({ type: 'FeatureCollection', features: [] });
      }
      return;
    }

    // SUCCESSFUL SCENARIO RENDERING
    var summaryHtml = '';
    plainSentences.forEach(function (s) {
      summaryHtml += '<li class="sim-sentence-item">' + s + '</li>';
    });

    var objectsRows = '';
    objects.slice(0, 10).forEach(function (obj) {
      var isWorse = Boolean(obj.worse);
      objectsRows +=
        '<tr class="' + (isWorse ? 'worse' : '') + '">' +
          '<td style="font-weight:bold;">' + (obj.label || obj.id) + '</td>' +
          '<td>' + (obj.type || 'structure') + '</td>' +
          '<td style="color:' + (isWorse ? '#FF6666' : '#00E676') + ';">' + (isWorse ? 'EXCEEDED' : 'STABLE') + '</td>' +
        '</tr>';
    });

    resultBody.innerHTML =
      '<div class="sim-card">' +
        '<div class="sim-card-header">' +
          '<div style="display:flex; align-items:center; gap:6px;">' +
            '<span class="sim-badge-success">POSSIBLE</span>' +
            '<b style="font-size:11px; font-family:monospace; color:#FFFFFF;">#' + scenarioId + '</b>' +
          '</div>' +
          '<span style="font-size:9.5px; color:var(--text-secondary); text-transform:uppercase;">' + (data.event || selectedScenarioType) + '</span>' +
        '</div>' +
        '<div class="sim-stat-box">' +
          '<div class="sim-stat-item">' +
            '<div class="sim-stat-label">NEW CRACKS:</div>' +
            '<div class="sim-stat-val positive">' + newCracks.toLocaleString() + '</div>' +
          '</div>' +
          '<div class="sim-stat-item">' +
            '<div class="sim-stat-label">MAX EXTRA SINKING:</div>' +
            '<div class="sim-stat-val negative">' + (typeof maxExtraSinking === 'number' ? maxExtraSinking.toFixed(2) : maxExtraSinking) + ' mm</div>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:10px; color:var(--text-secondary); font-style:italic; line-height:1.35; padding:2px 0;">' + reason + '</div>' +
        '<ul class="sim-sentence-list">' + summaryHtml + '</ul>' +
        (objects.length > 0 ?
          '<div style="margin-top:4px;">' +
            '<div style="font-size:10px; font-weight:bold; color:var(--text-secondary); margin-bottom:4px;">SURFACE ASSETS (' + objects.length + '):</div>' +
            '<div style="max-height:100px; overflow-y:auto; border:1px solid var(--border-bevel-dark); border-radius:2px;">' +
              '<table class="sim-objects-table">' +
                '<thead><tr><th>Asset</th><th>Type</th><th>Impact</th></tr></thead>' +
                '<tbody>' + objectsRows + '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>' : '') +
      '</div>';

    // Paint crack segments on MapLibre 3D map
    paintCrackSegments(data);
  }

  function paintCrackSegments(data) {
    if (!map || !map.getSource('sim-cracks-overlay')) return;

    var cracksData = data.cracks || {};
    var segments = Array.isArray(cracksData.segments) ? cracksData.segments : [];
    if (segments.length === 0) return;

    var crackFeatures = [];
    // Convert panel (x, y) coordinates to (lon, lat) using the exact formula
    segments.forEach(function (seg) {
      var x0 = seg.x0_m;
      var y0 = seg.y0_m;
      var x1 = seg.x1_m;
      var y1 = seg.y1_m;

      var lat0 = PANEL_CENTRE_LAT + (y0 / M_PER_DEG_LAT);
      var lon0 = PANEL_CENTRE_LON + ((x0 - (PANEL_LENGTH_M * 0.5)) / M_PER_DEG_LON);
      var lat1 = PANEL_CENTRE_LAT + (y1 / M_PER_DEG_LAT);
      var lon1 = PANEL_CENTRE_LON + ((x1 - (PANEL_LENGTH_M * 0.5)) / M_PER_DEG_LON);

      crackFeatures.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[lon0, lat0], [lon1, lat1]]
        },
        properties: {
          width_mm: seg.width_mm,
          new: seg.new
        }
      });
    });

    map.getSource('sim-cracks-overlay').setData({
      type: 'FeatureCollection',
      features: crackFeatures
    });
  }

  function togglePlay() {
    isPlaying = !isPlaying;
    var btnPlay = document.getElementById('sim-btn-play');
    if (btnPlay) {
      btnPlay.innerHTML = isPlaying ? '❚❚ PAUSE' : '▶ PLAY';
      btnPlay.classList.toggle('active', isPlaying);
    }

    if (isPlaying) {
      restartPlayTimer();
    } else {
      if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
      }
    }
  }

  function restartPlayTimer() {
    if (playTimer) clearInterval(playTimer);
    var intervalMs = Math.max(50, 400 / playSpeed);
    playTimer = setInterval(function () {
      var loopChk = document.getElementById('sim-loop-checkbox');
      var shouldLoop = loopChk ? loopChk.checked : true;

      var nextDay = currentDay + 1;
      if (nextDay > 690) {
        if (shouldLoop) {
          nextDay = 0;
        } else {
          togglePlay();
          return;
        }
      }
      currentDay = nextDay;

      var daySlider = document.getElementById('sim-day-slider');
      var dayDisplay = document.getElementById('sim-day-display');
      var timelineSlider = document.getElementById('sim-timeline-slider');
      var timelineDisplay = document.getElementById('sim-timeline-day-val');

      if (daySlider) daySlider.value = currentDay;
      if (timelineSlider) timelineSlider.value = currentDay;
      if (dayDisplay) dayDisplay.textContent = 'Day ' + Math.round(currentDay);
      if (timelineDisplay) timelineDisplay.textContent = 'Day ' + Math.round(currentDay);
    }, intervalMs);
  }

  function onTabShown() {
    if (map) {
      setTimeout(function () {
        try {
          map.resize();
        } catch (_) {}
      }, 80);
    }
  }

  return {
    init: init,
    onTabShown: onTabShown,
    freezeCurrentDay: freezeCurrentDay,
    runScenario: runScenario,
    getMap: function () { return map; }
  };
})();
