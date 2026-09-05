'use strict';

/**
 * Panel Grid Module
 * Subdivides Panel A Extraction Phase into an 8x8 interactive sector grid (64 sectors: A1 to H8).
 * Prepared for 3D terrain window launching per individual grid sector.
 */
var panelGrid = (function () {
  var map = null;
  var gridGroup = null;
  // Cells and labels live in separate groups so LABELS can be turned off while
  // GRID stays on - the four-way combination the HUD exposes.
  var cellGroup = null;
  var labelGroup = null;
  var tagMarkers = {};
  var cellPolygons = {};
  var selectedCellId = null;
  var cellsData = {};
  var bannerEl = null;

  var GRID_CONFIG = {
    rows: 8, // Rows A, B, C, D, E, F, G, H (North to South)
    cols: 8, // Cols 1, 2, 3, 4, 5, 6, 7, 8 (West to East)
    rowNames: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    colNames: ['1', '2', '3', '4', '5', '6', '7', '8'],
    // The grid is defined in METRES on the panel frame, not in degrees. The
    // simulation window is 600 x 600 m centred on the panel centre, so an 8x8
    // grid gives 75 x 75 m sectors. Corners are projected to lat/lon through
    // mapView.xyToLatLon (the same converter as geo.py), which is what makes
    // the grid cover literally the same ground as the physics. The old
    // hardcoded Jharia degree box sat ~1000 km from the modelled site.
    halfM: 300,
    // Grid lines are magenta, not the old slate blue at 45% opacity. Over ESRI
    // satellite imagery (browns, greens, greys) the previous lines were nearly
    // invisible at the 600 m window; magenta appears nowhere in aerial terrain
    // and nowhere else in this HUD, so a grid line can never be mistaken for
    // ground detail or for another overlay.
    defaultStyle: {
      color: '#FF00E5',
      weight: 1.6,
      opacity: 0.95,
      dashArray: '5, 4',
      fillColor: '#FF00E5',
      fillOpacity: 0.05,
      interactive: true
    },
    hoverStyle: {
      color: '#FFFFFF',
      weight: 2.6,
      opacity: 1,
      dashArray: 'none',
      fillColor: '#FF00E5',
      fillOpacity: 0.22
    },
    selectedStyle: {
      color: '#00E5FF',
      weight: 3.2,
      opacity: 1,
      dashArray: 'none',
      fillColor: '#00E5FF',
      fillOpacity: 0.30
    },
    // 64 cells over 31 nodes means most sectors legitimately hold none. Drawing
    // them in the normal style would imply they are monitored and healthy, so
    // an empty sector is greyed and labelled "no coverage" instead.
    emptyStyle: {
      color: '#8A97A0',
      weight: 1.1,
      opacity: 0.7,
      dashArray: '2, 6',
      fillColor: '#8A97A0',
      fillOpacity: 0.06,
      interactive: true
    }
  };

  // SURFACE shading is a SEPARATE channel from the grid line colour on purpose:
  // the point of the toggle is to compare the two. The magenta outline says
  // "this is sector D4"; the fill says "this is what the ground under D4 is
  // doing". Mixing them into one colour would make the comparison impossible.
  //
  // Bands are on peak strain across the sector's nodes, matching the thresholds
  // node-markers.js already uses for marker state, so a sector cannot disagree
  // with the markers sitting inside it.
  var SURFACE_BANDS = [
    { max: 400, color: '#2E7D32', label: 'STABLE' },
    { max: 600, color: '#FFC107', label: 'SUBSIDING' },
    { max: Infinity, color: '#B71C1C', label: 'TROUGH' }
  ];
  var SURFACE_FILL_OPACITY = 0.42;
  var surfaceOn = false;
  var gridOn = true;
  var labelsOn = true;

  // Cell geometry in the physics frame. Row 0 is the NORTH-most row, so y runs
  // downward with r; col 0 is the WEST-most, so x runs rightward with c.
  function cellExtentM(r, c) {
    var half = GRID_CONFIG.halfM;
    var cellM = (half * 2) / GRID_CONFIG.rows;
    var xMin = -half + c * cellM;
    var yMax = half - r * cellM;
    return { xMin: xMin, xMax: xMin + cellM, yMin: yMax - cellM, yMax: yMax };
  }

  // Project a metre extent to the lat/lon corners Leaflet needs, through the
  // map's single converter so the grid cannot drift from the markers.
  function cellCorners(ext) {
    var sw = mapView.xyToLatLon(ext.xMin, ext.yMin);
    var ne = mapView.xyToLatLon(ext.xMax, ext.yMax);
    return { south: sw[0], west: sw[1], north: ne[0], east: ne[1] };
  }

  // Node -> cell assignment is done on x/y METRES, never on lat/lon, so it is
  // computed in the same frame the physics runs in and cannot drift with the
  // projection. Nodes outside the 600 m window (the gateway) match no cell.
  function nodesInExtent(allNodes, ext) {
    var ids = [];
    for (var i = 0; i < allNodes.length; i++) {
      var n = allNodes[i];
      if (typeof n.x !== 'number' || typeof n.y !== 'number') continue;
      if (n.x >= ext.xMin && n.x < ext.xMax && n.y >= ext.yMin && n.y < ext.yMax) {
        ids.push(n.node_id);
      }
    }
    return ids;
  }

  // Peak strain over the nodes in a cell, or null when the cell holds no node
  // with telemetry yet - null means "unknown", which is drawn differently from
  // "stable". Reading through nodeMarkers keeps one source of live telemetry.
  function cellSurface(cellId) {
    var d = cellsData[cellId];
    if (!d || !d.nodes || d.nodes.length === 0) return null;
    if (typeof nodeMarkers === 'undefined' || typeof nodeMarkers.getNodeData !== 'function') return null;

    var peak = null;
    for (var i = 0; i < d.nodes.length; i++) {
      var nd = nodeMarkers.getNodeData(d.nodes[i]);
      var t = nd && nd.lastTelemetry;
      if (!t) continue;
      var v = t.strain_ustrain || 0;
      if (peak === null || v > peak) peak = v;
    }
    if (peak === null) return null;

    for (var b = 0; b < SURFACE_BANDS.length; b++) {
      if (peak < SURFACE_BANDS[b].max) {
        return { peak: peak, color: SURFACE_BANDS[b].color, label: SURFACE_BANDS[b].label };
      }
    }
    return null;
  }

  function styleForCell(cellId) {
    if (selectedCellId === cellId) return GRID_CONFIG.selectedStyle;
    var d = cellsData[cellId];
    var base = (d && d.nodeCount === 0) ? GRID_CONFIG.emptyStyle : GRID_CONFIG.defaultStyle;

    if (!surfaceOn) return base;

    // Surface mode repaints only the fill and keeps the outline, so the sector
    // boundary stays readable on top of the shading.
    var surf = cellSurface(cellId);
    if (!surf) {
      return Object.assign({}, base, { fillColor: '#404A50', fillOpacity: 0.28 });
    }
    return Object.assign({}, base, { fillColor: surf.color, fillOpacity: SURFACE_FILL_OPACITY });
  }

  function tooltipFor(cellId, count) {
    var line = (count === 0)
      ? '<div class="grid-tooltip-info">NO COVERAGE — 0 sensor nodes</div>'
      : '<div class="grid-tooltip-info">' + count + ' Sensor Nodes Active</div>';

    var surfLine = '';
    if (surfaceOn) {
      var surf = cellSurface(cellId);
      surfLine = surf
        ? '<div class="grid-tooltip-info">SURFACE: ' + surf.label +
          ' (peak ' + Math.round(surf.peak) + ' ustrain)</div>'
        : '<div class="grid-tooltip-info">SURFACE: NO DATA</div>';
    }

    return '<div class="grid-tooltip-content">' +
             '<div class="grid-tooltip-title">PANEL A : SECTOR ' + cellId + '</div>' +
             line +
             surfLine +
             '<div class="grid-tooltip-hint">⚡ CLICK FOR 3D TERRAIN VIEW</div>' +
           '</div>';
  }

  // Both build and refresh read nodes from the same place: the live records
  // carrying x/y. fixtureProvider returns null in live mode, hence the guard.
  function currentNodes(passed) {
    if (Array.isArray(passed)) return passed;
    if (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      var n = fixtureProvider.getNodes();
      if (Array.isArray(n)) return n;
    }
    return [];
  }

  function init(mapInstance) {
    map = mapInstance;
    if (!map) return;

    createHUDNotificationBanner();
    buildGrid();
    setupToggleUI();

    if (typeof bus !== 'undefined') {
      bus.on('nodes-loaded', function (nodes) {
        refreshNodeDistribution(nodes);
      });
      bus.on('replay-started', function () {
        refreshNodeDistribution();
      });
      bus.on('telemetry', function () {
        // Surface shading is driven by live strain, so it has to repaint as
        // telemetry lands. Cheap: 64 setStyle calls, and only while SURFACE
        // is actually on.
        if (surfaceOn) restyleAllCells();
      });
    }

    console.log('[PANEL_GRID] Initialized 8x8 Sector Grid (64 Sectors) over Panel A');
  }

  function createHUDNotificationBanner() {
    var mapContainer = document.getElementById('map-container');
    if (!mapContainer || bannerEl) return;
    mapContainer.style.position = 'relative';

    bannerEl = document.createElement('div');
    bannerEl.id = 'panel-grid-hud-banner';
    bannerEl.className = 'grid-hud-banner';
    bannerEl.innerHTML = 
      '<span class="grid-hud-badge" id="grid-hud-badge">3D SECTOR --</span>' +
      '<span class="grid-hud-text" id="grid-hud-text">Select an 8x8 sector to launch 3D terrain view</span>' +
      '<button class="grid-hud-btn" id="btn-grid-3d-launch">3D VIEW HOOK</button>' +
      '<span class="grid-hud-close" id="btn-grid-hud-close" title="Dismiss">×</span>';

    mapContainer.appendChild(bannerEl);

    var closeBtn = bannerEl.querySelector('#btn-grid-hud-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        hideBanner();
      });
    }

    var launchBtn = bannerEl.querySelector('#btn-grid-3d-launch');
    if (launchBtn) {
      launchBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        trigger3DView(selectedCellId);
      });
    }
  }

  function showBanner(cellData) {
    if (!bannerEl) return;
    var badge = bannerEl.querySelector('#grid-hud-badge');
    var text = bannerEl.querySelector('#grid-hud-text');

    if (badge) badge.textContent = '3D SECTOR ' + cellData.id;
    if (text) {
      var nodeCountStr = cellData.nodeCount + ' sensor' + (cellData.nodeCount === 1 ? '' : 's');
      text.textContent = '8x8 Sector ' + cellData.id + ' (' + nodeCountStr + ') — Ready for 3D View';
    }

    bannerEl.style.display = 'flex';
  }

  function hideBanner() {
    if (bannerEl) bannerEl.style.display = 'none';
  }

  function buildGrid() {
    if (gridGroup && map) {
      map.removeLayer(gridGroup);
    }

    if (map && !map.getPane('gridPane')) {
      map.createPane('gridPane');
      map.getPane('gridPane').style.zIndex = '480';
    }

    gridGroup = L.featureGroup({ pane: 'gridPane' });
    cellGroup = L.featureGroup({ pane: 'gridPane' });
    labelGroup = L.featureGroup({ pane: 'gridPane' });
    tagMarkers = {};
    cellPolygons = {};
    cellsData = {};

    var allNodes = currentNodes();

    for (var r = 0; r < GRID_CONFIG.rows; r++) {
      var rowName = GRID_CONFIG.rowNames[r];

      for (var c = 0; c < GRID_CONFIG.cols; c++) {
        var colName = GRID_CONFIG.colNames[c];
        var cellId = rowName + colName;

        var ext = cellExtentM(r, c);
        var k = cellCorners(ext);
        var south = k.south, north = k.north, west = k.west, east = k.east;

        // Assignment happens on x/y metres, in the physics frame.
        var cellNodes = nodesInExtent(allNodes, ext);

        var cellCenter = [(south + north) / 2, (west + east) / 2];
        var cellBounds = [[south, west], [north, east]];

        var cellData = {
          id: cellId,
          name: 'Panel A — Sector ' + cellId,
          panel_id: 'PNL-A',
          grid_type: '8x8',
          row: rowName,
          col: parseInt(colName),
          bounds: cellBounds,
          center: cellCenter,
          latRange: [south, north],
          lngRange: [west, east],
          // The metre extent travels with the cell so the 3D terrain window
          // can cut exactly this patch of the simulation window.
          xRange: [ext.xMin, ext.xMax],
          yRange: [ext.yMin, ext.yMax],
          nodeCount: cellNodes.length,
          nodes: cellNodes
        };

        cellsData[cellId] = cellData;

        // Create polygon for cell
        var polyOpts = Object.assign({}, styleForCell(cellId), { pane: 'gridPane' });
        var polygon = L.polygon(
          [[south, west], [south, east], [north, east], [north, west]],
          polyOpts
        );
        polygon._cellId = cellId;

        var tooltipHtml = tooltipFor(cellId, cellNodes.length);

        polygon.bindTooltip(tooltipHtml, {
          className: 'grid-sector-tooltip',
          direction: 'center',
          sticky: true,
          opacity: 0.98
        });

        // Mouse events
        polygon.on('mouseover', function () {
          var cid = this._cellId;
          if (selectedCellId !== cid) {
            this.setStyle(GRID_CONFIG.hoverStyle);
          }
        });

        polygon.on('mouseout', function () {
          var cid = this._cellId;
          if (selectedCellId !== cid) {
            // styleForCell, not defaultStyle: a hovered empty cell must fall
            // back to grey, otherwise it silently repaints as a covered one.
            this.setStyle(styleForCell(cid));
          }
        });

        polygon.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          selectSector(this._cellId);
        });

        polygon.addTo(cellGroup);
        cellPolygons[cellId] = polygon;

        // Watermark Label at top-left corner of each 8x8 cell
        var labelLat = north - (north - south) * 0.16;
        var labelLng = west + (east - west) * 0.08;

        var tagIcon = L.divIcon({
          className: 'grid-cell-watermark-icon',
          html: '<div class="grid-cell-watermark" id="grid-tag-' + cellId + '">' + cellId + '</div>',
          iconSize: [22, 14],
          iconAnchor: [0, 0]
        });

        var tagMarker = L.marker([labelLat, labelLng], { icon: tagIcon, interactive: false });
        tagMarker.addTo(labelGroup);
        tagMarkers[cellId] = tagMarker;
      }
    }

    cellGroup.addTo(gridGroup);
    labelGroup.addTo(gridGroup);
    gridGroup.addTo(map);
    applyVisibility();
  }

  // GRID off hides the cells AND the labels: labels alone, floating with no
  // boundaries, name sectors the user cannot see. LABELS off hides only the
  // tags. That gives the four states: grid+labels, grid only, labels-with-grid
  // implied off (= nothing), and nothing.
  function applyVisibility() {
    if (!map || !gridGroup) return;

    if (gridOn) {
      if (!map.hasLayer(gridGroup)) gridGroup.addTo(map);
      if (!gridGroup.hasLayer(cellGroup)) cellGroup.addTo(gridGroup);
      if (labelsOn) {
        if (!gridGroup.hasLayer(labelGroup)) labelGroup.addTo(gridGroup);
      } else if (gridGroup.hasLayer(labelGroup)) {
        gridGroup.removeLayer(labelGroup);
      }
    } else if (map.hasLayer(gridGroup)) {
      map.removeLayer(gridGroup);
    }
  }

  function restyleAllCells() {
    var ids = Object.keys(cellPolygons);
    for (var i = 0; i < ids.length; i++) {
      cellPolygons[ids[i]].setStyle(styleForCell(ids[i]));
      cellPolygons[ids[i]].setTooltipContent(
        tooltipFor(ids[i], cellsData[ids[i]] ? cellsData[ids[i]].nodeCount : 0)
      );
    }
  }

  function setActive(btn, on) {
    if (!btn) return;
    if (on) btn.classList.add('active');
    else btn.classList.remove('active');
  }

  function setupToggleUI() {
    var btnGrid = document.getElementById('btn-grid-toggle');
    var btnLabels = document.getElementById('btn-grid-labels');
    var btnSurface = document.getElementById('btn-grid-surface');

    if (btnGrid) {
      btnGrid.addEventListener('click', function () {
        gridOn = !gridOn;
        setActive(btnGrid, gridOn);
        applyVisibility();
      });
    }
    if (btnLabels) {
      btnLabels.addEventListener('click', function () {
        labelsOn = !labelsOn;
        setActive(btnLabels, labelsOn);
        applyVisibility();
      });
    }
    if (btnSurface) {
      btnSurface.addEventListener('click', function () {
        surfaceOn = !surfaceOn;
        setActive(btnSurface, surfaceOn);
        restyleAllCells();
      });
    }

    setActive(btnGrid, gridOn);
    setActive(btnLabels, labelsOn);
    setActive(btnSurface, surfaceOn);
  }

  function selectSector(cellId) {
    if (!cellsData[cellId]) return;

    // Reset previously selected cell
    if (selectedCellId && cellPolygons[selectedCellId]) {
      var prevId = selectedCellId;
      selectedCellId = null;
      cellPolygons[prevId].setStyle(styleForCell(prevId));
      selectedCellId = prevId;
      var oldTag = document.getElementById('grid-tag-' + selectedCellId);
      if (oldTag) oldTag.classList.remove('active');
    }

    selectedCellId = cellId;

    // Highlight newly selected cell
    if (cellPolygons[cellId]) {
      cellPolygons[cellId].setStyle(GRID_CONFIG.selectedStyle);
      cellPolygons[cellId].bringToFront();
      var newTag = document.getElementById('grid-tag-' + cellId);
      if (newTag) newTag.classList.add('active');
    }

    var cellData = cellsData[cellId];

    // Expose for external access and 3D window caller
    window.__selectedGridSector = cellData;

    showBanner(cellData);

    // Emit event across app bus
    if (typeof bus !== 'undefined') {
      bus.emit('grid-selected', cellData);
      bus.emit('3d-view-requested', cellData);
    }

    // Open in-app 3D workstation window immediately
    if (typeof terrain3DWindow !== 'undefined' && typeof terrain3DWindow.openSector === 'function') {
      terrain3DWindow.openSector(cellData);
    }

    console.log('[PANEL_GRID] 8x8 Sector selected:', cellData);
  }

  function trigger3DView(cellId) {
    var cellData = cellsData[cellId];
    if (!cellData) return;

    if (typeof terrain3DWindow !== 'undefined' && typeof terrain3DWindow.openSector === 'function') {
      terrain3DWindow.openSector(cellData);
    } else if (typeof bus !== 'undefined') {
      bus.emit('3d-view-requested', cellData);
    }
  }

  function refreshNodeDistribution(passedNodes) {
    var allNodes = currentNodes(passedNodes);
    var covered = 0;

    for (var r = 0; r < GRID_CONFIG.rows; r++) {
      var rowName = GRID_CONFIG.rowNames[r];

      for (var c = 0; c < GRID_CONFIG.cols; c++) {
        var colName = GRID_CONFIG.colNames[c];
        var cellId = rowName + colName;

        var cellNodes = nodesInExtent(allNodes, cellExtentM(r, c));
        if (cellNodes.length > 0) covered++;

        if (cellsData[cellId]) {
          cellsData[cellId].nodes = cellNodes;
          cellsData[cellId].nodeCount = cellNodes.length;
        }

        if (cellPolygons[cellId]) {
          cellPolygons[cellId].setTooltipContent(tooltipFor(cellId, cellNodes.length));
          // Restyle: a cell that just gained or lost its nodes must change
          // between the grey "no coverage" look and the normal one.
          cellPolygons[cellId].setStyle(styleForCell(cellId));
        }
      }
    }

    console.log('[PANEL_GRID] Distribution over ' + allNodes.length + ' nodes: ' +
                covered + '/' + (GRID_CONFIG.rows * GRID_CONFIG.cols) + ' sectors covered');
  }

  function getSelectedSector() {
    return selectedCellId ? cellsData[selectedCellId] : null;
  }

  function getAllSectors() {
    return cellsData;
  }

  return {
    init: init,
    selectSector: selectSector,
    getSelectedSector: getSelectedSector,
    getAllSectors: getAllSectors,
    trigger3DView: trigger3DView,
    setGridVisible: function (on) { gridOn = !!on; applyVisibility(); },
    setLabelsVisible: function (on) { labelsOn = !!on; applyVisibility(); },
    setSurfaceVisible: function (on) { surfaceOn = !!on; restyleAllCells(); }
  };
})();
