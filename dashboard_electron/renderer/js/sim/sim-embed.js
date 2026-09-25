'use strict';

/**
 * sim-embed.js — Simulation Tab 3D Viewport Embed Controller
 *
 * Embeds the website simulation (simulation/frontend, the Three.js subsidence
 * viewport) INSIDE the Simulation tab's center column via an iframe, cropped
 * to the operator's current selection — instead of opening it in a separate
 * browser tab/window.
 *
 * Source priority:
 *   1. Vite dev server  http://127.0.0.1:5173/?embed=1... (live code)
 *   2. Production build http://<host>:8085/sim/?embed=1... (served by serve.js
 *      from simulation/frontend/dist, works without the dev server)
 *   3. MapLibre 3D map fallback (the pre-existing sim viewport) when neither
 *      embed source answers the ready handshake.
 *
 * Bridge protocol (see simulation/frontend/src/embed.ts):
 *   parent -> iframe: { source:'r4-sim-embed', cmd, ... }
 *   iframe -> parent: { source:'r4-sim-viewport', event, ... }
 *
 * Coordinates: the iframe speaks panel-frame metres (x=east, y=north about
 * the Adriyala origin). This module converts the dashboard's lat/lon bounds
 * with the same flat-earth projection as geo.py / map-view.js, clamped to
 * the 600 m simulation window.
 */
var simEmbed = (function () {
  var DEV_BASE = 'http://127.0.0.1:5173/';
  var READY_TIMEOUT_MS = 7000;

  // Adriyala origin + projection constants (mirror of geo.py / map-view.js).
  var ORIGIN_LAT = 18.6435;
  var ORIGIN_LON = 79.5725;
  var M_PER_DEG_LAT = 111320.0;
  var M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN_LAT * Math.PI / 180);
  var WINDOW_HALF_M = 300;

  var frame = null;
  var fallbackEl = null;
  var mapEl = null;
  var btnEmbed = null;
  var btnMap = null;

  // 'embed' | 'map'. Embed is default; map is user override or auto-fallback.
  var viewMode = 'embed';
  var autoFellBack = false;
  var useDevServer = true;
  var readyReceived = false;
  var readyTimer = null;
  var triedFallbackBuild = false;
  var lastBoundsInfo = null;
  var lastDay = 0;
  var isInitialized = false;

  function getBuildBase() {
    return 'http://' + (window.location.hostname || 'localhost') + ':8085/sim/';
  }

  function latLonToXy(lat, lon) {
    var north = (lat - ORIGIN_LAT) * M_PER_DEG_LAT;
    var east = (lon - ORIGIN_LON) * M_PER_DEG_LON;
    return [east, north];
  }

  function clampWindow(v) {
    if (v < -WINDOW_HALF_M) return -WINDOW_HALF_M;
    if (v > WINDOW_HALF_M) return WINDOW_HALF_M;
    return v;
  }

  /**
   * Normalize a lat/lon selection into iframe clip bounds + node allowlist.
   * Accepts { south, north, west, east } with optional nodes:[records] and
   * label. Returns { clip:{xMin,xMax,yMin,yMax}|null, nodes:number[]|null }.
   */
  function normalizeBounds(info) {
    if (!info || !isFinite(info.south) || !isFinite(info.north) ||
        !isFinite(info.west) || !isFinite(info.east)) {
      return { clip: null, nodes: null, label: (info && info.label) || null };
    }
    var sw = latLonToXy(info.south, info.west);
    var ne = latLonToXy(info.north, info.east);
    var xMin = clampWindow(Math.min(sw[0], ne[0]));
    var xMax = clampWindow(Math.max(sw[0], ne[0]));
    var yMin = clampWindow(Math.min(sw[1], ne[1]));
    var yMax = clampWindow(Math.max(sw[1], ne[1]));
    if (!(xMax > xMin) || !(yMax > yMin)) {
      return { clip: null, nodes: null, label: info.label || null };
    }

    var nodeIds = null;
    if (Array.isArray(info.nodes)) {
      var seen = {};
      var ids = [];
      for (var i = 0; i < info.nodes.length; i++) {
        var rec = info.nodes[i];
        var raw = null;
        if (rec !== null && typeof rec === 'object') {
          raw = rec.node_id != null ? rec.node_id : (rec.id != null ? rec.id : rec.nodeId);
        } else {
          raw = rec;
        }
        if (raw === null || raw === undefined) continue;
        var parsed = parseInt(String(raw).replace(/^[Nn]/, ''), 10);
        if (isFinite(parsed) && parsed > 0 && !seen[parsed]) {
          seen[parsed] = true;
          ids.push(parsed);
        }
      }
      // An explicit (possibly empty) node list is authoritative: an empty
      // selection renders zero nodes rather than leaking the full district.
      // Only when NO record carried a parseable id do we fall back to the
      // spatial clip inside the iframe (nodes: null).
      nodeIds = (info.nodes.length === 0 || ids.length > 0) ? ids.sort(function (a, b) { return a - b; }) : null;
    }

    return {
      clip: {
        xMin: Math.round(xMin * 10) / 10,
        xMax: Math.round(xMax * 10) / 10,
        yMin: Math.round(yMin * 10) / 10,
        yMax: Math.round(yMax * 10) / 10
      },
      nodes: nodeIds,
      label: info.label || null
    };
  }

  function activeExaggeration() {
    if (document.getElementById('sim-exag-1') &&
        document.getElementById('sim-exag-1').classList.contains('active')) return 1;
    if (document.getElementById('sim-exag-5') &&
        document.getElementById('sim-exag-5').classList.contains('active')) return 5;
    return 3;
  }

  function buildEmbedUrl(base, boundsInfo, day) {
    var norm = normalizeBounds(boundsInfo);
    var qs = '?embed=1';
    if (norm.clip) {
      qs += '&xmin=' + encodeURIComponent(norm.clip.xMin) +
            '&xmax=' + encodeURIComponent(norm.clip.xMax) +
            '&ymin=' + encodeURIComponent(norm.clip.yMin) +
            '&ymax=' + encodeURIComponent(norm.clip.yMax);
    }
    if (norm.nodes) {
      qs += '&nodes=' + encodeURIComponent(norm.nodes.join(','));
    }
    if (day !== null && day !== undefined && isFinite(day)) {
      qs += '&day=' + encodeURIComponent(Math.round(day));
    }
    qs += '&exag=' + encodeURIComponent(activeExaggeration());
    if (norm.label) {
      qs += '&label=' + encodeURIComponent(String(norm.label).slice(0, 80));
    }
    return base + qs;
  }

  function post(cmd) {
    if (!frame || !frame.contentWindow || !readyReceived) return false;
    try {
      var msg = Object.assign({ source: 'r4-sim-embed' }, cmd);
      frame.contentWindow.postMessage(msg, '*');
      return true;
    } catch (_) {
      return false;
    }
  }

  function showFallbackNotice(html) {
    if (!fallbackEl) return;
    fallbackEl.style.display = 'flex';
    var body = fallbackEl.querySelector('.sim-embed-fallback-body');
    if (body && html) body.innerHTML = html;
  }

  function hideFallbackNotice() {
    if (!fallbackEl) return;
    fallbackEl.style.display = 'none';
  }

  function applyViewMode() {
    if (btnEmbed) btnEmbed.classList.toggle('active', viewMode === 'embed');
    if (btnMap) btnMap.classList.toggle('active', viewMode === 'map');
    if (frame) frame.style.display = viewMode === 'embed' ? 'block' : 'none';
    if (mapEl) mapEl.style.visibility = viewMode === 'embed' ? 'hidden' : 'visible';
    if (viewMode === 'map') {
      hideFallbackNotice();
      if (typeof simTab !== 'undefined' && simTab.getMap && simTab.getMap()) {
        try { simTab.getMap().resize(); } catch (_) {}
      }
    } else {
      if (readyReceived) hideFallbackNotice();
    }
  }

  function setViewMode(mode) {
    viewMode = (mode === 'map') ? 'map' : 'embed';
    if (viewMode === 'embed') {
      autoFellBack = false;
      ensureLoaded(lastBoundsInfo, lastDay);
    }
    applyViewMode();
    console.log('[SIM_EMBED] View mode: ' + viewMode);
  }

  function armReadyTimer() {
    disarmReadyTimer();
    readyTimer = setTimeout(onReadyTimeout, READY_TIMEOUT_MS);
  }

  function disarmReadyTimer() {
    if (readyTimer) {
      clearTimeout(readyTimer);
      readyTimer = null;
    }
  }

  function onReadyTimeout() {
    if (readyReceived) return;
    if (useDevServer && !triedFallbackBuild) {
      // Dev server silent — try the production build on :8085/sim/ (same
      // tile server that already feeds this dashboard, CORS-safe to probe).
      triedFallbackBuild = true;
      var probeUrl = getBuildBase() + 'index.html';
      fetch(probeUrl, { method: 'GET' })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          useDevServer = false;
          readyReceived = false;
          if (frame) {
            frame.src = buildEmbedUrl(getBuildBase(), lastBoundsInfo, lastDay);
            armReadyTimer();
          }
          console.log('[SIM_EMBED] Dev server silent, loading production build from ' + getBuildBase());
        })
        .catch(function () {
          fallBackToMap('Neither the 3D sandbox dev server (:5173) nor the production build (:8085/sim/) answered.');
        });
      return;
    }
    fallBackToMap(useDevServer
      ? 'The 3D sandbox dev server (:5173) did not answer.'
      : 'The production 3D build (:8085/sim/) did not answer.');
  }

  function fallBackToMap(reason) {
    disarmReadyTimer();
    autoFellBack = true;
    viewMode = 'map';
    applyViewMode();
    // The map is the working surface now; surface the reason as a dismissible
    // strip rather than blocking the viewport.
    showFallbackNotice(
      '<b>MAP FALLBACK</b> — ' + reason +
      ' Showing the MapLibre 3D view instead.' +
      ' Start the sandbox with <code>npm run sim:ui</code> (port 5173) or rebuild it' +
      ' (<code>npm run build</code> in <code>simulation/frontend</code>), then press' +
      ' <b>3D SIM</b> to retry.' +
      ' <button id="sim-embed-retry" class="sim-timeline-btn" style="margin-left:8px;">RETRY 3D SIM</button>'
    );
    if (fallbackEl) fallbackEl.classList.add('sim-embed-fallback-strip');
    var retry = document.getElementById('sim-embed-retry');
    if (retry) {
      retry.addEventListener('click', function () {
        triedFallbackBuild = false;
        useDevServer = true;
        readyReceived = false;
        if (fallbackEl) fallbackEl.classList.remove('sim-embed-fallback-strip');
        setViewMode('embed');
      });
    }
    console.warn('[SIM_EMBED] ' + reason + ' Fell back to MapLibre view.');
  }

  function onChildMessage(event) {
    var d = event && event.data;
    if (!d || d.source !== 'r4-sim-viewport') return;
    if (d.event === 'ready') {
      if (readyReceived) return;
      readyReceived = true;
      disarmReadyTimer();
      hideFallbackNotice();
      applyViewMode();
      // Re-state current selection/day: the iframe may have loaded before the
      // parent knew the final bounds (or reloaded on its own).
      pushBounds(lastBoundsInfo);
      lastPostedDay = Math.round(lastDay);
      post({ cmd: 'set-day', day: lastPostedDay });
      post({ cmd: 'set-exag', value: activeExaggeration() });
      console.log('[SIM_EMBED] Viewport ready (' + (useDevServer ? 'dev :5173' : 'build :8085/sim') + ')');
      return;
    }
    if (d.event === 'node-select') {
      var id = (d.id === null || d.id === undefined) ? null : d.id;
      if (id !== null && typeof simTab !== 'undefined' && simTab.selectNode) {
        try { simTab.selectNode('N' + id); } catch (_) {}
      }
      if (typeof bus !== 'undefined' && bus.emit) {
        bus.emit('sim-embed-node-select', { id: id });
      }
      return;
    }
    if (d.event === 'status') {
      var hud = document.getElementById('sim-hud-text');
      void hud;
      return;
    }
  }

  function pushBounds(boundsInfo) {
    if (!boundsInfo) return;
    var norm = normalizeBounds(boundsInfo);
    post({ cmd: 'set-bounds', bounds: norm.clip, nodes: norm.nodes || null, label: norm.label });
    updateCoordsLabel(norm.clip);
  }

  function updateCoordsLabel(clip) {
    var coordsEl = document.getElementById('sim-coords');
    if (!coordsEl || !clip) return;
    var cx = (clip.xMin + clip.xMax) / 2;
    var cy = (clip.yMin + clip.yMax) / 2;
    var lat = ORIGIN_LAT + cy / M_PER_DEG_LAT;
    var lon = ORIGIN_LON + cx / M_PER_DEG_LON;
    coordsEl.textContent = 'Lat: ' + lat.toFixed(4) + ' | Lng: ' + lon.toFixed(4);
  }

  /**
   * Ensure the iframe is loaded (first call) or push new bounds (later
   * calls). boundsInfo: { south, north, west, east, nodes?, label? }.
   */
  function ensureLoaded(boundsInfo, day) {
    if (boundsInfo) lastBoundsInfo = boundsInfo;
    if (day !== null && day !== undefined && isFinite(day)) lastDay = day;
    if (viewMode !== 'embed' || !frame) return;
    if (!frame.src || frame.src === '' || frame.getAttribute('src') === '') {
      var base = useDevServer ? DEV_BASE : getBuildBase();
      readyReceived = false;
      frame.src = buildEmbedUrl(base, lastBoundsInfo, lastDay);
      armReadyTimer();
    } else if (readyReceived) {
      pushBounds(lastBoundsInfo);
      setDay(lastDay);
    }
  }

  function init() {
    if (isInitialized) return;
    isInitialized = true;
    frame = document.getElementById('sim-embed-frame');
    fallbackEl = document.getElementById('sim-embed-fallback');
    mapEl = document.getElementById('sim-maplibre-map');
    btnEmbed = document.getElementById('sim-view-embed');
    btnMap = document.getElementById('sim-view-map');

    if (btnEmbed) {
      btnEmbed.addEventListener('click', function () { setViewMode('embed'); });
    }
    if (btnMap) {
      btnMap.addEventListener('click', function () { setViewMode('map'); });
    }
    window.addEventListener('message', onChildMessage);

    applyViewMode();
    // Load lazily on first SIM tab visit so cold dashboard start pays nothing
    // when the operator never opens the tab.
    console.log('[SIM_EMBED] Initialized (lazy load on first SIM tab visit)');
  }

  // --- Parent control surface (called by sim-tab.js) ---

  function setView(pitchDeg, bearingDeg) {
    post({ cmd: 'set-view', pitchDeg: pitchDeg, bearingDeg: bearingDeg });
  }

  function setExag(value) {
    post({ cmd: 'set-exag', value: value });
  }

  function recenter() {
    var norm = normalizeBounds(lastBoundsInfo);
    post({ cmd: 'recenter', bounds: norm.clip });
  }

  var lastPostedDay = null;

  function setDay(day) {
    if (day === null || day === undefined || !isFinite(day)) return;
    lastDay = day;
    // The parent timeline ticks sub-day steps while playing; only post when
    // the displayed whole day actually changes.
    var rounded = Math.round(day);
    if (rounded === lastPostedDay) return;
    lastPostedDay = rounded;
    post({ cmd: 'set-day', day: rounded });
  }

  /**
   * Map a dashboard scenario type onto a visible ground event at the
   * selection centre. The :8010 consequence forecast still runs as before;
   * this makes the 3D ground move with it.
   */
  function triggerScenario(scenarioType, daysAhead) {
    var norm = normalizeBounds(lastBoundsInfo);
    var cx = 0;
    var cy = 0;
    if (norm.clip) {
      cx = (norm.clip.xMin + norm.clip.xMax) / 2;
      cy = (norm.clip.yMin + norm.clip.yMax) / 2;
    }
    var span = norm.clip ? Math.max(norm.clip.xMax - norm.clip.xMin, norm.clip.yMax - norm.clip.yMin) : 200;
    var rad = Math.min(140, Math.max(40, span * 0.35));
    var t = String(scenarioType || 'crack').toLowerCase();
    var type = 'tilt';
    var sev = 0.5;
    if (t === 'sudden_sinking' || t === 'sink') {
      type = 'collapse';
      sev = 0.75;
    } else if (t === 'edge_collapse' || t === 'collapse') {
      type = 'collapse';
      sev = 1.5;
      rad = Math.min(160, Math.max(60, span * 0.45));
    }
    void daysAhead;
    post({ cmd: 'trigger', type: type, cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10, sev: sev, rad: Math.round(rad) });
  }

  function clearSelection() {
    lastBoundsInfo = null;
    post({ cmd: 'set-bounds', bounds: null, nodes: null, label: null });
    var coordsEl = document.getElementById('sim-coords');
    if (coordsEl) coordsEl.textContent = 'Lat: 18.6435 | Lng: 79.5725';
  }

  return {
    init: init,
    ensureLoaded: ensureLoaded,
    setViewMode: setViewMode,
    getViewMode: function () { return viewMode; },
    isEmbedReady: function () { return readyReceived && viewMode === 'embed'; },
    setView: setView,
    setExag: setExag,
    recenter: recenter,
    setDay: setDay,
    triggerScenario: triggerScenario,
    clearSelection: clearSelection,
    normalizeBounds: normalizeBounds,
    latLonToXy: latLonToXy
  };
})();

if (typeof window !== 'undefined') {
  window.simEmbed = simEmbed;
}
