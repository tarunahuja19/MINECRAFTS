'use strict';

var mapLayers = (function () {
  var panelOutlineLayer = null;
  var riskZonesLayer = null;

  var ZONE_STYLES = {
    high_confidence: {
      color: 'transparent',
      fillColor: 'rgba(0, 200, 60, 0.04)',
      fillOpacity: 0.04,
      weight: 1,
      dashArray: '3 3',
      className: ''
    },
    low_confidence: {
      color: 'rgba(255, 165, 0, 0.35)',
      fillColor: 'rgba(255, 165, 0, 0.05)',
      fillOpacity: 0.05,
      weight: 1,
      dashArray: '3 3',
      className: ''
    },
    brittle_failure: {
      color: 'rgba(255, 50, 50, 0.45)',
      fillColor: 'rgba(255, 30, 30, 0.07)',
      fillOpacity: 0.07,
      weight: 1,
      dashArray: '4 4',
      className: ''
    }
  };

  function loadPanelOutline(map, geojsonPath) {
    return fetch(geojsonPath).then(function (r) { return r.json(); }).then(function (data) {
      panelOutlineLayer = L.geoJSON(data, {
        filter: function (feature) {
          return !feature.properties.grid_id;
        },
        style: {
          color: '#5A8FA8',
          weight: 1.8,
          dashArray: '8 4',
          fill: true,
          fillColor: 'rgba(90, 143, 168, 0.03)',
          fillOpacity: 0.03,
          opacity: 0.85
        }
      });
      panelOutlineLayer.addTo(map);

      var bounds = panelOutlineLayer.getBounds();
      var tagIcon = L.divIcon({
        className: 'panel-boundary-tag',
        html: '<div style="font-family:\'Courier New\',monospace;font-size:9px;font-weight:bold;color:#75A4B8;background:rgba(10,18,24,0.85);padding:2px 6px;border:1px solid #2B424C;border-radius:2px;letter-spacing:0.08em;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.5);">PANEL-A : EXTRACTION PHASE</div>',
        iconSize: [168, 18],
        iconAnchor: [0, 22]
      });
      L.marker([bounds.getNorth(), bounds.getWest()], { icon: tagIcon, interactive: false }).addTo(map);

      return panelOutlineLayer;
    });
  }

  function loadRiskZones(map, geojsonPath) {
    return fetch(geojsonPath).then(function (r) { return r.json(); }).then(function (data) {
      riskZonesLayer = L.geoJSON(data, {
        interactive: false,
        style: function (feature) {
          var zoneType = feature.properties.zone_type || 'high_confidence';
          return ZONE_STYLES[zoneType] || ZONE_STYLES.high_confidence;
        },
        onEachFeature: function (feature, layer) {
          var label = feature.properties.label ||
            (feature.properties.zone_type ? feature.properties.zone_type.replace(/_/g, ' ').toUpperCase() : '');
          if (label) {
            layer.bindTooltip(label, {
              className: 'node-tooltip',
              sticky: true
            });
          }
        }
      });
      riskZonesLayer.addTo(map);
      return riskZonesLayer;
    });
  }

  function getPanelOutline() { return panelOutlineLayer; }
  function getRiskZones() { return riskZonesLayer; }

  return {
    loadPanelOutline: loadPanelOutline,
    loadRiskZones: loadRiskZones,
    getPanelOutline: getPanelOutline,
    getRiskZones: getRiskZones
  };
})();
