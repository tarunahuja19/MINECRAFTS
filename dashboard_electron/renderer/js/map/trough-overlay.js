'use strict';

var troughOverlay = (function () {
  // Feature flag: set to false to disable subsidence bowl overlay rendering
  var ENABLE_SUBSIDENCE_BOWL = false;

  var overlays = {};
  var map = null;

  var LEVEL_COLORS = {
    1: { stroke: '#FFB300', fill: 'rgba(255, 179, 0, 0.08)' },
    2: { stroke: '#FF6600', fill: 'rgba(255, 102, 0, 0.10)' },
    3: { stroke: '#FF2222', fill: 'rgba(255, 34, 34, 0.12)' }
  };

  var activeAlarmId = null;

  function init(mapInstance) {
    map = mapInstance;

    // Explicit operator selection in Alarm History or on map always redraws the contour
    bus.on('alarm-selected', function (alarm) {
      drawContour(alarm, true);
    });

    // Incoming alarms only auto-update the subsidence bowl for regional/zone events
    // or if no contour is active yet. Isolated single-node alarms do not displace the bowl.
    bus.on('alarm', function (alarm) {
      if (!alarm) return;
      var isRegional = Boolean(alarm.zone_id || (alarm.affected_nodes && alarm.affected_nodes.length > 1));
      var hasActiveContour = Boolean(activeAlarmId && overlays[activeAlarmId]);

      if (isRegional || !hasActiveContour) {
        drawContour(alarm, false);
      }
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

  function drawContour(alarm, force) {
    if (!ENABLE_SUBSIDENCE_BOWL) {
      removeAll();
      return;
    }
    if (!map || !alarm || !alarm.centroid) return;
    if (typeof alarm.centroid.lat !== 'number' || typeof alarm.centroid.lng !== 'number') return;

    // If already showing this alarm and not forced, keep existing contour
    if (!force && activeAlarmId === alarm.alarm_id && overlays[alarm.alarm_id]) {
      return;
    }

    // Clear previous active contours
    removeAll();
    activeAlarmId = alarm.alarm_id;

    var points = [];
    var cx = alarm.centroid.lat;
    var cy = alarm.centroid.lng;

    if (alarm.affected_nodes) {
      for (var i = 0; i < alarm.affected_nodes.length; i++) {
        var nd = nodeMarkers.getNodeData(alarm.affected_nodes[i]);
        if (nd && typeof nd.lat === 'number' && typeof nd.lng === 'number') {
          points.push([nd.lat, nd.lng]);
        }
      }
    }

    // If fewer than 2 nodes, draw a realistic ~120m radius subsidence trough (~0.0011 degrees)
    if (points.length < 2) {
      points = [[cx - 0.0011, cy - 0.0011], [cx + 0.0011, cy + 0.0011]];
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
    activeAlarmId = null;
  }

  return {
    init: init,
    drawContour: drawContour,
    removeContour: removeContour,
    removeAll: removeAll,
    setFeatureEnabled: function (enabled) {
      ENABLE_SUBSIDENCE_BOWL = Boolean(enabled);
      if (!ENABLE_SUBSIDENCE_BOWL) removeAll();
    },
    isFeatureEnabled: function () {
      return ENABLE_SUBSIDENCE_BOWL;
    }
  };
})();
