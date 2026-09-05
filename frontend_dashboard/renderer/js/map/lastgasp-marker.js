'use strict';

var lastgaspMarker = (function () {
  var pulseRings = {};
  var map = null;

  function init(mapInstance) {
    map = mapInstance;

    bus.on('telemetry', function (t) {
      if (t.flags & 1) {
        var nodeId = t._node_id || t.node_id;
        showPulse(nodeId);
      }
    });

    bus.on('node-status-change', function (data) {
      if (data.state === 'lastgasp') {
        showPulse(data.node_id);
      } else if (pulseRings[data.node_id]) {
        removePulse(data.node_id);
      }
    });

    bus.on('nodes-loaded', function (nodes) {
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].state === 'lastgasp') {
          showPulse(nodes[i].node_id);
        }
      }
    });

    bus.on('fixture-started', function () {
      removeAll();
    });

    bus.on('replay-started', function () {
      removeAll();
    });
  }

  function showPulse(nodeId) {
    if (!map) return;
    if (pulseRings[nodeId]) return;

    var nd = nodeMarkers.getNodeData(nodeId);
    if (!nd) return;

    var ring = L.circleMarker([nd.lat, nd.lng], {
      radius: 12,
      color: '#FF4400',
      weight: 1.5,
      fillColor: 'rgba(255, 51, 0, 0.2)',
      fillOpacity: 1,
      interactive: false,
      className: 'lastgasp-pulse'
    });

    ring.addTo(map);
    pulseRings[nodeId] = ring;
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
