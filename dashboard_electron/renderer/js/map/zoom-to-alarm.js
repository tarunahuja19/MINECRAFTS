'use strict';

var zoomToAlarm = (function () {
  var lastAutoZoomTime = 0;
  var AUTO_ZOOM_COOLDOWN_MS = 12000; // 12-second cooldown on unprompted auto-pans

  function init() {
    // Explicit selection by operator always pans immediately
    bus.on('alarm-selected', function (alarm) {
      zoomTo(alarm, true);
    });

    // Background incoming alarms: only auto-pan for major events (Level 3 collapse or regional zone)
    // with a generous cooldown so the operator's view never violently jerks between nodes.
    bus.on('alarm', function (alarm) {
      if (!alarm) return;
      var isMajorRegional = (alarm.level >= 3) || (alarm.level >= 2 && Boolean(alarm.zone_id));
      if (!isMajorRegional) return;

      var now = Date.now();
      if (now - lastAutoZoomTime >= AUTO_ZOOM_COOLDOWN_MS) {
        lastAutoZoomTime = now;
        var mapTab = document.querySelector('.tab-btn[data-tab="map"]');
        var isMapActive = mapTab && mapTab.classList.contains('active');
        zoomTo(alarm, isMapActive);
      }
    });
  }

  function zoomTo(alarm, forceSwitchTab) {
    if (!alarm) return;

    var centroid = alarm.centroid;
    if (!centroid && alarm.affected_nodes && alarm.affected_nodes.length > 0) {
      for (var k = 0; k < alarm.affected_nodes.length; k++) {
        var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(alarm.affected_nodes[k]) : null;
        if (nd && typeof nd.lat === 'number' && typeof nd.lng === 'number') {
          centroid = { lat: nd.lat, lng: nd.lng };
          break;
        }
      }
    }
    if (!centroid) return;

    if (forceSwitchTab) {
      var tabBtn = document.querySelector('.tab-btn[data-tab="map"]');
      if (tabBtn && !tabBtn.classList.contains('active')) {
        tabBtn.click();
      }
    }

    var map = mapView.getMap();
    if (!map) return;

    if (alarm.affected_nodes && alarm.affected_nodes.length > 1) {
      var bounds = [];
      for (var i = 0; i < alarm.affected_nodes.length; i++) {
        var nd2 = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(alarm.affected_nodes[i]) : null;
        if (nd2 && typeof nd2.lat === 'number' && typeof nd2.lng === 'number') {
          bounds.push([nd2.lat, nd2.lng]);
        }
      }
      bounds.push([centroid.lat, centroid.lng]);
      map.fitBounds(L.latLngBounds(bounds).pad(0.6), { maxZoom: 17, animate: true, duration: 1.2 });
    } else {
      map.setView([centroid.lat, centroid.lng], 17, { animate: true, duration: 1.2 });
    }
  }

  return {
    init: init,
    zoomTo: zoomTo
  };
})();
