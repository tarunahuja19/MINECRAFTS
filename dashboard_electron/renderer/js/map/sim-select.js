'use strict';

/**
 * sim-select.js — SIM Area Selection Tool (Twin of Area Select 3D)
 *
 * - SIM Button OFF (Default):
 *     Clicking and dragging navigates / pans the 2D map smoothly.
 * - SIM Button ON:
 *     Mouse cursor changes to a crosshair.
 *     Clicking and dragging on the map draws a cyan marquee selection box.
 *     On mouse release, the 2D selection box disappears immediately,
 *     stores selection into selectionStore, and triggers sendToSim.send()
 *     to launch the Simulation Sandbox with the selected region and nodes.
 *     SIM mode then automatically resets to OFF so you can navigate the map again.
 */
var simSelect = (function () {
  var map = null;
  var isSimModeActive = false;
  var isDragging = false;
  var startPoint = null;
  var startLatLng = null;
  var marqueeBoxEl = null;
  var badgeEl = null;
  var simBtn = null;
  var simBadgeEl = null;
  var hintBannerEl = null;

  function init(mapInstance) {
    map = mapInstance;
    if (!map) return;

    if (map.doubleClickZoom && typeof map.doubleClickZoom.disable === 'function') {
      map.doubleClickZoom.disable();
    }

    injectStyles();
    setupUI();
    setupMapListeners();
    setupBusListeners();

    setSimMode(false, true);

    console.log('[SIM_SELECT] Initialized SIM selection tool (drag to select & send to Simulation Sandbox)');
  }

  function injectStyles() {
    if (document.getElementById('sim-select-styles')) return;
    var style = document.createElement('style');
    style.id = 'sim-select-styles';
    style.textContent =
      '.tool-btn {' +
      '  position: relative !important;' +
      '  display: inline-flex !important;' +
      '  flex-direction: column !important;' +
      '  align-items: center !important;' +
      '  justify-content: center !important;' +
      '  padding: 3px 6px !important;' +
      '  min-width: 32px !important;' +
      '  gap: 2px !important;' +
      '}' +
      '.hud-btn-label {' +
      '  font-family: "Courier New", Courier, monospace;' +
      '  font-size: 8.5px;' +
      '  line-height: 1;' +
      '  letter-spacing: 0.05em;' +
      '  font-weight: bold;' +
      '}' +
      '#btn-sim-select.active {' +
      '  background: #22D3EE !important;' +
      '  color: #041B24 !important;' +
      '  border-color: #22D3EE !important;' +
      '  box-shadow: 0 0 10px rgba(34, 211, 238, 0.5) !important;' +
      '}' +
      '#btn-sim-select:not(.active):hover {' +
      '  background: #1C303B !important;' +
      '  color: #C5D6DC !important;' +
      '  border-color: #385564 !important;' +
      '}' +
      '#sim-select-badge {' +
      '  position: absolute;' +
      '  top: -4px;' +
      '  right: -5px;' +
      '  background: #22D3EE;' +
      '  color: #041B24;' +
      '  border-radius: 9px;' +
      '  padding: 0 4px;' +
      '  font-family: "Courier New", monospace;' +
      '  font-size: 9px;' +
      '  font-weight: bold;' +
      '  min-width: 13px;' +
      '  text-align: center;' +
      '  line-height: 13px;' +
      '  display: none;' +
      '  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);' +
      '  pointer-events: none;' +
      '}' +
      '#btn-sim-select.active #sim-select-badge {' +
      '  background: #041B24 !important;' +
      '  color: #22D3EE !important;' +
      '}' +
      '.leaflet-container.sim-select-active,' +
      '.leaflet-container.sim-select-active .leaflet-pane {' +
      '  cursor: crosshair !important;' +
      '}' +
      '.leaflet-container.sim-select-active .leaflet-gridPane-pane {' +
      '  pointer-events: none !important;' +
      '}' +
      '.map-marquee-box-sim {' +
      '  position: absolute;' +
      '  border: 1.5px dashed #22D3EE;' +
      '  background: rgba(34, 211, 238, 0.12);' +
      '  box-shadow: 0 0 8px rgba(34, 211, 238, 0.25);' +
      '  pointer-events: none;' +
      '  z-index: 1000;' +
      '  border-radius: 2px;' +
      '}' +
      '.map-marquee-badge-sim {' +
      '  position: absolute;' +
      '  top: -25px;' +
      '  left: 0;' +
      '  background: rgba(17, 26, 32, 0.96);' +
      '  border: 1px solid #2A3841;' +
      '  border-left: 3px solid #22D3EE;' +
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
      '.sim-select-hint-banner {' +
      '  position: absolute;' +
      '  bottom: 20px;' +
      '  left: 50%;' +
      '  transform: translateX(-50%);' +
      '  background: rgba(22, 32, 40, 0.96);' +
      '  border: 1px solid #2E3E4A;' +
      '  border-left: 3px solid #22D3EE;' +
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
    simBtn = document.getElementById('btn-sim-select');
    simBadgeEl = document.getElementById('sim-select-badge');
    var mapContainer = document.getElementById('map-container');

    if (simBtn) {
      simBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        setSimMode(!isSimModeActive);
      });
    }

    if (mapContainer && !hintBannerEl) {
      hintBannerEl = document.createElement('div');
      hintBannerEl.id = 'sim-select-hint';
      hintBannerEl.className = 'sim-select-hint-banner';
      hintBannerEl.innerHTML =
        '<span style="color:#22D3EE;font-family:\'Courier New\',monospace;font-weight:bold;display:inline-flex;align-items:center;gap:4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M5 2 L5 18 L9.2 14 L13.5 22 L16.2 20.6 L11.8 12.6 Z"/></svg> SIM SELECTION ACTIVE:</span> Click & drag on map to select simulation region (Click SIM icon or press ESC to cancel)';
      hintBannerEl.style.display = 'none';
      mapContainer.appendChild(hintBannerEl);
    }

    // Press Escape to cancel SIM mode anytime
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isSimModeActive) {
        cancelDrag();
        setSimMode(false);
      }
    });
  }

  function cancelDrag() {
    if (isDragging) {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      removeMarqueeBox();
    }
  }

  function setSimMode(active, silent) {
    isSimModeActive = Boolean(active);
    var container = map ? map.getContainer() : null;

    if (isSimModeActive) {
      if (typeof areaSelect3D !== 'undefined' && areaSelect3D.setCursorMode) {
        areaSelect3D.setCursorMode(false);
      }
    } else {
      cancelDrag();
    }

    if (simBtn) {
      simBtn.classList.toggle('active', isSimModeActive);
      if (isSimModeActive) {
        simBtn.title = 'SIM Selection Active — Click to turn OFF and navigate 2D map';
      } else {
        simBtn.title = 'SIM Area Selection Tool (ON: drag to select, auto-sends to Simulation Sandbox)';
      }
    }

    if (container) {
      container.classList.toggle('sim-select-active', isSimModeActive);
    }

    if (hintBannerEl) {
      hintBannerEl.style.display = isSimModeActive ? 'flex' : 'none';
    }

    if (map && map.dragging) {
      if (isSimModeActive) {
        map.dragging.disable();
      } else {
        var isAreaSelectActive = (typeof areaSelect3D !== 'undefined' && areaSelect3D.isCursorModeActive && areaSelect3D.isCursorModeActive());
        if (!isAreaSelectActive) {
          map.dragging.enable();
        }
      }
    }

    if (!silent) {
      console.log('[SIM_SELECT] SIM Selection Mode:', isSimModeActive ? 'ACTIVE' : 'OFF');
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
      if (typeof areaSelect3D !== 'undefined' && areaSelect3D.isCursorModeActive && areaSelect3D.isCursorModeActive()) {
        return;
      }
      if (e.button !== 0) return;
      if (isControlOrMarker(e.target)) return;

      if (!isSimModeActive) {
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
  }

  function onMouseMove(e) {
    if (!isDragging || !startPoint || !marqueeBoxEl || !map) return;

    var container = map.getContainer();
    if (!container) return;

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

    var currentLatLng = map.mouseEventToLatLng(e);
    var bounds = L.latLngBounds([startLatLng, currentLatLng]);
    var nodeCount = countNodesInBounds(bounds);

    if (badgeEl) {
      badgeEl.textContent = 'SIM REGION | ' + Math.round(width) + '×' + Math.round(height) + 'px | ' + nodeCount + ' nodes';
    }
  }

  function onMouseUp(e) {
    if (!isDragging || !map) return;
    isDragging = false;

    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);

    var container = map.getContainer();
    var rect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
    var endX = e.clientX - rect.left;
    var endY = e.clientY - rect.top;

    var width = Math.abs(endX - startPoint.x);
    var height = Math.abs(endY - startPoint.y);

    removeMarqueeBox();

    if (width < 18 || height < 18) {
      return;
    }

    var endLatLng = map.mouseEventToLatLng(e);
    finalizeSelection(startLatLng, endLatLng);

    setSimMode(false);
  }

  function createMarqueeBox(point) {
    removeMarqueeBox();
    var container = map.getContainer();

    marqueeBoxEl = document.createElement('div');
    marqueeBoxEl.className = 'map-marquee-box-sim';
    marqueeBoxEl.style.left = point.x + 'px';
    marqueeBoxEl.style.top = point.y + 'px';
    marqueeBoxEl.style.width = '0px';
    marqueeBoxEl.style.height = '0px';

    badgeEl = document.createElement('div');
    badgeEl.className = 'map-marquee-badge-sim';
    badgeEl.textContent = 'SIM REGION';
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

    var allNodes = getAllAvailableNodes();
    var selectedNodeIds = [];

    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      var pos = resolveNodePosition(n);
      if (pos && pos.lat >= south && pos.lat <= north && pos.lng >= west && pos.lng <= east) {
        var rawId = (n.node_id != null && n.node_id !== '') ? n.node_id
          : (n.id != null && n.id !== '') ? n.id
          : (n.nodeId != null && n.nodeId !== '') ? n.nodeId : null;
        if (rawId != null) {
          selectedNodeIds.push(String(rawId));
        }
      }
    }

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

    // Set selection in store first (mandatory: send() reads the store)
    if (typeof selectionStore !== 'undefined' && typeof selectionStore.set === 'function') {
      selectionStore.set(selectionData);
    }

    // Auto-send selection to Simulation Sandbox
    if (typeof sendToSim !== 'undefined' && typeof sendToSim.send === 'function') {
      sendToSim.send();
    }

    console.log('[SIM_SELECT] Selection sent to Simulation Sandbox:', selectionData);
  }

  function updateBadge(selection) {
    if (!simBadgeEl) {
      simBadgeEl = document.getElementById('sim-select-badge');
    }
    if (!simBadgeEl) return;

    if (selection === null) {
      setTimeout(function () { updateBadge(); }, 0);
      return;
    }

    if (selection && selection.channel === '3d') selection = null;
    var hasSelection = (typeof selectionStore !== 'undefined' && typeof selectionStore.has === 'function')
      ? selectionStore.has('sim')
      : Boolean(selection);

    var sel = (selection && selection.channel !== '3d' ? selection : null) ||
      ((hasSelection && typeof selectionStore !== 'undefined' && typeof selectionStore.get === 'function') ? selectionStore.get('sim') : null);

    var count = 0;
    if (hasSelection && sel) {
      if (typeof sel.nodeCount === 'number') {
        count = sel.nodeCount;
      } else if (Array.isArray(sel.nodes)) {
        count = sel.nodes.length;
      }
    }

    // No number on the SIM button without nodes: a zero-node selection (or
    // none at all) shows no badge rather than a "0".
    var showBadge = hasSelection && count > 0;
    simBadgeEl.textContent = String(count);
    simBadgeEl.style.display = showBadge ? 'inline-block' : 'none';
    if (showBadge) {
      simBadgeEl.title = count + ' node' + (count === 1 ? '' : 's') + ' in selection';
    } else {
      simBadgeEl.title = '';
    }
  }

  function setupBusListeners() {
    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('selection-changed', function (selection) {
        updateBadge(selection);
      });
      bus.on('grid-selected', function (cellData) {
        updateBadge(cellData);
      });
      bus.on('system-reset', function () {
        setTimeout(function () { updateBadge(); }, 0);
      });
    }
    updateBadge();
  }

  return {
    init: init,
    setSimMode: setSimMode,
    isSimModeActive: function () { return isSimModeActive; }
  };
})();

if (typeof window !== 'undefined') {
  window.simSelect = simSelect;
}
