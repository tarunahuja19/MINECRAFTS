'use strict';

// Tab switching
document.getElementById('tab-bar').addEventListener('click', function (e) {
  var btn = e.target.closest('.tab-btn');
  if (!btn) return;
  var tab = btn.dataset.tab;

  document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
  btn.classList.add('active');

  document.querySelectorAll('.tab-view').forEach(function (v) { v.style.display = 'none'; });
  var target = document.getElementById('tab-' + tab);
  if (target) target.style.display = 'flex';
  if (tab === 'map' && mapView.getMap()) {
    mapView.getMap().invalidateSize();
  }
});

// Ensure map tab is flex by default
document.getElementById('tab-map').style.display = 'flex';

// Initialize map and data layer
(function () {
  var map = mapView.init('map-container');

  // Leaflet needs a valid container size — force recalc after layout settles
  setTimeout(function () { map.invalidateSize(); }, 100);

  bus.on('nodes-loaded', function (nodes) {
    nodeMarkers.init(map, nodes);
  });

  mapLayers.loadPanelOutline(map, '../fixtures/panel_outline.geojson');
  mapLayers.loadRiskZones(map, '../fixtures/risk_zones.geojson');
  panelGrid.init(map);
  terrain3DWindow.init();
  mapTabs.init();
  areaSelect3D.init(map);

  nodeDetail.init();

  // Phase 3B — Alarm system modules
  alarmBanner.init();
  alarmDetail.init();
  troughOverlay.init(map);
  confidenceBadge.init(map);
  lastgaspMarker.init(map);
  ringFallback.init(map);
  zoomToAlarm.init();
  alarmHistory.init(['map-alarm-history-container', 'alarm-history-container']);

  // Phase 3C — System health & alert configuration
  statusBar.init();
  syncIndicator.init();
  nodeTable.init('node-health-table-container');
  nodeTable.init('node-table-container');
  mqttLog.init('mqtt-log-container');
  tierConfig.init('tier-config-container');
  smsContacts.init('sms-contacts-container');
  dispatchLog.init('dispatch-log-container');
  blastTest.init('blast-test-container');

  // Phase 3D — History & replay
  replayController.init(['map-replay-controller-container', 'replay-controller-container']);
  pastAlarms.init('past-alarms-container');
  nodeKillViewer.init('kill-viewer-container');
  fpSummary.init('fp-summary-container');

  // Phase 5 — Export report
  exportReport.init();

  // Phase 6 — Info Tab Interactive Reference
  if (typeof infoTab !== 'undefined' && infoTab.init) {
    infoTab.init();
  }

  var viewSwitcher = document.getElementById('panel-view-switcher');
  var btnViewBoth = document.getElementById('btn-view-both');
  var btnViewAlarm = document.getElementById('btn-view-alarm');
  var btnViewNode = document.getElementById('btn-view-node');
  var alarmPanel = document.getElementById('panel-alarm-detail');
  var nodePanel = document.getElementById('panel-node-detail');

  function setRightPanelView(mode) {
    if (btnViewBoth) btnViewBoth.classList.toggle('active', mode === 'both');
    if (btnViewAlarm) btnViewAlarm.classList.toggle('active', mode === 'alarm');
    if (btnViewNode) btnViewNode.classList.toggle('active', mode === 'node');

    if (mode === 'both') {
      if (alarmPanel) alarmPanel.style.display = 'block';
      if (nodePanel) nodePanel.style.display = 'block';
    } else if (mode === 'alarm') {
      if (alarmPanel) alarmPanel.style.display = 'block';
      if (nodePanel) nodePanel.style.display = 'none';
    } else if (mode === 'node') {
      if (alarmPanel) alarmPanel.style.display = 'none';
      if (nodePanel) nodePanel.style.display = 'block';
    }
  }

  if (btnViewBoth) btnViewBoth.addEventListener('click', function () { setRightPanelView('both'); });
  if (btnViewAlarm) btnViewAlarm.addEventListener('click', function () { setRightPanelView('alarm'); });
  if (btnViewNode) btnViewNode.addEventListener('click', function () { setRightPanelView('node'); });

  bus.on('alarm-detail-opened', function (alarm) {
    knotheChart.init('knothe-chart-container', alarm);
    dispatchStatus.render('dispatch-container', alarm);
    operatorActions.render('operator-actions-container', alarm);

    if (nodePanel && nodePanel.style.display !== 'none') {
      if (viewSwitcher) viewSwitcher.style.display = 'flex';
      setRightPanelView('both');
    }
  });

  bus.on('alarm-detail-closed', function () {
    knotheChart.destroy();
    if (viewSwitcher) viewSwitcher.style.display = 'none';
  });

  bus.on('detail-opened', function (data) {
    if (alarmPanel && alarmPanel.style.display !== 'none') {
      if (viewSwitcher) viewSwitcher.style.display = 'flex';
      setRightPanelView('both');
    } else {
      if (viewSwitcher) viewSwitcher.style.display = 'none';
    }
  });

  bus.on('detail-closed', function () {
    if (typeof strainChart !== 'undefined' && strainChart.destroy) {
      strainChart.destroy();
    }
    if (typeof tiltChart !== 'undefined' && tiltChart.destroy) {
      tiltChart.destroy();
    }
    if (viewSwitcher) viewSwitcher.style.display = 'none';
  });

  var btnCloseAll = document.getElementById('btn-close-all');
  if (btnCloseAll) {
    btnCloseAll.addEventListener('click', async function () {
      var confirmed = window.confirm(
        'STOP SIMULATION, WIPE DATABASE & QUIT?\n\n' +
        'This will halt the simulation engine, wipe runtime tables in PostgreSQL, and quit the application.'
      );
      if (!confirmed) return;

      btnCloseAll.textContent = 'CLOSING...';
      btnCloseAll.disabled = true;

      // Halt any local replay or simulation playback immediately
      if (typeof replayController !== 'undefined' && replayController.teardown) {
        replayController.teardown();
      }
      if (typeof fixtureProvider !== 'undefined' && fixtureProvider.stopReplay) {
        fixtureProvider.stopReplay();
      }

      var host = window.location.hostname || 'localhost';

      // 1. Stop simulation engine
      try {
        await fetch('http://' + host + ':8000/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' })
        });
      } catch (e) {}

      try {
        await fetch('http://' + host + ':8080/api/simulation/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop' })
        });
      } catch (e) {}

      // 2. Wipe database
      try {
        var res = await fetch('http://' + host + ':8080/api/system/reset', { method: 'POST' });
        var data = await res.json();
        bus.emit('system-reset', data);
      } catch (e) {}

      // 3. Reset local UI state
      bus.emit('alarms-loaded', []);
      bus.emit('simulation-status', { is_running: false, is_paused: false, state: 'STOPPED' });
      if (typeof alarmBanner !== 'undefined') {
        alarmBanner.hide();
        if (alarmBanner.updateBadge) alarmBanner.updateBadge(0);
      }
      if (typeof alarmDetail !== 'undefined' && alarmDetail.hide) {
        alarmDetail.hide();
      }

      // 4. Quit Electron via IPC
      if (window.r4 && window.r4.closeApp) {
        window.r4.closeApp();
      }
    });
  }

  modeSwitch.init();
})();
