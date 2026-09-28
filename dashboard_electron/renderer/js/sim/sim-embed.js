'use strict';

/**
 * sim-embed.js — Dual-slot 3D viewport embed manager (SIM + FORGE).
 *
 * Embeds the website simulation (simulation/frontend, the Three.js subsidence
 * viewport) inside BOTH dashboard tabs via iframes. Each tab owns one slot:
 *   - sim:   full district, day label, node clicks -> data inspector. Never
 *            receives triggers or crack overlays.
 *   - forge: selection clip + label, triggers, crack lines. Experiments here
 *            run the iframe's LOCAL mesh preview only (never engine commands),
 *            so the SIM slot's ground cannot move.
 *
 * Perf: a slot loads lazily on its tab's first show; the hidden tab's iframe
 * sits under display:none, which suspends its rendering loop automatically
 * (no pause commands — pause would halt the SHARED engine clock for both).
 * Works in Electron (file:// parent, http://127.0.0.1 iframes, postMessage
 * with '*' both ways — see simulation/frontend/src/embed.ts).
 *
 * Source priority per slot:
 *   1. Vite dev server  http://127.0.0.1:5173/?embed=1...
 *   2. Production build http://<host>:8085/sim/?embed=1...
 *   3. Retry strip when neither answers the ready handshake.
 *
 * Coordinates: the iframe speaks panel-frame metres (x=east, y=north about
 * the Adriyala origin). Same flat-earth projection as geo.py / map-view.js,
 * clamped to the 600 m simulation window.
 */
var simEmbed = (function () {
  var DEV_BASE = (typeof window !== 'undefined' && window.SANDBOX_UI_URL)
    ? (window.SANDBOX_UI_URL.replace(/\/+$/, '') + '/')
    : 'http://127.0.0.1:5173/';
  var READY_TIMEOUT_MS = 7000;
  var MAX_QUEUED = 30;

  // Adriyala origin + projection constants (mirror of geo.py / map-view.js).
  var ORIGIN_LAT = 18.6435;
  var ORIGIN_LON = 79.5725;
  var M_PER_DEG_LAT = 111320.0;
  var M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos(ORIGIN_LAT * Math.PI / 180);
  var WINDOW_HALF_M = 300;

  function makeSlot(name, frameId, fallbackId) {
    return {
      name: name,
      frameId: frameId,
      fallbackId: fallbackId,
      frame: null,
      fallbackEl: null,
      loadedOnce: false,
      useDevServer: true,
      triedProd: false,
      readyReceived: false,
      readyTimer: null,
      queue: [],
      lastBoundsInfo: null,
      lastNorm: null,
      lastDay: 0,
      lastStatus: null,
      // Ring of posted commands (test observability + debugging).
      cmdLog: []
    };
  }

  var slots = {
    sim: makeSlot('sim', 'sim-embed-frame', 'sim-embed-fallback'),
    forge: makeSlot('forge', 'forge-embed-frame', 'forge-embed-fallback')
  };

  var isInitialized = false;

  function getBuildBase() {
    if (typeof window !== 'undefined' && window.SANDBOX_UI_URL) {
      return window.SANDBOX_UI_URL.replace(/\/+$/, '') + '/';
    }
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

  function buildEmbedUrl(base, boundsInfo, day, slotName) {
    var norm = normalizeBounds(boundsInfo);
    var qs = '?embed=1';
    // Slot identity: the iframe is the same app in both tabs, but FORGE is a
    // sandbox view — it must not show engine packet-sync toasts (SIM only).
    if (slotName === 'sim' || slotName === 'forge') {
      qs += '&slot=' + slotName;
    }
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

  function showFallbackNotice(slot, html) {
    if (!slot.fallbackEl) return;
    slot.fallbackEl.style.display = 'flex';
    var body = slot.fallbackEl.querySelector('.sim-embed-fallback-body');
    if (body && html) body.innerHTML = html;
  }

  function hideFallbackNotice(slot) {
    if (!slot.fallbackEl) return;
    slot.fallbackEl.style.display = 'none';
  }

  function postToSlot(slot, cmd) {
    if (!slot.frame || !slot.frame.contentWindow || !slot.readyReceived) {
      if (slot.queue && slot.queue.length < MAX_QUEUED) slot.queue.push(cmd);
      return false;
    }
    try {
      var msg = Object.assign({ source: 'r4-sim-embed' }, cmd);
      slot.frame.contentWindow.postMessage(msg, '*');
      slot.cmdLog.push({ t: Date.now(), cmd: cmd.cmd || '?' });
      if (slot.cmdLog.length > 40) slot.cmdLog.shift();
      return true;
    } catch (_) {
      return false;
    }
  }

  function flushQueue(slot) {
    if (!slot.readyReceived || slot.queue.length === 0) return;
    var pending = slot.queue;
    slot.queue = [];
    pending.forEach(function (cmd) { postToSlot(slot, cmd); });
  }

  function armReadyTimer(slot) {
    if (slot.readyTimer) {
      clearTimeout(slot.readyTimer);
      slot.readyTimer = null;
    }
    slot.readyTimer = setTimeout(function () {
      slot.readyTimer = null;
      if (slot.readyReceived) return;
      if (slot.useDevServer && !slot.triedProd) {
        // Dev server silent: try the production bundle once.
        slot.useDevServer = false;
        slot.triedProd = true;
        loadSlot(slot);
      } else {
        showFallbackNotice(slot,
          '3D viewport unreachable (tried :5173 and :8085/sim). ' +
          'Start the sim UI or bundle and press RETRY.');
      }
    }, READY_TIMEOUT_MS);
  }

  function loadSlot(slot) {
    if (!slot.frame) return;
    slot.readyReceived = false;
    slot.queue = [];
    slot.lastNorm = normalizeBounds(slot.lastBoundsInfo);
    hideFallbackNotice(slot);
    var base = slot.useDevServer ? DEV_BASE : getBuildBase();
    slot.frame.src = buildEmbedUrl(base, slot.lastBoundsInfo, slot.lastDay, slot.name);
    slot.loadedOnce = true;
    armReadyTimer(slot);
  }

  function retrySlot(slot) {
    slot.useDevServer = true;
    slot.triedProd = false;
    loadSlot(slot);
  }

  function ensureLoaded(slotName, boundsInfo, day) {
    var slot = slots[slotName];
    if (!slot || !slot.frame) return;
    if (boundsInfo !== undefined) slot.lastBoundsInfo = boundsInfo;
    if (day !== undefined && day !== null && isFinite(day)) slot.lastDay = day;
    if (!slot.loadedOnce || !slot.frame.src) {
      loadSlot(slot);
      return;
    }
    if (boundsInfo !== undefined) {
      var norm = normalizeBounds(boundsInfo);
      slot.lastNorm = norm;
      postToSlot(slot, { cmd: 'set-bounds', bounds: norm.clip, nodes: norm.nodes, label: norm.label });
    }
    if (day !== undefined && day !== null && isFinite(day)) {
      postToSlot(slot, { cmd: 'set-day', day: Math.round(day) });
    }
  }

  function slotFromEvent(e) {
    var names = Object.keys(slots);
    for (var i = 0; i < names.length; i++) {
      var slot = slots[names[i]];
      if (slot.frame && slot.frame.contentWindow && e.source === slot.frame.contentWindow) {
        return slot;
      }
    }
    return null;
  }

  function numericToNodeId(num) {
    var n = parseInt(num, 10);
    if (!isFinite(n) || n <= 0) return null;
    return 'N' + String(n).padStart(2, '0');
  }

  function onMessage(e) {
    var d = e && e.data;
    if (!d || d.source !== 'r4-sim-viewport') return;
    var slot = slotFromEvent(e);
    if (!slot) return;

    if (d.event === 'ready') {
      slot.readyReceived = true;
      if (slot.readyTimer) {
        clearTimeout(slot.readyTimer);
        slot.readyTimer = null;
      }
      hideFallbackNotice(slot);
      flushQueue(slot);
      console.log('[SIM_EMBED:' + slot.name + '] ready (' +
        (slot.useDevServer ? 'dev :5173' : 'prod :8085/sim') + ')');
    } else if (d.event === 'node-select') {
      // Route node clicks to the owning tab's inspector (numeric id -> Nxx).
      var nid = (d.id === null || d.id === undefined) ? null : numericToNodeId(d.id);
      if (nid && typeof simTab !== 'undefined' && simTab.selectNode) {
        try { simTab.selectNode(nid, slot.name === 'forge' ? 'forge' : 'sim'); } catch (_) {}
      }
    } else if (d.event === 'status') {
      slot.lastStatus = {
        connected: !!d.connected,
        running: !!d.running,
        tDays: d.tDays,
        nodes: d.nodes,
        faceYM: d.faceYM
      };
      if (slot.name === 'sim' && typeof window !== 'undefined' && window.dispatchEvent) {
        try {
          window.dispatchEvent(new CustomEvent('sim-face', { detail: { faceYM: d.faceYM } }));
        } catch (_) {}
      }
    } else if (d.event === 'terrain-target') {
      if (slot.name === 'forge' && typeof simTab !== 'undefined' && simTab.setForgeTarget) {
        try { simTab.setForgeTarget(d); } catch (_) {}
      }
    } else if (d.event === 'forge-frame-applied') {
      slot.lastForgeFrameApplied = d;
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        try {
          window.dispatchEvent(new CustomEvent('forge-frame-applied', { detail: d }));
        } catch (_) {}
      }
    }
  }

  function bindRetry(slot) {
    if (!slot.fallbackEl) return;
    var btn = slot.fallbackEl.querySelector('.sim-embed-retry-btn');
    if (btn) {
      btn.addEventListener('click', function () { retrySlot(slot); });
    }
  }

  function init() {
    if (isInitialized) return;
    isInitialized = true;
    Object.keys(slots).forEach(function (name) {
      var slot = slots[name];
      slot.frame = document.getElementById(slot.frameId);
      slot.fallbackEl = document.getElementById(slot.fallbackId);
      bindRetry(slot);
    });
    window.addEventListener('message', onMessage);
    // Lazy: slots load on first show of their tab (onSlotShown), so cold
    // dashboard start pays no WebGL cost for views never opened.
    console.log('[SIM_EMBED] Initialized (dual slot sim+forge, lazy load)');
  }

  // Called when a tab becomes visible: lazy-load once, then no-op. The
  // hidden slot needs no pause: display:none suspends its frame loop, and
  // pause commands would halt the SHARED engine clock for both slots.
  function onSlotShown(slotName) {
    var slot = slots[slotName];
    if (!slot || !slot.frame) return;
    if (!slot.loadedOnce || !slot.frame.src) {
      ensureLoaded(slotName, slot.lastBoundsInfo, slot.lastDay);
    }
  }

  function onSlotHidden(_slotName) {
    // Intentional no-op (see onSlotShown).
  }

  return {
    init: init,
    ensureLoaded: ensureLoaded,
    onSlotShown: onSlotShown,
    onSlotHidden: onSlotHidden,
    normalizeBounds: normalizeBounds,
    latLonToXy: latLonToXy,
    setView: function (slotName, pitchDeg, bearingDeg) {
      var slot = slots[slotName];
      if (slot) postToSlot(slot, { cmd: 'set-view', pitchDeg: pitchDeg, bearingDeg: bearingDeg });
    },
    setExag: function (slotName, value) {
      var slot = slots[slotName];
      if (slot) postToSlot(slot, { cmd: 'set-exag', value: value });
    },
    recenter: function (slotName, boundsInfo) {
      var slot = slots[slotName];
      if (!slot) return;
      if (boundsInfo !== undefined) {
        var norm = normalizeBounds(boundsInfo);
        postToSlot(slot, { cmd: 'recenter', bounds: norm.clip });
      } else {
        postToSlot(slot, { cmd: 'recenter' });
      }
    },
    setDay: function (day) {
      Object.keys(slots).forEach(function (name) {
        var slot = slots[name];
        if (day !== null && day !== undefined && isFinite(day)) slot.lastDay = day;
        postToSlot(slot, { cmd: 'set-day', day: Math.round(day) });
      });
    },
    selectNode: function (slotName, id) {
      var slot = slots[slotName];
      if (slot) postToSlot(slot, { cmd: 'select-node', id: id });
    },
    triggerScenario: function (slotName, type, cx, cy, sev, rad, ppv, durS) {
      var slot = slots[slotName];
      if (!slot) return;
      var cmd = { cmd: 'trigger', type: type, cx: cx, cy: cy, sev: sev, rad: rad };
      if (ppv !== undefined && ppv !== null && isFinite(ppv)) cmd.ppv = ppv;
      if (durS !== undefined && durS !== null && isFinite(durS)) cmd.durS = durS;
      postToSlot(slot, cmd);
    },
    setCracks: function (slotName, segments) {
      var slot = slots[slotName];
      if (slot) postToSlot(slot, { cmd: 'set-cracks', segments: segments || [] });
    },
    resetLocal: function (slotName) {
      var slot = slots[slotName];
      if (slot) postToSlot(slot, { cmd: 'reset-local' });
    },
    clearSelection: function (slotName) {
      var slot = slots[slotName];
      if (!slot) return;
      slot.lastBoundsInfo = null;
      slot.lastNorm = null;
      postToSlot(slot, { cmd: 'set-bounds', bounds: null, nodes: null, label: null });
      postToSlot(slot, { cmd: 'set-cracks', segments: [] });
      postToSlot(slot, { cmd: 'recenter', bounds: null });
    },
    getStatus: function (slotName) {
      var slot = slots[slotName];
      return slot ? slot.lastStatus : null;
    },
    getSlotInfo: function (slotName) {
      var slot = slots[slotName];
      if (!slot) return null;
      return {
        loaded: slot.loadedOnce,
        ready: slot.readyReceived,
        day: slot.lastDay,
        clip: slot.lastNorm ? slot.lastNorm.clip : null,
        nodes: slot.lastNorm ? slot.lastNorm.nodes : null,
        label: slot.lastNorm ? slot.lastNorm.label : null,
        src: slot.frame ? String(slot.frame.src || '') : ''
      };
    },
    getCommands: function (slotName) {
      var slot = slots[slotName];
      if (!slot) return [];
      var queued = (slot.queue || []).map(function (c) { return c.cmd; });
      var logged = (slot.cmdLog || []).map(function (e) { return e.cmd; });
      return queued.concat(logged);
    },
    isReady: function (slotName) {
      var slot = slots[slotName];
      return slot ? slot.readyReceived : false;
    },
    sendForgeFrame: function (frame) {
      var slot = slots.forge;
      if (slot) postToSlot(slot, { cmd: 'forge-frame', frame: frame });
    },
    // `extra` adds per-type fields: tilt {direction_deg}, crack {line: {x0, y0, x1, y1}}.
    sendForgeEffect: function (type, cx, cy, rad, depth, ppv, extra) {
      var slot = slots.forge;
      if (slot) postToSlot(slot, Object.assign({ cmd: 'forge-effect', type: type, cx: cx, cy: cy, rad: rad, depth: depth, ppv: ppv }, extra || {}));
    },
    // Zone preview (drawing only; dashed white/red rings at 1.2 R and 1.5 R). x = null
    // clears it. `line` ({x0,y0,x1,y1,width_m}) previews a CRACK zone instead of the ring.
    sendForgePreview: function (x, y, radiusM, line) {
      var slot = slots.forge;
      if (slot) postToSlot(slot, { cmd: 'forge-preview', x: x, y: y, radius_m: radiusM, line: line || null });
    },
    getLastForgeFrameApplied: function () {
      return slots.forge ? slots.forge.lastForgeFrameApplied || null : null;
    }
  };
})();

if (typeof window !== 'undefined') {
  window.simEmbed = simEmbed;
}
