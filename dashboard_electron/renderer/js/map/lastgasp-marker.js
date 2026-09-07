'use strict';

var lastgaspMarker = (function () {
  var pulseRings = {};
  var map = null;

  function updateZoomScale() {
    if (!map) return;
    var z = map.getZoom ? map.getZoom() : 17;
    // Standard baseline zoom is 17.
    // At higher zoom (18-19), slightly expand (1.12-1.25)
    // At lower zoom (16: 0.80, 15: 0.58, <=14: 0.40), shrink significantly so rings do not overlap neighboring nodes.
    var factor = 1.0;
    if (z >= 19) factor = 1.25;
    else if (z === 18) factor = 1.12;
    else if (z === 17) factor = 1.0;
    else if (z === 16) factor = 0.80;
    else if (z === 15) factor = 0.58;
    else factor = Math.max(0.32, 0.40 - (14 - z) * 0.05);

    var container = map.getContainer ? map.getContainer() : null;
    if (container) {
      container.style.setProperty('--alert-ring-zoom-scale', String(factor));
    }
  }

  function init(mapInstance) {
    map = mapInstance;

    if (map) {
      map.on('zoom', updateZoomScale);
      map.on('zoomend', updateZoomScale);
      updateZoomScale();
    }

    bus.on('telemetry', function (t) {
      var nodeId = t._node_id || t.node_id;
      if (!nodeId) return;
      var state = t.state || (t.aggregates && t.aggregates.node_state ? String(t.aggregates.node_state).toLowerCase() : null);
      if (t.flags & 1) state = 'lastgasp';
      if (state === 'critical' || state === 'lastgasp' || state === 'warning') {
        showPulse(nodeId, state);
      } else if (pulseRings[nodeId] && (state === 'active' || state === 'stable' || state === 'normal')) {
        removePulse(nodeId);
      }
    });

    bus.on('alarm', function (alarm) {
      if (alarm.affected_nodes) {
        var targetState = (alarm.level === 3) ? 'critical' : 'warning';
        for (var j = 0; j < alarm.affected_nodes.length; j++) {
          showPulse(alarm.affected_nodes[j], targetState);
        }
      }
    });

    bus.on('node-status-change', function (data) {
      if (data.state === 'critical' || data.state === 'lastgasp' || data.state === 'warning') {
        showPulse(data.node_id, data.state);
      } else if (pulseRings[data.node_id] && (data.state === 'active' || data.state === 'stable' || data.state === 'normal')) {
        removePulse(data.node_id);
      }
    });

    bus.on('nodes-loaded', function (nodes) {
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].state === 'critical' || nodes[i].state === 'lastgasp' || nodes[i].state === 'warning') {
          showPulse(nodes[i].node_id, nodes[i].state);
        }
      }
    });

    bus.on('simulation-status', function (data) {
      var s = data.state || (data.is_running ? 'RUNNING' : 'STOPPED');
      if (s === 'STOPPED') {
        removeAll();
      }
    });

    bus.on('system-reset', function () {
      removeAll();
    });

    bus.on('fixture-started', function () {
      removeAll();
    });

    bus.on('replay-started', function () {
      removeAll();
    });
  }

  function showPulse(nodeId, state) {
    if (!map) return;
    if (pulseRings[nodeId]) {
      if (pulseRings[nodeId]._pulseState === state) return;
      removePulse(nodeId);
    }

    var nd = nodeMarkers.getNodeData(nodeId);
    if (!nd || typeof nd.lat !== 'number' || typeof nd.lng !== 'number') return;

    var ringClass = (state === 'lastgasp') ? 'alert-ring ring-lastgasp' :
                    (state === 'warning') ? 'alert-ring ring-warning' : 'alert-ring';

    var icon = L.divIcon({
      className: 'alert-ring-icon',
      html: '<div class="alert-ring-container">' +
            '<div class="' + ringClass + '"></div>' +
            '<div class="' + ringClass + '"></div>' +
            '<div class="' + ringClass + '"></div>' +
            '<div class="' + ringClass + '"></div>' +
            '</div>',
      iconSize: [0, 0],
      iconAnchor: [0, 0]
    });

    var marker = L.marker([nd.lat, nd.lng], {
      icon: icon,
      interactive: false,
      zIndexOffset: -100
    });
    marker._pulseState = state;

    marker.addTo(map);
    pulseRings[nodeId] = marker;
  }

  function removePulse(nodeId) {
    if (pulseRings[nodeId]) {
      map.removeLayer(pulseRings[nodeId]);
      delete pulseRings[nodeId];
    }
  }

  function removeAll() {
    var keys = Object.keys(pulseRings);
    for (var i = 0; i < keys.length; i++) {
      map.removeLayer(pulseRings[keys[i]]);
    }
    pulseRings = {};
  }

  return {
    init: init,
    showPulse: showPulse,
    removePulse: removePulse,
    removeAll: removeAll
  };
})();
