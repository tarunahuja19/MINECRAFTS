'use strict';

var confidenceBadge = (function () {
  var badges = {};
  var map = null;

  var ZONE_LABELS = {
    high_warning:    { text: 'HIGH CONFIDENCE',    css: 'badge-high' },
    medium_warning:  { text: 'MEDIUM CONFIDENCE',  css: 'badge-medium' },
    low_confidence:  { text: 'LOW CONFIDENCE',     css: 'badge-low' }
  };

  function init(mapInstance) {
    map = mapInstance;

    bus.on('alarm', function (alarm) {
      showBadge(alarm);
    });

    bus.on('alarm-ack', function (data) {
      if (data && data.alarm_id) {
        removeBadge(data.alarm_id);
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

  function showBadge(alarm) {
    if (!map || !alarm.centroid) return;

    // Clear previous badges so multiple alarms do not stack
    removeAll();

    var zone = ZONE_LABELS[alarm.confidence_zone] || {
      text: (alarm.confidence_zone || 'CAUTION').replace(/_/g, ' ').toUpperCase(),
      css: 'badge-medium'
    };

    var icon = L.divIcon({
      className: 'node-marker',
      html: '<div class="confidence-zone-badge ' + zone.css + '">' + zone.text + '</div>',
      iconSize: [130, 20],
      iconAnchor: [65, 10]
    });

    // Offset north-east of centroid so it sits beside the trough contour and does not occlude nodes
    var badgeLat = alarm.centroid.lat + 0.0012;
    var badgeLng = alarm.centroid.lng + 0.0014;

    var marker = L.marker([badgeLat, badgeLng], {
      icon: icon,
      interactive: false,
      zIndexOffset: 200
    });

    marker.addTo(map);
    badges[alarm.alarm_id] = marker;
  }

  function removeBadge(alarmId) {
    if (badges[alarmId]) {
      map.removeLayer(badges[alarmId]);
      delete badges[alarmId];
    }
  }

  function removeAll() {
    var keys = Object.keys(badges);
    for (var i = 0; i < keys.length; i++) {
      map.removeLayer(badges[keys[i]]);
    }
    badges = {};
  }

  return {
    init: init,
    showBadge: showBadge,
    removeBadge: removeBadge,
    removeAll: removeAll
  };
})();
