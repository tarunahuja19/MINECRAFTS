'use strict';

/**
 * Area Select 3D Module (Cursor Selection Tool)
 * 
 * - CURSOR Button OFF (Default):
 *     Clicking and dragging navigates / pans the 2D map smoothly.
 *     Clicking on sensor nodes opens node details / alarms.
 * - CURSOR Button ON:
 *     Mouse cursor changes to a crosshair.
 *     Clicking and dragging on the map draws a marquee selection box.
 *     On mouse release, the 2D selection box disappears immediately and
 *     launches the 3D Terrain Workstation displaying that exact region and its sensors.
 *     CURSOR mode then automatically resets to OFF so you can navigate the map again.
 */
var areaSelect3D = (function () {
  var map = null;
  var isCursorModeActive = false;
  var isDragging = false;
  var startPoint = null;
  var startLatLng = null;
  var marqueeBoxEl = null;
  var badgeEl = null;
  var cursorBtn = null;
  var hintBannerEl = null;

  function init(mapInstance) {
    map = mapInstance;
    if (!map) return;

    // Disable Leaflet's default double-click-to-zoom to avoid sudden map jumps
    if (map.doubleClickZoom && typeof map.doubleClickZoom.disable === 'function') {
      map.doubleClickZoom.disable();
    }

    injectStyles();
    setupUI();
    setupMapListeners();

    // Start with CURSOR mode OFF so normal 2D map navigation works immediately
    setCursorMode(false, true);

    console.log('[AREA_SELECT_3D] Initialized CURSOR 3D tool (toggle ON to select 3D area, OFF to navigate map)');
  }

  function injectStyles() {
    if (document.getElementById('area-select-3d-styles')) return;
    var style = document.createElement('style');
    style.id = 'area-select-3d-styles';
    style.textContent =
      '#btn-cursor-mode.active {' +
      '  background: #00E676 !important;' +
      '  color: #061A12 !important;' +
      '  border-color: #00E676 !important;' +
      '  box-shadow: none !important;' +
      '}' +
      '#btn-cursor-mode:not(.active):hover {' +
      '  background: #1C303B !important;' +
      '  color: #C5D6DC !important;' +
      '  border-color: #385564 !important;' +
      '}' +
      '.leaflet-container.area-select-active,' +
      '.leaflet-container.area-select-active .leaflet-pane {' +
      '  cursor: crosshair !important;' +
      '}' +
      '.leaflet-container.area-select-active .leaflet-gridPane-pane {' +
      '  pointer-events: none !important;' +
      '}' +
      '.map-marquee-box {' +
      '  position: absolute;' +
      '  border: 1.5px dashed #00E676;' +
      '  background: rgba(0, 230, 118, 0.12);' +
      '  box-shadow: 0 0 8px rgba(0, 230, 118, 0.25);' +
      '  pointer-events: none;' +
      '  z-index: 1000;' +
      '  border-radius: 2px;' +
      '}' +
      '.map-marquee-badge {' +
      '  position: absolute;' +
      '  top: -25px;' +
      '  left: 0;' +
      '  background: rgba(17, 26, 32, 0.96);' +
      '  border: 1px solid #2A3841;' +
      '  border-left: 3px solid #00E676;' +
      '  border-radius: 2px;' +
      '  color: #D4D8DC;' +
      '  font-family: "Courier New", monospace;' +
      '  font-size: 10px;' +
      '  font-weight: bold;' +
      '  padding: 2px 7px;' +
      '  white-space: nowrap;' +
      '  box-shadow: 0 2px 8px rgba(0,0,0,0.7);' +
      '  letter-spacing: 0.05em;' +
      '}' +
      '.area-select-hint-banner {' +
      '  position: absolute;' +
      '  bottom: 20px;' +
      '  left: 50%;' +
      '  transform: translateX(-50%);' +
      '  background: rgba(22, 32, 40, 0.96);' +
      '  border: 1px solid #2E3E4A;' +
      '  border-left: 3px solid #00E676;' +
      '  color: #D4D8DC;' +
      '  font-family: Tahoma, "Segoe UI", Arial, sans-serif;' +
      '  font-size: 11px;' +
      '  padding: 5px 14px;' +
      '  border-radius: 2px;' +
      '  z-index: 800;' +
      '  pointer-events: none;' +
      '  box-shadow: 0 4px 16px rgba(0,0,0,0.7);' +
      '  display: flex;' +
      '  align-items: center;' +
      '  gap: 8px;' +
      '}';
    document.head.appendChild(style);
  }

  function setupUI() {
    cursorBtn = document.getElementById('btn-cursor-mode') || document.getElementById('btn-select-3d-area');
    var mapContainer = document.getElementById('map-container');

    if (cursorBtn) {
      cursorBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setCursorMode(!isCursorModeActive);
      });
    }

    if (mapContainer && !hintBannerEl) {
      hintBannerEl = document.createElement('div');
      hintBannerEl.className = 'area-select-hint-banner';
      hintBannerEl.innerHTML =
        '<span style="color:#00E676;font-family:\'Courier New\',monospace;font-weight:bold;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2 L5 18 L9.2 14 L13.5 22 L16.2 20.6 L11.8 12.6 L17.5 12.6 Z"/></svg> 3D SELECTION ACTIVE:</span> Click & drag on map to select 3D terrain (Click cursor icon or press ESC to navigate 2D map)';
      hintBannerEl.style.display = 'none';
      mapContainer.appendChild(hintBannerEl);
    }

    // Press Escape to cancel CURSOR mode anytime
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isCursorModeActive) {
        if (isDragging) {
          isDragging = false;
          removeMarqueeBox();
        }
        setCursorMode(false);
      }
    });
  }

  function setCursorMode(active, silent) {
    isCursorModeActive = Boolean(active);
    var container = map ? map.getContainer() : null;

    if (cursorBtn) {
      cursorBtn.classList.toggle('active', isCursorModeActive);
      if (isCursorModeActive) {
        cursorBtn.title = 'Cursor Selection Active — Click to turn OFF and navigate 2D map';
      } else {
        cursorBtn.title = 'Click to turn ON 3D area selection cursor';
      }
    }

    if (container) {
      container.classList.toggle('area-select-active', isCursorModeActive);
    }

    if (hintBannerEl) {
      hintBannerEl.style.display = isCursorModeActive ? 'flex' : 'none';
    }

    // If CURSOR mode is ON, disable Leaflet map drag panning so dragging draws the selection box.
    // If CURSOR mode is OFF, enable Leaflet map drag panning so dragging navigates the 2D map.
    if (map && map.dragging) {
      if (isCursorModeActive) {
        map.dragging.disable();
      } else {
        map.dragging.enable();
      }
    }

    if (!silent) {
      console.log('[AREA_SELECT_3D] CURSOR Selection Mode:', isCursorModeActive ? 'ACTIVE' : 'OFF');
    }
  }

  function isControlOrMarker(target) {
    if (!target) return false;
    return Boolean(
      target.closest('.leaflet-marker-icon') ||
      target.closest('.leaflet-popup') ||
      target.closest('.leaflet-control') ||
      target.closest('.map-hud-controls') ||
      target.closest('.terrain-3d-window')
    );
  }

  function setupMapListeners() {
    if (!map) return;
    var container = map.getContainer();

    container.addEventListener('mousedown', function (e) {
      // Left click only
      if (e.button !== 0) return;
      if (isControlOrMarker(e.target)) return;

      // Selection is triggered if CURSOR mode is ON or if user holds Shift
      var shouldSelect = isCursorModeActive || e.shiftKey;
      if (!shouldSelect) {
        // Normal navigation mode: let Leaflet handle map panning
        return;
      }

      isDragging = true;
      if (map.dragging && map.dragging.enabled()) {
        map.dragging.disable();
      }

      var rect = container.getBoundingClientRect();
      startPoint = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        clientX: e.clientX,
        clientY: e.clientY
      };
      startLatLng = map.mouseEventToLatLng(e);

      createMarqueeBox(startPoint);

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      e.preventDefault();
      e.stopPropagation();
    });

    function onMouseMove(e) {
      if (!isDragging || !startPoint || !marqueeBoxEl) return;

      var rect = container.getBoundingClientRect();
      var curX = e.clientX - rect.left;
      var curY = e.clientY - rect.top;

      var minX = Math.min(startPoint.x, curX);
      var minY = Math.min(startPoint.y, curY);
      var width = Math.abs(curX - startPoint.x);
      var height = Math.abs(curY - startPoint.y);

      marqueeBoxEl.style.left = minX + 'px';
      marqueeBoxEl.style.top = minY + 'px';
      marqueeBoxEl.style.width = width + 'px';
      marqueeBoxEl.style.height = height + 'px';

      // Estimate nodes inside during drag
      var currentLatLng = map.mouseEventToLatLng(e);
      var bounds = L.latLngBounds([startLatLng, currentLatLng]);
      var nodeCount = countNodesInBounds(bounds);

      if (badgeEl) {
        badgeEl.textContent = '✛ 3D REGION | ' + Math.round(width) + '×' + Math.round(height) + 'px | ' + nodeCount + ' Nodes';
      }
    }

    function onMouseUp(e) {
      if (!isDragging) return;
      isDragging = false;

      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      var rect = container.getBoundingClientRect();
      var endX = e.clientX - rect.left;
      var endY = e.clientY - rect.top;

      var width = Math.abs(endX - startPoint.x);
      var height = Math.abs(endY - startPoint.y);

      // Immediately remove marquee box from 2D map
      removeMarqueeBox();

      // If drag is smaller than 18px threshold, cancel without launching
      if (width < 18 || height < 18) {
        return;
      }

      var endLatLng = map.mouseEventToLatLng(e);
      finalizeSelection(startLatLng, endLatLng);

      // Turn CURSOR mode OFF after a successful selection so the 2D map
      // is immediately ready for navigation without requiring an extra click
      setCursorMode(false);
    }
  }

  function createMarqueeBox(point) {
    removeMarqueeBox();
    var container = map.getContainer();

    marqueeBoxEl = document.createElement('div');
    marqueeBoxEl.className = 'map-marquee-box';
    marqueeBoxEl.style.left = point.x + 'px';
    marqueeBoxEl.style.top = point.y + 'px';
    marqueeBoxEl.style.width = '0px';
    marqueeBoxEl.style.height = '0px';

    badgeEl = document.createElement('div');
    badgeEl.className = 'map-marquee-badge';
    badgeEl.textContent = '✛ 3D REGION';
    marqueeBoxEl.appendChild(badgeEl);

    container.appendChild(marqueeBoxEl);
  }

  function removeMarqueeBox() {
    if (marqueeBoxEl && marqueeBoxEl.parentNode) {
      marqueeBoxEl.parentNode.removeChild(marqueeBoxEl);
    }
    marqueeBoxEl = null;
    badgeEl = null;
  }

  function getAllAvailableNodes() {
    if (typeof nodeMarkers !== 'undefined' && typeof nodeMarkers.getAllNodes === 'function') {
      var all = nodeMarkers.getAllNodes();
      if (all && all.length) return all;
    }
    if (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      var f = fixtureProvider.getNodes();
      if (Array.isArray(f) && f.length) return f;
    }
    return [];
  }

  function resolveNodePosition(n) {
    if (!n) return null;
    var lat = (typeof n.lat === 'number') ? n.lat : (Array.isArray(n.pos) ? n.pos[0] : (typeof n.latitude === 'number' ? n.latitude : null));
    var lng = (typeof n.lng === 'number') ? n.lng : (Array.isArray(n.pos) ? n.pos[1] : (typeof n.longitude === 'number' ? n.longitude : null));
    if (typeof lat !== 'number' && typeof n.x === 'number' && typeof mapView !== 'undefined' && mapView.xyToLatLon) {
      var p = mapView.xyToLatLon(n.x, n.y);
      if (p) { lat = p[0]; lng = p[1]; }
    }
    if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)) {
      if (lat > 50 && lng < 50) return { lat: lng, lng: lat };
      return { lat: lat, lng: lng };
    }
    return null;
  }

  function countNodesInBounds(bounds) {
    var allNodes = getAllAvailableNodes();
    var count = 0;
    for (var i = 0; i < allNodes.length; i++) {
      var pos = resolveNodePosition(allNodes[i]);
      if (pos && bounds.contains([pos.lat, pos.lng])) count++;
    }
    return count;
  }

  function finalizeSelection(latLngA, latLngB) {
    if (!latLngA || !latLngB) return;

    var south = Math.min(latLngA.lat, latLngB.lat);
    var north = Math.max(latLngA.lat, latLngB.lat);
    var west = Math.min(latLngA.lng, latLngB.lng);
    var east = Math.max(latLngA.lng, latLngB.lng);

    if (!isFinite(south) || !isFinite(north) || !isFinite(west) || !isFinite(east)) return;

    var bounds = [[south, west], [north, east]];
    var center = [(south + north) / 2, (west + east) / 2];

    // Collect all sensor nodes situated within this custom box
    var allNodes = getAllAvailableNodes();
    var selectedNodeIds = [];

    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      var pos = resolveNodePosition(n);
      if (pos && pos.lat >= south && pos.lat <= north && pos.lng >= west && pos.lng <= east) {
        selectedNodeIds.push(n.node_id);
      }
    }

    // Convert lat/lon bounds into simulation panel metres (x/y)
    var swXY = (typeof mapView !== 'undefined' && typeof mapView.latLonToXY === 'function')
      ? mapView.latLonToXY(south, west) : [-150, -150];
    var neXY = (typeof mapView !== 'undefined' && typeof mapView.latLonToXY === 'function')
      ? mapView.latLonToXY(north, east) : [150, 150];

    var xMin = Math.min(swXY[0], neXY[0]);
    var xMax = Math.max(swXY[0], neXY[0]);
    var yMin = Math.min(swXY[1], neXY[1]);
    var yMax = Math.max(swXY[1], neXY[1]);

    var selectionData = {
      id: 'CUSTOM',
      name: 'Custom Region (' + selectedNodeIds.length + ' node' + (selectedNodeIds.length === 1 ? '' : 's') + ')',
      panel_id: 'PNL-A',
      grid_type: 'custom_selection',
      bounds: bounds,
      center: center,
      latRange: [south, north],
      lngRange: [west, east],
      xRange: [xMin, xMax],
      yRange: [yMin, yMax],
      nodeCount: selectedNodeIds.length,
      nodes: selectedNodeIds
    };

    window.__selectedGridSector = selectionData;

    if (typeof selectionStore !== 'undefined' && typeof selectionStore.set === 'function') {
      selectionStore.set(selectionData);
    }

    // Launch in 3D tab
    if (typeof mapTabs !== 'undefined' && typeof mapTabs.open3DTab === 'function') {
      mapTabs.open3DTab(selectionData);
    } else if (typeof bus !== 'undefined' && bus.emit) {
      bus.emit('3d-view-requested', selectionData);
    } else if (typeof terrain3DWindow !== 'undefined' && typeof terrain3DWindow.openSector === 'function') {
      terrain3DWindow.openSector(selectionData);
    }

    console.log('[AREA_SELECT_3D] Custom area launched in 3D:', selectionData);
  }

  return {
    init: init,
    setCursorMode: setCursorMode,
    isCursorModeActive: function () { return isCursorModeActive; }
  };
})();
