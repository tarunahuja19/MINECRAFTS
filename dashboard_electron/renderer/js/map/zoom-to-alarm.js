'use strict';

var zoomToAlarm = (function () {
  function init() {
    bus.on('alarm-selected', function (alarm) {
      zoomTo(alarm, true);
    });

    bus.on('alarm', function (alarm) {
      // Level 2 = CRITICAL (limit exceeded), Level 3 = FAILED (collapse).
      // Both warrant pulling the operator's eye to the location.
      if (alarm.level >= 2) {
        var mapTab = document.querySelector('.tab-btn[data-tab="map"]');
        var isMapActive = mapTab && mapTab.classList.contains('active');
        zoomTo(alarm, isMapActive);
      }
    });
  }

  function zoomTo(alarm, forceSwitchTab) {
    if (!alarm || !alarm.centroid) return;

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
        var nd = nodeMarkers.getNodeData(alarm.affected_nodes[i]);
        if (nd) bounds.push([nd.lat, nd.lng]);
      }
      bounds.push([alarm.centroid.lat, alarm.centroid.lng]);
      map.fitBounds(L.latLngBounds(bounds).pad(0.6), { maxZoom: 17 });
    } else {
      map.setView([alarm.centroid.lat, alarm.centroid.lng], 17);
    }
  }

  return {
    init: init,
    zoomTo: zoomTo
  };
})();
