'use strict';

var lastgaspMarker = (function () {
  var pulseRings = {};
  var map = null;

  function init(mapInstance) {
    map = mapInstance;

    bus.on('telemetry', function (t) {
      var nodeId = t._node_id || t.node_id;
      if (!nodeId) return;
      var state = t.state || (t.aggregates && t.aggregates.node_state ? String(t.aggregates.node_state).toLowerCase() : null);
      if (state === 'critical' || state === 'lastgasp' || (t.flags & 1) || (t.crack_flags && (t.crack_flags & 1))) {
        showPulse(nodeId, (state === 'lastgasp' || (t.flags & 1)) ? 'lastgasp' : 'critical');
      } else if (pulseRings[nodeId]) {
        removePulse(nodeId);
      }
    });

    bus.on('node-status-change', function (data) {
      if (data.state === 'critical' || data.state === 'lastgasp') {
        showPulse(data.node_id, data.state);
      } else if (pulseRings[data.node_id]) {
        removePulse(data.node_id);
      }
    });

    bus.on('nodes-loaded', function (nodes) {
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].state === 'critical' || nodes[i].state === 'lastgasp') {
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
    if (pulseRings[nodeId]) return;

    var nd = nodeMarkers.getNodeData(nodeId);
    if (!nd || typeof nd.lat !== 'number' || typeof nd.lng !== 'number') return;

    var isLastgasp = (state === 'lastgasp');
    var ringClass = isLastgasp ? 'alert-ring ring-lastgasp' : 'alert-ring';

    var icon = L.divIcon({
      className: 'alert-ring-icon',
      html: '<div class="alert-ring-container">' +
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
