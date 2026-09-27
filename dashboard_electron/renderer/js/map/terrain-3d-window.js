'use strict';

/**
 * Terrain 3D Window Controller
 * Manages the floating 3D workstation window featuring Real 3D Satellite Terrain (MapLibre 3D DEM),
 * persistent sensor markers, 3D tilt presets, and a Google Earth 3D redirect icon button.
 */
var terrain3DWindow = (function () {

  // Single source for "all node records, whatever mode we are in". nodeMarkers
  // holds the live set (with x/y and lat/lon) once nodes-loaded has fired.
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
  var windowEl = null;
  var currentSector = null;
  var isMinimized = false;
  var isMaximized = false;
  var realTerrainInitialized = false;

  // Dragging state
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;

  function init() {
    if (document.getElementById('pane-3d-view')) {
      console.log('[TERRAIN_3D_WINDOW] Integrated into Map Workspace Tabs');
      return;
    }
    createWindowDOM();
    setupEventHandlers();

    // Listen to sector selection events from panel-grid or area-select-3d
    if (typeof bus !== 'undefined') {
      bus.on('3d-view-requested', function (sectorData) {
        openSector(sectorData);
      });
    }

    console.log('[TERRAIN_3D_WINDOW] Initialized Real 3D Satellite Terrain Workstation');
  }

  function createWindowDOM() {
    var parent = document.getElementById('tab-map') || document.body;
    if (document.getElementById('terrain-3d-window')) return;

    windowEl = document.createElement('div');
    windowEl.id = 'terrain-3d-window';
    windowEl.className = 'terrain-3d-window';

    windowEl.innerHTML = 
      '<!-- Window Header Bar -->' +
      '<div class="terrain-win-header" id="terrain-win-header">' +
        '<div class="terrain-win-title">' +
          '<span class="terrain-coords-text" id="terrain-win-coords" style="margin-left:0;">Lat: --, Lng: --</span>' +
        '</div>' +
        '<div class="terrain-win-actions">' +
          '<button class="terrain-win-btn" id="btn-win-minimize" title="Minimize to dock">_</button>' +
          '<button class="terrain-win-btn" id="btn-win-maximize" title="Maximize / Restore">□</button>' +
          '<button class="terrain-win-btn" id="btn-win-popout" title="Pop Out to Standalone Window">↗</button>' +
          '<button class="terrain-win-btn close-btn" id="btn-win-close" title="Close Window">×</button>' +
        '</div>' +
      '</div>' +

      '<!-- Toolbar -->' +
      '<div class="terrain-win-toolbar">' +
        '<div class="terrain-controls-group" id="terrain-real3d-controls">' +
          '<span style="font-size:9.5px; color:#94A3B8; font-weight:bold;">3D TILT:</span>' +
          '<button class="terrain-tool-btn active" id="btn-cam-tilt65">65° ISO</button>' +
          '<button class="terrain-tool-btn" id="btn-cam-tilt0">TOP 2D</button>' +
          '<button class="terrain-tool-btn" id="btn-cam-tilt78">78° STEEP</button>' +
          '<span style="width:1px; height:16px; background:#2A3B4A; margin:0 4px;"></span>' +
          // Vertical exaggeration. The terrarium DEM stops at z15 (~4.5 m/px,
          // interpolated from ~30 m SRTM), so a sector's ~34 m of relief is
          // real but reads flat at true scale. These trade fidelity for
          // legibility without touching the underlying elevation data.
          '<span style="font-size:9.5px; color:#94A3B8; font-weight:bold;">VERT EXAG:</span>' +
          '<button class="terrain-tool-btn" id="btn-exag-1">1x</button>' +
          '<button class="terrain-tool-btn active" id="btn-exag-3">3x</button>' +
          '<button class="terrain-tool-btn" id="btn-exag-5">5x</button>' +
          '<span style="width:1px; height:16px; background:#2A3B4A; margin:0 4px;"></span>' +
          '<span style="font-size:9.5px; color:#94A3B8; font-weight:bold;">HEATMAP:</span>' +
          '<select id="terrain-heatmap-mode" style="background:#14222A; color:#D4D8DC; border:1px solid #2E3E4A; border-radius:2px; font-family:Courier New,monospace; font-size:10px; padding:2px 4px; cursor:pointer;">' +
            '<option value="none">None</option>' +
            '<option value="depth">Depth (m)</option>' +
            '<option value="tilt">Tilt (mm/m)</option>' +
            '<option value="strain">Strain (mm/m)</option>' +
            '<option value="curvature">Curvature (1/m)</option>' +
            '<option value="ppv">PPV (mm/s)</option>' +
            '<option value="risk">Risk Index</option>' +
          '</select>' +
        '</div>' +

        '<div style="display:flex; align-items:center; gap:6px; margin-left:auto;">' +
          '<span style="font-size:9.5px; color:#78909C;">GOOGLE EARTH:</span>' +
          '<button class="terrain-redirect-btn" id="btn-launch-google-earth" title="Open Sector in Google Earth 3D (60° Tilt)">' +
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:block;">' +
              '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>' +
              '<polyline points="15 3 21 3 21 9"></polyline>' +
              '<line x1="10" y1="14" x2="21" y2="3"></line>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>' +

      '<!-- Body -->' +
      '<div class="terrain-win-body">' +
        '<!-- Real MapLibre 3D Satellite Terrain Map Container -->' +
        '<div class="terrain-canvas-container" id="real-terrain-container">' +
          '<div id="real-terrain-3d-map" style="width:100%; height:100%;"></div>' +

          '<!-- HUD Overlays -->' +
          '<div class="terrain-hud-stats">' +
            '<div class="terrain-hud-line">SECTOR: <span class="terrain-hud-val" id="hud-stat-sector">--</span></div>' +
            '<div class="terrain-hud-line">DEM ELEVATION: <span class="terrain-hud-val">194m - 228m MSL</span></div>' +
            '<div class="terrain-hud-line">ENGINE: <span class="terrain-hud-val">Real Satellite 3D DEM</span></div>' +
            '<div class="terrain-hud-line">SENSORS: <span class="terrain-hud-val" id="hud-stat-sensor-count">0 Detected</span></div>' +
          '</div>' +

          '<div class="terrain-hud-legend-box">' +
            '<div class="terrain-legend-item"><span class="terrain-legend-color" style="background:#00CC44;"></span>ACTIVE</div>' +
            '<div class="terrain-legend-item"><span class="terrain-legend-color" style="background:#FFA500;"></span>WARNING</div>' +
            '<div class="terrain-legend-item"><span class="terrain-legend-color" style="background:#FF2222;"></span>CRITICAL</div>' +
          '</div>' +
        '</div>' +

        '<!-- Right Node List Sidebar -->' +
        '<div class="terrain-nodes-sidebar" id="terrain-nodes-sidebar">' +
          '<div class="terrain-sidebar-header" id="terrain-sidebar-header">REGION SENSORS</div>' +
          '<div id="terrain-node-list-container" style="flex:1; overflow-y:auto;"></div>' +
        '</div>' +
      '</div>';

    parent.appendChild(windowEl);
  }

  function setupEventHandlers() {
    var header = windowEl.querySelector('#terrain-win-header');
    var btnClose = windowEl.querySelector('#btn-win-close');
    var btnMin = windowEl.querySelector('#btn-win-minimize');
    var btnMax = windowEl.querySelector('#btn-win-maximize');
    var btnPop = windowEl.querySelector('#btn-win-popout');

    // Dragging
    header.addEventListener('mousedown', function (e) {
      if (e.target.closest('.terrain-win-btn')) return;
      if (isMaximized) return;
      isDragging = true;
      var rect = windowEl.getBoundingClientRect();
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
      if (!isDragging) return;
      var parentRect = windowEl.parentElement.getBoundingClientRect();
      var newLeft = e.clientX - parentRect.left - dragOffsetX;
      var newTop = e.clientY - parentRect.top - dragOffsetY;

      newLeft = Math.max(10, Math.min(newLeft, parentRect.width - windowEl.offsetWidth - 10));
      newTop = Math.max(10, Math.min(newTop, parentRect.height - windowEl.offsetHeight - 10));

      windowEl.style.left = newLeft + 'px';
      windowEl.style.top = newTop + 'px';
    }

    function onMouseUp() {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    // Window actions
    btnClose.addEventListener('click', function () { close(); });
    btnMin.addEventListener('click', function () { toggleMinimize(); });
    btnMax.addEventListener('click', function () { toggleMaximize(); });
    btnPop.addEventListener('click', function () { popOutWindow(); });

    // Google Earth 3D Redirect Launcher
    var btnEarth = windowEl.querySelector('#btn-launch-google-earth');
    if (btnEarth) {
      btnEarth.addEventListener('click', function () { launchGoogleEarth(); });
    }

    // 3D Tilt Controls
    var btnTilt65 = windowEl.querySelector('#btn-cam-tilt65');
    var btnTilt0 = windowEl.querySelector('#btn-cam-tilt0');
    var btnTilt78 = windowEl.querySelector('#btn-cam-tilt78');

    btnTilt65.addEventListener('click', function () {
      setActiveTiltBtn(this);
      realTerrain3D.setCameraPreset('iso');
    });
    btnTilt0.addEventListener('click', function () {
      setActiveTiltBtn(this);
      realTerrain3D.setCameraPreset('top');
    });
    btnTilt78.addEventListener('click', function () {
      setActiveTiltBtn(this);
      realTerrain3D.setCameraPreset('steep');
    });

    // Vertical exaggeration controls
    var exagBtns = {
      1: windowEl.querySelector('#btn-exag-1'),
      3: windowEl.querySelector('#btn-exag-3'),
      5: windowEl.querySelector('#btn-exag-5')
    };
    Object.keys(exagBtns).forEach(function (factor) {
      var btn = exagBtns[factor];
      if (!btn) return;
      btn.addEventListener('click', function () {
        Object.keys(exagBtns).forEach(function (f) {
          if (exagBtns[f]) exagBtns[f].classList.remove('active');
        });
        this.classList.add('active');
        realTerrain3D.setExaggeration(parseFloat(factor));
      });
    });

    // Heatmap mode selector
    var heatmapSelect = windowEl.querySelector('#terrain-heatmap-mode');
    if (heatmapSelect) {
      heatmapSelect.addEventListener('change', function () {
        var mode = this.value;
        if (typeof realTerrain3D !== 'undefined' && realTerrain3D.setHeatmapMode) {
          realTerrain3D.setHeatmapMode(mode);
        } else {
          renderHeatmapOverlay(mode);
        }
      });
      if (typeof bus !== 'undefined') {
        bus.on('heatmap-mode', function (mode) {
          heatmapSelect.value = mode || 'none';
        });
      }
    }

    function setActiveTiltBtn(activeBtn) {
      [btnTilt65, btnTilt0, btnTilt78].forEach(function (b) { b.classList.remove('active'); });
      activeBtn.classList.add('active');
    }
  }

  // ---- Heatmap overlay for 3D MapLibre view ----
  var heatmapCanvas = null;
  var currentHeatmapMode = 'none';
  var HEATMAP_RES = 96;

  // Colour ramp stops (matches heatmap-overlay.js)
  var HEATMAP_STOPS = (typeof heatmapOverlay !== 'undefined' && heatmapOverlay.RAMP_FOR_MODE) ? heatmapOverlay.RAMP_FOR_MODE : {
    depth:     [[0.00,'#06b6d4'],[0.25,'#3b82f6'],[0.50,'#8b5cf6'],[0.75,'#d946ef'],[1.00,'#ff0055']],
    tilt:      [[0.00,'#00e5ff'],[0.25,'#10b981'],[0.50,'#facc15'],[0.75,'#fb923c'],[1.00,'#ef4444']],
    strain:    [[0.00,'#38bdf8'],[0.25,'#6366f1'],[0.50,'#a855f7'],[0.75,'#ec4899'],[1.00,'#f43f5e']],
    curvature: [[0.00,'#06b6d4'],[0.35,'#3b82f6'],[0.60,'#a855f7'],[0.80,'#f43f5e'],[1.00,'#fbbf24']],
    ppv:       [[0.00,'#38bdf8'],[0.25,'#818cf8'],[0.50,'#f472b6'],[0.75,'#fb7185'],[1.00,'#ef4444']],
    risk:      [[0.00,'#10b981'],[0.25,'#84cc16'],[0.50,'#f59e0b'],[0.75,'#ea580c'],[1.00,'#dc2626']]
  };
  var HEATMAP_MAX = { tilt: 35, strain: 24.0, curvature: 0.005, ppv: 25, depth: 2.5 };

  function hexToRgbLocal(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function sampleRampLocal(t, stops) {
    var tc = Math.min(1.0, Math.max(0.0, t));
    for (var i = 0; i < stops.length - 1; i++) {
      if (tc >= stops[i][0] && tc <= stops[i + 1][0]) {
        var f = stops[i + 1][0] === stops[i][0] ? 0 : (tc - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        var a = hexToRgbLocal(stops[i][1]);
        var b = hexToRgbLocal(stops[i + 1][1]);
        return [Math.round(a[0] + f * (b[0] - a[0])), Math.round(a[1] + f * (b[1] - a[1])), Math.round(a[2] + f * (b[2] - a[2]))];
      }
    }
    return hexToRgbLocal(stops[stops.length - 1][1]);
  }

  function renderHeatmapOverlay(mode) {
    currentHeatmapMode = mode;
    var inst = realTerrain3D.getInstance ? realTerrain3D.getInstance('real-terrain-3d-map') : null;
    var mlMap = inst ? inst.map : (realTerrain3D.getMap ? realTerrain3D.getMap('real-terrain-3d-map') : null);
    if (!mlMap) return;

    // Remove existing overlay
    try { if (mlMap.getLayer('heatmap-layer')) mlMap.removeLayer('heatmap-layer'); } catch (_) {}
    try { if (mlMap.getSource('heatmap-source')) mlMap.removeSource('heatmap-source'); } catch (_) {}

    if (mode === 'none' || !HEATMAP_STOPS[mode]) return;

    // Get sector bounds for the overlay coordinates
    if (!currentSector) return;
    var sb = null;
    if (currentSector.lngRange && currentSector.latRange) {
      sb = {
        minLat: Math.min(currentSector.latRange[0], currentSector.latRange[1]),
        maxLat: Math.max(currentSector.latRange[0], currentSector.latRange[1]),
        minLng: Math.min(currentSector.lngRange[0], currentSector.lngRange[1]),
        maxLng: Math.max(currentSector.lngRange[0], currentSector.lngRange[1])
      };
    } else if (currentSector.bounds && currentSector.bounds.length >= 2) {
      sb = {
        minLat: Math.min(currentSector.bounds[0][0], currentSector.bounds[1][0]),
        maxLat: Math.max(currentSector.bounds[0][0], currentSector.bounds[1][0]),
        minLng: Math.min(currentSector.bounds[0][1], currentSector.bounds[1][1]),
        maxLng: Math.max(currentSector.bounds[0][1], currentSector.bounds[1][1])
      };
    } else if (currentSector.center) {
      sb = {
        minLat: currentSector.center[0] - 0.003,
        maxLat: currentSector.center[0] + 0.003,
        minLng: currentSector.center[1] - 0.003,
        maxLng: currentSector.center[1] + 0.003
      };
    }
    if (!sb) return;

    // Convert to panel-frame metres for evaluation
    var xRange = currentSector.xRange || [-150, 150];
    var yRange = currentSector.yRange || [-150, 150];

    // Use heatmapOverlay's evaluatePoint if available, else approximate
    var hasPhysics = typeof heatmapOverlay !== 'undefined' && heatmapOverlay.getMode;

    // Render to canvas
    if (!heatmapCanvas) {
      heatmapCanvas = document.createElement('canvas');
      heatmapCanvas.width = HEATMAP_RES;
      heatmapCanvas.height = HEATMAP_RES;
    }
    var hCtx = heatmapCanvas.getContext('2d');
    var imgData = hCtx.createImageData(HEATMAP_RES, HEATMAP_RES);
    var data = imgData.data;
    var stops = HEATMAP_STOPS[mode];
    var xMin = xRange[0], xMax = xRange[1];
    var yMin = yRange[0], yMax = yRange[1];
    var cellW = (xMax - xMin) / HEATMAP_RES;
    var cellH = (yMax - yMin) / HEATMAP_RES;

    for (var row = 0; row < HEATMAP_RES; row++) {
      var y = yMax - (row + 0.5) * cellH;
      for (var col = 0; col < HEATMAP_RES; col++) {
        var x = xMin + (col + 0.5) * cellW;
        var t = 0;

        if (hasPhysics && heatmapOverlay.evaluatePoint && heatmapOverlay.channelValue) {
          // Use the real geomechanics physics engine for accurate heatmap
          try {
            var pt = heatmapOverlay.evaluatePoint(x, y);
            t = Math.min(1.0, Math.max(0.0, heatmapOverlay.channelValue(mode, pt)));
          } catch (_) {
            t = 0;
          }
        } else {
          // Distance-based approximation fallback for standalone popout
          var sCenterX = (xMin + xMax) / 2;
          var sCenterY = (yMin + yMax) / 2;
          var distFromCenter = Math.hypot(x - sCenterX, y - sCenterY);
          var sHalfW = Math.max(50, (xMax - xMin) / 2);
          if (mode === 'depth') {
            t = Math.max(0, 1.0 - distFromCenter / sHalfW) * 0.7;
          } else if (mode === 'tilt') {
            var tiltPeak = sHalfW * 0.4;
            t = Math.exp(-Math.pow((distFromCenter - tiltPeak) / (sHalfW * 0.3), 2)) * 0.8;
          } else if (mode === 'strain') {
            t = Math.exp(-Math.pow(distFromCenter / (sHalfW * 0.5), 2)) * 0.6;
          } else if (mode === 'curvature') {
            t = Math.exp(-Math.pow(distFromCenter / (sHalfW * 0.4), 2)) * 0.7;
          } else if (mode === 'ppv') {
            t = Math.max(0, 1.0 - distFromCenter / (sHalfW * 1.2)) * 0.5;
          } else if (mode === 'risk') {
            t = Math.max(0, 1.0 - distFromCenter / sHalfW) * 0.65;
          }
        }

        t = Math.min(1.0, Math.max(0, t));
        var rgb = sampleRampLocal(t, stops);
        var normT = Math.max(0, (t - 0.04) / 0.96);
        var alpha = t < 0.04 ? 0 : Math.min(215, Math.round(75 + 140 * Math.pow(normT, 0.85)));
        var idx = (row * HEATMAP_RES + col) * 4;
        data[idx] = rgb[0];
        data[idx + 1] = rgb[1];
        data[idx + 2] = rgb[2];
        data[idx + 3] = alpha;
      }
    }
    hCtx.putImageData(imgData, 0, 0);

    // Add as MapLibre image source + layer
    var dataUrl = heatmapCanvas.toDataURL();
    mlMap.addSource('heatmap-source', {
      type: 'image',
      url: dataUrl,
      coordinates: [
        [sb.minLng, sb.maxLat], // top-left
        [sb.maxLng, sb.maxLat], // top-right
        [sb.maxLng, sb.minLat], // bottom-right
        [sb.minLng, sb.minLat]  // bottom-left
      ]
    });
    mlMap.addLayer({
      id: 'heatmap-layer',
      type: 'raster',
      source: 'heatmap-source',
      paint: { 'raster-opacity': 0.75, 'raster-fade-duration': 0 }
    });

  }

  var openSectorDebounceTimer = null;
  function openSector(sectorData) {
    if (!sectorData) return;
    currentSector = sectorData;

    if (typeof mapTabs !== 'undefined' && typeof mapTabs.open3DTab === 'function') {
      mapTabs.open3DTab(sectorData);
      return;
    }

    if (openSectorDebounceTimer) {
      clearTimeout(openSectorDebounceTimer);
    }
    openSectorDebounceTimer = setTimeout(function () {
      openSectorDebounceTimer = null;
      doOpenSector(sectorData);
    }, 16);
  }

  function doOpenSector(sectorData) {
    if (!sectorData) return;
    currentSector = sectorData;

    // Show window
    windowEl.style.display = 'flex';
    if (isMinimized) toggleMinimize();

    // Update Header coordinates
    var coords = windowEl.querySelector('#terrain-win-coords');
    var latStr = '--';
    var lngStr = '--';
    if (sectorData.latRange && sectorData.lngRange) {
      latStr = sectorData.latRange[0].toFixed(4) + '° - ' + sectorData.latRange[1].toFixed(4) + '°N';
      lngStr = sectorData.lngRange[0].toFixed(4) + '° - ' + sectorData.lngRange[1].toFixed(4) + '°E';
    } else if (sectorData.center) {
      latStr = sectorData.center[0].toFixed(4) + '°N';
      lngStr = sectorData.center[1].toFixed(4) + '°E';
    }
    if (coords) coords.textContent = latStr + ' | ' + lngStr;

    // Update HUD stats
    var hudSector = windowEl.querySelector('#hud-stat-sector');
    if (hudSector) hudSector.textContent = (sectorData.id === 'CUSTOM') ? 'CUSTOM AREA' : sectorData.id;

    // Update Node Sidebar list and get detected count
    var count = populateNodeSidebar(sectorData);

    var hudCount = windowEl.querySelector('#hud-stat-sensor-count');
    if (hudCount) hudCount.textContent = count + ' Sensors Detected';

    var sidebarHeader = windowEl.querySelector('#terrain-sidebar-header');
    if (sidebarHeader) {
      sidebarHeader.textContent = 'REGION SENSORS (' + count + ')';
    }

    // Settle layout then initialize or load into Real 3D Satellite Terrain Map
    requestAnimationFrame(function () {
      if (!realTerrainInitialized || !realTerrain3D.getMap()) {
        realTerrainInitialized = realTerrain3D.init('real-terrain-3d-map', sectorData);
      } else {
        realTerrain3D.loadSector(sectorData);
      }

      realTerrain3D.onResize();
      setTimeout(function () { realTerrain3D.onResize(); }, 80);
      setTimeout(function () { realTerrain3D.onResize(); }, 250);
    });
  }

  function launchGoogleEarth() {
    if (!currentSector) return;
    var cLat = currentSector.center[0];
    var cLng = currentSector.center[1];

    // Opens Google Earth Web with 60° tilt, distance 400m, looking at the exact sector
    var earthUrl = 'https://earth.google.com/web/@' + cLat + ',' + cLng + ',230a,400d,35y,45h,60t,0r';
    window.open(earthUrl, '_blank');
  }

  function populateNodeSidebar(sector) {
    var container = windowEl.querySelector('#terrain-node-list-container');
    if (!container) return 0;
    container.innerHTML = '';

    var allNodes = liveNodeRecords();
    var nodeMap = {};
    for (var i = 0; i < allNodes.length; i++) {
      if (allNodes[i] && allNodes[i].node_id) {
        nodeMap[allNodes[i].node_id] = allNodes[i];
      }
    }

    var targetNodes = [];
    if (sector.nodes && sector.nodes.length > 0) {
      sector.nodes.forEach(function (nodeItem) {
        var nodeId = (typeof nodeItem === 'object' && nodeItem !== null) ? nodeItem.node_id : nodeItem;
        var n = nodeMap[nodeId] || (typeof nodeItem === 'object' ? nodeItem : null);
        if (n) targetNodes.push(n);
      });
    }

    // Fallback: If sector.nodes was empty or missed nodes, check if any nodes fall within bounds
    if (targetNodes.length === 0 && sector.latRange && sector.lngRange) {
      var minLat = Math.min(sector.latRange[0], sector.latRange[1]);
      var maxLat = Math.max(sector.latRange[0], sector.latRange[1]);
      var minLng = Math.min(sector.lngRange[0], sector.lngRange[1]);
      var maxLng = Math.max(sector.lngRange[0], sector.lngRange[1]);
      allNodes.forEach(function (n) {
        var lat = n.lat;
        var lng = n.lng;
        if (typeof lat !== 'number' && typeof n.x === 'number' && typeof mapView !== 'undefined' && mapView.xyToLatLon) {
          var p = mapView.xyToLatLon(n.x, n.y);
          lat = p[0]; lng = p[1];
        }
        if (typeof lat === 'number' && typeof lng === 'number' && lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
          targetNodes.push(n);
        }
      });
    }

    if (targetNodes.length === 0) {
      container.innerHTML = '<div style="padding:16px 8px; color:#64748B; text-align:center;">No sensor nodes in this peripheral block.</div>';
      return 0;
    }

    targetNodes.forEach(function (n) {
      var card = document.createElement('div');
      card.className = 'terrain-node-card';

      var state = n.state || 'active';
      var color = '#00CC44';
      if (state === 'warning') color = '#FFA500';
      if (state === 'critical') color = '#FF2222';
      if (state === 'lastgasp') color = '#FF4400';
      if (state === 'dead') color = '#5A6A72';

      var t = n.lastTelemetry;
      // `||` treated a genuine 0 reading and an absent channel alike, and
      // invented 142 / -32 for nodes whose tier carries no such sensor.
      var strainVal = null;
      if (t) {
        if (t.strain_ustrain != null) strainVal = t.strain_ustrain;
        else if (t.strain_ue != null) strainVal = t.strain_ue;
      }
      var strainStr = strainVal != null ? strainVal + ' µε' : '--';
      var tiltStr = (t && t.tilt_x_mdeg != null) ? t.tilt_x_mdeg + ' mdeg' : '--';

      card.innerHTML = 
        '<div class="terrain-node-card-title">' +
          '<div style="display:flex; align-items:center; gap:6px;">' +
            '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:' + color + '; border:1px solid rgba(0,0,0,0.5); flex-shrink:0;"></span>' +
            '<span style="color:#D4D8DC; font-weight:bold;">' + n.node_id + '</span>' +
          '</div>' +
          '<span class="state-badge ' + state + '">' + state.toUpperCase() + '</span>' +
        '</div>' +
        '<div class="terrain-node-card-sub">' +
          '<span>Role: <b style="color:#D4D8DC;">' + (n.role || n.node_type || (n.node_id === 'N31' ? 'gateway' : 'scout')) + '</b></span>' +
          '<span>Strain: <b style="color:#A8D8A8;">' + strainStr + '</b></span>' +
        '</div>' +
        '<div class="terrain-node-card-sub" style="margin-top:2px;">' +
          '<span>Ring: <b style="color:#D4D8DC;">' + (n.ring || 'core') + '</b></span>' +
          '<span>Tilt: <b style="color:#A8D8A8;">' + tiltStr + '</b></span>' +
        '</div>';

      card.addEventListener('click', function () {
        if (typeof bus !== 'undefined') {
          bus.emit('node-selected', n.node_id);
        }
      });

      container.appendChild(card);
    });

    return targetNodes.length;
  }

  function toggleMinimize() {
    isMinimized = !isMinimized;
    windowEl.classList.toggle('minimized', isMinimized);
    var btnMin = windowEl.querySelector('#btn-win-minimize');
    if (btnMin) btnMin.textContent = isMinimized ? '□' : '_';
    if (!isMinimized) {
      setTimeout(function () { realTerrain3D.onResize(); }, 50);
    }
  }

  function toggleMaximize() {
    isMaximized = !isMaximized;
    windowEl.classList.toggle('maximized', isMaximized);
    var btnMax = windowEl.querySelector('#btn-win-maximize');
    if (btnMax) btnMax.textContent = isMaximized ? '❐' : '□';
    setTimeout(function () {
      realTerrain3D.onResize();
    }, 50);
  }

  function popOutWindow() {
    if (!currentSector) return;

    if (window.r4 && typeof window.r4.open3DWindow === 'function') {
      window.r4.open3DWindow(currentSector);
      return;
    }

    var url = '3d-window.html?sector=' + encodeURIComponent(currentSector.id);
    var popWin = window.open(
      url,
      'R4_3D_Terrain_' + currentSector.id,
      'width=1280,height=850,menubar=no,toolbar=no,location=no,status=no'
    );
    if (popWin) popWin.focus();
  }

  function close() {
    windowEl.style.display = 'none';
  }

  return {
    init: init,
    openSector: openSector,
    close: close,
    toggleMinimize: toggleMinimize,
    toggleMaximize: toggleMaximize,
    popOutWindow: popOutWindow
  };
})();
