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
  var sandboxSession = null;

  // Timeline playback state
  var isPlaying = false;
  var playTimer = null;
  var playSpeed = 1; // 1x, 10x, 50x, 100x

  function init() {
    setupDomListeners();
    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('sim-sandbox-create', function (payload) {
        console.log('[SIM_TAB] Sandbox payload received with ' + (payload && payload.nodes ? payload.nodes.length : 0) + ' cloned nodes:', payload);
        window.__simSandboxPayload = payload;
        handleSandboxCreate(payload);
      });
      bus.on('system-reset', function () {
        if (sandboxSession) {
          console.log('[SIM_TAB] system-reset ignored: sandbox session ' + sandboxSession.id + ' is active and isolated');
          return;
        }
      });
    }
    try {
      initMapLibre();
    } catch (err) {
      console.warn('[sim-tab] initMapLibre caught error:', err);
    }
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

    // Recenter camera to sandbox session bounds
    var btnRecenter = document.getElementById('sim-recenter-btn');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', function () {
        recenterToSessionBounds();
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
        },
        'sim-mesh-links': {
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
        },
        {
          id: 'sim-mesh-links-glow',
          type: 'line',
          source: 'sim-mesh-links',
          paint: {
            'line-color': '#00E676',
            'line-width': 4.0,
            'line-opacity': 0.45
          }
        },
        {
          id: 'sim-mesh-links-core',
          type: 'line',
          source: 'sim-mesh-links',
          paint: {
            'line-color': '#80FFB4',
            'line-width': 1.8,
            'line-opacity': 0.9,
            'line-dasharray': [3, 2]
          }
        }
      ]
    };

    try {
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
        if (sandboxSession && Array.isArray(sandboxSession.nodes)) {
          renderClonedNodeMarkers(sandboxSession.nodes);
          renderMeshLinks(sandboxSession.nodes);
        } else {
          renderNodeMarkersOnMap();
        }
      });

      map.on('mousemove', function (e) {
        var coordsEl = document.getElementById('sim-coords');
        if (coordsEl && e.lngLat) {
          coordsEl.textContent = 'Lat: ' + e.lngLat.lat.toFixed(4) + ' | Lng: ' + e.lngLat.lng.toFixed(4);
        }
      });
    } catch (err) {
      console.warn('[sim-tab] MapLibre initialization failed:', err.message);
    }
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

    // Count nodes in this segment or moving (bulk reads use the sandbox clone)
    var movingCount = 0;
    if (sandboxSession && Array.isArray(sandboxSession.nodes)) {
      movingCount = sandboxSession.nodes.length;
    } else {
      var allNodes = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes) ? (fixtureProvider.getNodes() || []) : [];
      if (snap && snap.bounds) {
        var b = snap.bounds;
        allNodes.forEach(function (n) {
          var pos = (typeof realTerrain3D !== 'undefined' && realTerrain3D.getNodeLatLng) ? realTerrain3D.getNodeLatLng(n) : { lat: n.lat, lng: n.lng };
          if (pos && pos.lat >= b.south && pos.lat <= b.north && pos.lng >= b.west && pos.lng <= b.east) {
            movingCount++;
          }
        });
      }
      if (movingCount === 0) movingCount = 8; // Default active mining cluster
    }
    if (nodesMovingEl) {
      nodesMovingEl.textContent = movingCount + (sandboxSession ? ' Cloned' : ' Active');
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

  function renderNodeMarkersOnMap() {
    if (!map) return;

    if (sandboxSession && Array.isArray(sandboxSession.nodes)) {
      renderClonedNodeMarkers(sandboxSession.nodes);
      return;
    }

    // Clear previous markers
    mapMarkers.forEach(function (m) { m.remove(); });
    mapMarkers = [];

    var allNodes = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes) ? (fixtureProvider.getNodes() || []) : [];

    allNodes.forEach(function (n) {
      var lat = n.lat || n.latitude;
      var lng = n.lng || n.longitude;
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      var nodeId = n.node_id || n.id || 'N??';
      var state = (n.state || 'active').toLowerCase();
      var role = n.role || n.node_type || (nodeId === 'N31' ? 'gateway' : 'scout');
      var tierLetter = n.tier ? String(n.tier).charAt(0) : (nodeId === 'N31' ? 'G' : 'A');
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

  function renderClonedNodeMarkers(clonedNodes) {
    if (!map) return;

    // Clear previous markers
    mapMarkers.forEach(function (m) { m.remove(); });
    mapMarkers = [];

    if (!Array.isArray(clonedNodes)) return;

    clonedNodes.forEach(function (n) {
      var lat = (typeof n.lat === 'number') ? n.lat : (n.latitude || (Array.isArray(n.pos) ? n.pos[0] : null));
      var lng = (typeof n.lng === 'number') ? n.lng : (n.longitude || (Array.isArray(n.pos) ? n.pos[1] : null));
      if (typeof lat !== 'number' || typeof lng !== 'number') return;

      var nodeId = n.node_id || n.id || 'N??';
      var state = (n.state || 'active').toLowerCase();
      var role = n.role || n.node_type || (nodeId === 'N31' ? 'gateway' : 'scout');
      var tierLetter = n.tier ? String(n.tier).charAt(0) : (nodeId === 'N31' ? 'G' : 'A');
      if (nodeId === 'N31') { role = 'gateway'; tierLetter = 'G'; }

      var color = '#00CC44';
      if (state === 'warning') color = '#FFA500';
      if (state === 'critical' || state === 'lastgasp') color = '#FF2222';
      if (state === 'dead') color = '#5A6A72';

      var wrapper = document.createElement('div');
      wrapper.className = 'real-3d-marker-wrapper sim-cloned-marker';
      wrapper.setAttribute('data-node-id', nodeId);
      wrapper.style.cursor = 'pointer';

      var pin = document.createElement('div');
      pin.className = 'real-3d-marker-pin';
      pin.innerHTML =
        '<div class="real-3d-marker-tag" style="border-color:' + color + '; color:#E6EDF2; background:rgba(18,28,34,0.95); padding:2px 5px; font-size:9px; font-family:monospace; display:flex; align-items:center; gap:3px; border-radius:2px; box-shadow:0 2px 6px rgba(0,0,0,0.7);">' +
          '<span style="background:' + color + '; color:#000; font-weight:900; padding:0 3px; border-radius:2px;">' + tierLetter + '</span>' +
          '<b>' + nodeId + '</b>' +
          '<span style="color:#00E676; font-size:8px;" title="Cloned Sandbox Entity">⚲</span>' +
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

    var nd = null;
    if (sandboxSession && Array.isArray(sandboxSession.nodes)) {
      nd = sandboxSession.nodes.find(function (n) { return (n.node_id || n.id) === nodeId; });
    }
    // Only getNodeData (single-node inspect) may remain as fallback for live node metadata
    if (!nd && typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) {
      nd = nodeMarkers.getNodeData(nodeId);
    }
    if (!nd) nd = { node_id: nodeId, state: 'active' };

    var role = nd.role || nd.node_type || (nodeId === 'N31' ? 'gateway' : 'scout');
    var tier = nd.tier || (nodeId === 'N31' ? '3' : '1A');
    var state = (nd.state || 'active').toUpperCase();
    var lat = (typeof nd.lat === 'number') ? nd.lat : (nd.latitude || (Array.isArray(nd.pos) ? nd.pos[0] : null));
    var lng = (typeof nd.lng === 'number') ? nd.lng : (nd.longitude || (Array.isArray(nd.pos) ? nd.pos[1] : null));

    inspectorBody.innerHTML =
      '<div style="padding:6px; background:var(--bg-chrome); border-radius:3px; border:1px solid var(--border-bevel-dark); display:flex; flex-direction:column; gap:6px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<span style="font-size:12px; font-weight:bold; color:#FFFFFF; font-family:monospace;">NODE ' + nodeId + (sandboxSession ? ' (CLONED)' : '') + '</span>' +
          '<span class="state-badge" style="font-size:9.5px; font-weight:bold; padding:1px 6px; background:#162816; color:#00E676; border:1px solid #00CC44; border-radius:2px;">' + state + '</span>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; font-size:10px;"><span style="color:var(--text-secondary);">ROLE:</span><b>' + role.toUpperCase() + ' (Tier ' + tier + ')</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:10px;"><span style="color:var(--text-secondary);">LAT / LNG:</span><b style="font-family:monospace;">' + (lat ? lat.toFixed(5) : '--') + ', ' + (lng ? lng.toFixed(5) : '--') + '</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:10px;"><span style="color:var(--text-secondary);">STATUS:</span><b style="color:#00E676;">' + (sandboxSession ? 'SANDBOX CLONE &bull; ISOLATED' : 'MONITORED & SYNCHRONIZED') + '</b></div>' +
        (sandboxSession ? '<div style="display:flex; justify-content:space-between; font-size:9.5px; color:#A4B8C4; padding-top:2px; border-top:1px solid rgba(255,255,255,0.06); font-family:monospace;"><span>SESSION:</span><span>' + sandboxSession.id + '</span></div>' : '') +
      '</div>';
  }

  /* --- Sandbox Session & Pipeline Helpers --- */

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function getDistanceMeters(lat1, lon1, lat2, lon2) {
    var dy = (lat2 - lat1) * M_PER_DEG_LAT;
    var dx = (lon2 - lon1) * M_PER_DEG_LON;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function ensureMapReady() {
    return new Promise(function (resolve) {
      if (!map) {
        initMapLibre();
      }
      if (map && map.loaded && map.loaded()) {
        return resolve();
      }
      if (map && map.isStyleLoaded && map.isStyleLoaded()) {
        return resolve();
      }
      if (map) {
        map.once('load', function () { resolve(); });
        setTimeout(resolve, 800);
      } else {
        resolve();
      }
    });
  }

  function getSelectionBounds(payload) {
    var s = null, n = null, w = null, e = null;

    if (payload.lngRange && payload.latRange && payload.lngRange.length === 2 && payload.latRange.length === 2) {
      w = Math.min(payload.lngRange[0], payload.lngRange[1]);
      e = Math.max(payload.lngRange[0], payload.lngRange[1]);
      s = Math.min(payload.latRange[0], payload.latRange[1]);
      n = Math.max(payload.latRange[0], payload.latRange[1]);
    } else if (Array.isArray(payload.bounds) && payload.bounds.length === 2 && Array.isArray(payload.bounds[0])) {
      s = Math.min(payload.bounds[0][0], payload.bounds[1][0]);
      n = Math.max(payload.bounds[0][0], payload.bounds[1][0]);
      w = Math.min(payload.bounds[0][1], payload.bounds[1][1]);
      e = Math.max(payload.bounds[0][1], payload.bounds[1][1]);
    } else if (payload.bounds && typeof payload.bounds === 'object' && 'south' in payload.bounds) {
      s = payload.bounds.south;
      n = payload.bounds.north;
      w = payload.bounds.west;
      e = payload.bounds.east;
    }

    if ((s == null || !isFinite(s)) && Array.isArray(payload.nodes) && payload.nodes.length > 0) {
      var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      var count = 0;
      payload.nodes.forEach(function (nd) {
        var lat = (typeof nd.lat === 'number') ? nd.lat : (nd.latitude || (Array.isArray(nd.pos) ? nd.pos[0] : null));
        var lng = (typeof nd.lng === 'number') ? nd.lng : (nd.longitude || (Array.isArray(nd.pos) ? nd.pos[1] : null));
        if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)) {
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          count++;
        }
      });
      if (count > 0) {
        s = minLat; n = maxLat; w = minLng; e = maxLng;
      }
    }

    if (s == null || !isFinite(s) || n == null || !isFinite(n) || w == null || !isFinite(w) || e == null || !isFinite(e)) {
      return {
        south: PANEL_CENTRE_LAT - 0.005,
        north: PANEL_CENTRE_LAT + 0.005,
        west: PANEL_CENTRE_LON - 0.008,
        east: PANEL_CENTRE_LON + 0.008
      };
    }

    if (Math.abs(n - s) < 0.001) {
      s -= 0.0015;
      n += 0.0015;
    }
    if (Math.abs(e - w) < 0.001) {
      w -= 0.0015;
      e += 0.0015;
    }

    return { south: s, north: n, west: w, east: e };
  }

  function fitSimCameraToBounds(bounds) {
    if (!map || !bounds) return;
    try {
      map.fitBounds(
        [[bounds.west, bounds.south], [bounds.east, bounds.north]],
        {
          padding: 60,
          pitch: map.getPitch() || 65,
          bearing: map.getBearing() || 28,
          duration: 900
        }
      );
    } catch (err) {
      console.warn('[sim-tab] Camera fit notice:', err.message);
    }
  }

  function recenterToSessionBounds() {
    if (!map) return null;
    var bounds = null;
    if (sandboxSession) {
      if (sandboxSession.bounds) {
        bounds = sandboxSession.bounds;
      } else if (sandboxSession.selection) {
        bounds = getSelectionBounds(sandboxSession.selection);
      } else if (Array.isArray(sandboxSession.nodes) && sandboxSession.nodes.length > 0) {
        bounds = getSelectionBounds({ nodes: sandboxSession.nodes });
      }
    }
    if (!bounds && lastSnapshotData && lastSnapshotData.bounds) {
      bounds = lastSnapshotData.bounds;
    }
    if (!bounds) {
      bounds = {
        south: PANEL_CENTRE_LAT - 0.005,
        north: PANEL_CENTRE_LAT + 0.005,
        west: PANEL_CENTRE_LON - 0.008,
        east: PANEL_CENTRE_LON + 0.008
      };
    }
    console.log('[SIM_TAB] Recentering sim camera to session bounds:', bounds);
    fitSimCameraToBounds(bounds);
    return bounds;
  }


  function renderSessionChip(session) {
    var container = document.getElementById('sim-session-chip-container');
    if (!container) {
      var toolbar = document.querySelector('.sim-toolbar');
      if (toolbar) {
        container = document.createElement('div');
        container.id = 'sim-session-chip-container';
        container.style.display = 'inline-flex';
        container.style.alignItems = 'center';
        container.style.marginLeft = '8px';
        toolbar.appendChild(container);
      }
    }
    if (!container) return;

    var count = Array.isArray(session.nodes) ? session.nodes.length : 0;
    container.innerHTML =
      '<div id="sim-session-chip" class="sim-session-chip" title="Active Isolated Sandbox Session ' + session.id + '">' +
        '<span class="sim-chip-dot"></span>' +
        '<span class="sim-chip-text">SANDBOX: ' + session.id + ' (' + count + ' node' + (count === 1 ? '' : 's') + ')</span>' +
      '</div>';
  }

  function renderSandboxBanner(session) {
    var banner = document.getElementById('sim-sandbox-banner');
    if (!banner) {
      var canvasWrap = document.querySelector('.sim-canvas-wrap');
      if (canvasWrap) {
        banner = document.createElement('div');
        banner.id = 'sim-sandbox-banner';
        banner.className = 'sim-sandbox-banner';
        canvasWrap.appendChild(banner);
      }
    }
    if (!banner) return;

    var count = Array.isArray(session.nodes) ? session.nodes.length : 0;
    var dayVal = Math.round(session.day != null ? session.day : currentDay);

    banner.innerHTML =
      '<span class="sim-sandbox-pulse-dot"></span>' +
      '<span>SANDBOX ACTIVE &bull; SESSION <b id="sim-sandbox-session-id">' + session.id + '</b> &bull; DAY <span id="sim-sandbox-day">' + dayVal + '</span> &bull; <span id="sim-sandbox-nodes-count">' + count + '</span> CLONED NODES</span>';
    banner.style.display = 'flex';

    // Hide scenario banner if present to avoid dual overlapping banners
    var scenarioBanner = document.getElementById('sim-scenario-banner');
    if (scenarioBanner) {
      scenarioBanner.style.display = 'none';
    }
  }

  function showLoadingOverlay() {
    var overlay = document.getElementById('sim-loading-overlay');
    if (!overlay) return;

    overlay.classList.remove('fade-out');
    overlay.style.display = 'flex';

    var stages = overlay.querySelectorAll('.sim-stage-item');
    stages.forEach(function (st) {
      st.classList.remove('active', 'done');
      var icon = st.querySelector('.sim-stage-icon');
      if (icon) icon.textContent = '○';
    });

    var statusText = document.getElementById('sim-loading-status-text');
    if (statusText) statusText.textContent = 'Preparing isolated clone environment...';
  }

  function updateStageStatus(stageKey, status, customText) {
    var overlay = document.getElementById('sim-loading-overlay');
    if (!overlay) return;

    var statusText = document.getElementById('sim-loading-status-text');
    if (statusText && customText) statusText.textContent = customText;

    var items = overlay.querySelectorAll('.sim-stage-item');
    items.forEach(function (el) {
      if (el.dataset.stage === stageKey) {
        el.classList.remove('active', 'done');
        if (status === 'active') {
          el.classList.add('active');
          var icon = el.querySelector('.sim-stage-icon');
          if (icon) icon.textContent = '▶';
        } else if (status === 'done') {
          el.classList.add('done');
          var icon = el.querySelector('.sim-stage-icon');
          if (icon) icon.textContent = '✓';
        }
      }
    });
  }

  function hideLoadingOverlay() {
    var overlay = document.getElementById('sim-loading-overlay');
    if (!overlay) return;

    overlay.classList.add('fade-out');
    setTimeout(function () {
      overlay.style.display = 'none';
      overlay.classList.remove('fade-out');
    }, 280);
  }

  async function fetchAndPaintGeology(payload, bounds) {
    var seg = currentSegment || '3';
    var day = currentDay || 172;

    var snapData = null;
    try {
      var res = await fetch(LAB_API_BASE + '/api/snapshot?day=' + encodeURIComponent(day) + '&segment=' + encodeURIComponent(seg));
      if (res.ok) {
        snapData = await res.json();
      }
    } catch (e) {
      console.warn('[sim-tab] Snapshot fetch warning:', e.message);
    }

    if (!snapData) {
      snapData = {
        day: day,
        segment: seg,
        bounds: bounds,
        subsidence_mm: [[-50, -120], [-180, -40]]
      };
    }

    lastSnapshotData = snapData;
    isFrozen = true;

    // The sandbox paints the USER'S selection box — not the lab's segment
    // bounds. Override so the zone/trough align with the fitted camera.
    if (bounds && bounds.south != null) {
      lastSnapshotData.bounds = bounds;
    }

    // Paint boundary & trough contours from snapshot (using selection bounds if available)
    paintSnapshotOnMap(snapData, bounds);

    // Update HUD stats
    updateHudStats(snapData, seg);

    // Fetch and paint cracks from :8010
    try {
      var crackRes = await fetch(LAB_API_BASE + '/api/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          day: day,
          segment: seg,
          type: 'crack',
          params: { days_ahead: 60 }
        })
      });
      if (crackRes.ok) {
        var crackData = await crackRes.json();
        paintCrackSegments(crackData);
      }
    } catch (err) {
      console.warn('[sim-tab] Cracks fetch warning:', err.message);
    }
  }

  function buildMeshLinksGeoJSON(nodes) {
    var features = [];
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return { type: 'FeatureCollection', features: features };
    }

    var GATEWAY_LAT = 18.6371097;
    var GATEWAY_LNG = 79.580332;
    var GATEWAY_ID = 'N31';

    function getNodeCoord(n) {
      var lat = (typeof n.lat === 'number') ? n.lat : (n.latitude || (Array.isArray(n.pos) ? n.pos[0] : null));
      var lng = (typeof n.lng === 'number') ? n.lng : (n.longitude || (Array.isArray(n.pos) ? n.pos[1] : null));
      if (typeof lat === 'number' && typeof lng === 'number') {
        return { lat: lat, lng: lng };
      }
      return null;
    }

    var validNodes = [];
    nodes.forEach(function (n) {
      var pos = getNodeCoord(n);
      if (pos) {
        validNodes.push({
          id: n.node_id || n.id || 'N??',
          lat: pos.lat,
          lng: pos.lng,
          node: n
        });
      }
    });

    if (validNodes.length === 0) {
      return { type: 'FeatureCollection', features: features };
    }

    var connectedPairs = new Set();
    var nodeLinkCount = {};
    validNodes.forEach(function (vn) { nodeLinkCount[vn.id] = 0; });

    // 1. Neighbour topology: connect each node to its closest 2 neighbours within 350m
    validNodes.forEach(function (nA) {
      var distances = [];
      validNodes.forEach(function (nB) {
        if (nA.id === nB.id) return;
        var dist = getDistanceMeters(nA.lat, nA.lng, nB.lat, nB.lng);
        distances.push({ node: nB, dist: dist });
      });
      distances.sort(function (a, b) { return a.dist - b.dist; });

      var maxNeighbors = Math.min(2, distances.length);
      for (var i = 0; i < maxNeighbors; i++) {
        var target = distances[i];
        if (target.dist <= 350) {
          var pairKey = [nA.id, target.node.id].sort().join('--');
          if (!connectedPairs.has(pairKey)) {
            connectedPairs.add(pairKey);
            nodeLinkCount[nA.id]++;
            nodeLinkCount[target.node.id]++;
            features.push({
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [nA.lng, nA.lat],
                  [target.node.lng, target.node.lat]
                ]
              },
              properties: {
                type: 'mesh',
                from: nA.id,
                to: target.node.id,
                distance_m: Math.round(target.dist)
              }
            });
          }
        }
      }
    });

    // Gateway coordinates
    var gwInClones = validNodes.find(function (vn) { return vn.id === GATEWAY_ID; });
    var gwPos = gwInClones ? { lat: gwInClones.lat, lng: gwInClones.lng } : { lat: GATEWAY_LAT, lng: GATEWAY_LNG };

    // 2. Fallback: line to gateway N31 for any node with 0 mesh links, and uplink from closest node in cluster
    var closestToGw = null;
    var minGwDist = Infinity;

    validNodes.forEach(function (vn) {
      if (vn.id === GATEWAY_ID) return;
      var dGw = getDistanceMeters(vn.lat, vn.lng, gwPos.lat, gwPos.lng);
      if (dGw < minGwDist) {
        minGwDist = dGw;
        closestToGw = vn;
      }

      // Fallback if isolated (0 mesh connections)
      if (nodeLinkCount[vn.id] === 0) {
        var fallbackKey = [vn.id, GATEWAY_ID].sort().join('--');
        if (!connectedPairs.has(fallbackKey)) {
          connectedPairs.add(fallbackKey);
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: [
                [vn.lng, vn.lat],
                [gwPos.lng, gwPos.lat]
              ]
            },
            properties: {
              type: 'gateway-fallback',
              from: vn.id,
              to: GATEWAY_ID,
              distance_m: Math.round(dGw)
            }
          });
        }
      }
    });

    // Uplink connection to gateway N31
    if (closestToGw) {
      var gwKey = [closestToGw.id, GATEWAY_ID].sort().join('--');
      if (!connectedPairs.has(gwKey)) {
        connectedPairs.add(gwKey);
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: [
              [closestToGw.lng, closestToGw.lat],
              [gwPos.lng, gwPos.lat]
            ]
          },
          properties: {
            type: 'gateway-uplink',
            from: closestToGw.id,
            to: GATEWAY_ID,
            distance_m: Math.round(minGwDist)
          }
        });
      }
    }

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  function renderMeshLinks(clonedNodes) {
    if (!map) return;
    var geoJSON = buildMeshLinksGeoJSON(clonedNodes);

    if (map.getSource('sim-mesh-links')) {
      map.getSource('sim-mesh-links').setData(geoJSON);
    } else {
      try {
        map.addSource('sim-mesh-links', {
          type: 'geojson',
          data: geoJSON
        });
        map.addLayer({
          id: 'sim-mesh-links-glow',
          type: 'line',
          source: 'sim-mesh-links',
          paint: {
            'line-color': '#00E676',
            'line-width': 4.0,
            'line-opacity': 0.45
          }
        });
        map.addLayer({
          id: 'sim-mesh-links-core',
          type: 'line',
          source: 'sim-mesh-links',
          paint: {
            'line-color': '#80FFB4',
            'line-width': 1.8,
            'line-opacity': 0.9,
            'line-dasharray': [3, 2]
          }
        });
      } catch (err) {
        console.warn('[sim-tab] Error adding mesh links layer:', err.message);
      }
    }
  }

  function showSandboxRightPanel(session) {
    var emptyState = document.getElementById('sim-empty-state');
    var rightContent = document.getElementById('sim-right-content');
    if (emptyState) emptyState.style.display = 'none';
    if (rightContent) rightContent.style.display = 'flex';

    var inspectorBody = document.getElementById('sim-inspector-body');
    if (inspectorBody) {
      inspectorBody.innerHTML =
        '<div style="padding:8px; background:var(--bg-chrome); border-radius:3px; border:1px solid #1B445A; display:flex; flex-direction:column; gap:6px;">' +
          '<div style="display:flex; justify-content:space-between; align-items:center;">' +
            '<span style="font-size:11px; font-weight:bold; color:#00FF88; font-family:monospace;">SANDBOX CLONE ACTIVE</span>' +
            '<span class="sim-badge-success">' + session.id + '</span>' +
          '</div>' +
          '<div style="font-size:10px; color:var(--text-secondary); line-height:1.4;">' +
            'Deep-cloned snapshot of <b>' + session.nodes.length + ' node records</b> at Day <b>' + Math.round(session.day) + '</b>. ' +
            'Click any sensor pin on the terrain to inspect isolated channel readings.' +
          '</div>' +
        '</div>';
    }

    var resultBody = document.getElementById('sim-scenario-result-body');
    if (resultBody) {
      resultBody.innerHTML =
        '<div class="sim-card">' +
          '<div class="sim-card-header">' +
            '<div style="font-size:11px; color:#00FF88; font-weight:bold;">SANDBOX ISOLATION VERIFIED</div>' +
            '<span class="sim-badge-success">OFF-LINE COPY</span>' +
          '</div>' +
          '<div style="font-size:10.5px; color:var(--text-primary); line-height:1.4;">' +
            'This simulation runs in an isolated sandbox. Events injected here will <b>NOT</b> alter active sensor thresholds or alert logs on the live dashboard.' +
          '</div>' +
        '</div>';
    }
  }

  async function handleSandboxCreate(payload) {
    console.log('[SIM_TAB] Starting sandbox initialization pipeline...');

    // Switch to Sim Tab view if not active
    var tabSim = document.getElementById('tab-sim');
    if (tabSim && tabSim.style.display === 'none') {
      var simTabBtn = document.querySelector('#tab-bar .tab-btn[data-tab="sim"]');
      if (simTabBtn) {
        simTabBtn.click();
      } else {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-view').forEach(function (v) { v.style.display = 'none'; });
        tabSim.style.display = 'flex';
        onTabShown();
      }
    }

    showLoadingOverlay();

    // Stage 1: Cloning
    updateStageStatus('cloning', 'active', 'Cloning selection and node records...');
    await sleep(200);

    var sessionId = 'SBX-' + (payload && payload.id && payload.id !== 'CUSTOM' ? payload.id : 'ADR') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    var clonedNodes = (payload && Array.isArray(payload.nodes))
      ? JSON.parse(JSON.stringify(payload.nodes))
      : [];

    sandboxSession = {
      id: sessionId,
      selection: JSON.parse(JSON.stringify(payload || {})),
      day: currentDay,
      nodes: clonedNodes,
      createdAt: Date.now()
    };
    window.__simSandboxSession = sandboxSession;

    renderSessionChip(sandboxSession);
    renderSandboxBanner(sandboxSession);
    updateStageStatus('cloning', 'done');

    // Stage 2: Camera
    updateStageStatus('camera', 'active', 'Framing MapLibre 3D camera to selection bounds...');
    await ensureMapReady();
    var bounds = getSelectionBounds(payload);
    sandboxSession.bounds = bounds;
    fitSimCameraToBounds(bounds);
    await sleep(250);
    updateStageStatus('camera', 'done');

    // Stage 3: Trough
    updateStageStatus('trough', 'active', 'Pulling :8010 subsidence trough & crack models...');
    await fetchAndPaintGeology(payload, bounds);
    await sleep(220);
    updateStageStatus('trough', 'done');

    // Stage 4: Nodes
    updateStageStatus('nodes', 'active', 'Rendering markers from ' + sandboxSession.nodes.length + ' cloned nodes...');
    renderClonedNodeMarkers(sandboxSession.nodes);
    await sleep(200);
    updateStageStatus('nodes', 'done');

    // Stage 5: Links
    updateStageStatus('links', 'active', 'Synthesizing mesh links & gateway N31 topology...');
    renderMeshLinks(sandboxSession.nodes);
    await sleep(240);
    updateStageStatus('links', 'done');

    // Final finish
    await sleep(300);
    hideLoadingOverlay();
    showSandboxRightPanel(sandboxSession);

    console.log('[SIM_TAB] Sandbox pipeline complete for session ' + sandboxSession.id);

    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('sim-sandbox-loaded', sandboxSession);
    }
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
    getMap: function () { return map; },
    getSandboxSession: function () { return sandboxSession; },
    handleSandboxCreate: handleSandboxCreate,
    recenterToSessionBounds: recenterToSessionBounds
  };
})();

if (typeof window !== 'undefined') {
  window.simTab = simTab;
}
