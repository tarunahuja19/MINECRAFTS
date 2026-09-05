'use strict';

/**
 * Panel Grid Module
 * Subdivides Panel A Extraction Phase into an 8x8 interactive sector grid (64 sectors: A1 to H8).
 * Prepared for 3D terrain window launching per individual grid sector.
 */
var panelGrid = (function () {
  var map = null;
  var gridGroup = null;
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
    bounds: {
      minLat: 23.7395,
      maxLat: 23.7485,
      minLng: 86.4140,
      maxLng: 86.4250
    },
    defaultStyle: {
      color: 'rgba(90, 143, 168, 0.45)',
      weight: 0.9,
      dashArray: '3, 3',
      fillColor: 'rgba(90, 143, 168, 0.02)',
      fillOpacity: 0.02,
      interactive: true
    },
    hoverStyle: {
      color: '#38BDF8',
      weight: 1.6,
      dashArray: 'none',
      fillColor: 'rgba(56, 189, 248, 0.18)',
      fillOpacity: 0.18
    },
    selectedStyle: {
      color: '#00E5FF',
      weight: 2.2,
      dashArray: 'none',
      fillColor: 'rgba(0, 229, 255, 0.26)',
      fillOpacity: 0.26
    }
  };

  function init(mapInstance) {
    map = mapInstance;
    if (!map) return;

    createHUDNotificationBanner();
    buildGrid();

    if (typeof bus !== 'undefined') {
      bus.on('nodes-loaded', function (nodes) {
        refreshNodeDistribution(nodes);
      });
      bus.on('replay-started', function () {
        refreshNodeDistribution();
      });
      bus.on('telemetry', function () {
        // Live telemetry listener
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
    tagMarkers = {};
    cellPolygons = {};
    cellsData = {};

    var b = GRID_CONFIG.bounds;
    var rowHeight = (b.maxLat - b.minLat) / GRID_CONFIG.rows;
    var colWidth = (b.maxLng - b.minLng) / GRID_CONFIG.cols;

    var allNodes = [];
    if (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      var n = fixtureProvider.getNodes();
      if (Array.isArray(n)) allNodes = n;
    }

    for (var r = 0; r < GRID_CONFIG.rows; r++) {
      var rowName = GRID_CONFIG.rowNames[r];
      var north = b.maxLat - r * rowHeight;
      var south = north - rowHeight;

      for (var c = 0; c < GRID_CONFIG.cols; c++) {
        var colName = GRID_CONFIG.colNames[c];
        var west = b.minLng + c * colWidth;
        var east = west + colWidth;
        var cellId = rowName + colName;

        // Correlate sensor nodes inside this 8x8 cell
        var cellNodes = [];
        for (var i = 0; i < allNodes.length; i++) {
          var node = allNodes[i];
          if (node.lat >= south && node.lat < north && node.lng >= west && node.lng < east) {
            cellNodes.push(node.node_id);
          }
        }

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
          nodeCount: cellNodes.length,
          nodes: cellNodes
        };

        cellsData[cellId] = cellData;

        // Create polygon for cell
        var polyOpts = Object.assign({}, GRID_CONFIG.defaultStyle, { pane: 'gridPane' });
        var polygon = L.polygon(
          [[south, west], [south, east], [north, east], [north, west]],
          polyOpts
        );
        polygon._cellId = cellId;

        // Tooltip
        var tooltipHtml = 
          '<div class="grid-tooltip-content">' +
            '<div class="grid-tooltip-title">PANEL A : SECTOR ' + cellId + '</div>' +
            '<div class="grid-tooltip-info">' + cellNodes.length + ' Sensor Nodes Active</div>' +
            '<div class="grid-tooltip-hint">⚡ CLICK FOR 3D TERRAIN VIEW</div>' +
          '</div>';

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
            this.setStyle(GRID_CONFIG.defaultStyle);
          }
        });

        polygon.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          selectSector(this._cellId);
        });

        polygon.addTo(gridGroup);
        cellPolygons[cellId] = polygon;

        // Watermark Label at top-left corner of each 8x8 cell
        var labelLat = north - (rowHeight * 0.16);
        var labelLng = west + (colWidth * 0.08);

        var tagIcon = L.divIcon({
          className: 'grid-cell-watermark-icon',
          html: '<div class="grid-cell-watermark" id="grid-tag-' + cellId + '">' + cellId + '</div>',
          iconSize: [22, 14],
          iconAnchor: [0, 0]
        });

        var tagMarker = L.marker([labelLat, labelLng], { icon: tagIcon, interactive: false });
        tagMarker.addTo(gridGroup);
        tagMarkers[cellId] = tagMarker;
      }
    }

    gridGroup.addTo(map);
  }

  function selectSector(cellId) {
    if (!cellsData[cellId]) return;

    // Reset previously selected cell
    if (selectedCellId && cellPolygons[selectedCellId]) {
      cellPolygons[selectedCellId].setStyle(GRID_CONFIG.defaultStyle);
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
    var allNodes = [];
    if (Array.isArray(passedNodes)) {
      allNodes = passedNodes;
    } else if (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      var n = fixtureProvider.getNodes();
      if (Array.isArray(n)) allNodes = n;
    }

    var b = GRID_CONFIG.bounds;
    var rowHeight = (b.maxLat - b.minLat) / GRID_CONFIG.rows;
    var colWidth = (b.maxLng - b.minLng) / GRID_CONFIG.cols;

    for (var r = 0; r < GRID_CONFIG.rows; r++) {
      var rowName = GRID_CONFIG.rowNames[r];
      var north = b.maxLat - r * rowHeight;
      var south = north - rowHeight;

      for (var c = 0; c < GRID_CONFIG.cols; c++) {
        var colName = GRID_CONFIG.colNames[c];
        var west = b.minLng + c * colWidth;
        var east = west + colWidth;
        var cellId = rowName + colName;

        var cellNodes = [];
        for (var i = 0; i < allNodes.length; i++) {
          var node = allNodes[i];
          if (node.lat >= south && node.lat < north && node.lng >= west && node.lng < east) {
            cellNodes.push(node.node_id);
          }
        }

        if (cellsData[cellId]) {
          cellsData[cellId].nodes = cellNodes;
          cellsData[cellId].nodeCount = cellNodes.length;
        }

        if (cellPolygons[cellId]) {
          var tooltipHtml = 
            '<div class="grid-tooltip-content">' +
              '<div class="grid-tooltip-title">PANEL A : SECTOR ' + cellId + '</div>' +
              '<div class="grid-tooltip-info">' + cellNodes.length + ' Sensor Nodes Active</div>' +
              '<div class="grid-tooltip-hint">⚡ CLICK FOR 3D TERRAIN VIEW</div>' +
            '</div>';
          cellPolygons[cellId].setTooltipContent(tooltipHtml);
        }
      }
    }
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
    trigger3DView: trigger3DView
  };
})();
