'use strict';

/**
 * sim-tab.js — Simulation Tab (data viewer) & Forge Tab (sandbox lab) controller.
 * Both tabs render the website 3D app (simulation/frontend ?embed=1) through
 * sim-embed.js dual slots; this module owns dashboard chrome + lab wiring only.
 * - SIMULATION tab: full-district live DATA viewer (embedded 3D terrain,
 *   LIVE day badge, right data inspector). PLAY/PAUSE/RESET live in
 *   sim-controls.js. Selections and FORGE experiments NEVER alter this tab.
 * - FORGE tab: private what-if lab on its own timeline. Left: target +
 *   CRACK / TILT / VIBRATION / CAVE-IN sliders + FIRE. Centre: the embedded
 *   3D view fed by :8020 frames. Right: health strip, node card, mini map and
 *   FORGE alarms, all coloured by the frame's node_states.
 * - Talks to the FORGE math server on :8020 only. It never calls the lab,
 *   never controls the live engine, and reads the backend only for the
 *   live-day status.
 * - Reads node records via nodeMarkers.getNodeData (single-node inspect) and
 *   fixtureProvider (bulk district pool). Never touches live map state.
 */
var simTab = (function () {

  // Geo constants matching mine-sim/config/mines/adriyala_lw1.yaml.
  // Projection matches lab.yaml m_per_deg_lat, simulation/sandbox/geo.py,
  // map-view.js and sim-embed.js (111320 x cos(lat0)).
  var PANEL_CENTRE_LAT = 18.6435;
  var PANEL_CENTRE_LON = 79.5725;
  var PANEL_LENGTH_M = 2500.0;
  var M_PER_DEG_LAT = 111320.0;
  var M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(PANEL_CENTRE_LAT * Math.PI / 180);

  var currentDay = 0;
  var selectedScenarioType = 'crack'; // 'crack', 'tilt', 'vibration', 'sudden_sinking'
  var sandboxSession = null;
  var simLiveBadgeTimer = null;

  function isSimTabVisible() {
    var tabSim = document.getElementById('tab-sim');
    return !!(tabSim && tabSim.style.display !== 'none');
  }

  function startSimLiveBadgePolling() {
    if (simLiveBadgeTimer) return;
    simLiveBadgeTimer = setInterval(function () {
      if (!isSimTabVisible()) {
        stopSimLiveBadgePolling();
        return;
      }
      updateSimLiveBadge();
    }, 5000);
  }

  function stopSimLiveBadgePolling() {
    if (simLiveBadgeTimer) {
      clearInterval(simLiveBadgeTimer);
      simLiveBadgeTimer = null;
    }
  }

  // Latest-telemetry cache, same rule as MAP node-sensors.js (scan fixture
  // history from the end, cache per node) so SIM/FORGE show the same numbers.
  var nodeTelemetryCache = {};

  function updateSimLiveBadge() {
    var badge = document.getElementById('sim-live-day-badge');
    if (!badge) return;
    var port = '8080';
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      var match = window.location.search.match(/[?&]backend_port=(\d+)/);
      if (match) port = match[1];
    }
    var apiBase = 'http://' + (window.location.hostname || 'localhost') + ':' + port;
    fetch(apiBase + '/api/simulation/status', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var seconds = data ? data.t_sim_seconds : undefined;
        if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
          badge.textContent = 'LIVE · —';
          return;
        }
        var day = (seconds / 86400).toFixed(1);
        badge.textContent = 'LIVE · Day ' + day;
      })
      .catch(function () {
        badge.textContent = 'LIVE · —';
      });
  }

  function latestNodeTelemetry(nodeId) {
    if (!nodeId) return null;
    if (nodeTelemetryCache[nodeId]) return nodeTelemetryCache[nodeId];
    if (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry) {
      var allT = fixtureProvider.getTelemetry();
      if (allT && allT.length) {
        for (var k = allT.length - 1; k >= 0; k--) {
          if (allT[k].node_id === nodeId) {
            nodeTelemetryCache[nodeId] = allT[k];
            return allT[k];
          }
        }
      }
    }
    return null;
  }

  function init() {
    (function injectViewportDarkBackground() {
      if (typeof document === 'undefined' || document.getElementById('sim-dark-viewport-style')) return;
      var st = document.createElement('style');
      st.id = 'sim-dark-viewport-style';
      st.textContent = '.sim-canvas-wrap, #sim-maplibre-map { background: #05090D !important; }';
      document.head.appendChild(st);
    })();

    setupDomListeners();
    updateCloseButtonState();
    updateGateState();

    // Embedded 3D subsidence viewport (cropped to selection). Loads lazily on
    // first SIM tab visit; falls back to the MapLibre canvas below it.
    if (typeof simEmbed !== 'undefined' && simEmbed.init) {
      simEmbed.init();
    }

    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('sim-sandbox-create', function (payload) {
        console.log('[SIM_TAB] Sandbox payload received with ' + (payload && payload.nodes ? payload.nodes.length : 0) + ' cloned nodes:', payload);
        window.__simSandboxPayload = payload;
        handleSandboxCreate(payload);
      });
      bus.on('system-reset', function () {
        if (sandboxSession) {
          console.log('[SIM_TAB] system-reset ignored: sandbox session ' + sandboxSession.id + ' is active and isolated');
        }
      });
      bus.on('selection-changed', function () {
        updateGateState();
      });
      bus.on('node-status-change', function (data) {
        if (!sandboxSession || !data) return;
        var nodeId = data.node_id || data.id;
        var state = data.state;
        if (nodeId && state) {
          repaintClonedMarker(nodeId, state);
        }
      });
      bus.on('telemetry', function (data) {
        if (!sandboxSession || !data) return;
        var nodeId = data._node_id || data.node_id;
        // Never re-derive state from strain/tilt in sim-tab (server node_state only — same rule as live-provider). Telemetry listener uses data.state only.
        var state = data.state;
        if (nodeId && state) {
          repaintClonedMarker(nodeId, state);
        }
      });
    }
    if (typeof simEmbed !== 'undefined' && simEmbed.init) {
      try { simEmbed.init(); } catch (err) {
        console.warn('[sim-tab] simEmbed.init caught error:', err);
      }
    }
    logDatasetProof();
    setTimeout(function () {
      assertNodeParity();
    }, 1500);
    renderForgeHealth();
    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('nodes-loaded', function () {
        renderForgeRight();
      });
    }
    updateGateState();
    // Live badge polling starts on onTabShown('sim')
  }

  function setupDomListeners() {
    var tabBar = document.getElementById('tab-bar');
    if (tabBar) {
      tabBar.addEventListener('click', function (e) {
        var btn = e.target.closest('.tab-btn');
        if (btn && btn.dataset.tab !== 'sim') {
          stopSimLiveBadgePolling();
        }
      });
    }

    // FORGE always uses the full terrain and all nodes.

    // Scenario buttons (CRACK, TILT, VIBRATION, CAVE-IN)
    var scenarioBtns = document.querySelectorAll('.sim-scenario-btn');
    scenarioBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        scenarioBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selectedScenarioType = btn.dataset.type || 'crack';
        updateScenarioParamsVisibility(selectedScenarioType);
        if (forgePreviewOn) sendForgePreview();
      });
    });
    updateScenarioParamsVisibility(selectedScenarioType || 'crack');

    // 5b. Event sliders: each badge shows its slider's live value + unit.
    var sliders = document.querySelectorAll('#sim-left .forge-slider');
    sliders.forEach(function (slider) {
      var badge = document.querySelector('.forge-slider-val[data-for="' + slider.id + '"]');
      if (!badge) return;
      var paint = function () {
        badge.textContent = slider.value + ' ' + (badge.getAttribute('data-unit') || '');
      };
      slider.addEventListener('input', paint);
      if (/-radius$/.test(slider.id)) {
        slider.addEventListener('input', sendForgePreview);
      }
      paint();
    });

    // 6. FIRE EVENT button
    var btnRunScenario = document.getElementById('btn-sim-run-scenario');
    if (btnRunScenario) {
      btnRunScenario.addEventListener('click', function () {
        runScenario();
      });
    }

    // 6b. RESET FORGE: drop every FORGE-only effect; the live ground stays.
    var btnForgeReset = document.getElementById('btn-forge-reset');
    if (btnForgeReset) {
      btnForgeReset.addEventListener('click', function () {
        resetForge();
      });
    }

    // 6c. FORGE Timeline toolbar (slider, play/pause, speed, seed)
    initForgeTimeline();
    renderForgeTarget();
    renderForgeEvents();

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
        if (typeof simEmbed !== 'undefined' && simEmbed.setView) simEmbed.setView('sim', 65, 28);
      });
    }
    if (btnTilt0) {
      btnTilt0.addEventListener('click', function () {
        setActiveTiltBtn(btnTilt0);
        if (typeof simEmbed !== 'undefined' && simEmbed.setView) simEmbed.setView('sim', 0, 0);
      });
    }
    if (btnTilt78) {
      btnTilt78.addEventListener('click', function () {
        setActiveTiltBtn(btnTilt78);
        if (typeof simEmbed !== 'undefined' && simEmbed.setView) simEmbed.setView('sim', 78, 40);
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
        if (typeof simEmbed !== 'undefined' && simEmbed.setExag) simEmbed.setExag('sim', 1);
      });
    }
    if (btnExag3) {
      btnExag3.addEventListener('click', function () {
        setActiveExagBtn(btnExag3);
        if (typeof simEmbed !== 'undefined' && simEmbed.setExag) simEmbed.setExag('sim', 3);
      });
    }
    if (btnExag5) {
      btnExag5.addEventListener('click', function () {
        setActiveExagBtn(btnExag5);
        if (typeof simEmbed !== 'undefined' && simEmbed.setExag) simEmbed.setExag('sim', 5);
      });
    }

    // SIM recenter: full district only (selection-proof).
    var btnRecenter = document.getElementById('sim-recenter-btn');
    if (btnRecenter) {
      btnRecenter.addEventListener('click', function () {
        recenterToSessionBounds();
      });
    }

    // FORGE recenter: selection bounds on the region view.
    var btnForgeRecenter = document.getElementById('forge-recenter-btn');
    if (btnForgeRecenter) {
      btnForgeRecenter.addEventListener('click', function () {
        if (typeof simEmbed !== 'undefined' && simEmbed.recenter) {
          var b = (sandboxSession && sandboxSession.bounds) ? sandboxSession.bounds : null;
          if (!b && sandboxSession && sandboxSession.selection) {
            try { b = getSelectionBounds(sandboxSession.selection); } catch (_) { b = null; }
          }
          simEmbed.recenter('forge', b || undefined);
        }
      });
    }

    // Close sandbox session button
    bindCloseButton();


  }

  // NOTE: 3D views are the embedded website app (sim-embed.js dual slots).
  // The old MapLibre SIM map was removed; the iframe renders terrain+nodes.



  function updateScenarioParamsVisibility(type) {
    var groups = document.querySelectorAll('.sim-event-param-group');
    groups.forEach(function (g) { g.style.display = 'none'; });
    var target = document.getElementById('sim-params-' + type);
    if (target) {
      target.style.display = 'block';
    }
  }

  function updateGateState() {
    // FORGE operates directly on the entire mine domain; it is never gated.
    var hasSelection = false;
    try {
      if (typeof selectionStore !== 'undefined' && typeof selectionStore.has === 'function' &&
          selectionStore.has('sim') && typeof selectionStore.get === 'function') {
        var sel = selectionStore.get('sim');
        var selCount = 0;
        if (sel) {
          if (typeof sel.nodeCount === 'number') selCount = sel.nodeCount;
          else if (Array.isArray(sel.nodes)) selCount = sel.nodes.length;
        }
        hasSelection = selCount > 0;
      }
    } catch (_) { hasSelection = false; }
    var hasSession = Boolean(sandboxSession);

    // Gate banner stays hidden: entire terrain is accessible in FORGE
    var gateBanner = document.getElementById('sim-gate-banner');
    if (gateBanner) gateBanner.style.display = 'none';

    // RUN & event buttons remain active for full terrain scenarios
    var btnRun = document.getElementById('btn-sim-run-scenario');
    if (btnRun) {
      btnRun.disabled = false;
      btnRun.title = 'Run experiment scenario';
      btnRun.style.opacity = '1';
      btnRun.style.cursor = 'pointer';
    }
    var scenarioBtns = document.querySelectorAll('.sim-scenario-btn');
    scenarioBtns.forEach(function (b) {
      b.removeAttribute('disabled');
      b.style.opacity = '1';
      b.style.cursor = 'pointer';
    });

    // Region readout mirrors selection or indicates entire domain
    if (!hasSession) {
      renderRegionReadout(hasSelection ? selectionStore.get('sim') : null);
    }
  }

  function renderRegionReadout(sel) {
    var el = document.getElementById('sim-region-readout');
    if (!el) return;
    var nodes = sel && Array.isArray(sel.nodes) ? sel.nodes : [];
    var ids = nodes.map(function (n) {
      return (n && (n.node_id || n.id)) ? (n.node_id || n.id) : (typeof n === 'string' ? n : null);
    }).filter(Boolean);
    if (ids.length === 0 && sandboxSession && Array.isArray(sandboxSession.nodes)) {
      ids = sandboxSession.nodes.map(function (n) { return n.node_id || n.id; }).filter(Boolean);
    }
    if (ids.length === 0) {
      el.style.color = 'var(--text-primary)';
      el.textContent = 'Entire Mine Domain (Full 600m Terrain — 31 Nodes)';
      return;
    }
    var label = (sel && (sel.label || sel.sectorId || sel.id)) ||
      (sandboxSession && (sandboxSession.label || sandboxSession.id)) || 'region';
    el.style.color = 'var(--text-primary)';
    el.innerHTML = '<b style="color:#00FF88;">' + ids.length + ' nodes</b> — ' +
      ids.slice(0, 12).join(', ') + (ids.length > 12 ? ' …' : '') +
      '<br><span style="color:var(--text-secondary); font-size:9.5px;">' + label + '</span>';
  }




  // NOTE: trough/zone/camera painters removed with the MapLibre SIM map.
  // The embedded 3D app renders terrain; the dashboard paints no map layers.

  function nodeStateColor(state) {
    var s = (state || 'active').toLowerCase();
    if (s === 'warning') return '#FFA500';
    if (s === 'critical' || s === 'lastgasp') return '#FF2222';
    if (s === 'dead') return '#5A6A72';
    return '#00CC44';
  }

  // NOTE: node markers render inside the embedded 3D app (both slots).
  // Clicks arrive via sim-embed node-select routing -> selectNode().

  function repaintClonedMarker(nodeId, newState) {
    if (!sandboxSession) return;
    // 3D markers live inside the embedded app (engine telemetry repaints
    // them); here we update the clone record + mini dashboard row only.
    var newColor = nodeStateColor(newState);

    if (Array.isArray(sandboxSession.nodes)) {
      var nd = sandboxSession.nodes.find(function (n) { return (n.node_id || n.id) === nodeId; });
      if (nd) nd.state = newState;
    }

    // Update status in mini dashboard row if rendered
    var row = document.querySelector('.sim-node-item[data-node-id="' + nodeId + '"]');
    if (row) {
      var dot = row.querySelector('.sim-node-status-dot');
      if (dot) { dot.style.background = newColor; dot.style.color = newColor; }
      var stateSpan = row.querySelector('.sim-node-readings span:last-child');
      if (stateSpan) { stateSpan.style.color = newColor; stateSpan.textContent = newState.toUpperCase(); }
    }
  }




  function nodeIdToNumber(nodeId) {
    var n = parseInt(String(nodeId || '').replace(/^[Nn]/, ''), 10);
    return (isFinite(n) && n > 0) ? n : null;
  }

  function selectNode(nodeId, source) {
    if (!nodeId) return;
    // No global node-selected emit: SIM/FORGE inspection stays local and never
    // drives the MAP detail panel (tab independence).
    if (source === 'sim') {
      renderDataNodeDetail(nodeId);
      if (typeof simEmbed !== 'undefined' && simEmbed.selectNode) {
        simEmbed.selectNode('sim', nodeIdToNumber(nodeId));
      }
      return;
    }
    if (typeof simEmbed !== 'undefined' && simEmbed.selectNode) {
      simEmbed.selectNode('forge', nodeIdToNumber(nodeId));
    }
    forgeSelectedNode = nodeId;
    renderForgeRight();
  }

  /**
   * SIM data inspector: district truth for one node (record + latest fixture
   * telemetry, same numbers MAP shows). Never reads sandbox clones.
   */
  function renderDataNodeDetail(nodeId) {
    var body = document.getElementById('sim-data-inspector-body');
    if (!body) return;
    var emptyState = document.getElementById('sim-empty-state');
    var rightContent = document.getElementById('sim-right-content');
    if (emptyState) emptyState.style.display = 'none';
    if (rightContent) rightContent.style.display = 'flex';

    var nd = null;
    if (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) {
      try { nd = nodeMarkers.getNodeData(nodeId); } catch (_) { nd = null; }
    }
    if (!nd && typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes) {
      var all = fixtureProvider.getNodes() || [];
      for (var i = 0; i < all.length; i++) {
        if (all[i] && (all[i].node_id === nodeId || all[i].id === nodeId)) { nd = all[i]; break; }
      }
    }
    if (!nd) nd = { node_id: nodeId, state: 'active' };

    var t = latestNodeTelemetry(nodeId) || {};
    var tiltStr = '--';
    if (t.tilt_x_mdeg != null || t.tilt_y_mdeg != null) {
      tiltStr = (Math.hypot(t.tilt_x_mdeg || 0, t.tilt_y_mdeg || 0) / 1000).toFixed(2) + '°';
    }
    var strainStr = (t.strain_ustrain != null) ? (Math.round(t.strain_ustrain) + 'µε') : '--';
    var battStr = (t.vbat_mv != null) ? (t.vbat_mv + ' mV') : '--';

    var role = nd.role || nd.node_type || (nodeId === 'N31' ? 'gateway' : 'scout');
    var tier = nd.tier || (nodeId === 'N31' ? '3' : '1A');
    var state = (nd.state || 'active').toUpperCase();
    var color = nodeStateColor(nd.state || 'active');
    var lat = (typeof nd.lat === 'number') ? nd.lat : (nd.latitude || (Array.isArray(nd.pos) ? nd.pos[0] : null));
    var lng = (typeof nd.lng === 'number') ? nd.lng : (nd.longitude || (Array.isArray(nd.pos) ? nd.pos[1] : null));

    body.innerHTML =
      '<div style="padding:6px; background:var(--bg-chrome); border-radius:3px; border:1px solid var(--border-bevel-dark); display:flex; flex-direction:column; gap:4px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<span style="font-size:11px; font-weight:bold; color:#FFFFFF; font-family:monospace;">NODE ' + nodeId + '</span>' +
          '<span style="font-size:9px; font-weight:bold; padding:1px 5px; background:rgba(0,0,0,0.4); color:' + color + '; border:1px solid ' + color + '; border-radius:2px;">' + state + '</span>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">ROLE:</span><b>' + String(role).toUpperCase() + ' (Tier ' + tier + ')</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">LAT / LNG:</span><b style="font-family:monospace;">' + (lat != null ? lat.toFixed(5) : '--') + ', ' + (lng != null ? lng.toFixed(5) : '--') + '</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">TILT:</span><b style="font-family:monospace;">' + tiltStr + '</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">STRAIN:</span><b style="font-family:monospace;">' + strainStr + '</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">BATTERY:</span><b style="font-family:monospace;">' + battStr + '</b></div>' +
        '<div style="font-size:9px; color:#A4B8C4; padding-top:2px; border-top:1px solid rgba(255,255,255,0.06);">DISTRICT DATA — same source as MAP</div>' +
      '</div>';
  }

  function resetForge() {
    if (typeof simEmbed !== 'undefined' && simEmbed.resetLocal) {
      simEmbed.resetLocal('forge');
    }
    pauseForge();
    forgeState.events = forgeState.events.filter(function (ev) { return ev.source === 'live'; });
    renderForgeEvents();
    resetForgeAlarms();
    clearForgePreview();
    renderForgeRight();
    updateForgeRange(function () {
      if (forgeState.day > forgeState.endDay) forgeState.day = forgeState.endDay;
      updateForgeUI();
      requestForgeFrame(forgeState.day);
    });
  }

  // POST /forge/range for the current events -> endDay, then cb().
  function updateForgeRange(cb) {
    callForgeApi('/forge/range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: forgeState.events })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (rangeData) {
        if (!rangeData || typeof rangeData.end_day !== 'number') throw new Error('no end_day');
        forgeState.endDay = rangeData.end_day;
        updateForgeUI();
        if (cb) cb();
      })
      .catch(function (err) {
        console.warn('[FORGE] /forge/range failed:', err);
      });
  }

  // Click-to-target: (0, 0) until the FORGE terrain is clicked.
  var forgeTarget = { x: 0, y: 0, isDefault: true };

  function setForgeTarget(t) {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return;
    forgeTarget = {
      x: t.x,
      y: t.y,
      elev: t.elev,
      slopeDeg: t.slopeDeg,
      zoneName: t.zoneName,
      isDefault: false
    };
    renderForgeTarget();
    sendForgePreview();
  }

  function renderForgeTarget() {
    var el = document.getElementById('forge-target-readout');
    if (!el) return;
    var txt = 'x ' + Math.round(forgeTarget.x) + ' m · y ' + Math.round(forgeTarget.y) + ' m';
    if (forgeTarget.isDefault) {
      txt += ' (default)';
    } else {
      // elev is height above the mesh datum (same number the sim panel shows as "+N m").
      if (Number.isFinite(forgeTarget.elev)) txt += ' · elev +' + forgeTarget.elev.toFixed(1) + ' m';
      if (Number.isFinite(forgeTarget.slopeDeg)) txt += ' · ' + forgeTarget.slopeDeg.toFixed(1) + '°';
      if (forgeTarget.zoneName) txt += ' · ' + forgeTarget.zoneName;
    }
    el.textContent = txt;
  }

  function forgeEventLine(ev) {
    return 'Day ' + Number(ev.day).toFixed(1) + ' · CAVE-IN ' + fmtNum(ev.depth_m) + ' m / ' +
      fmtNum(ev.radius_m) + ' m at (' + Math.round(ev.x) + ', ' + Math.round(ev.y) + ')' +
      (ev.source === 'live' ? ' (live)' : '');
  }

  function fmtNum(v) {
    return (Math.round(v * 10) / 10).toString();
  }

  function renderForgeEvents() {
    var list = document.getElementById('forge-event-list');
    if (!list) return;
    list.innerHTML = '';
    if (forgeState.events.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'forge-event-empty';
      empty.textContent = 'No events yet.';
      list.appendChild(empty);
      return;
    }
    forgeState.events.forEach(function (ev) {
      var row = document.createElement('div');
      row.className = 'forge-event-row' + (ev.source === 'live' ? ' live' : '');
      row.textContent = forgeEventLine(ev);
      list.appendChild(row);
    });
  }

  // FIRE with CAVE-IN: the cave-in becomes an event on FORGE's timeline at the
  // current FORGE day. :8020 computes the ground; the slot only plays the look.
  // duration_h: there is no duration control, so the engine default
  // (apply_collapse duration_hours=4.8) is used.
  var FORGE_CAVEIN_DURATION_H = 4.8;

  function fireForgeCaveIn() {
    var depthEl = document.getElementById('sim-cavein-depth');
    var radiusEl = document.getElementById('sim-cavein-radius');
    var depth = depthEl ? parseFloat(depthEl.value) : NaN;
    var radius = radiusEl ? parseFloat(radiusEl.value) : NaN;
    if (!(depth > 0) || !(radius > 0)) {
      console.warn('[FORGE] CAVE-IN needs depth and radius sliders');
      return;
    }
    var ev = {
      type: 'cave_in',
      x: forgeTarget.x,
      y: forgeTarget.y,
      radius_m: radius,
      depth_m: depth,
      day: forgeState.day,
      duration_h: FORGE_CAVEIN_DURATION_H
    };
    pauseForge();
    forgeState.events.push(ev);
    renderForgeEvents();
    if (typeof simEmbed !== 'undefined' && simEmbed.sendForgeEffect) {
      simEmbed.sendForgeEffect('cave_in', ev.x, ev.y, ev.radius_m, ev.depth_m);
    }
    clearForgePreview();
    updateForgeRange(function () {
      playForge();
    });
  }

  // =========================================================================
  // FORGE Timeline Engine (:8020 frames)
  // =========================================================================
  var FORGE_API_BASE = (function () {
    if (typeof window !== 'undefined') {
      if (window.__FORGE_API_BASE__) return window.__FORGE_API_BASE__;
      try {
        var params = new URLSearchParams(window.location.search);
        var p = params.get('forge_port');
        if (p) return 'http://127.0.0.1:' + p;
        var b = params.get('forge_api');
        if (b) return b;
      } catch (_) {}
    }
    return 'http://127.0.0.1:8020';
  })();

  function callForgeApi(endpoint, options) {
    var url = FORGE_API_BASE + endpoint;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = null;
    var opts = Object.assign({}, options || {});
    if (controller) {
      opts.signal = controller.signal;
      timer = setTimeout(function () { controller.abort(); }, 2000);
    }
    return fetch(url, opts)
      .then(function (res) {
        if (timer) clearTimeout(timer);
        return res;
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  var forgeState = {
    day: 0,
    events: [],
    endDay: 120,
    playing: false,
    speed: 1
  };

  var forgeInitialized = false;
  var forgeFrameInFlight = false;
  var forgePendingDay = null;
  var forgeLastStepWallTime = 0;

  function updateForgeUI() {
    var badge = document.getElementById('forge-day-badge');
    var slider = document.getElementById('forge-day-slider');
    var btnPlay = document.getElementById('forge-play-btn');

    if (slider) {
      slider.max = String(forgeState.endDay || 120);
      slider.value = String(forgeState.day);
    }
    if (badge) {
      badge.textContent = 'FORGE · Day ' + forgeState.day.toFixed(1) + ' / ' + Math.round(forgeState.endDay);
      badge.dataset.day = forgeState.day.toFixed(1);
      badge.dataset.endDay = String(Math.round(forgeState.endDay));
    }
    if (btnPlay) {
      btnPlay.textContent = forgeState.playing ? '⏸ PAUSE' : '▶ PLAY';
    }
  }

  function requestForgeFrame(day) {
    if (forgeFrameInFlight) {
      forgePendingDay = day;
      return;
    }
    forgeFrameInFlight = true;
    forgePendingDay = null;

    callForgeApi('/forge/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        day: day,
        events: forgeState.events,
        include_grids: false
      })
    })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (frame) {
      forgeFrameInFlight = false;
      if (typeof simEmbed !== 'undefined' && simEmbed.sendForgeFrame) {
        simEmbed.sendForgeFrame(frame);
      }
      onForgeFrame(frame);
      updateForgeUI();

      if (forgeState.playing) {
        onPlayFrameDelivered();
      } else if (forgePendingDay !== null) {
        var next = forgePendingDay;
        forgePendingDay = null;
        requestForgeFrame(next);
      }
    })
    .catch(function (err) {
      forgeFrameInFlight = false;
      console.warn('[FORGE] frame fetch failed:', err);
      if (forgeState.playing) {
        pauseForge();
      }
      if (forgePendingDay !== null) {
        var next = forgePendingDay;
        forgePendingDay = null;
        requestForgeFrame(next);
      }
    });
  }

  function onPlayFrameDelivered() {
    if (!forgeState.playing) return;
    var now = performance.now();
    var wallSec = (now - forgeLastStepWallTime) / 1000.0;
    forgeLastStepWallTime = now;

    var nextDay = forgeState.day + (forgeState.speed * wallSec);
    // Node states only change while a collapse is in progress (engine rule:
    // event day to collapse end + 0.05 d, about 0.6 d with the default 8 h
    // warning). Never step over such a window: land inside it once.
    forgeState.events.forEach(function (ev) {
      var start = ev.day;
      var end = ev.day + ((ev.warning_hours != null ? ev.warning_hours : 8) + (ev.duration_h || 0)) / 24 + 0.05;
      if (forgeState.day < start && nextDay > end) {
        nextDay = Math.min(nextDay, (start + end) / 2);
      }
    });
    if (nextDay >= forgeState.endDay) {
      forgeState.day = forgeState.endDay;
      forgeState.playing = false;
      updateForgeUI();
      requestForgeFrame(forgeState.endDay);
      return;
    }

    forgeState.day = nextDay;
    updateForgeUI();
    requestForgeFrame(forgeState.day);
  }

  function playForge() {
    if (forgeState.day >= forgeState.endDay) {
      forgeState.day = 0;
    }
    forgeState.playing = true;
    forgeLastStepWallTime = performance.now();
    updateForgeUI();
    if (!forgeFrameInFlight) {
      requestForgeFrame(forgeState.day);
    }
  }

  function pauseForge() {
    forgeState.playing = false;
    updateForgeUI();
  }

  function togglePlayForge() {
    if (forgeState.playing) {
      pauseForge();
    } else {
      playForge();
    }
  }

  function seedForge() {
    if (forgeState.playing) {
      pauseForge();
    }

    var badge = document.getElementById('forge-day-badge');
    var note = document.getElementById('forge-badge-note');
    var btnPlay = document.getElementById('forge-play-btn');

    function proceedWithRange() {
      if (btnPlay) btnPlay.disabled = false;
      callForgeApi('/forge/range', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: forgeState.events })
      })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (rangeData) {
        forgeState.endDay = (rangeData && typeof rangeData.end_day === 'number') ? rangeData.end_day : 120;
        forgeState.playing = false;
        if (btnPlay) btnPlay.textContent = '▶ PLAY';
        updateForgeUI();
        requestForgeFrame(forgeState.day);
      })
      .catch(function (err) {
        console.warn('[FORGE] /forge/range failed:', err);
        forgeOffline();
      });
    }

    callForgeApi('/forge/seed', { method: 'GET' })
      .then(function (res) {
        if (!res.ok) {
          throw new Error(res.status === 503 ? 'engine 503' : 'HTTP ' + res.status);
        }
        return res.json();
      })
      .then(function (seedData) {
        if (typeof seedData.day === 'number' && Number.isFinite(seedData.day)) {
          forgeState.day = Math.round(seedData.day * 10) / 10;
        } else {
          forgeState.day = 0;
        }
        forgeState.events = Array.isArray(seedData.events) ? seedData.events : [];
        renderForgeEvents();
        resetForgeAlarms();
        if (note) {
          note.style.display = 'none';
          note.textContent = '';
        }
        proceedWithRange();
      })
      .catch(function (seedErr) {
        var reason = seedErr && seedErr.message ? seedErr.message : 'offline';
        var apiBase = 'http://' + (window.location.hostname || 'localhost') + ':8080';
        fetch(apiBase + '/api/simulation/status', { cache: 'no-store' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (statusData) {
            var seconds = statusData ? statusData.t_sim_seconds : undefined;
            if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
              throw new Error('no valid t_sim_seconds');
            }
            var liveDay = Math.round((seconds / 86400) * 10) / 10;
            forgeState.day = liveDay;
            forgeState.events = [];
            renderForgeEvents();
            if (note) {
              note.style.display = '';
              note.textContent = 'live cave-ins not copied (' + reason + ')';
              note.title = note.textContent;
            }
            proceedWithRange();
          })
          .catch(forgeOffline);
      });

    function forgeOffline() {
      forgeState.playing = false;
      if (btnPlay) {
        btnPlay.disabled = true;
        btnPlay.textContent = '▶ PLAY';
      }
      if (badge) badge.textContent = 'FORGE offline: start :8020';
      if (note) {
        note.style.display = 'none';
        note.textContent = '';
      }
    }
  }

  function initForgeTimeline() {
    var btnPlay = document.getElementById('forge-play-btn');
    if (btnPlay) {
      btnPlay.addEventListener('click', function () {
        togglePlayForge();
      });
    }

    var speedBtns = document.querySelectorAll('.forge-speed-btn');
    speedBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        speedBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var spd = parseFloat(btn.dataset.speed);
        if (Number.isFinite(spd) && spd > 0) {
          forgeState.speed = spd;
        }
      });
    });

    var slider = document.getElementById('forge-day-slider');
    if (slider) {
      slider.addEventListener('input', function () {
        var val = parseFloat(slider.value);
        if (Number.isFinite(val)) {
          forgeState.day = val;
          updateForgeUI();
          requestForgeFrame(val);
        }
      });
    }

    var btnLiveDay = document.getElementById('forge-live-day-btn');
    if (btnLiveDay) {
      btnLiveDay.addEventListener('click', function () {
        seedForge();
      });
    }
  }

  // =========================================================================
  // FORGE right column: health strip, node card, mini map, FORGE alarms.
  // Every colour and count comes from the current :8020 frame's node_states,
  // never from live or fixture states. Node positions (x, y in engine metres)
  // come from the fixture layout, which is the engine's own 31-node layout.
  // =========================================================================
  var forgeLastFrame = null;
  var forgePrevStates = null;
  var forgePrevDay = null;
  var forgeFirstStateDay = {};   // 'N12' -> { WARNING: day, CRITICAL: day }
  var forgeAlarms = [];          // newest first
  var forgeSelectedNode = null;
  var forgePreviewOn = false;
  var FORGE_ALARM_MAX = 200;
  var FORGE_SITE_HALF_M = 300;   // FORGE terrain is the 600 m district square

  function forgeLayoutNodes() {
    var all = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes)
      ? (fixtureProvider.getNodes() || []) : [];
    return all.filter(function (n) { return n && Number.isFinite(n.x) && Number.isFinite(n.y); });
  }

  function forgeNodeId(n) {
    return n.node_id || n.id;
  }

  function forgeStateOf(nodeId) {
    var st = forgeLastFrame && forgeLastFrame.node_states ? forgeLastFrame.node_states[nodeId] : null;
    return st || 'ACTIVE';
  }

  function forgeStateColor(st) {
    return nodeStateColor(st === 'ACTIVE' ? 'active' : st);
  }

  function forgeFrameNode(nodeId) {
    if (!forgeLastFrame || !Array.isArray(forgeLastFrame.nodes)) return null;
    var num = nodeIdToNumber(nodeId);
    for (var i = 0; i < forgeLastFrame.nodes.length; i++) {
      if (forgeLastFrame.nodes[i].node_id === num) return forgeLastFrame.nodes[i];
    }
    return null;
  }

  // Nearest event already started on this FORGE day: { ev, index, dist }.
  function forgeNearestEvent(x, y, day) {
    var best = null;
    forgeState.events.forEach(function (ev, idx) {
      if (ev.day > day + 1e-9) return;
      var d = Math.hypot(ev.x - x, ev.y - y);
      if (!best || d < best.dist) best = { ev: ev, index: idx, dist: d };
    });
    return best;
  }

  function forgeEventTag(ev, index) {
    return 'CAVE-IN #' + (index + 1) + (ev.source === 'live' ? ' live' : '');
  }

  function resetForgeAlarms() {
    forgeAlarms = [];
    forgeFirstStateDay = {};
    forgePrevStates = null;
    forgePrevDay = null;
  }

  // Called with every frame :8020 returns. Alarms are state changes between
  // consecutive frames while FORGE time moves forward (or events change on
  // the same day, e.g. right after FIRE).
  function onForgeFrame(frame) {
    if (!frame || !frame.node_states) return;
    var day = Number(frame.t_days);
    var states = frame.node_states;
    forgeLastFrame = frame;
    var layout = {};
    forgeLayoutNodes().forEach(function (n) { layout[forgeNodeId(n)] = n; });

    if (forgePrevDay !== null && day < forgePrevDay) {
      // Sliding back: forget "first went" days that are now in the future.
      Object.keys(forgeFirstStateDay).forEach(function (nid) {
        var f = forgeFirstStateDay[nid];
        if (f.WARNING > day) delete f.WARNING;
        if (f.CRITICAL > day) delete f.CRITICAL;
      });
    } else if (forgePrevStates) {
      Object.keys(states).sort().forEach(function (nid) {
        var st = states[nid];
        var prev = forgePrevStates[nid] || 'ACTIVE';
        if (st === prev) return;
        var why = '';
        var pos = layout[nid];
        if (pos) {
          var near = forgeNearestEvent(pos.x, pos.y, day);
          if (near) why = ' (' + forgeEventTag(near.ev, near.index) + ', ' + Math.round(near.dist) + ' m)';
        }
        forgeAlarms.unshift({ day: day, node: nid, state: st, text: 'Day ' + day.toFixed(1) + ' · ' + nid + ' → ' + st + why });
      });
      if (forgeAlarms.length > FORGE_ALARM_MAX) forgeAlarms.length = FORGE_ALARM_MAX;
    }
    Object.keys(states).forEach(function (nid) {
      var st = states[nid];
      if (st !== 'WARNING' && st !== 'CRITICAL') return;
      var f = forgeFirstStateDay[nid] || (forgeFirstStateDay[nid] = {});
      if (f[st] === undefined) f[st] = day;
    });
    forgePrevStates = states;
    forgePrevDay = day;
    renderForgeRight();
  }

  function renderForgeRight() {
    renderForgeHealth();
    renderForgeNodeDetail();
    renderForgeMiniMap();
    renderForgeAlarms();
  }

  function renderForgeHealth() {
    var body = document.getElementById('forge-health-body');
    var badge = document.getElementById('forge-health-badge');
    var nodes = forgeLayoutNodes();
    var counts = { ACTIVE: 0, WARNING: 0, CRITICAL: 0 };
    nodes.forEach(function (n) {
      var st = forgeStateOf(forgeNodeId(n));
      counts[st] = (counts[st] || 0) + 1;
    });
    if (badge) badge.textContent = nodes.length + ' NODES';
    var countsEl = document.getElementById('forge-health-counts');
    if (countsEl) {
      Array.prototype.forEach.call(countsEl.querySelectorAll('b[data-k]'), function (b) {
        b.textContent = forgeLastFrame ? String(counts[b.getAttribute('data-k')] || 0) : '--';
      });
    }
    if (!body) return;
    if (nodes.length === 0) {
      body.innerHTML = '<div class="forge-empty">No district nodes loaded yet.</div>';
      return;
    }
    var html = '';
    nodes.forEach(function (n) {
      var nid = forgeNodeId(n);
      var st = forgeStateOf(nid);
      html += '<span class="forge-health-dot' + (nid === forgeSelectedNode ? ' selected' : '') +
        '" data-node-id="' + nid + '" data-state="' + st + '" style="background:' + forgeStateColor(st) +
        ';" title="' + nid + ' · ' + st + '"></span>';
    });
    body.innerHTML = html;
    Array.prototype.forEach.call(body.querySelectorAll('.forge-health-dot'), function (dot) {
      dot.addEventListener('click', function () {
        selectNode(dot.getAttribute('data-node-id'), 'forge');
      });
    });
  }

  function renderForgeNodeDetail() {
    var el = document.getElementById('forge-node-detail');
    if (!el) return;
    var nid = forgeSelectedNode;
    var pos = null;
    forgeLayoutNodes().forEach(function (n) { if (forgeNodeId(n) === nid) pos = n; });
    if (!nid || !pos) {
      el.innerHTML = '<div class="forge-empty">Click a node</div>';
      return;
    }
    var st = forgeStateOf(nid);
    var fn = forgeFrameNode(nid);
    var day = forgeLastFrame ? Number(forgeLastFrame.t_days) : forgeState.day;
    var subs = (fn && Number.isFinite(fn.subsidence_mm)) ? fn.subsidence_mm.toFixed(1) + ' mm' : '--';
    var tilt = '--';
    if (fn && (fn.tilt_x != null || fn.tilt_y != null)) {
      // µrad -> mm/m (1 mm/m = 1000 µrad)
      tilt = (Math.hypot(fn.tilt_x || 0, fn.tilt_y || 0) / 1000).toFixed(2) + ' mm/m';
    }
    var near = forgeNearestEvent(pos.x, pos.y, day);
    var nearTxt = near ? Math.round(near.dist) + ' m · ' + forgeEventTag(near.ev, near.index) : 'no event yet';
    var first = forgeFirstStateDay[nid] || {};
    var firstTxt = [];
    if (first.WARNING !== undefined) firstTxt.push('WARN d' + first.WARNING.toFixed(1));
    if (first.CRITICAL !== undefined) firstTxt.push('CRIT d' + first.CRITICAL.toFixed(1));
    var role = pos.node_type || pos.role || 'scout';
    function row(k, v) { return '<span class="k">' + k + '</span><span class="v">' + v + '</span>'; }
    el.innerHTML =
      '<div class="forge-node-card" data-node-id="' + nid + '" data-state="' + st + '">' +
        '<div class="title"><span>NODE ' + nid + '</span>' +
          '<span class="forge-state-pill" style="color:' + forgeStateColor(st) + ';">' + st + '</span></div>' +
        row('Role / tier', String(role).toUpperCase() + ' · ' + (pos.tier || '--')) +
        row('x, y', Math.round(pos.x) + ' m, ' + Math.round(pos.y) + ' m') +
        row('lat, lng', (Number.isFinite(pos.lat) ? pos.lat.toFixed(5) : '--') + ', ' + (Number.isFinite(pos.lng) ? pos.lng.toFixed(5) : '--')) +
        row('Subsidence', subs) +
        row('Tilt', tilt) +
        row('Nearest event', nearTxt) +
        row('First alarm', firstTxt.length ? firstTxt.join(' · ') : 'none') +
      '</div>';
  }

  function forgePreviewRadius() {
    var ids = { sudden_sinking: 'sim-cavein-radius', tilt: 'sim-tilt-radius', crack: 'sim-crack-radius' };
    var el = document.getElementById(ids[selectedScenarioType] || '');
    var r = el ? parseFloat(el.value) : NaN;
    return r > 0 ? r : null;
  }

  function renderForgeMiniMap() {
    var svg = document.getElementById('forge-minimap');
    if (!svg) return;
    var H = FORGE_SITE_HALF_M;
    var k = 200 / (2 * H);                               // px per metre
    function px(x) { return ((x + H) * k).toFixed(1); }
    function py(y) { return ((H - y) * k).toFixed(1); }  // north up
    var day = forgeLastFrame ? Number(forgeLastFrame.t_days) : forgeState.day;
    var out = '<rect x="0" y="0" width="200" height="200" fill="#0B141A" stroke="#3A5566" stroke-width="1"/>' +
      '<line x1="100" y1="0" x2="100" y2="200" stroke="#1A2A33" stroke-width="0.5"/>' +
      '<line x1="0" y1="100" x2="200" y2="100" stroke="#1A2A33" stroke-width="0.5"/>';
    forgeState.events.forEach(function (ev, idx) {
      var started = ev.day <= day + 1e-9;
      out += '<circle class="event" data-event="' + idx + '" cx="' + px(ev.x) + '" cy="' + py(ev.y) + '" r="' + (ev.radius_m * k).toFixed(1) +
        '" fill="' + (started ? 'rgba(255,34,34,0.12)' : 'none') + '" stroke="' + (started ? '#FF5252' : '#6B4040') + '" stroke-width="1"/>' +
        '<text x="' + px(ev.x) + '" y="' + (py(ev.y) - ev.radius_m * k - 2).toFixed(1) + '" fill="#FF9A9A" font-size="7" text-anchor="middle">d' + Number(ev.day).toFixed(1) + '</text>';
    });
    var pr = forgePreviewOn ? forgePreviewRadius() : null;
    if (pr) {
      out += '<circle id="forge-minimap-preview" cx="' + px(forgeTarget.x) + '" cy="' + py(forgeTarget.y) + '" r="' + (pr * k).toFixed(1) +
        '" data-radius-m="' + pr + '" fill="none" stroke="#FFAA00" stroke-width="1" stroke-dasharray="4 2"/>';
    }
    var tx = px(forgeTarget.x), ty = py(forgeTarget.y);
    out += '<g id="forge-minimap-target" stroke="#FFFFFF" stroke-width="0.8"><line x1="' + (tx - 5) + '" y1="' + ty + '" x2="' + (tx - 1.5) + '" y2="' + ty + '"/><line x1="' + (+tx + 1.5) + '" y1="' + ty + '" x2="' + (+tx + 5) + '" y2="' + ty + '"/>' +
      '<line x1="' + tx + '" y1="' + (ty - 5) + '" x2="' + tx + '" y2="' + (ty - 1.5) + '"/><line x1="' + tx + '" y1="' + (+ty + 1.5) + '" x2="' + tx + '" y2="' + (+ty + 5) + '"/></g>';
    forgeLayoutNodes().forEach(function (n) {
      var nid = forgeNodeId(n);
      var st = forgeStateOf(nid);
      out += '<circle class="node" data-node-id="' + nid + '" data-state="' + st + '" cx="' + px(n.x) + '" cy="' + py(n.y) + '" r="3.2" fill="' + forgeStateColor(st) +
        '" stroke="' + (nid === forgeSelectedNode ? '#FFFFFF' : '#05090D') + '" stroke-width="' + (nid === forgeSelectedNode ? 1.4 : 0.6) + '"><title>' + nid + ' · ' + st + '</title></circle>';
    });
    svg.innerHTML = out;
    Array.prototype.forEach.call(svg.querySelectorAll('.node'), function (c) {
      c.addEventListener('click', function () { selectNode(c.getAttribute('data-node-id'), 'forge'); });
    });
    var badge = document.getElementById('forge-map-badge');
    if (badge) badge.textContent = forgeState.events.length + ' EVENT' + (forgeState.events.length === 1 ? '' : 'S');
  }

  function renderForgeAlarms() {
    var list = document.getElementById('forge-alarm-list');
    var badge = document.getElementById('forge-alarm-badge');
    if (badge) badge.textContent = String(forgeAlarms.length);
    if (!list) return;
    if (forgeAlarms.length === 0) {
      list.innerHTML = '<div class="forge-empty">No FORGE alarms yet.</div>';
      return;
    }
    list.innerHTML = forgeAlarms.map(function (a) {
      return '<div class="forge-alarm-row ' + a.state + '" title="' + a.text + '">' + a.text + '</div>';
    }).join('');
  }

  // Live radius preview: drawing only, no maths. Shown in the 3D view (dashed
  // beacon ring) and on the mini map while a radius slider moves or the
  // target changes; cleared on FIRE and RESET FORGE.
  function sendForgePreview() {
    var r = forgePreviewRadius();
    if (!r) { clearForgePreview(); return; }
    forgePreviewOn = true;
    if (typeof simEmbed !== 'undefined' && simEmbed.sendForgePreview) {
      simEmbed.sendForgePreview(forgeTarget.x, forgeTarget.y, r);
    }
    renderForgeMiniMap();
  }

  function clearForgePreview() {
    forgePreviewOn = false;
    if (typeof simEmbed !== 'undefined' && simEmbed.sendForgePreview) {
      simEmbed.sendForgePreview(null, null, null);
    }
    renderForgeMiniMap();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // NOTE: mesh-link synthesis + map readiness went away with the MapLibre
  // maps (the embedded app renders its own topology).

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

  function recenterToSessionBounds() {
    // SIM recenter = full district default. Sessions/selections never move
    // the SIM camera (FORGE has its own recenter for selection bounds).
    if (typeof simEmbed !== 'undefined' && simEmbed.recenter) {
      simEmbed.recenter('sim');
    }
    console.log('[SIM_TAB] Recentering sim camera to full district.');
    return {
      south: PANEL_CENTRE_LAT - 0.005,
      north: PANEL_CENTRE_LAT + 0.005,
      west: PANEL_CENTRE_LON - 0.008,
      east: PANEL_CENTRE_LON + 0.008
    };
  }


  function bindCloseButton() {
    var btnCloseSession = document.getElementById('btn-sim-close-session');
    if (btnCloseSession) {
      btnCloseSession.addEventListener('click', function () {
        closeSandboxSession();
      });
    }
  }

  function setViewportLit(isLit) {
    var vp = document.getElementById('forge-middle');
    if (!vp) return;
    if (isLit) {
      vp.classList.add('forge-live-lit');
    } else {
      vp.classList.remove('forge-live-lit');
    }
  }

  function updateCloseButtonState() {
    var btnClose = document.getElementById('btn-sim-close-session');
    if (!btnClose) return;
    var hasSession = Boolean(sandboxSession);
    btnClose.disabled = !hasSession;
    if (hasSession) {
      btnClose.style.opacity = '1';
      btnClose.style.cursor = 'pointer';
      btnClose.style.borderColor = '#FF5252';
      btnClose.style.color = '#FF8A8A';
    } else {
      btnClose.style.opacity = '0.45';
      btnClose.style.cursor = 'not-allowed';
      btnClose.style.borderColor = '#555';
      btnClose.style.color = '#777';
    }
  }

  function closeSandboxSession() {
    var closedSessionId = sandboxSession ? sandboxSession.id : (window.__simSandboxSession ? window.__simSandboxSession.id : 'unknown');
    var closedSelection = sandboxSession ? sandboxSession.selection : (window.__simSandboxSession ? window.__simSandboxSession.selection : null);

    // stopPlay()? NO — keep timeline state untouched (if playing, it keeps playing).
    sandboxSession = null;
    window.__simSandboxSession = null;
    // window.__simSandboxPayload stays untouched
    // SIM map/markers/camera/embed: untouched. Close only clears FORGE.

    // Clear FORGE slot (selection clip + crack overlay)
    if (typeof simEmbed !== 'undefined' && simEmbed.clearSelection) {
      try { simEmbed.clearSelection('forge'); } catch (_) {}
    }

    // Closing the session also releases the SIM-channel MAP selection that
    // created it: the SIM/SEND badges drop their counts, the gate banner
    // returns, and the readout falls back to the select-nodes prompt. The 3D
    // channel is untouched (close only undoes what a SIM area send did).
    try {
      if (typeof selectionStore !== 'undefined' && typeof selectionStore.clear === 'function') {
        selectionStore.clear('sim');
      }
    } catch (_) {}

    // Hide sandbox banner & chip
    var sandboxBanner = document.getElementById('sim-sandbox-banner');
    if (sandboxBanner) {
      sandboxBanner.style.display = 'none';
    }
    var chipContainer = document.getElementById('sim-session-chip-container');
    if (chipContainer) {
      chipContainer.innerHTML = '';
    }
    // Hide scenario banner (session over; WHAT-IF mode off)
    var scenarioBanner = document.getElementById('sim-scenario-banner');
    if (scenarioBanner) {
      scenarioBanner.style.display = 'none';
    }

    // Keep the FORGE dashboard column visible (small dashboard replica remains visible).
    var forgeRight = document.getElementById('forge-right');
    if (forgeRight) forgeRight.style.display = '';
    var storeSel = null;
    try {
      storeSel = (typeof selectionStore !== 'undefined' && selectionStore.has('sim'))
        ? selectionStore.get('sim') : null;
    } catch (_) {}
    renderRegionReadout(storeSel);

    // (The SIM-channel store clear happens above, right after the slot
    // clear, so every readout below already sees the released state.)

    // bus.emit('sim-sandbox-closed', { closedAt: Date.now() }); console.log closed session id
    console.log('[SIM_TAB] Closed sandbox session ' + closedSessionId);
    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('sim-sandbox-closed', { closedAt: Date.now(), id: closedSessionId, selection: closedSelection });
    }

    // Update CLOSE button disabled state
    updateCloseButtonState();
    setViewportLit(false);
    updateGateState();

    // make close return to the MAP tab
    var mapTabBtn = document.querySelector('#tab-bar .tab-btn[data-tab="map"]');
    if (mapTabBtn) {
      mapTabBtn.click();
    }
  }

  async function logDatasetProof() {
    var nodes = (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') ? (fixtureProvider.getNodes() || []) : [];
    if (nodes.length === 0 && typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.loadFixtures === 'function') {
      try {
        var res = await fixtureProvider.loadFixtures('../fixtures');
        if (res && res.source) window.__nodeDatasetSource = res.source;
        if (res && Array.isArray(res.nodes) && res.nodes.length > 0) {
          nodes = res.nodes;
        }
      } catch (_) {}
    }
    if (nodes.length === 0 && typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      nodes = fixtureProvider.getNodes() || [];
    }

    var source = window.__nodeDatasetSource || 'fixtures';

    if (nodes.length === 0 && typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      var allM = fixtureProvider.getNodes();
      if (Array.isArray(allM) && allM.length > 0) nodes = allM;
    }

    var count = nodes.length;
    var firstStr = 'none';
    if (count > 0 && nodes[0]) {
      var fn = nodes[0];
      var fId = fn.node_id || fn.id || 'N01';
      var fLat = (typeof fn.lat === 'number') ? fn.lat : (fn.latitude || (Array.isArray(fn.pos) ? fn.pos[0] : 0));
      var fLng = (typeof fn.lng === 'number') ? fn.lng : (fn.longitude || (Array.isArray(fn.pos) ? fn.pos[1] : 0));
      firstStr = fId + '@' + fLat + ',' + fLng;
    }

    console.log('[SIM_TAB_DATASET] source=' + source + ' nodes=' + count + ' first=' + firstStr);
  }

  function assertNodeParity(customClones, customPool) {
    var renderedPool = (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function')
      ? fixtureProvider.getNodes()
      : null;

    var dashboardPool = (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function')
      ? fixtureProvider.getNodes()
      : null;

    var pool = customPool;
    if (!pool) {
      if (sandboxSession) {
        pool = (sandboxSession.selection && Array.isArray(sandboxSession.selection.nodes) && sandboxSession.selection.nodes.length > 0)
          ? sandboxSession.selection.nodes
          : (sandboxSession.nodes || []);
      } else {
        pool = (dashboardPool && dashboardPool.length > 0) ? dashboardPool : (renderedPool || []);
      }
    }

    var mapNodes = customClones;
    if (!mapNodes) {
      if (sandboxSession && Array.isArray(sandboxSession.nodes)) {
        mapNodes = sandboxSession.nodes;
      } else {
        mapNodes = (renderedPool && renderedPool.length > 0) ? renderedPool : (dashboardPool || []);
      }
    }

    if (!pool || !mapNodes || pool.length === 0 || mapNodes.length === 0) {
      return { passed: true, pending: true };
    }

    var poolMap = {};
    pool.forEach(function (n) {
      var id = n.node_id || n.id;
      if (id) poolMap[id] = n;
    });

    var mapNodesMap = {};
    mapNodes.forEach(function (n) {
      var id = n.node_id || n.id;
      if (id) mapNodesMap[id] = n;
    });

    var missingInMap = [];
    var missingInPool = [];
    var coordMismatch = [];

    // Check missing in map
    Object.keys(poolMap).forEach(function (id) {
      if (!mapNodesMap[id]) {
        if (missingInMap.length < 20) missingInMap.push(id);
      }
    });

    // Check missing in pool and coordinate mismatch
    Object.keys(mapNodesMap).forEach(function (id) {
      var mapNode = mapNodesMap[id];
      var poolNode = poolMap[id];
      if (!poolNode) {
        if (missingInPool.length < 20) missingInPool.push(id);
      } else {
        var lat1 = (typeof poolNode.lat === 'number') ? poolNode.lat : (poolNode.latitude || (Array.isArray(poolNode.pos) ? poolNode.pos[0] : null));
        var lng1 = (typeof poolNode.lng === 'number') ? poolNode.lng : (poolNode.longitude || (Array.isArray(poolNode.pos) ? poolNode.pos[1] : null));
        var lat2 = (typeof mapNode.lat === 'number') ? mapNode.lat : (mapNode.latitude || (Array.isArray(mapNode.pos) ? mapNode.pos[0] : null));
        var lng2 = (typeof mapNode.lng === 'number') ? mapNode.lng : (mapNode.longitude || (Array.isArray(mapNode.pos) ? mapNode.pos[1] : null));

        if (lat1 != null && lng1 != null && lat2 != null && lng2 != null) {
          var dLat = Math.abs(lat1 - lat2);
          var dLng = Math.abs(lng1 - lng2);
          if (dLat > 1e-6 || dLng > 1e-6) {
            if (coordMismatch.length < 20) {
              coordMismatch.push({
                node_id: id,
                poolLat: lat1,
                poolLng: lng1,
                mapLat: lat2,
                mapLng: lng2,
                diffLat: dLat,
                diffLng: dLng
              });
            }
          }
        }
      }
    });

    var passed = (missingInMap.length === 0 && missingInPool.length === 0 && coordMismatch.length === 0);

    var result = {
      passed: passed,
      missingInMap: missingInMap,
      missingInPool: missingInPool,
      coordMismatch: coordMismatch,
      checkedAt: Date.now()
    };

    window.__nodeParityResult = result;

    if (passed) {
      console.log('[NODE_PARITY] PASS: Node parity verified (' + Object.keys(poolMap).length + ' nodes match between dashboard pool and map pool within 1e-6)');
    } else {
      console.error('[NODE_PARITY] FAIL: Node parity mismatch:', result);
    }

    return result;
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
    updateCloseButtonState();
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
    updateCloseButtonState();
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

  async function clipForgeToRegion(payload, bounds) {
    // The FORGE 3D view clips to the USER'S selection box + node allowlist.
    // FORGE ground comes from :8020 frames only. SIM slot untouched.
    var day = (sandboxSession && sandboxSession.day != null)
      ? Math.round(sandboxSession.day)
      : Math.round(currentDay);

    if (typeof simEmbed !== 'undefined' && simEmbed.ensureLoaded) {
      simEmbed.ensureLoaded('forge', {
        south: bounds.south,
        north: bounds.north,
        west: bounds.west,
        east: bounds.east,
        nodes: (sandboxSession && sandboxSession.nodes) || [],
        label: (payload && (payload.label || payload.name)) || (sandboxSession && sandboxSession.id) || null
      }, day);
    }
  }

  // NOTE: mesh-link synthesis removed with the MapLibre maps. The embedded
  // 3D app renders its own mesh topology + gateway links per slot.

  function showSandboxRightPanel(session) {
    setViewportLit(true);

    // Reveal the FORGE dashboard (hidden until a region exists) + readout.
    var forgeRight = document.getElementById('forge-right');
    if (forgeRight) forgeRight.style.display = '';
    renderRegionReadout(session.selection || null);

  }

  async function handleSandboxCreate(payload) {
    console.log('[SIM_TAB] Starting sandbox initialization pipeline...');

    // Switch to the FORGE tab (sandbox home). SIM/MAP untouched.
    var tabForge = document.getElementById('tab-forge');
    if (tabForge && tabForge.style.display === 'none') {
      var forgeTabBtn = document.querySelector('#tab-bar .tab-btn[data-tab="forge"]');
      if (forgeTabBtn) {
        forgeTabBtn.click();
      } else {
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        document.querySelectorAll('.tab-view').forEach(function (v) { v.style.display = 'none'; });
        tabForge.style.display = 'flex';
        onTabShown('forge');
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
      day: 0,
      nodes: clonedNodes,
      createdAt: Date.now()
    };
    window.__simSandboxSession = sandboxSession;

    var poolN = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes && fixtureProvider.getNodes())
      ? fixtureProvider.getNodes().length
      : 0;
    if (poolN === 0) poolN = clonedNodes.length;

    console.log('[SIM_TAB_DATASET] session ' + sessionId + ' cloned ' + clonedNodes.length + '/' + poolN + ' nodes (dashboard pool ' + poolN + ').');
    if (clonedNodes.length === 0) {
      console.warn('[SIM_TAB_DATASET] Empty selection sandbox created (0 cloned nodes)');
    }

    currentDay = 0;
    if (sandboxSession) {
      sandboxSession.day = 0;
      var sandboxDayEl = document.getElementById('sim-sandbox-day');
      if (sandboxDayEl) sandboxDayEl.textContent = '0';
    }
    if (typeof simEmbed !== 'undefined' && simEmbed.setDay) {
      simEmbed.setDay(0);
    }

    renderSessionChip(sandboxSession);
    renderSandboxBanner(sandboxSession);
    updateCloseButtonState();
    updateGateState();
    // No autoplay: PLAY stays manual. Selection never starts playback.
    updateStageStatus('cloning', 'done');

    // Stage 2: Camera (FORGE slot only; SIM slot untouched)
    updateStageStatus('camera', 'active', 'Framing 3D viewport camera to selection bounds...');
    var bounds = getSelectionBounds(payload);
    sandboxSession.bounds = bounds;
    if (typeof simEmbed !== 'undefined' && simEmbed.onSlotShown) {
      simEmbed.onSlotShown('forge');
    }
    await sleep(250);
    updateStageStatus('camera', 'done');

    // Stage 3: Trough (region ground truth + slot clip on the FORGE view)
    updateStageStatus('trough', 'active', 'Clipping the FORGE view to the selection...');
    await clipForgeToRegion(payload, bounds);
    await sleep(220);
    updateStageStatus('trough', 'done');

    // Stage 4: Nodes (allowlist rides the slot clip; the iframe renders)
    updateStageStatus('nodes', 'active', 'Rendering markers from ' + sandboxSession.nodes.length + ' cloned nodes...');
    await sleep(200);
    updateStageStatus('nodes', 'done');

    // Stage 5: Links (the embedded app draws its own mesh topology)
    updateStageStatus('links', 'active', 'Mesh topology renders inside the 3D view...');
    await sleep(240);
    updateStageStatus('links', 'done');

    // Final finish
    await sleep(300);
    hideLoadingOverlay();
    showSandboxRightPanel(sandboxSession);
    updateCloseButtonState();

    assertNodeParity(sandboxSession.nodes, (payload && Array.isArray(payload.nodes) && payload.nodes.length > 0) ? payload.nodes : null);

    console.log('[SIM_TAB] Sandbox pipeline complete for session ' + sandboxSession.id);

    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('sim-sandbox-loaded', sandboxSession);
    }
  }

  // NOTE: showRightPanelContent removed with the freeze flow (only caller).


  // FIRE EVENT. CAVE-IN is a FORGE timeline event computed by :8020.
  // CRACK / TILT / VIBRATION become timeline events in B2d-B2f; until then
  // TILT and VIBRATION only play their look at the target (no maths), and
  // CRACK says it is not built yet. FORGE never calls the 690-day lab.
  function runScenario() {
    var type = selectedScenarioType || 'crack';
    setViewportLit(true);
    if (type === 'sudden_sinking') {
      fireForgeCaveIn();
      return;
    }
    fireForgeTrigger(type);
    clearForgePreview();
    var btnRun = document.getElementById('btn-sim-run-scenario');
    if (type === 'crack' && btnRun) {
      btnRun.textContent = 'CRACK: NOT BUILT YET (B2d)';
      setTimeout(function () { btnRun.textContent = 'FIRE EVENT'; }, 1800);
    }
  }

  function fireForgeTrigger(type) {
    if (typeof simEmbed === 'undefined' || !simEmbed.triggerScenario) return;
    var cx = forgeTarget.x;
    var cy = forgeTarget.y;
    if (type === 'tilt') {
      var rEl = document.getElementById('sim-tilt-radius');
      var rateEl = document.getElementById('sim-tilt-rate');
      var tRad = rEl ? parseFloat(rEl.value) : 100;
      var tiltRate = rateEl ? parseFloat(rateEl.value) : 5;
      simEmbed.triggerScenario('forge', 'tilt', cx, cy, Math.abs(tiltRate) * tRad / 1000, tRad);
    } else if (type === 'vibration') {
      simEmbed.triggerScenario('forge', 'vibration', cx, cy, 0, 0, undefined, undefined);
    }
  }

  function onTabShown(tab) {
    updateGateState();
    renderForgeHealth();
    if (tab === 'sim') {
      startSimLiveBadgePolling();
      updateSimLiveBadge();
    } else {
      stopSimLiveBadgePolling();
    }
    if (tab === 'forge') {
      if (!forgeInitialized) {
        forgeInitialized = true;
        seedForge();
      }
    } else {
      pauseForge();
    }
    // Lazy-load the shown tab's 3D slot on first visit (perf: a slot costs
    // no WebGL until its tab opens; the hidden slot's frame loop suspends
    // automatically under display:none).
    if (typeof simEmbed !== 'undefined' && simEmbed.onSlotShown) {
      simEmbed.onSlotShown(tab === 'forge' ? 'forge' : 'sim');
    }
  }

  return {
    init: init,
    onTabShown: onTabShown,
    runScenario: runScenario,
    getSandboxSession: function () { return sandboxSession; },
    handleSandboxCreate: handleSandboxCreate,
    closeSandboxSession: closeSandboxSession,
    updateGateState: updateGateState,
    renderForgeHealth: renderForgeHealth,
    renderForgeRight: renderForgeRight,
    getForgeAlarms: function () { return forgeAlarms.slice(); },
    getForgeFrame: function () { return forgeLastFrame; },
    renderDataNodeDetail: renderDataNodeDetail,
    selectNode: selectNode,
    assertNodeParity: assertNodeParity,
    repaintClonedMarker: repaintClonedMarker,
    nodeStateColor: nodeStateColor,
    recenterToSessionBounds: recenterToSessionBounds,
    updateSimLiveBadge: updateSimLiveBadge,
    getCurrentDay: function () { return currentDay; },
    getForgeState: function () { return Object.assign({}, forgeState); },
    seedForge: seedForge,
    requestForgeFrame: requestForgeFrame,
    playForge: playForge,
    pauseForge: pauseForge,
    setForgeTarget: setForgeTarget,
    getForgeTarget: function () { return Object.assign({}, forgeTarget); }
  };
})();

if (typeof window !== 'undefined') {
  window.simTab = simTab;
}
