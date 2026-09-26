'use strict';

/**
 * sim-tab.js — Simulation Tab (data viewer) & Forge Tab (sandbox lab) controller.
 * Both tabs render the website 3D app (simulation/frontend ?embed=1) through
 * sim-embed.js dual slots; this module owns dashboard chrome + lab wiring only.
 * - SIMULATION tab: selection-proof full-district DATA viewer. Embedded 3D
 *   terrain with all district nodes, HUD (SECTOR, FACE, DEEPEST, NODES MOVING),
 *   manual timeline scrubber (PLAY/step/slider refresh the :8010 snapshot HUD
 *   for the shown day), right data inspector (click a node in 3D). Selections,
 *   sandbox sessions and experiments NEVER alter this tab.
 * - FORGE tab: sandbox lab. Left controls (day, segment scope, CRACK / TILT /
 *   VIBRATION / CAVE-IN + per-event params, FIRE EVENT), middle 3D region
 *   view (embedded app clipped to the selection; local-preview triggers +
 *   crack lines), right dashboard (district health dots + clone list +
 *   sandbox notifications + consequence results). MAP SIM-box selections
 *   auto-open it.
 * - Talks to Scenario Lab server on :8010 (GET /api/segments, GET /api/snapshot, POST /api/scenario).
 * - Reads node records via nodeMarkers.getNodeData (single-node inspect) and
 *   fixtureProvider (bulk district pool). Never touches live map state.
 */
var simTab = (function () {
  var LAB_API_BASE = 'http://' + (window.location.hostname || 'localhost') + ':8010';

  // Geo constants matching mine-sim/config/mines/adriyala_lw1.yaml.
  // Projection matches lab.yaml m_per_deg_lat, simulation/sandbox/geo.py,
  // map-view.js and sim-embed.js (111320 x cos(lat0)).
  var PANEL_CENTRE_LAT = 18.6435;
  var PANEL_CENTRE_LON = 79.5725;
  var PANEL_LENGTH_M = 2500.0;
  var M_PER_DEG_LAT = 111320.0;
  var M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(PANEL_CENTRE_LAT * Math.PI / 180);

  var currentDay = 0;
  var currentSegment = '3';
  var selectedScenarioType = 'crack'; // 'crack', 'tilt', 'vibration', 'sudden_sinking'
  var isFrozen = false;
  var segmentsData = [];
  var lastSnapshotData = null;
  var lastScenarioData = null;
  var sandboxSession = null;
  var isLabAvailable = true;
  var inTabNotifications = [];
  var isPlaying = false;
  var simLiveBadgeTimer = null;

  // Latest-telemetry cache, same rule as MAP node-sensors.js (scan fixture
  // history from the end, cache per node) so SIM/FORGE show the same numbers.
  var nodeTelemetryCache = {};

  function updateSimLiveBadge() {
    var badge = document.getElementById('sim-live-day-badge');
    if (!badge) return;
    var apiBase = 'http://' + (window.location.hostname || 'localhost') + ':8080';
    fetch(apiBase + '/api/simulation/status', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var seconds = (data && data.t_sim_seconds) || 0;
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
          return;
        }
        // The PLAY button (and its stopPlay()) was removed in B0; nothing
        // sets isPlaying true anymore, so there is nothing to stop here.
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
    loadSegments();
    logDatasetProof();
    setTimeout(function () {
      assertNodeParity();
    }, 1500);
    renderForgeHealth();
    var inspectorBody = document.getElementById('sim-inspector-body');
    if (inspectorBody && !inspectorBody.innerHTML.trim()) {
      inspectorBody.innerHTML = '<div style="color:var(--text-secondary); font-size:10.5px; padding:6px;">No nodes in active sandbox session. Draw a SIM box on MAP to begin.</div><div id="sim-active-node-detail-container"></div>';
    }
    var notifBody = document.getElementById('sim-notifications-body');
    if (notifBody && !notifBody.innerHTML.trim()) {
      notifBody.innerHTML = '<div class="sim-empty-notif" style="color:var(--text-secondary); font-size:10.5px; padding:6px;">No scenario alarms. Draw a SIM box on MAP and run an experiment to observe consequences.</div>';
    }
    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('nodes-loaded', function () {
        renderForgeHealth();
      });
    }
    updateGateState();
    updateSimLiveBadge();
    if (simLiveBadgeTimer) clearInterval(simLiveBadgeTimer);
    simLiveBadgeTimer = setInterval(updateSimLiveBadge, 5000);
  }

  function setupDomListeners() {

    // 2. Zone picker REMOVED: the region comes ONLY from the MAP SIM-box
    // selection (currentSegment stays '3' as the lab snapshot-values scope).

    // 3. Isolate checkbox REMOVED (UI cleanup): SIM always shows the full
    // district, FORGE always frames the selection.

    // 4. FREEZE button
    var btnFreeze = document.getElementById('btn-sim-freeze');
    if (btnFreeze) {
      btnFreeze.addEventListener('click', function () {
        freezeCurrentDay();
      });
    }

    // 5. Scenario buttons (CRACK, TILT, VIBRATION, CAVE-IN)
    var scenarioBtns = document.querySelectorAll('.sim-scenario-btn');
    scenarioBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        scenarioBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selectedScenarioType = btn.dataset.type || 'crack';
        updateScenarioParamsVisibility(selectedScenarioType);
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

  async function checkLabAvailability() {
    var isUp = false;
    try {
      var controller = new AbortController();
      var timeoutId = setTimeout(function () { controller.abort(); }, 1500);
      var r = await fetch(LAB_API_BASE + '/health', { signal: controller.signal });
      clearTimeout(timeoutId);
      if (r.ok) isUp = true;
    } catch (_) {
      try {
        var c2 = new AbortController();
        var t2 = setTimeout(function () { c2.abort(); }, 1500);
        var r2 = await fetch(LAB_API_BASE + '/api/segments', { signal: c2.signal });
        clearTimeout(t2);
        if (r2.ok) isUp = true;
      } catch (_) {
        isUp = false;
      }
    }
    isLabAvailable = isUp;
    return isUp;
  }

  // Legacy FREEZE flow removed (button hidden; experiments need no freeze).
  // Kept as a stub for export compatibility; ground truth loads silently
  // inside runScenario and the SIM day-scrub.
  function freezeCurrentDay() {
    console.warn('[sim-tab] freezeCurrentDay is retired; no freeze flow.');
  }

  function deepestFromSnapshot(snap) {
    var deepestS = 0;
    if (snap && Array.isArray(snap.subsidence_mm)) {
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
    return deepestS;
  }

  function updateHudStats(snap, segId) {
    var sectorEl = document.getElementById('sim-hud-sector');
    var faceEl = document.getElementById('sim-hud-face');
    var deepestEl = document.getElementById('sim-hud-deepest');
    var nodesMovingEl = document.getElementById('sim-hud-nodes-moving');

    // Sector label (SIM HUD is data-only; sandbox identity lives in FORGE).
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
    var deepestS = deepestFromSnapshot(snap);
    if (deepestEl) {
      deepestEl.textContent = deepestS.toFixed(1) + ' mm';
    }

    // Count district nodes inside the snapshot bounds (data pool only).
    var movingCount = 0;
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
    if (movingCount === 0) movingCount = allNodes.length || 8;
    if (nodesMovingEl) {
      nodesMovingEl.textContent = movingCount + ' Active';
    }
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

  function addSandboxNotification(notif) {
    var notifBody = document.getElementById('sim-notifications-body');
    var badge = document.getElementById('sim-notifications-badge');
    inTabNotifications.unshift(notif);
    if (badge) {
      badge.textContent = inTabNotifications.length + ' EVENTS';
    }
    if (!notifBody) return;

    var emptyNotif = notifBody.querySelector('.sim-empty-notif');
    if (emptyNotif) {
      emptyNotif.remove();
    }

    var isDanger = notif.severity === 'high' || notif.type === 'sudden_sinking' || notif.type === 'edge_collapse' || notif.type === 'ERROR';
    var itemEl = document.createElement('div');
    itemEl.className = 'sim-notif-item' + (isDanger ? ' danger' : '');
    itemEl.innerHTML =
      '<div class="sim-notif-header">' +
        '<span class="sim-notif-badge' + (isDanger ? ' danger' : '') + '">' + (notif.title || notif.type || 'EVENT').toUpperCase() + '</span>' +
        '<span class="sim-notif-tag">OFFLINE SANDBOX</span>' +
        '<span style="font-family:monospace;">' + (notif.time || ('Day ' + Math.round(currentDay))) + '</span>' +
      '</div>' +
      '<div class="sim-notif-body">' + notif.message + '</div>';

    if (notifBody.firstChild) {
      notifBody.insertBefore(itemEl, notifBody.firstChild);
    } else {
      notifBody.appendChild(itemEl);
    }
  }

  function renderSandboxMiniDashboard(clonedNodes, selectedNodeId) {
    var inspectorBody = document.getElementById('sim-inspector-body');
    var countBadge = document.getElementById('sim-nodes-count-badge');
    var headerTitle = document.getElementById('sim-inspector-header-title');
    if (headerTitle) headerTitle.textContent = 'SANDBOX CLUSTER NODES';
    if (countBadge) countBadge.textContent = (clonedNodes ? clonedNodes.length : 0) + ' CLONED';
    if (!inspectorBody) return;

    if (!clonedNodes || clonedNodes.length === 0) {
      inspectorBody.innerHTML = '<div style="color:var(--text-secondary); font-size:10.5px; padding:6px;">No nodes in active sandbox session.</div>';
      return;
    }

    var activeId = selectedNodeId || (clonedNodes[0] && (clonedNodes[0].node_id || clonedNodes[0].id));

    var html = '<div class="sim-nodes-mini-dashboard" style="display:flex; flex-direction:column; gap:3px; margin-bottom:6px;">';

    clonedNodes.forEach(function (n) {
      var nodeId = n.node_id || n.id || 'N??';
      var state = (n.state || 'active').toLowerCase();
      var color = nodeStateColor(state);
      var role = n.role || n.node_type || (nodeId === 'N31' ? 'gateway' : 'scout');
      var tierLetter = n.tier ? String(n.tier).charAt(0) : (nodeId === 'N31' ? 'G' : 'A');
      if (nodeId === 'N31') tierLetter = 'G';

      // Readings: same latest-telemetry rule as MAP (parity), clone fields
      // next, deterministic placeholder only when nothing exists at all.
      var tele = latestNodeTelemetry(nodeId) || {};
      var tiltDeg = 0.0;
      var strainVal = 142;
      if (tele.tilt_x_mdeg != null || tele.tilt_y_mdeg != null) {
        tiltDeg = (Math.hypot(tele.tilt_x_mdeg || 0, tele.tilt_y_mdeg || 0) / 1000);
      } else if (n.tilt_x != null || n.tilt_y != null) {
        tiltDeg = (Math.hypot(n.tilt_x || 0, n.tilt_y || 0) / 1000);
      } else if (n.lastTelemetry && (n.lastTelemetry.tilt_x_mdeg != null || n.lastTelemetry.tilt_y_mdeg != null)) {
        tiltDeg = (Math.hypot(n.lastTelemetry.tilt_x_mdeg || 0, n.lastTelemetry.tilt_y_mdeg || 0) / 1000);
      } else {
        var num = parseInt(nodeId.replace(/\D/g, ''), 10) || 1;
        tiltDeg = 0.05 + (num % 5) * 0.04;
      }

      if (tele.strain_ustrain != null) {
        strainVal = Math.round(tele.strain_ustrain);
      } else if (n.lastTelemetry && n.lastTelemetry.strain_ustrain != null) {
        strainVal = Math.round(n.lastTelemetry.strain_ustrain);
      } else if (n.strain != null) {
        strainVal = Math.round(n.strain);
      }

      var tiltStr = tiltDeg.toFixed(2) + '°';
      var isSelected = (nodeId === activeId);

      html +=
        '<div class="sim-node-item' + (isSelected ? ' selected' : '') + '" data-node-id="' + nodeId + '">' +
          '<div style="display:flex; align-items:center; gap:6px;">' +
            '<span class="sim-node-status-dot" style="background:' + color + '; color:' + color + ';"></span>' +
            '<b style="font-family:monospace; color:#FFFFFF; font-size:10.5px;">' + nodeId + '</b>' +
            '<span style="font-size:8.5px; background:rgba(255,255,255,0.06); padding:0 3px; border-radius:2px; color:var(--text-secondary);">' + tierLetter + '</span>' +
          '</div>' +
          '<div class="sim-node-readings">' +
            '<span>Tilt: <span class="sim-node-metric-val">' + tiltStr + '</span></span>' +
            '<span style="color:rgba(255,255,255,0.15);">|</span>' +
            '<span>ε: <span class="sim-node-metric-val">' + strainVal + 'µε</span></span>' +
            '<span style="color:rgba(255,255,255,0.15);">|</span>' +
            '<span style="color:' + color + '; font-weight:bold; font-size:9px;">' + state.toUpperCase() + '</span>' +
          '</div>' +
        '</div>';
    });

    html += '</div>';

    // Detail card container for active node
    html += '<div id="sim-active-node-detail-container"></div>';

    inspectorBody.innerHTML = html;

    // Attach click listeners to node rows
    var rows = inspectorBody.querySelectorAll('.sim-node-item');
    rows.forEach(function (r) {
      r.addEventListener('click', function () {
        var nid = this.getAttribute('data-node-id');
        rows.forEach(function (other) { other.classList.remove('selected'); });
        this.classList.add('selected');
        selectNode(nid);
      });
    });

    if (activeId) {
      renderActiveNodeDetail(activeId);
    }
  }

  function renderActiveNodeDetail(nodeId) {
    var detailContainer = document.getElementById('sim-active-node-detail-container') || document.getElementById('sim-inspector-body');
    if (!detailContainer) return;

    var nd = null;
    if (sandboxSession && Array.isArray(sandboxSession.nodes)) {
      nd = sandboxSession.nodes.find(function (n) { return (n.node_id || n.id) === nodeId; });
    }
    if (!nd && typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) {
      nd = nodeMarkers.getNodeData(nodeId);
    }
    if (!nd) nd = { node_id: nodeId, state: 'active' };

    var role = nd.role || nd.node_type || (nodeId === 'N31' ? 'gateway' : 'scout');
    var tier = nd.tier || (nodeId === 'N31' ? '3' : '1A');
    var state = (nd.state || 'active').toUpperCase();
    var color = nodeStateColor(nd.state || 'active');
    var lat = (typeof nd.lat === 'number') ? nd.lat : (nd.latitude || (Array.isArray(nd.pos) ? nd.pos[0] : null));
    var lng = (typeof nd.lng === 'number') ? nd.lng : (nd.longitude || (Array.isArray(nd.pos) ? nd.pos[1] : null));
    // CLONED means membership in THIS session's clone set — not merely that a
    // session exists. Health dots cover every district node, so a dot outside
    // the selection must read MONITORED, never ISOLATED.
    var isClone = Boolean(sandboxSession && Array.isArray(sandboxSession.nodes) &&
      sandboxSession.nodes.some(function (n) { return (n.node_id || n.id) === nodeId; }));

    detailContainer.innerHTML =
      '<div style="padding:6px; background:var(--bg-chrome); border-radius:3px; border:1px solid var(--border-bevel-dark); display:flex; flex-direction:column; gap:4px;">' +
        '<div style="display:flex; justify-content:space-between; align-items:center;">' +
          '<span style="font-size:11px; font-weight:bold; color:#FFFFFF; font-family:monospace;">NODE ' + nodeId + (isClone ? ' (CLONED)' : '') + '</span>' +
          '<span class="state-badge" style="font-size:9px; font-weight:bold; padding:1px 5px; background:rgba(0,0,0,0.4); color:' + color + '; border:1px solid ' + color + '; border-radius:2px;">' + state + '</span>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">ROLE:</span><b>' + role.toUpperCase() + ' (Tier ' + tier + ')</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">LAT / LNG:</span><b style="font-family:monospace;">' + (lat ? lat.toFixed(5) : '--') + ', ' + (lng ? lng.toFixed(5) : '--') + '</b></div>' +
        '<div style="display:flex; justify-content:space-between; font-size:9.5px;"><span style="color:var(--text-secondary);">STATUS:</span><b style="color:' + color + ';">' + (isClone ? 'SANDBOX CLONE &bull; ISOLATED' : 'MONITORED') + '</b></div>' +
        (sandboxSession ? '<div style="display:flex; justify-content:space-between; font-size:9px; color:#A4B8C4; padding-top:2px; border-top:1px solid rgba(255,255,255,0.06); font-family:monospace;"><span>SESSION:</span><span>' + sandboxSession.id + '</span></div>' : '') +
      '</div>';
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
    // Update selected class on mini dashboard rows if present
    var inspectorBody = document.getElementById('sim-inspector-body');
    if (inspectorBody) {
      var rows = inspectorBody.querySelectorAll('.sim-node-item');
      rows.forEach(function (r) {
        if (r.getAttribute('data-node-id') === nodeId) {
          r.classList.add('selected');
        } else {
          r.classList.remove('selected');
        }
      });
    }
    renderActiveNodeDetail(nodeId);
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
    addSandboxNotification({
      type: 'RESET',
      title: 'FORGE RESET',
      severity: 'info',
      time: 'Day ' + Math.round(currentDay),
      message: 'All FORGE events cleared — ground is back to the live state.'
    });
  }

  /**
   * FORGE district health board: one dot per district node (FULL pool, not
   * just the selection), colored by the same state rule as MAP markers.
   */
  function renderForgeHealth() {
    var body = document.getElementById('forge-health-body');
    var badge = document.getElementById('forge-health-badge');
    var allNodes = (typeof fixtureProvider !== 'undefined' && fixtureProvider.getNodes)
      ? (fixtureProvider.getNodes() || [])
      : [];
    if (badge) badge.textContent = allNodes.length + ' NODES';
    if (!body) return;
    if (allNodes.length === 0) {
      body.innerHTML = '<div style="color:var(--text-secondary); font-size:10.5px; padding:6px;">No district nodes loaded yet.</div>';
      return;
    }
    var html = '';
    allNodes.forEach(function (n) {
      var nodeId = n.node_id || n.id || 'N??';
      var state = (n.state || 'active').toLowerCase();
      var color = nodeStateColor(state);
      html += '<span class="forge-health-dot" data-node-id="' + nodeId + '" style="cursor:pointer;" title="' + nodeId + ' — ' + state.toUpperCase() + ' (click to inspect)">' +
        '<i style="background:' + color + ';"></i>' + nodeId + '</span>';
    });
    body.innerHTML = html;

    var dots = body.querySelectorAll('.forge-health-dot');
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () {
        var nid = this.getAttribute('data-node-id');
        if (nid) {
          selectNode(nid);
        }
      });
    });
  }

  /* --- Sandbox Session & Pipeline Helpers --- */

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
    // channel is untouched (close only undoes what a SIM-box send did).
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
    var labBanner = document.getElementById('sim-lab-down-banner');
    if (labBanner) {
      labBanner.style.display = 'none';
    }
    var labBadge = document.querySelector('#sim-left .panel-badge');
    if (labBadge) {
      labBadge.textContent = 'LAB 8010';
      labBadge.style.color = '#00FF88';
      labBadge.style.borderColor = '#00CC44';
      labBadge.style.background = '#1B445A';
    }

    // Reset notifications feed with empty state placeholder
    var notifBody = document.getElementById('sim-notifications-body');
    if (notifBody) {
      notifBody.innerHTML = '<div class="sim-empty-notif" style="color:var(--text-secondary); font-size:10.5px; padding:6px;">No scenario alarms. Draw a SIM box on MAP and run an experiment to observe consequences.</div>';
    }
    var notifBadge = document.getElementById('sim-notifications-badge');
    if (notifBadge) notifBadge.textContent = 'OFFLINE FEED';
    inTabNotifications = [];

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

    // Reset clone mini dashboard with detail card slot
    var inspectorBody = document.getElementById('sim-inspector-body');
    if (inspectorBody) {
      inspectorBody.innerHTML = '<div style="color:var(--text-secondary); font-size:10.5px; padding:6px;">No nodes in active sandbox session. Draw a SIM box on MAP to begin.</div><div id="sim-active-node-detail-container"></div>';
    }
    var countBadge = document.getElementById('sim-nodes-count-badge');
    if (countBadge) countBadge.textContent = '0 CLONED';

    var resultBody = document.getElementById('sim-scenario-result-body');
    if (resultBody) {
      resultBody.innerHTML =
        '<div class="sim-card">' +
          '<div class="sim-card-header">' +
            '<div style="font-size:11px; color:#00FF88; font-weight:bold;">SANDBOX ISOLATION VERIFIED</div>' +
            '<span class="sim-badge-success">OFF-LINE COPY</span>' +
          '</div>' +
          '<div style="font-size:10.5px; color:var(--text-primary); line-height:1.4;">' +
            'Pick CRACK / TILT / VIBRATION / CAVE-IN + parameters, press FIRE EVENT — the consequence forecast for this isolated region appears here.' +
          '</div>' +
          '<div style="font-size:9.5px; color:var(--text-secondary); line-height:1.35; margin-top:2px;">' +
            'This simulation runs in an isolated sandbox. Events injected here will <b>NOT</b> alter active sensor thresholds or alert logs on the live dashboard.' +
          '</div>' +
        '</div>';
    }

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

  async function fetchAndPaintGeology(payload, bounds) {
    // Region ground truth for the FORGE slot: snapshot values come from the
    // lab segment scope (before/after strip); the 3D view clips to the USER'S
    // selection box + node allowlist. No auto crack run: cracks draw only
    // after the user presses RUN. SIM slot untouched.
    var seg = currentSegment || '3';
    var day = (sandboxSession && sandboxSession.day != null)
      ? Math.round(sandboxSession.day)
      : Math.round(currentDay);

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

    if (bounds && bounds.south != null) {
      lastSnapshotData.bounds = bounds;
    }

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

    // Mini dashboard in the FORGE right column: list all sandboxSession.nodes
    // with status color, tilt + key readings each. SIM panels untouched.
    renderSandboxMiniDashboard(session.nodes);

    // In-tab sandbox notification list fed by scenario runs and session events
    inTabNotifications = [];
    addSandboxNotification({
      type: 'INIT',
      title: 'SANDBOX INIT',
      time: 'Day ' + Math.round(session.day || currentDay),
      message: 'Isolated clone created with ' + session.nodes.length + ' nodes (' + session.id + '). Real-time dashboard alarms untouched.'
    });

    var resultBody = document.getElementById('sim-scenario-result-body');
    if (resultBody) {
      if (!isLabAvailable) {
        resultBody.innerHTML =
          '<div class="sim-card" style="border-left: 3px solid #FF5252;">' +
            '<div class="sim-card-header">' +
              '<span style="font-size:11px; color:#FF5252; font-weight:bold;">SCENARIO LAB (:8010) OFFLINE</span>' +
              '<span class="sim-badge-danger" style="background:#3A1414; color:#FF5252; border:1px solid #FF5252; padding:1px 5px; font-size:9px; border-radius:2px;">OFFLINE</span>' +
            '</div>' +
            '<div style="font-size:10.5px; color:#FFA4A4; line-height:1.4; margin-top:4px;">' +
              'Failed to connect to Scenario Lab server at <b>' + LAB_API_BASE + '</b>. Geologic crack modeling and what-if calculations are unavailable. Start via scripts/start_all.js or python -m lab.server --port 8010.' +
            '</div>' +
          '</div>';
      } else {
        resultBody.innerHTML =
          '<div class="sim-card">' +
            '<div class="sim-card-header">' +
              '<div style="font-size:11px; color:#00FF88; font-weight:bold;">SANDBOX ISOLATION VERIFIED</div>' +
              '<span class="sim-badge-success">OFF-LINE COPY</span>' +
            '</div>' +
            '<div style="font-size:10.5px; color:var(--text-primary); line-height:1.4;">' +
              'Pick CRACK / TILT / VIBRATION / CAVE-IN + parameters, press FIRE EVENT — the consequence forecast for this isolated region appears here.' +
            '</div>' +
            '<div style="font-size:9.5px; color:var(--text-secondary); line-height:1.35; margin-top:2px;">' +
              'This simulation runs in an isolated sandbox. Events injected here will <b>NOT</b> alter active sensor thresholds or alert logs on the live dashboard.' +
            '</div>' +
          '</div>';
      }
    }
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

    // Health check :8010 on sandbox open
    var labAvailable = await checkLabAvailability();
    var labBanner = document.getElementById('sim-lab-down-banner');
    var labBadge = document.querySelector('#sim-left .panel-badge');

    if (!labAvailable) {
      console.warn('[SIM_TAB] Scenario Lab (:8010) is DOWN at ' + LAB_API_BASE);
      if (labBanner) labBanner.style.display = 'flex';
      if (labBadge) {
        labBadge.textContent = 'LAB 8010: DOWN';
        labBadge.style.color = '#FF5252';
        labBadge.style.borderColor = '#FF5252';
        labBadge.style.background = '#3A1414';
      }
    } else {
      if (labBanner) labBanner.style.display = 'none';
      if (labBadge) {
        labBadge.textContent = 'LAB 8010';
        labBadge.style.color = '#00FF88';
        labBadge.style.borderColor = '#00CC44';
        labBadge.style.background = '#1B445A';
      }
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
    updateStageStatus('trough', 'active', 'Pulling :8010 subsidence trough & crack models...');
    await fetchAndPaintGeology(payload, bounds);
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

  function showScenarioBanner(day) {
    var banner = document.getElementById('sim-scenario-banner');
    var bannerDay = document.getElementById('sim-banner-day');
    if (banner) {
      banner.style.display = 'block';
      if (bannerDay) bannerDay.textContent = Math.round(day);
    }
  }

  var DEFAULT_MINE_BOUNDS = {
    south: 18.640,
    north: 18.647,
    west: 79.569,
    east: 79.576
  };

  function getRunBounds() {
    // Region for a run: live session bounds first, else the current
    // SIM-channel selection, or fallback to the full mine panel bounds.
    if (sandboxSession) {
      if (sandboxSession.bounds && sandboxSession.bounds.south != null) return sandboxSession.bounds;
      if (sandboxSession.selection) {
        try {
          var sb = getSelectionBounds(sandboxSession.selection);
          if (sb && sb.south != null) return sb;
        } catch (_) {}
      }
    }
    try {
      if (typeof selectionStore !== 'undefined' && selectionStore.has('sim')) {
        var sel = selectionStore.get('sim');
        var bb = getSelectionBounds(sel);
        if (bb && bb.south != null) return bb;
      }
    } catch (_) {}
    return DEFAULT_MINE_BOUNDS;
  }

  function runScenario() {
    // Region is mandatory: experiments run ONLY on a MAP-selected region
    // (the old zone fallback is gone). The button is disabled when gated,
    // but programmatic callers (tests) get a clean refusal, not a crash.
    if (!getRunBounds()) {
      addSandboxNotification({
        type: selectedScenarioType || 'crack',
        title: 'NO REGION',
        severity: 'info',
        time: 'Day ' + Math.round(currentDay),
        message: 'Draw a SIM box on MAP first — experiments need a selected region.'
      });
      updateGateState();
      return;
    }

    setViewportLit(true);
    var btnRun = document.getElementById('btn-sim-run-scenario');
    if (btnRun) {
      btnRun.textContent = 'RUNNING...';
      btnRun.disabled = true;
    }

    var day = (sandboxSession && sandboxSession.day != null)
      ? Math.round(sandboxSession.day)
      : Math.round(currentDay);

    var type = selectedScenarioType || 'crack';
    var params = {};

    if (type === 'crack') {
      var dayAheadInput = document.getElementById('sim-days-ahead');
      var crackRadiusInput = document.getElementById('sim-crack-radius');
      params = {
        days_ahead: dayAheadInput ? parseFloat(dayAheadInput.value || 30) : 30,
        nearby_radius_m: crackRadiusInput ? parseFloat(crackRadiusInput.value || 150) : 150
      };
    } else if (type === 'tilt') {
      var tiltRateInput = document.getElementById('sim-tilt-rate');
      var tiltDirInput = document.getElementById('sim-tilt-dir');
      var tiltRadiusInput = document.getElementById('sim-tilt-radius');
      params = {
        tilt_mm_per_m: tiltRateInput ? parseFloat(tiltRateInput.value || 5.0) : 5.0,
        direction_deg: tiltDirInput ? parseFloat(tiltDirInput.value || 0.0) : 0.0,
        radius_m: tiltRadiusInput ? parseFloat(tiltRadiusInput.value || 100.0) : 100.0
      };
    } else if (type === 'vibration') {
      params = {};
    } else if (type === 'sudden_sinking') {
      var caveinRadiusInput = document.getElementById('sim-cavein-radius');
      params = {
        collapse_radius_m: caveinRadiusInput ? parseFloat(caveinRadiusInput.value || 60.0) : 60.0
      };
    } else if (type === 'edge_collapse') {
      params = {
        pillar_width_m: 20.0,
        length_m: 300.0
      };
    }

    // Region-scoped maths: the run ALWAYS carries the USER'S selection
    // bounds (server confines via bounds_to_zone). Guaranteed present by the
    // gate above — no zone fallback anymore.
    var runBounds = getRunBounds();
    var payload = {
      day: day,
      type: type,
      params: params,
      bounds: { north: runBounds.north, south: runBounds.south, east: runBounds.east, west: runBounds.west }
    };

    // Silent ground-truth load for the before/after strip + FORGE trough
    // (no freeze flow; the user asked for experiments, not freeze steps).
    fetch(LAB_API_BASE + '/api/snapshot?day=' + encodeURIComponent(day) + '&segment=' + encodeURIComponent(currentSegment))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (snap) {
        if (snap) {
          lastSnapshotData = snap;
          isFrozen = true;
          // FORGE slot clip already carries the run region; no repaint needed.
        }
      })
      .catch(function () {});

    fetch(LAB_API_BASE + '/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        lastScenarioData = data;
        if (btnRun) {
          btnRun.textContent = 'FIRE EVENT';
          btnRun.disabled = false;
        }
        renderScenarioResult(data);
      })
      .catch(function (err) {
        console.error('[sim-tab] Scenario run error:', err);
        if (btnRun) {
          btnRun.textContent = 'FIRE EVENT';
          btnRun.disabled = false;
        }
        var resultBody = document.getElementById('sim-scenario-result-body');
        if (resultBody) {
          resultBody.innerHTML =
            '<div class="sim-card" style="border-left: 3px solid #FF5252;">' +
              '<div class="sim-card-header">' +
                '<span style="font-size:11px; color:#FF5252; font-weight:bold;">SCENARIO LAB (:8010) OFFLINE</span>' +
                '<span class="sim-badge-danger" style="background:#3A1414; color:#FF5252; border:1px solid #FF5252; padding:1px 5px; font-size:9px; border-radius:2px;">OFFLINE</span>' +
              '</div>' +
              '<div style="font-size:10.5px; color:#FFA4A4; line-height:1.4; margin-top:4px;">' +
                'Scenario computation failed: ' + (err.message || 'Unable to connect to ' + LAB_API_BASE) + '. Ensure lab server is running on port 8010.' +
              '</div>' +
            '</div>';
        }
        addSandboxNotification({
          type: 'ERROR',
          title: 'RUN FAILED',
          severity: 'high',
          time: 'Day ' + Math.round(currentDay),
          message: 'Scenario execution failed: ' + (err.message || 'Lab :8010 down')
        });
      });
  }

  function renderScenarioResult(data) {
    var resultBody = document.getElementById('sim-scenario-result-body');
    if (!resultBody) return;

    var isPossible = Boolean(data && data.possible);
    var scenarioId = (data && (data.scenario_id || data.id)) || 'N/A';
    var reason = (data && (data.reason || (data.summary && data.summary.plain && data.summary.plain[0]))) || '';
    var newCracks = (data && (data.new_cracks || (data.summary && data.summary.new_cracks))) || 0;
    var maxExtraSinking = (data && data.max_extra_sinking_mm !== undefined && data.max_extra_sinking_mm !== null)
      ? data.max_extra_sinking_mm
      : ((data && data.summary && data.summary.max_extra_sinking_mm !== undefined && data.summary.max_extra_sinking_mm !== null) ? data.summary.max_extra_sinking_mm : 0);

    var plainSentences = (data && data.summary && Array.isArray(data.summary.plain)) ? data.summary.plain : (reason ? [reason] : []);
    var objects = (data && Array.isArray(data.objects)) ? data.objects : [];

    // 1) Header Block: TYPE · DAY <day> ...
    var typeLabel = 'CRACK';
    var rawType = (data && (data.event || data.event_name)) || selectedScenarioType || 'crack';
    var lowerType = String(rawType).toLowerCase();
    if (lowerType === 'crack') {
      typeLabel = 'CRACK';
    } else if (lowerType === 'sudden_sinking' || lowerType === 'sink') {
      typeLabel = 'CAVE-IN';
    } else if (lowerType === 'tilt') {
      typeLabel = 'TILT';
    } else if (lowerType === 'vibration') {
      typeLabel = 'VIBRATION';
    } else if (lowerType === 'edge_collapse' || lowerType === 'collapse') {
      typeLabel = 'COLLAPSE';
    } else {
      typeLabel = rawType.toUpperCase();
    }

    var dayVal = (data && data.frozen_day != null)
      ? Math.round(data.frozen_day)
      : (data && data.request && data.request.day != null
        ? Math.round(data.request.day)
        : (sandboxSession && sandboxSession.day != null ? Math.round(sandboxSession.day) : Math.round(currentDay)));

    var daysAheadInput = document.getElementById('sim-days-ahead');
    var daysAheadVal = (data && data.params_used && data.params_used.days_ahead && typeof data.params_used.days_ahead.value === 'number')
      ? Math.round(data.params_used.days_ahead.value)
      : (data && data.request && data.request.params && data.request.params.days_ahead != null
        ? Math.round(data.request.params.days_ahead)
        : (daysAheadInput ? Math.round(parseFloat(daysAheadInput.value || 30)) : 30));

    var headerTitle = (lowerType === 'crack')
      ? (typeLabel + ' · DAY ' + dayVal + ' + ' + daysAheadVal + 'D HORIZON')
      : (typeLabel + ' · DAY ' + dayVal + ' · ' + (data && data.zone_id ? ('ZONE ' + data.zone_id) : 'DISTRICT'));

    if (!isPossible) {
      // REFUSAL RENDERING
      resultBody.innerHTML =
        '<div class="sim-card sim-refusal-card">' +
          '<div class="sim-card-header sim-consequence-header">' +
            '<div class="sim-header-title-row">' +
              '<span class="sim-consequence-title">' + headerTitle + '</span>' +
              '<div style="display:flex; align-items:center; gap:6px;">' +
                '<span class="sim-badge-refusal">REFUSED</span>' +
                '<b class="sim-scenario-id">#' + scenarioId + '</b>' +
              '</div>' +
            '</div>' +
            '<div class="sim-isolation-tag">OFF-LINE WHAT-IF — live dashboard untouched</div>' +
          '</div>' +
          '<div class="sim-refusal-box" style="margin-top:6px;">' +
            '<div class="sim-refusal-title">' +
              '<span class="sim-badge-refusal">REFUSED</span>' +
              '<span>SCENARIO REJECTED BY SAFETY GATE</span>' +
            '</div>' +
            '<div style="font-weight:bold; margin-bottom:6px; color:#FFFFFF;">Scenario #' + scenarioId + '</div>' +
            '<div style="font-size:11px; line-height:1.4;">' + reason + '</div>' +
          '</div>' +
        '</div>';

      // Clear crack lines on the FORGE slot (refusal draws nothing)
      if (typeof simEmbed !== 'undefined' && simEmbed.setCracks) {
        simEmbed.setCracks('forge', []);
      }

      addSandboxNotification({
        type: selectedScenarioType,
        title: typeLabel + ' REFUSED',
        severity: 'info',
        time: 'Day ' + dayVal,
        message: 'Scenario #' + scenarioId + ' rejected: ' + (reason || 'Safety threshold check failed')
      });
      return;
    }

    // 2) BEFORE -> AFTER Sinking Strip
    var hasSnapshot = Boolean(lastSnapshotData);
    var beforeSinking = hasSnapshot ? deepestFromSnapshot(lastSnapshotData) : null;
    var extraSinking = typeof maxExtraSinking === 'number' ? maxExtraSinking : parseFloat(maxExtraSinking) || 0;
    var afterSinking = hasSnapshot ? (beforeSinking + extraSinking) : extraSinking;

    var beforeStr = (beforeSinking != null) ? (beforeSinking.toFixed(1) + ' mm') : '';
    var extraStr = (typeof extraSinking === 'number' ? extraSinking.toFixed(1) : extraSinking) + ' mm';
    var afterStr = (typeof afterSinking === 'number' ? afterSinking.toFixed(1) : afterSinking) + ' mm';

    var stripHtml = '<div class="sim-sinking-strip ' + (hasSnapshot ? 'sim-strip-3col' : 'sim-strip-2col') + '">';
    if (hasSnapshot) {
      stripHtml +=
        '<div class="sim-strip-box">' +
          '<span class="sim-strip-label">NOW</span> ' +
          '<span class="sim-strip-val">' + beforeStr + '</span>' +
        '</div>';
    }
    stripHtml +=
      '<div class="sim-strip-box">' +
        '<span class="sim-strip-label">+ EXTRA</span> ' +
        '<span class="sim-strip-val negative">' + extraStr + '</span>' +
      '</div>' +
      '<div class="sim-strip-box">' +
        '<span class="sim-strip-label">= PROJECTED</span> ' +
        '<span class="sim-strip-val negative">' + afterStr + '</span>' +
      '</div>' +
    '</div>';

    // 3) Worst-hit Callout
    function getObjectSortMetric(obj) {
      if (!obj) return 0;
      if (typeof obj.extra_sinking_mm === 'number') return Math.abs(obj.extra_sinking_mm);
      if (typeof obj.extra_subsidence_mm === 'number') return Math.abs(obj.extra_subsidence_mm);
      if (obj.after && obj.before && typeof obj.after.subsidence_mm === 'number' && typeof obj.before.subsidence_mm === 'number') {
        return Math.abs(obj.after.subsidence_mm - obj.before.subsidence_mm);
      }
      if (typeof obj.severity === 'number') return obj.severity;
      if (obj.after && typeof obj.after.change_of_length_mm === 'number') return Math.abs(obj.after.change_of_length_mm);
      if (obj.after && typeof obj.after.worst_strain_mm_per_m === 'number') return obj.after.worst_strain_mm_per_m;
      return 0;
    }

    var worseObjects = objects.filter(function (obj) {
      return Boolean(obj && (obj.worse === true || obj.worse === 1 || obj.worse === 'true'));
    });

    worseObjects.sort(function (a, b) {
      return getObjectSortMetric(b) - getObjectSortMetric(a);
    });

    var topWorse = worseObjects.slice(0, 3);
    var worstHitRows = '';
    if (topWorse.length > 0) {
      topWorse.forEach(function (obj) {
        var label = obj.label || obj.id || 'Asset';
        worstHitRows +=
          '<div class="sim-worst-hit-row">' +
            '<span class="sim-worst-hit-label">' + label + '</span> ' +
            '<span class="sim-worst-hit-tag">— EXCEEDED</span>' +
          '</div>';
      });
    } else {
      worstHitRows = '<div class="sim-worst-hit-empty">no exceedances</div>';
    }

    // 4) Plain sentences list
    var summaryHtml = '';
    plainSentences.forEach(function (s) {
      summaryHtml += '<li class="sim-sentence-item">' + s + '</li>';
    });

    // Vibration block
    var vibHtml = '';
    if (data && data.vibration && typeof data.vibration.max_ppv_mm_s === 'number') {
      var vib = data.vibration;
      var overLim = Boolean(vib.over_domestic_limit);
      vibHtml = '<div class="sim-cracks-box" style="margin-top:4px;">' +
        '<span class="sim-cracks-label">CAVING PPV:</span>' +
        '<span class="sim-cracks-val" style="color:' + (overLim ? '#FF5252' : '#00E676') + ';">' +
        vib.max_ppv_mm_s.toFixed(2) + ' mm/s (' + (overLim ? 'EXCEEDS DGMS' : 'COMPLIANT') + ')</span>' +
      '</div>';
    }

    // Full 10-row table
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

    // Assemble Card
    resultBody.innerHTML =
      '<div class="sim-card sim-consequence-card">' +
        // 1) Header Block
        '<div class="sim-card-header sim-consequence-header">' +
          '<div class="sim-header-title-row">' +
            '<span class="sim-consequence-title">' + headerTitle + '</span>' +
            '<div style="display:flex; align-items:center; gap:6px;">' +
              '<span class="sim-badge-success">POSSIBLE</span>' +
              '<b class="sim-scenario-id">#' + scenarioId + '</b>' +
            '</div>' +
          '</div>' +
          '<div class="sim-isolation-tag">OFF-LINE WHAT-IF — live dashboard untouched</div>' +
        '</div>' +

        // 2) BEFORE -> AFTER Sinking Strip
        stripHtml +

        // Prominent Cracks Count Box
        '<div class="sim-cracks-box">' +
          '<span class="sim-cracks-label">NEW CRACKS:</span>' +
          '<span class="sim-cracks-val">' + newCracks.toLocaleString() + '</span>' +
        '</div>' +

        // Vibration PPV Box
        vibHtml +

        // Reason line
        (reason ? '<div class="sim-consequence-reason">' + reason + '</div>' : '') +

        // Plain sentences
        (summaryHtml ? '<ul class="sim-sentence-list">' + summaryHtml + '</ul>' : '') +

        // 3) Worst-hit Callout & Full Assets Table
        '<div class="sim-worst-hit-block">' +
          '<div class="sim-section-subtitle">WORST-HIT CALLOUT:</div>' +
          worstHitRows +
        '</div>' +

        (objects.length > 0 ?
          '<div style="margin-top:6px;">' +
            '<div class="sim-section-subtitle">SURFACE ASSETS (' + objects.length + '):</div>' +
            '<div style="max-height:100px; overflow-y:auto; border:1px solid var(--border-bevel-dark); border-radius:2px;">' +
              '<table class="sim-objects-table">' +
                '<thead><tr><th>Asset</th><th>Type</th><th>Impact</th></tr></thead>' +
                '<tbody>' + objectsRows + '</tbody>' +
              '</table>' +
            '</div>' +
          '</div>' : '') +
      '</div>';

    // Paint crack lines on the FORGE slot + raise WHAT-IF banner
    paintCrackSegments(data);
    showScenarioBanner(dayVal);
    fireForgeTrigger(data, lowerType, maxExtraSinking);

    // In-tab sandbox scenario notification (isolated from global alarm banner/log)
    addSandboxNotification({
      type: selectedScenarioType,
      title: typeLabel + ' INJECTED',
      severity: 'warn',
      time: 'Day ' + dayVal + (lowerType === 'crack' ? (' (+' + daysAheadVal + 'd)') : ''),
      message: 'Consequence: ' + (typeof maxExtraSinking === 'number' ? maxExtraSinking.toFixed(1) : maxExtraSinking) + ' mm sinking, ' + newCracks + ' new cracks. ' + (reason || '')
    });
  }

  function buildCrackAppSegments(data) {
    // Lab panel metres (x: 0..panel length, y about centre) -> app mine-frame
    // metres (x/y about panel centre): ax = x - L/2, ay = y. Same relation
    // the lat/lon projection uses, without the round trip.
    var cracksData = (data && data.cracks) || {};
    var segments = Array.isArray(cracksData.segments) ? cracksData.segments : [];
    var half = PANEL_LENGTH_M * 0.5;
    return segments.map(function (seg) {
      return {
        x0: seg.x0_m - half,
        y0: seg.y0_m,
        x1: seg.x1_m - half,
        y1: seg.y1_m,
        width_mm: seg.width_mm || 0,
        isNew: seg.new === true
      };
    });
  }

  function paintCrackSegments(data) {
    // Crack lines draw on the FORGE slot only (hypothetical breaks).
    if (typeof simEmbed === 'undefined' || !simEmbed.setCracks) return;
    simEmbed.setCracks('forge', buildCrackAppSegments(data));
  }

  /**
   * Fire the FORGE slot's local ground preview for a scenario result.
   * Local-preview ONLY (the embedded app sends no engine commands), so the
   * SIM slot's ground can never move. Magnitudes come from the lab result.
   */
  function fireForgeTrigger(data, lowerType, maxExtraSinking) {
    if (!data || !data.possible) return;
    if (typeof simEmbed === 'undefined' || !simEmbed.triggerScenario) return;

    var cx = 0;
    var cy = 0;
    try {
      var b = getRunBounds();
      if (b && b.south != null && simEmbed.latLonToXy) {
        var xy = simEmbed.latLonToXy((b.south + b.north) / 2, (b.west + b.east) / 2);
        cx = xy[0];
        cy = xy[1];
      }
    } catch (_) {}

    var params = (data && data.request && data.request.params) || {};
    var t = String(lowerType || '').toLowerCase();
    if (t === 'crack') {
      return; // cracks are lines only; the ground preview stays still
    } else if (t === 'sudden_sinking' || t === 'sink' || t === 'edge_collapse' || t === 'collapse' || t === 'cave-in') {
      var rad = (params.collapse_radius_m != null) ? params.collapse_radius_m : 60;
      var sevM = Math.abs(maxExtraSinking || 0) / 1000;
      if (!(sevM > 0)) sevM = 0.5;
      simEmbed.triggerScenario('forge', 'collapse', cx, cy, sevM, rad);
    } else if (t === 'tilt') {
      var tRad = (params.radius_m != null) ? params.radius_m : 60;
      var tiltRate = (params.tilt_mm_per_m != null) ? params.tilt_mm_per_m : 2;
      simEmbed.triggerScenario('forge', 'tilt', cx, cy, Math.abs(tiltRate) * tRad / 1000, tRad);
    } else if (t === 'vibration') {
      var ppv = (data.vibration && data.vibration.ppv_max_mm_s != null)
        ? data.vibration.ppv_max_mm_s
        : ((data.summary && data.summary.ppv_max_mm_s != null) ? data.summary.ppv_max_mm_s : undefined);
      simEmbed.triggerScenario('forge', 'vibration', cx, cy, 0, 0, ppv, undefined);
    }
  }

  function onTabShown(tab) {
    updateGateState();
    renderForgeHealth();
    if (tab === 'sim') {
      updateSimLiveBadge();
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
    freezeCurrentDay: freezeCurrentDay,
    runScenario: runScenario,
    renderScenarioResult: renderScenarioResult,
    deepestFromSnapshot: deepestFromSnapshot,
    getSandboxSession: function () { return sandboxSession; },
    handleSandboxCreate: handleSandboxCreate,
    closeSandboxSession: closeSandboxSession,
    updateGateState: updateGateState,
    checkLabAvailability: checkLabAvailability,
    renderSandboxMiniDashboard: renderSandboxMiniDashboard,
    renderForgeHealth: renderForgeHealth,
    renderDataNodeDetail: renderDataNodeDetail,
    buildCrackAppSegments: buildCrackAppSegments,
    addSandboxNotification: addSandboxNotification,
    selectNode: selectNode,
    assertNodeParity: assertNodeParity,
    repaintClonedMarker: repaintClonedMarker,
    nodeStateColor: nodeStateColor,
    recenterToSessionBounds: recenterToSessionBounds,
    updateSimLiveBadge: updateSimLiveBadge,
    getCurrentDay: function () { return currentDay; },
    isPlaying: function () { return isPlaying; }
  };
})();

if (typeof window !== 'undefined') {
  window.simTab = simTab;
}
