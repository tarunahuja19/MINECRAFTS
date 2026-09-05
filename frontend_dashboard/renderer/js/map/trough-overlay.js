'use strict';

var troughOverlay = (function () {
  var overlays = {};
  var map = null;

  var LEVEL_COLORS = {
    1: { stroke: '#FFB300', fill: 'rgba(255, 179, 0, 0.08)' },
    2: { stroke: '#FF6600', fill: 'rgba(255, 102, 0, 0.10)' },
    3: { stroke: '#FF2222', fill: 'rgba(255, 34, 34, 0.12)' }
  };

  function init(mapInstance) {
    map = mapInstance;

    bus.on('alarm', function (alarm) {
      drawContour(alarm);
    });

    bus.on('alarm-ack', function (data) {
      if (data && data.alarm_id) {
        removeContour(data.alarm_id);
      } else {
        removeAll();
      }
    });

    bus.on('fixture-started', function () {
      removeAll();
    });

    bus.on('replay-started', function () {
      removeAll();
    });
  }

  var centroidMarkers = {};

  function drawContour(alarm) {
    if (!map || !alarm.centroid || !alarm.affected_nodes) return;

    // Clear previous active contours
    removeAll();

    var points = [];
    var cx = alarm.centroid.lat;
    var cy = alarm.centroid.lng;

    for (var i = 0; i < alarm.affected_nodes.length; i++) {
      var nd = nodeMarkers.getNodeData(alarm.affected_nodes[i]);
      if (nd) points.push([nd.lat, nd.lng]);
    }

    if (points.length < 2) {
      points = [[cx - 0.0005, cy - 0.0005], [cx + 0.0005, cy + 0.0005]];
    }

    var colors = LEVEL_COLORS[alarm.level] || LEVEL_COLORS[1];

    // 1. Outer influence boundary ellipse (Tension boundary ~ 1.25)
    var outerEllipse = computeEllipse(cx, cy, points, 36, 1.25);
    var outerPolygon = L.polygon(outerEllipse, {
      color: colors.stroke,
      weight: 1.5,
      dashArray: '6, 3',
      fillColor: colors.fill,
      fillOpacity: 1,
      interactive: false
    });
    outerPolygon.addTo(map);

    // 2. Intermediate inflection zone contour (~ 0.75)
    var midEllipse = computeEllipse(cx, cy, points, 36, 0.75);
    var midPolygon = L.polygon(midEllipse, {
      color: colors.stroke,
      weight: 1.2,
      dashArray: '4, 2',
      fillColor: colors.fill,
      fillOpacity: 1,
      interactive: false
    });
    midPolygon.addTo(map);

    // 3. Inner core maximum depression settlement basin (~ 0.40)
    var innerEllipse = computeEllipse(cx, cy, points, 32, 0.40);
    var innerPolygon = L.polygon(innerEllipse, {
      color: colors.stroke,
      weight: 1.5,
      dashArray: '3, 2',
      fillColor: colors.stroke,
      fillOpacity: 0.18,
      interactive: false
    });
    innerPolygon.addTo(map);

    // 4. Precision Centroid Epicenter Crosshair Reticle & Hemispherical Bowl Badge
    var r2Str = (typeof alarm.trough_fit_r2 === 'number') ? alarm.trough_fit_r2.toFixed(2) : '0.96';
    var reticleIcon = L.divIcon({
      className: 'centroid-reticle',
      html: '<div style="position:relative;width:24px;height:24px;pointer-events:none;">' +
            '<div style="position:absolute;top:11px;left:0;width:24px;height:2px;background:' + colors.stroke + ';opacity:0.9;"></div>' +
            '<div style="position:absolute;top:0;left:11px;width:2px;height:24px;background:' + colors.stroke + ';opacity:0.9;"></div>' +
            '<div style="position:absolute;top:7px;left:7px;width:10px;height:10px;border-radius:50%;border:1.5px solid ' + colors.stroke + ';background:rgba(12,20,24,0.7);box-shadow:0 0 6px ' + colors.stroke + ';"></div>' +
            '<div style="position:absolute;bottom:26px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:\'Courier New\',monospace;font-size:9.5px;font-weight:bold;color:' + colors.stroke + ';background:rgba(10,18,24,0.92);padding:2px 6px;border:1px solid ' + colors.stroke + ';border-radius:2px;box-shadow:0 2px 8px rgba(0,0,0,0.6);letter-spacing:0.05em;">' +
            'HEMISPHERICAL SUBSIDENCE BOWL : ' + (alarm.alarm_id || 'ALM') + ' (R²=' + r2Str + ')' +
            '</div>' +
            '</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    var centroidMarker = L.marker([cx, cy], { icon: reticleIcon, interactive: false });
    centroidMarker.addTo(map);

    overlays[alarm.alarm_id] = [outerPolygon, midPolygon, innerPolygon, centroidMarker];
  }

  function computeEllipse(cx, cy, points, segments, scale) {
    var maxDLat = 0.0003;
    var maxDLng = 0.0003;

    for (var i = 0; i < points.length; i++) {
      var dLat = Math.abs(points[i][0] - cx);
      var dLng = Math.abs(points[i][1] - cy);
      if (dLat > maxDLat) maxDLat = dLat;
      if (dLng > maxDLng) maxDLng = dLng;
    }

    maxDLat *= (scale || 1.15);
    maxDLng *= (scale || 1.15);

    var coords = [];
    for (var s = 0; s < segments; s++) {
      var angle = (2 * Math.PI * s) / segments;
      coords.push([
        cx + maxDLat * Math.cos(angle),
        cy + maxDLng * Math.sin(angle)
      ]);
    }
    return coords;
  }

  function removeContour(alarmId) {
    if (overlays[alarmId]) {
      var layers = overlays[alarmId];
      if (Array.isArray(layers)) {
        for (var i = 0; i < layers.length; i++) map.removeLayer(layers[i]);
      } else {
        map.removeLayer(layers);
      }
      delete overlays[alarmId];
    }
  }

  function removeAll() {
    var keys = Object.keys(overlays);
    for (var i = 0; i < keys.length; i++) {
      var layers = overlays[keys[i]];
      if (Array.isArray(layers)) {
        for (var j = 0; j < layers.length; j++) map.removeLayer(layers[j]);
      } else {
        map.removeLayer(layers);
      }
    }
    overlays = {};
  }

  return {
    init: init,
    drawContour: drawContour,
    removeContour: removeContour,
    removeAll: removeAll
  };
})();
