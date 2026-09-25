'use strict';

/**
 * send-to-sim.js — Bridge 2D/3D Selection to Simulation Sandbox
 *
 * Controls #btn-send-to-sim:
 * - Enabled only when selectionStore.has() is true
 * - Badge shows node count in the current selection
 * - On click: deep-clones the selection (JSON clone of bounds + resolved node records),
 *   switches to #tab-sim, and emits bus 'sim-sandbox-create' with the clone payload.
 * - Touches NOTHING on the live dashboard map (no troughOverlay, no mapView camera calls).
 */
var sendToSim = (function () {
  var btn = null;
  var badge = null;
  var isInitialized = false;

  function init() {
    btn = document.getElementById('btn-send-to-sim');
    badge = document.getElementById('send-to-sim-badge');

    injectStyles();

    if (!isInitialized) {
      isInitialized = true;
      setupListeners();
    }

    updateState();

    console.log('[SEND_TO_SIM] Initialized Send to Sim bridge');
  }

  function injectStyles() {
    if (document.getElementById('send-to-sim-styles')) return;
    var style = document.createElement('style');
    style.id = 'send-to-sim-styles';
    style.textContent =
      '#btn-send-to-sim {' +
      '  display: inline-flex;' +
      '  align-items: center;' +
      '  justify-content: center;' +
      '  gap: 5px;' +
      '  padding: 4px 8px;' +
      '  font-family: "Courier New", Courier, monospace;' +
      '  font-size: 10px;' +
      '  font-weight: bold;' +
      '  letter-spacing: 0.05em;' +
      '  transition: all 0.15s ease;' +
      '}' +
      '#btn-send-to-sim:disabled {' +
      '  opacity: 0.38 !important;' +
      '  cursor: not-allowed !important;' +
      '  border-color: #1A2830 !important;' +
      '  color: #556870 !important;' +
      '  background: #14222A !important;' +
      '  box-shadow: none !important;' +
      '}' +
      '#btn-send-to-sim:not(:disabled) {' +
      '  opacity: 1 !important;' +
      '  cursor: pointer !important;' +
      '  background: #10261E !important;' +
      '  border-color: #00E676 !important;' +
      '  color: #E0F2E9 !important;' +
      '  box-shadow: 0 0 6px rgba(0, 230, 118, 0.25) !important;' +
      '}' +
      '#btn-send-to-sim:not(:disabled):hover {' +
      '  background: #00E676 !important;' +
      '  color: #061A12 !important;' +
      '  border-color: #00E676 !important;' +
      '  box-shadow: 0 0 10px rgba(0, 230, 118, 0.5) !important;' +
      '}' +
      '#btn-send-to-sim:not(:disabled):hover #send-to-sim-badge {' +
      '  background: #061A12 !important;' +
      '  color: #00E676 !important;' +
      '}' +
      '#send-to-sim-badge {' +
      '  background: #00E676;' +
      '  color: #061A12;' +
      '  border-radius: 9px;' +
      '  padding: 1px 5px;' +
      '  font-family: "Courier New", monospace;' +
      '  font-size: 9px;' +
      '  font-weight: bold;' +
      '  min-width: 14px;' +
      '  text-align: center;' +
      '  line-height: 12px;' +
      '  display: none;' +
      '}';
    document.head.appendChild(style);
  }

  function resolveNodeRecord(nodeOrId) {
    if (!nodeOrId) return null;
    var id = (typeof nodeOrId === 'string' || typeof nodeOrId === 'number')
      ? String(nodeOrId)
      : (nodeOrId && (nodeOrId.node_id || nodeOrId.id || nodeOrId.nodeId));

    var record = null;
    if (id && typeof nodeMarkers !== 'undefined' && typeof nodeMarkers.getNodeData === 'function') {
      record = nodeMarkers.getNodeData(id);
    }
    if (!record && id && typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
      var fixtureNodes = fixtureProvider.getNodes();
      if (Array.isArray(fixtureNodes)) {
        for (var i = 0; i < fixtureNodes.length; i++) {
          var fn = fixtureNodes[i];
          if (fn && (fn.node_id === id || fn.id === id)) {
            record = fn;
            break;
          }
        }
      }
    }
    if (!record && id && typeof liveProvider !== 'undefined' && typeof liveProvider.getNode === 'function') {
      record = liveProvider.getNode(id);
    }
    if (!record && typeof nodeOrId === 'object') {
      record = nodeOrId;
    }
    if (!record) {
      record = { node_id: id };
    }
    return record;
  }

  function updateState(selection) {
    if (!btn) {
      btn = document.getElementById('btn-send-to-sim');
    }
    if (!badge) {
      badge = document.getElementById('send-to-sim-badge');
    }
    if (!btn) return;

    // Explicit clear (selection-changed with null after store.clear()).
    // Defer one tick: the store's own clear listener may not have run yet,
    // so store.has() can still be stale-true at this point.
    if (selection === null) {
      setTimeout(function () { updateState(); }, 0);
      return;
    }

    var hasSelection = (typeof selectionStore !== 'undefined' && typeof selectionStore.has === 'function')
      ? selectionStore.has()
      : Boolean(selection);

    var sel = selection || ((hasSelection && typeof selectionStore !== 'undefined' && typeof selectionStore.get === 'function') ? selectionStore.get() : null);

    var count = 0;
    if (hasSelection && sel) {
      if (typeof sel.nodeCount === 'number') {
        count = sel.nodeCount;
      } else if (Array.isArray(sel.nodes)) {
        count = sel.nodes.length;
      }
    }

    btn.disabled = !hasSelection;
    btn.classList.toggle('disabled', !hasSelection);
    btn.classList.toggle('has-selection', hasSelection);

    if (badge) {
      badge.textContent = String(count);
      badge.style.display = hasSelection ? 'inline-block' : 'none';
      if (hasSelection) {
        badge.title = count + ' node' + (count === 1 ? '' : 's') + ' in selection';
      }
    }

    if (hasSelection) {
      btn.title = 'Send selection (' + count + ' node' + (count === 1 ? '' : 's') + ') to Simulation Sandbox';
    } else {
      btn.title = 'Send Selection to Simulation Sandbox (Select an area on the 2D map first)';
    }
  }

  function captureDashboardState() {
    var mapInst = (typeof mapView !== 'undefined' && typeof mapView.getMap === 'function') ? mapView.getMap() : null;
    var c = mapInst ? mapInst.getCenter() : null;
    var z = mapInst ? mapInst.getZoom() : null;
    var ts = null;
    if (typeof troughOverlay !== 'undefined' && typeof troughOverlay.getState === 'function') {
      ts = troughOverlay.getState();
    } else if (typeof troughOverlay !== 'undefined') {
      ts = {
        enabled: (typeof troughOverlay.isFeatureEnabled === 'function') ? troughOverlay.isFeatureEnabled() : false,
        activeAlarmId: null,
        overlayCount: 0
      };
    }
    return {
      center: c ? { lat: c.lat, lng: c.lng } : null,
      zoom: z,
      troughState: ts ? JSON.parse(JSON.stringify(ts)) : null
    };
  }

  function assertDashboardStateUnchanged(beforeState, afterState) {
    if (!beforeState || !afterState) return true;

    var centerMatch = true;
    if (beforeState.center && afterState.center) {
      var dLat = Math.abs(beforeState.center.lat - afterState.center.lat);
      var dLng = Math.abs(beforeState.center.lng - afterState.center.lng);
      centerMatch = (dLat < 1e-4 && dLng < 1e-4);
    }

    var zoomMatch = (beforeState.zoom === afterState.zoom);
    var troughMatch = JSON.stringify(beforeState.troughState) === JSON.stringify(afterState.troughState);

    var passed = centerMatch && zoomMatch && troughMatch;
    var result = {
      passed: passed,
      centerMatch: centerMatch,
      zoomMatch: zoomMatch,
      troughMatch: troughMatch,
      before: beforeState,
      after: afterState,
      timestamp: Date.now()
    };
    window.__sendToSimAssertResult = result;

    if (!passed) {
      var errMsg = '[SEND_TO_SIM_ASSERT] FAILED: Dashboard state mutated during sandbox load! ' +
        'centerMatch=' + centerMatch + ', zoomMatch=' + zoomMatch + ', troughMatch=' + troughMatch;
      console.error(errMsg, result);
      throw new Error(errMsg);
    } else {
      console.log('[SEND_TO_SIM_ASSERT] PASSED: Dashboard map center+zoom and troughOverlay state unchanged after sandbox load.', result);
    }
    return passed;
  }

  function send() {
    var hasSelection = (typeof selectionStore !== 'undefined' && typeof selectionStore.has === 'function')
      ? selectionStore.has()
      : false;

    if (!hasSelection) return null;

    var sel = (typeof selectionStore !== 'undefined' && typeof selectionStore.get === 'function')
      ? selectionStore.get()
      : null;

    if (!sel) return null;

    // Capture dashboard state before SEND TO SIM
    var preSendState = captureDashboardState();
    window.__preSendDashboardState = preSendState;
    console.log('[SEND_TO_SIM] Captured pre-send dashboard state:', preSendState);

    // Resolve node records
    var rawNodes = Array.isArray(sel.nodes) ? sel.nodes : [];
    if (rawNodes.length === 0 && sel.bounds && Array.isArray(sel.bounds) && sel.bounds.length === 2) {
      var allNodes = [];
      if (typeof nodeMarkers !== 'undefined' && typeof nodeMarkers.getAllNodes === 'function') {
        allNodes = nodeMarkers.getAllNodes();
      } else if (typeof fixtureProvider !== 'undefined' && typeof fixtureProvider.getNodes === 'function') {
        allNodes = fixtureProvider.getNodes() || [];
      }
      var s = sel.bounds[0][0], w = sel.bounds[0][1];
      var n = sel.bounds[1][0], e = sel.bounds[1][1];
      for (var k = 0; k < allNodes.length; k++) {
        var nd = allNodes[k];
        var lat = nd.lat != null ? nd.lat : (Array.isArray(nd.pos) ? nd.pos[0] : null);
        var lng = nd.lng != null ? nd.lng : (Array.isArray(nd.pos) ? nd.pos[1] : null);
        if (lat != null && lng != null && lat >= s && lat <= n && lng >= w && lng <= e) {
          rawNodes.push(nd);
        }
      }
    }

    var resolvedNodes = [];
    for (var i = 0; i < rawNodes.length; i++) {
      var rec = resolveNodeRecord(rawNodes[i]);
      if (rec) resolvedNodes.push(rec);
    }

    // JSON deep-clone of bounds + resolved node records (and complete selection data)
    var cloneSource = Object.assign({}, sel, {
      bounds: sel.bounds ? JSON.parse(JSON.stringify(sel.bounds)) : null,
      nodes: resolvedNodes,
      nodeCount: resolvedNodes.length
    });

    var clonedPayload = JSON.parse(JSON.stringify(cloneSource));

    // Switch to #tab-sim (touching NOTHING on the dashboard map)
    var simTabBtn = document.querySelector('#tab-bar .tab-btn[data-tab="sim"]');
    if (simTabBtn) {
      simTabBtn.click();
    } else {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-view').forEach(function (v) { v.style.display = 'none'; });
      var tabSim = document.getElementById('tab-sim');
      if (tabSim) tabSim.style.display = 'flex';
      if (typeof simTab !== 'undefined' && typeof simTab.onTabShown === 'function') {
        simTab.onTabShown();
      }
    }

    // Emit bus 'sim-sandbox-create' with the clone
    if (typeof bus !== 'undefined' && typeof bus.emit === 'function') {
      bus.emit('sim-sandbox-create', clonedPayload);
    }

    // Verify console output
    console.log('[SIM_SANDBOX] Sandbox payload with ' + clonedPayload.nodes.length + ' cloned nodes:', clonedPayload);

    return clonedPayload;
  }

  function setupListeners() {
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        send();
      });
    }

    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('selection-changed', function (selection) {
        updateState(selection);
      });
      bus.on('grid-selected', function (cellData) {
        updateState(cellData);
      });
      bus.on('system-reset', function () {
        // Defer: selectionStore clears on the same event and may run after us.
        setTimeout(function () { updateState(); }, 0);
      });
      // Keep __simSandboxPayload updated on bus emit
      bus.on('sim-sandbox-create', function (payload) {
        window.__simSandboxPayload = payload;
      });
      // Assert dashboard state unchanged after sandbox finishes loading
      bus.on('sim-sandbox-loaded', function (session) {
        if (window.__preSendDashboardState) {
          var postSendState = captureDashboardState();
          assertDashboardStateUnchanged(window.__preSendDashboardState, postSendState);
        }
      });
    }
  }

  // Auto-init on DOM readiness
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      setTimeout(init, 0);
    }
  }

  return {
    init: init,
    updateState: updateState,
    send: send,
    captureDashboardState: captureDashboardState,
    assertDashboardStateUnchanged: assertDashboardStateUnchanged,
    getLastAssertResult: function () { return window.__sendToSimAssertResult; }
  };
})();


if (typeof window !== 'undefined') {
  window.sendToSim = sendToSim;
}
