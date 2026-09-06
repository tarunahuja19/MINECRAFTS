'use strict';

/**
 * Map Tabs, Windows 11 Snap Layouts & Snap Assist Tab Picker
 * 
 * Implements:
 * 1. Chrome-Style Tab Strip:
 *    - Pinned '2D OVERVIEW' tab (Leaflet master map).
 *    - Dynamic '3D: [Sector/Region]' tabs created on area selection.
 *    - Tab close (×) buttons and smooth fallback.
 * 2. Windows 11 Snap Layouts Flyout Menu:
 *    - Opens on hover over `#btn-snap-layout` (with grace timeout) or on click.
 *    - 5 Visual Box Layouts (no text numbers):
 *        1. Single Screen (1 Large Box - 100% Full View)
 *        2. 2-Split (50 / 50 Side-by-Side Vertical Columns)
 *        3. 3-Split (2 Above / 1 Below)
 *        4. 3-Split Vice Versa (1 Above / 2 Below)
 *        5. 4-Split Quadrants (2x2 Grid)
 *    - Interactive hover highlights individual boxes in terminal green (#00E676).
 * 3. Windows Snap Assist / Task View Tab Picker Animation:
 *    - When a split layout is selected, Pane 1 gets the active tab.
 *    - For remaining unassigned panes, Snap Assist displays miniature interactive
 *      window preview cards for all open tabs & quick sectors.
 *    - Clicking a card smoothly slots that window into the target pane!
 * 4. Multi-Engine Resizing:
 *    - Invalidate Leaflet and resizes all active MapLibre 3D instances.
 */
var mapTabs = (function () {
  var workspaceEl = null;
  var tabsTrackEl = null;
  var viewportEl = null;
  var snapBtnWrapper = null;
  var btnSnapLayout = null;
  var snapFlyout = null;
  var snapAssistOverlay = null;

  var tabs = {}; // id -> { id, title, sectorData, el }
  var tabOrder = [];
  var activeTabId = '2d';
  var currentLayout = 'single'; // 'single', 'split-2-col', 'split-3-top2-bottom1', 'split-3-top1-bottom2', 'split-4-quad'
  var tabCounter = 0;
  var flyoutHideTimer = null;

  // Slot assignments: slot 1..4 -> { tabId, sectorData, type: '2d'|'3d' }
  var slotAssignments = {
    1: { tabId: '2d', type: '2d' },
    2: null,
    3: null,
    4: null
  };

  var snapAssistPendingSlots = [];
  var snapAssistCurrentSlot = null;

  function init() {
    workspaceEl = document.getElementById('map-workspace');
    tabsTrackEl = document.getElementById('map-tabs-track');
    viewportEl = document.getElementById('map-workspace-viewport');
    snapBtnWrapper = document.getElementById('snap-btn-wrapper');
    btnSnapLayout = document.getElementById('btn-snap-layout');
    snapFlyout = document.getElementById('snap-layouts-flyout');
    snapAssistOverlay = document.getElementById('snap-assist-overlay');

    if (!workspaceEl || !tabsTrackEl || !viewportEl) {
      console.warn('[MAP_TABS] Workspace DOM elements not ready');
      return;
    }

    setupEventListeners();
    setup3DControls();
    setupSnapFlyout();
    setupSnapAssistEvents();
    setupPaneControls();

    // Listen on application bus for 3D selection events
    if (typeof bus !== 'undefined' && bus.on) {
      bus.on('3d-view-requested', function (sectorData) {
        open3DTab(sectorData);
      });
      bus.on('grid-selected', function (sectorData) {
        open3DTab(sectorData);
      });
    }

    console.log('[MAP_TABS] Initialized Windows Snap Layouts & Interactive Snap Assist');
  }

  function setupEventListeners() {
    var tabBtn2D = document.getElementById('tab-btn-2d');
    if (tabBtn2D) {
      tabBtn2D.addEventListener('click', function () {
        selectTab('2d');
      });
    }
  }

  /* --- Windows 11 Snap Layouts Flyout Menu --- */
  function setupSnapFlyout() {
    if (!snapBtnWrapper || !btnSnapLayout || !snapFlyout) return;

    // Open on hover over snap button or flyout menu with grace timeout
    snapBtnWrapper.addEventListener('mouseenter', function () {
      clearTimeout(flyoutHideTimer);
      showSnapFlyout();
    });

    snapBtnWrapper.addEventListener('mouseleave', function () {
      clearTimeout(flyoutHideTimer);
      flyoutHideTimer = setTimeout(function () {
        hideSnapFlyout();
      }, 250); // 250ms grace timeout matching Windows OS
    });

    // Toggle on click
    btnSnapLayout.addEventListener('click', function (e) {
      e.stopPropagation();
      if (snapFlyout.style.display === 'block') {
        hideSnapFlyout();
      } else {
        showSnapFlyout();
      }
    });

    // Wire clicks on layout cards
    var cards = snapFlyout.querySelectorAll('.snap-layout-card');
    cards.forEach(function (card) {
      card.addEventListener('click', function (e) {
        e.stopPropagation();
        var layout = this.getAttribute('data-layout');
        hideSnapFlyout();
        applyLayout(layout);
      });
    });

    // Dismiss flyout on outside click
    document.addEventListener('click', function (e) {
      if (!snapBtnWrapper.contains(e.target)) {
        hideSnapFlyout();
      }
    });
  }

  function showSnapFlyout() {
    if (!snapFlyout) return;
    snapFlyout.style.display = 'block';
    if (btnSnapLayout) btnSnapLayout.classList.add('active');

    // Highlight current layout card
    var cards = snapFlyout.querySelectorAll('.snap-layout-card');
    cards.forEach(function (card) {
      card.classList.toggle('active', card.getAttribute('data-layout') === currentLayout);
    });
  }

  function hideSnapFlyout() {
    if (!snapFlyout) return;
    snapFlyout.style.display = 'none';
    if (btnSnapLayout && currentLayout === 'single') {
      btnSnapLayout.classList.remove('active');
    }
  }

  /* --- Windows Snap Assist (Task View tab picker) --- */
  function setupSnapAssistEvents() {
    if (!snapAssistOverlay) return;

    var btnClose = document.getElementById('btn-snap-assist-close');
    var backdrop = document.getElementById('snap-assist-backdrop');

    if (btnClose) {
      btnClose.addEventListener('click', function () {
        dismissSnapAssist();
      });
    }
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        dismissSnapAssist();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && snapAssistOverlay.style.display !== 'none') {
        dismissSnapAssist();
      }
    });
  }

  function setupPaneControls() {
    // Maximize button on pane headers restores single screen
    var maxBtns = document.querySelectorAll('.btn-pane-max');
    maxBtns.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var slotId = parseInt(this.getAttribute('data-slot'), 10) || 1;
        maximizeSlot(slotId);
      });
    });
  }

  function maximizeSlot(slotId) {
    var assignment = slotAssignments[slotId];
    if (assignment && assignment.tabId) {
      selectTab(assignment.tabId);
    }
    applyLayout('single', slotId);
  }

  /* --- Layout Engine (5 Visual Layouts) --- */
  function applyLayout(layoutType, primarySlotOverride) {
    currentLayout = layoutType;
    if (!viewportEl) return;

    // Remove all previous layout classes
    viewportEl.classList.remove(
      'layout-single',
      'layout-2-split',
      'layout-3-top2-bottom1',
      'layout-3-top1-bottom2',
      'layout-4-quad'
    );

    var snapBtnText = document.getElementById('snap-btn-text');

    if (layoutType === 'single') {
      viewportEl.classList.add('layout-single');
      if (btnSnapLayout) btnSnapLayout.classList.remove('active');
      if (snapBtnText) snapBtnText.textContent = 'LAYOUTS';

      var targetSlot = primarySlotOverride || (activeTabId === '2d' ? 1 : 2);
      setActiveSingleSlot(targetSlot);
      resizeBothEngines();
      console.log('[MAP_TABS] Applied Single Screen Layout (100% full view)');
      return;
    }

    if (btnSnapLayout) btnSnapLayout.classList.add('active');
    if (snapBtnText) snapBtnText.textContent = 'SPLIT';

    var requiredSlots = [];
    if (layoutType === 'split-2-col') {
      viewportEl.classList.add('layout-2-split');
      requiredSlots = [1, 2];
    } else if (layoutType === 'split-3-top2-bottom1') {
      viewportEl.classList.add('layout-3-top2-bottom1');
      requiredSlots = [1, 2, 3];
    } else if (layoutType === 'split-3-top1-bottom2') {
      viewportEl.classList.add('layout-3-top1-bottom2');
      requiredSlots = [1, 2, 3];
    } else if (layoutType === 'split-4-quad') {
      viewportEl.classList.add('layout-4-quad');
      requiredSlots = [1, 2, 3, 4];
    }

    // In any split layout, Slot 1 is ALWAYS the 2D Overview Map
    assignTabToSlot(1, '2d');

    // Slot 2 is ALWAYS the active 3D tab or latest opened 3D tab or default sector E5
    var slot2TabId = null;
    var slot2Sector = null;
    if (activeTabId !== '2d' && tabs[activeTabId]) {
      slot2TabId = activeTabId;
      slot2Sector = tabs[activeTabId].sectorData;
    } else if (tabOrder.length > 0 && tabs[tabOrder[tabOrder.length - 1]]) {
      slot2TabId = tabOrder[tabOrder.length - 1];
      slot2Sector = tabs[slot2TabId].sectorData;
    } else {
      slot2Sector = { id: 'E5', title: '3D: SECTOR E5 (Active Face)', center: [18.6435, 79.5725], latRange: [18.6415, 18.6455], lngRange: [79.5705, 79.5745], nodes: ['N23', 'N24', 'N25', 'N31'] };
    }
    assignTabToSlot(2, slot2TabId, slot2Sector);

    // Resize both engines immediately so WebGL canvas gets new dimensions
    resizeBothEngines();

    // Determine unassigned slots for Snap Assist (slots 3 and 4)
    snapAssistPendingSlots = [];
    for (var i = 2; i < requiredSlots.length; i++) {
      var s = requiredSlots[i];
      snapAssistPendingSlots.push(s);
    }

    // Launch Snap Assist for the remaining slots (3-split or 4-split)
    if (snapAssistPendingSlots.length > 0) {
      promptSnapAssistNextSlot();
    }

    console.log('[MAP_TABS] Applied Layout:', layoutType, 'Required Panes:', requiredSlots.length);
  }

  function setActiveSingleSlot(slotId) {
    for (var i = 1; i <= 4; i++) {
      var slotEl = document.getElementById('pane-slot-' + i);
      if (slotEl) {
        slotEl.classList.toggle('active-single', i === slotId);
      }
    }
  }

  function promptSnapAssistNextSlot() {
    if (snapAssistPendingSlots.length === 0) {
      hideSnapAssist();
      resizeBothEngines();
      return;
    }

    snapAssistCurrentSlot = snapAssistPendingSlots.shift();
    showSnapAssist(snapAssistCurrentSlot);
  }

  function showSnapAssist(slotId) {
    if (!snapAssistOverlay) return;

    var promptEl = document.getElementById('snap-assist-prompt');
    if (promptEl) {
      promptEl.textContent = 'SELECT A WINDOW FOR PANE ' + slotId;
    }

    var cardsGrid = document.getElementById('snap-assist-cards-grid');
    if (!cardsGrid) return;
    cardsGrid.innerHTML = '';

    // Collect already assigned tab IDs in current layout
    var assignedTabIds = {};
    Object.keys(slotAssignments).forEach(function (k) {
      if (slotAssignments[k] && slotAssignments[k].tabId) {
        assignedTabIds[slotAssignments[k].tabId] = true;
      }
    });

    // 1. Available Open 3D Tabs
    var availableTabs = [];
    tabOrder.forEach(function (tId) {
      if (!assignedTabIds[tId] && tabs[tId]) {
        availableTabs.push({
          id: tId,
          title: tabs[tId].title,
          sectorData: tabs[tId].sectorData,
          type: '3d',
          icon: '🧊',
          desc: 'Real 3D Satellite DEM'
        });
      }
    });

    // 2. Quick-add suggestions if not enough tabs are open
    var defaultSectors = [
      { id: 'E5', title: '3D: SECTOR E5 (Active Face)', center: [18.6435, 79.5725], latRange: [18.6415, 18.6455], lngRange: [79.5705, 79.5745], nodes: ['N23', 'N24', 'N25', 'N31'] },
      { id: 'C3', title: '3D: SECTOR C3 (North Subsidence)', center: [18.6465, 79.5685], latRange: [18.6445, 18.6485], lngRange: [79.5665, 79.5705], nodes: ['N01', 'N02', 'N03', 'N04'] },
      { id: 'F6', title: '3D: SECTOR F6 (South Highwall)', center: [18.6405, 79.5755], latRange: [18.6385, 18.6425], lngRange: [79.5735, 79.5775], nodes: ['N15', 'N16', 'N17', 'N18'] },
      { id: 'A1', title: '3D: SECTOR A1 (NW Boundary)', center: [18.6495, 79.5655], latRange: [18.6475, 18.6515], lngRange: [79.5635, 79.5675], nodes: ['N09', 'N10'] }
    ];

    defaultSectors.forEach(function (sec) {
      var isAlreadyLoaded = false;
      Object.keys(slotAssignments).forEach(function (k) {
        if (slotAssignments[k] && slotAssignments[k].sectorData && slotAssignments[k].sectorData.id === sec.id) {
          isAlreadyLoaded = true;
        }
      });
      if (!isAlreadyLoaded) {
        availableTabs.push({
          id: 'quick-sector-' + sec.id,
          title: sec.title,
          sectorData: sec,
          type: '3d',
          icon: '🧊',
          desc: 'Quick Sector View'
        });
      }
    });

    // Render Preview Cards
    availableTabs.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'snap-assist-card';

      card.innerHTML =
        '<div class="snap-card-header">' +
          '<span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#00E676;"></span>' +
          '<span>' + item.title + '</span>' +
        '</div>' +
        '<div class="snap-card-preview">' +
          '<div class="snap-card-icon-badge">' +
            '<span style="font-size:22px;">' + item.icon + '</span>' +
            '<span style="font-family:\'Courier New\',monospace; font-size:9px; font-weight:bold; color:#E6EDF2;">' + item.type.toUpperCase() + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="snap-card-details">' +
          '<span>' + item.desc + '</span>' +
          '<span style="color:#00E676; font-weight:bold;">SELECT →</span>' +
        '</div>';

      card.addEventListener('click', function () {
        if (item.id.startsWith('quick-sector-')) {
          assignTabToSlot(slotId, null, item.sectorData);
        } else {
          assignTabToSlot(slotId, item.id);
        }

        // Animate & prompt next slot
        promptSnapAssistNextSlot();
      });

      cardsGrid.appendChild(card);
    });

    snapAssistOverlay.style.display = 'flex';
  }

  function hideSnapAssist() {
    if (snapAssistOverlay) snapAssistOverlay.style.display = 'none';
  }

  function dismissSnapAssist() {
    hideSnapAssist();
    // Auto-fill any remaining pending slots with available default sectors
    var defaults = [
      { id: 'C3', title: '3D: SECTOR C3', center: [18.6465, 79.5685], latRange: [18.6445, 18.6485], lngRange: [79.5665, 79.5705], nodes: ['N01', 'N02'] },
      { id: 'F6', title: '3D: SECTOR F6', center: [18.6405, 79.5755], latRange: [18.6385, 18.6425], lngRange: [79.5735, 79.5775], nodes: ['N15', 'N16'] },
      { id: 'A1', title: '3D: SECTOR A1', center: [18.6495, 79.5655], latRange: [18.6475, 18.6515], lngRange: [79.5635, 79.5675], nodes: ['N09', 'N10'] }
    ];
    while (snapAssistPendingSlots.length > 0) {
      var slot = snapAssistPendingSlots.shift();
      var defSec = defaults.shift() || defaults[0];
      assignTabToSlot(slot, null, defSec);
    }
    resizeBothEngines();
  }

  function assignTabToSlot(slotId, tabId, directSector) {
    var slotEl = document.getElementById('pane-slot-' + slotId);
    if (!slotEl) return;

    var titleEl = document.getElementById('slot-' + slotId + '-title');
    var sectorData = directSector;

    if (tabId && tabs[tabId]) {
      sectorData = tabs[tabId].sectorData;
    }

    if (slotId === 1) {
      slotAssignments[1] = { tabId: '2d', type: '2d' };
      if (titleEl) titleEl.textContent = '2D OVERVIEW';
      return;
    }

    var tName = sectorData ? (sectorData.id && sectorData.id !== 'CUSTOM' ? '3D: SECTOR ' + sectorData.id : '3D: TERRAIN') : ('3D VIEW ' + slotId);
    if (titleEl) titleEl.textContent = tName;
    slotAssignments[slotId] = { tabId: tabId, sectorData: sectorData, type: '3d' };

    load3DIntoSlot(slotId, sectorData);
  }

  function load3DIntoSlot(slotId, sectorData) {
    if (!sectorData) return;
    if (slotId === 2) {
      loadSectorIntoPrimary3DPane(sectorData);
      return;
    }

    var containerId = 'real-terrain-3d-map-' + slotId;
    var cont = document.getElementById(containerId);
    if (!cont || typeof realTerrain3D === 'undefined') return;

    var hudSec = document.getElementById('hud-stat-sector-' + slotId);
    if (hudSec) hudSec.textContent = sectorData.id || 'CUSTOM';

    var coordsEl = document.getElementById('terrain-pane-coords-' + slotId);
    if (coordsEl) {
      var latStr = '--', lngStr = '--';
      if (sectorData.latRange && sectorData.lngRange) {
        latStr = sectorData.latRange[0].toFixed(4) + '° - ' + sectorData.latRange[1].toFixed(4) + '°N';
        lngStr = sectorData.lngRange[0].toFixed(4) + '° - ' + sectorData.lngRange[1].toFixed(4) + '°E';
      } else if (sectorData.center) {
        latStr = sectorData.center[0].toFixed(4) + '°N';
        lngStr = sectorData.center[1].toFixed(4) + '°E';
      }
      coordsEl.textContent = latStr + ' | ' + lngStr;
    }

    requestAnimationFrame(function () {
      if (!realTerrain3D.getMap(containerId)) {
        realTerrain3D.init(containerId, sectorData);
      } else {
        realTerrain3D.loadSector(sectorData, containerId);
      }
      realTerrain3D.onResize(containerId);

      setTimeout(function () {
        realTerrain3D.onResize(containerId);
      }, 100);
      setTimeout(function () {
        realTerrain3D.onResize(containerId);
      }, 300);
    });
  }

  /* --- Tab Management & Switching --- */
  function open3DTab(sectorData) {
    if (!sectorData) return;

    var title = '3D: ';
    if (sectorData.id && sectorData.id !== 'CUSTOM') {
      title += 'SECTOR ' + sectorData.id;
    } else if (sectorData.latRange && sectorData.lngRange) {
      title += sectorData.latRange[0].toFixed(3) + '°, ' + sectorData.lngRange[0].toFixed(3) + '°';
    } else if (sectorData.center) {
      title += sectorData.center[0].toFixed(3) + '°N, ' + sectorData.center[1].toFixed(3) + '°E';
    } else {
      tabCounter++;
      title += 'AREA ' + tabCounter;
    }

    var existingTabId = null;
    tabOrder.forEach(function (id) {
      if (tabs[id] && tabs[id].sectorData && tabs[id].sectorData.id === sectorData.id && sectorData.id !== 'CUSTOM') {
        existingTabId = id;
      }
    });

    var tabId = existingTabId;
    if (!tabId) {
      tabCounter++;
      tabId = 'tab-3d-' + tabCounter;

      var tabEl = document.createElement('button');
      tabEl.className = 'map-tab';
      tabEl.id = 'tab-btn-' + tabId;
      tabEl.setAttribute('data-tab-id', tabId);
      tabEl.title = title;

      tabEl.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="map-tab-icon">' +
          '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>' +
          '<polyline points="3.27 6.96 12 12.01 20.73 6.96"/>' +
          '<line x1="12" y1="22.08" x2="12" y2="12"/>' +
        '</svg>' +
        '<span class="map-tab-title">' + title + '</span>' +
        '<span class="map-tab-close" title="Close Tab">×</span>';

      tabEl.addEventListener('click', function (e) {
        if (e.target.closest('.map-tab-close')) {
          close3DTab(tabId, e);
          return;
        }
        selectTab(tabId);
      });

      tabsTrackEl.appendChild(tabEl);

      tabs[tabId] = {
        id: tabId,
        title: title,
        sectorData: sectorData,
        el: tabEl
      };
      tabOrder.push(tabId);
    } else {
      tabs[tabId].sectorData = sectorData;
      tabs[tabId].title = title;
      var titleSpan = tabs[tabId].el.querySelector('.map-tab-title');
      if (titleSpan) titleSpan.textContent = title;
    }

    // Activate this tab
    selectTab(tabId);

    // If currently in multi-split mode, update the secondary slot with this new sector
    if (currentLayout !== 'single') {
      assignTabToSlot(2, tabId);
    }

    console.log('[MAP_TABS] Opened 3D Tab:', tabId, title);
  }

  function selectTab(tabId) {
    if (tabId !== '2d' && !tabs[tabId]) {
      tabId = '2d';
    }
    activeTabId = tabId;

    var tabBtn2D = document.getElementById('tab-btn-2d');
    if (tabBtn2D) {
      tabBtn2D.classList.toggle('active', tabId === '2d');
    }
    tabOrder.forEach(function (id) {
      if (tabs[id] && tabs[id].el) {
        tabs[id].el.classList.toggle('active', id === tabId);
      }
    });

    if (currentLayout === 'single') {
      // In single mode, activate slot 1 (for 2D) or slot 2 (for 3D)
      var targetSlot = (tabId === '2d') ? 1 : 2;
      setActiveSingleSlot(targetSlot);

      if (tabId !== '2d' && tabs[tabId]) {
        assignTabToSlot(2, tabId);
      }
    } else {
      // In split layout, assign clicked tab to the appropriate slot
      if (tabId === '2d') {
        assignTabToSlot(1, '2d');
      } else if (tabs[tabId]) {
        assignTabToSlot(2, tabId);
      }
    }

    resizeBothEngines();
  }

  function close3DTab(tabId, e) {
    if (e) e.stopPropagation();

    var tabInfo = tabs[tabId];
    if (!tabInfo) return;

    if (tabInfo.el && tabInfo.el.parentNode) {
      tabInfo.el.parentNode.removeChild(tabInfo.el);
    }

    delete tabs[tabId];
    var idx = tabOrder.indexOf(tabId);
    if (idx !== -1) tabOrder.splice(idx, 1);

    if (activeTabId === tabId) {
      if (tabOrder.length > 0) {
        var nextTabId = tabOrder[Math.max(0, idx - 1)];
        selectTab(nextTabId);
      } else {
        if (currentLayout !== 'single') {
          applyLayout('single');
        }
        selectTab('2d');
      }
    } else if (tabOrder.length === 0 && currentLayout !== 'single') {
      applyLayout('single');
    }

    console.log('[MAP_TABS] Closed 3D Tab:', tabId);
  }

  function loadSectorIntoPrimary3DPane(sectorData) {
    if (!sectorData) return;

    var coordsEl = document.getElementById('terrain-pane-coords');
    if (coordsEl) {
      var latStr = '--';
      var lngStr = '--';
      if (sectorData.latRange && sectorData.lngRange) {
        latStr = sectorData.latRange[0].toFixed(4) + '° - ' + sectorData.latRange[1].toFixed(4) + '°N';
        lngStr = sectorData.lngRange[0].toFixed(4) + '° - ' + sectorData.lngRange[1].toFixed(4) + '°E';
      } else if (sectorData.center) {
        latStr = sectorData.center[0].toFixed(4) + '°N';
        lngStr = sectorData.center[1].toFixed(4) + '°E';
      }
      coordsEl.textContent = latStr + ' | ' + lngStr;
    }

    var hudSector = document.getElementById('hud-stat-sector');
    if (hudSector) {
      hudSector.textContent = (sectorData.id === 'CUSTOM') ? 'CUSTOM AREA' : (sectorData.id || '--');
    }

    var count = populateNodeSidebar(sectorData);
    var hudCount = document.getElementById('hud-stat-sensor-count');
    if (hudCount) hudCount.textContent = count + ' Sensors Detected';
    var sidebarHeader = document.getElementById('terrain-sidebar-header');
    if (sidebarHeader) sidebarHeader.textContent = 'REGION SENSORS (' + count + ')';

    requestAnimationFrame(function () {
      if (typeof realTerrain3D !== 'undefined') {
        if (!realTerrain3D.getMap('real-terrain-3d-map')) {
          realTerrain3D.init('real-terrain-3d-map', sectorData);
        } else {
          realTerrain3D.loadSector(sectorData, 'real-terrain-3d-map');
        }
        realTerrain3D.onResize('real-terrain-3d-map');
        setTimeout(function () {
          realTerrain3D.onResize('real-terrain-3d-map');
        }, 100);
        setTimeout(function () {
          realTerrain3D.onResize('real-terrain-3d-map');
        }, 300);
      }
    });
  }

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

  function populateNodeSidebar(sector) {
    var container = document.getElementById('terrain-node-list-container');
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
    if (sector.nodes && Array.isArray(sector.nodes) && sector.nodes.length > 0) {
      sector.nodes.forEach(function (nodeItem) {
        var nodeId = (typeof nodeItem === 'object' && nodeItem !== null) ? nodeItem.node_id : nodeItem;
        var n = nodeMap[nodeId] || (typeof nodeItem === 'object' ? nodeItem : null);
        if (n) targetNodes.push(n);
      });
    } else if (sector.latRange && sector.lngRange) {
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
    } else if (sector.bounds && Array.isArray(sector.bounds) && sector.bounds.length >= 2) {
      var b0 = sector.bounds[0];
      var b1 = sector.bounds[1];
      var lat1 = (b0[0] < 50) ? b0[0] : b0[1];
      var lng1 = (b0[0] < 50) ? b0[1] : b0[0];
      var lat2 = (b1[0] < 50) ? b1[0] : b1[1];
      var lng2 = (b1[0] < 50) ? b1[1] : b1[0];
      var bMinLat = Math.min(lat1, lat2);
      var bMaxLat = Math.max(lat1, lat2);
      var bMinLng = Math.min(lng1, lng2);
      var bMaxLng = Math.max(lng1, lng2);
      allNodes.forEach(function (n) {
        var lat = n.lat;
        var lng = n.lng;
        if (typeof lat !== 'number' && typeof n.x === 'number' && typeof mapView !== 'undefined' && mapView.xyToLatLon) {
          var p = mapView.xyToLatLon(n.x, n.y);
          lat = p[0]; lng = p[1];
        }
        if (typeof lat === 'number' && typeof lng === 'number' && lat >= bMinLat && lat <= bMaxLat && lng >= bMinLng && lng <= bMaxLng) {
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
      var strainVal = t ? (t.strain_ustrain || t.strain_ue || 142) : (state === 'critical' ? 890 : 142);
      var strainStr = strainVal + ' µε';
      var tiltStr = t ? (t.tilt_x_mdeg || 0) + ' mdeg' : '-32 mdeg';

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

  function resizeBothEngines() {
    requestAnimationFrame(function () {
      if (typeof mapView !== 'undefined' && mapView.getMap()) {
        mapView.getMap().invalidateSize();
      }
      if (typeof realTerrain3D !== 'undefined') {
        realTerrain3D.onResize();
      }

      setTimeout(function () {
        if (typeof mapView !== 'undefined' && mapView.getMap()) {
          mapView.getMap().invalidateSize();
        }
        if (typeof realTerrain3D !== 'undefined') {
          realTerrain3D.onResize();
        }
      }, 120);

      setTimeout(function () {
        if (typeof mapView !== 'undefined' && mapView.getMap()) {
          mapView.getMap().invalidateSize();
        }
        if (typeof realTerrain3D !== 'undefined') {
          realTerrain3D.onResize();
        }
      }, 320);

      setTimeout(function () {
        if (typeof mapView !== 'undefined' && mapView.getMap()) {
          mapView.getMap().invalidateSize();
        }
        if (typeof realTerrain3D !== 'undefined') {
          realTerrain3D.onResize();
        }
      }, 500);
    });
  }

  function setupSlotToolbar(slotId, containerId) {
    var suffix = (slotId === 2) ? '' : ('-' + slotId);
    var btnTilt65 = document.getElementById('btn-cam-tilt65' + suffix);
    var btnTilt0 = document.getElementById('btn-cam-tilt0' + suffix);
    var btnTilt78 = document.getElementById('btn-cam-tilt78' + suffix);

    function setActiveTiltBtn(activeBtn) {
      [btnTilt65, btnTilt0, btnTilt78].forEach(function (b) {
        if (b) b.classList.remove('active');
      });
      if (activeBtn) activeBtn.classList.add('active');
    }

    if (btnTilt65) {
      btnTilt65.addEventListener('click', function () {
        setActiveTiltBtn(this);
        if (typeof realTerrain3D !== 'undefined') realTerrain3D.setCameraPreset('iso', containerId);
      });
    }
    if (btnTilt0) {
      btnTilt0.addEventListener('click', function () {
        setActiveTiltBtn(this);
        if (typeof realTerrain3D !== 'undefined') realTerrain3D.setCameraPreset('top', containerId);
      });
    }
    if (btnTilt78) {
      btnTilt78.addEventListener('click', function () {
        setActiveTiltBtn(this);
        if (typeof realTerrain3D !== 'undefined') realTerrain3D.setCameraPreset('steep', containerId);
      });
    }

    var exagBtns = {
      1: document.getElementById('btn-exag-1' + suffix),
      3: document.getElementById('btn-exag-3' + suffix),
      5: document.getElementById('btn-exag-5' + suffix)
    };
    Object.keys(exagBtns).forEach(function (factor) {
      var btn = exagBtns[factor];
      if (!btn) return;
      btn.addEventListener('click', function () {
        Object.keys(exagBtns).forEach(function (f) {
          if (exagBtns[f]) exagBtns[f].classList.remove('active');
        });
        this.classList.add('active');
        if (typeof realTerrain3D !== 'undefined') {
          realTerrain3D.setExaggeration(parseFloat(factor), containerId);
        }
      });
    });

    function getSlotSector() {
      if (typeof slotAssignments !== 'undefined' && slotAssignments[slotId] && slotAssignments[slotId].sectorData) {
        return slotAssignments[slotId].sectorData;
      }
      if (typeof tabs !== 'undefined' && typeof activeTabId !== 'undefined' && tabs[activeTabId] && tabs[activeTabId].sectorData) {
        return tabs[activeTabId].sectorData;
      }
      return null;
    }

    var btnEarth = document.getElementById('btn-launch-google-earth' + suffix);
    if (btnEarth) {
      btnEarth.addEventListener('click', function () {
        var sec = getSlotSector();
        if (sec && sec.center) {
          var c = sec.center;
          var earthUrl = 'https://earth.google.com/web/@' + c[0] + ',' + c[1] + ',200a,600d,35y,30h,60t,0r';
          window.open(earthUrl, '_blank');
        }
      });
    }

    var btnPopout = document.getElementById('btn-win-popout' + suffix);
    if (btnPopout) {
      btnPopout.addEventListener('click', function () {
        var sec = getSlotSector();
        var winUrl = '3d-window.html';
        if (sec && sec.id) {
          winUrl += '?sector=' + encodeURIComponent(sec.id);
        }
        window.open(winUrl, 'Terrain3D_Popout_' + slotId, 'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
      });
    }
  }

  function setup3DControls() {
    setupSlotToolbar(2, 'real-terrain-3d-map');
    setupSlotToolbar(3, 'real-terrain-3d-map-3');
    setupSlotToolbar(4, 'real-terrain-3d-map-4');
  }

  return {
    init: init,
    open3DTab: open3DTab,
    selectTab: selectTab,
    close3DTab: close3DTab,
    applyLayout: applyLayout,
    showSnapFlyout: showSnapFlyout,
    hideSnapFlyout: hideSnapFlyout,
    getCurrentLayout: function () { return currentLayout; },
    getActiveTabId: function () { return activeTabId; },
    resizeBothEngines: resizeBothEngines
  };
})();
