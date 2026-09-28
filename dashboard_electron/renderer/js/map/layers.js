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

  // Dynamic Event Hazard Layer (Cave-in & Collapse Zones on Real Map)
  var eventHazardLayer = null;
  var currentMap = null;

  function crosshairIcon() {
    return L.divIcon({
      className: 'forge-target-crosshair',
      html: '<svg width="24" height="24" viewBox="0 0 24 24" stroke="#FFFFFF" stroke-width="2" fill="none" style="filter:drop-shadow(0 0 2px #000);">' +
            '<line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/>' +
            '<line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/>' +
            '<circle cx="12" cy="12" r="3" stroke="#FF2222" stroke-width="2"/>' +
            '</svg>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
  }

  function initEventHazardLayer(map) {
    currentMap = map;
    if (!eventHazardLayer && map) {
      eventHazardLayer = L.layerGroup().addTo(map);
    }

    if (typeof bus !== 'undefined' && typeof bus.on === 'function') {
      bus.on('forge-collapse', function (data) {
        renderCollapseZone(data);
      });
      bus.on('forge-zones', function (zones) {
        renderZones(zones);
      });
      bus.on('forge-cracks', function (cracks) {
        renderCracks(cracks);
      });
      bus.on('forge-reset', function () {
        clearEventHazardLayer();
      });
      bus.on('system-reset', function () {
        clearEventHazardLayer();
      });
    }
  }

  function clearEventHazardLayer() {
    if (eventHazardLayer) {
      eventHazardLayer.clearLayers();
    }
  }

  function renderCollapseZone(data) {
    if (!currentMap || !eventHazardLayer || !data) return;
    eventHazardLayer.clearLayers();

    var cx = Number(data.cx) || 0;
    var cy = Number(data.cy) || 0;
    var r = Number(data.radiusM) || 75;
    var depth = Number(data.magnitudeM) || 1.5;
    var center = typeof mapView !== 'undefined' ? mapView.xyToLatLon(cx, cy) : [18.6435, 79.5725];

    var rWhite = r * 1.2;
    var rRed = r * 1.5;

    // Warning buffer zone (yellow / amber fill, red border)
    var redCircle = L.circle(center, {
      radius: rRed,
      color: '#FF3B3B',
      weight: 2,
      dashArray: '6 4',
      fillColor: '#FFAA00',
      fillOpacity: 0.22,
      interactive: true
    });
    redCircle.bindTooltip('WARNING ZONE (' + Math.round(rRed) + 'm buffer)', { className: 'node-tooltip' });

    // Critical impact pit (white ring, deep red fill)
    var whiteCircle = L.circle(center, {
      radius: rWhite,
      color: '#FFFFFF',
      weight: 2.5,
      fillColor: '#FF2222',
      fillOpacity: 0.35,
      interactive: true
    });
    whiteCircle.bindTooltip('CRITICAL CAVE-IN ZONE (' + Math.round(rWhite) + 'm · Depth: ' + depth.toFixed(1) + 'm)', { className: 'node-tooltip' });

    var centerMarker = L.marker(center, { icon: crosshairIcon(), interactive: true });
    centerMarker.bindTooltip('CAVE-IN EPICENTER (' + Math.round(cx) + 'm, ' + Math.round(cy) + 'm)', { className: 'node-tooltip' });

    redCircle.addTo(eventHazardLayer);
    whiteCircle.addTo(eventHazardLayer);
    centerMarker.addTo(eventHazardLayer);
  }

  function renderZones(zones) {
    if (!currentMap || !eventHazardLayer || !Array.isArray(zones)) return;
    eventHazardLayer.clearLayers();
    zones.forEach(function (z) {
      if (z.kind === 'crack' && Array.isArray(z.polyline)) {
        var pts = z.polyline.map(function (p) {
          return typeof mapView !== 'undefined' ? mapView.xyToLatLon(p[0], p[1]) : [18.6435, 79.5725];
        });
        var band = L.polyline(pts, { color: '#FFD400', opacity: 0.3, weight: 14, lineCap: 'round', lineJoin: 'round', interactive: false });
        var core = L.polyline(pts, { color: '#FF3B3B', opacity: 0.5, weight: 6, lineCap: 'round', lineJoin: 'round', interactive: false });
        band.addTo(eventHazardLayer);
        core.addTo(eventHazardLayer);
        return;
      }
      var c = typeof mapView !== 'undefined' ? mapView.xyToLatLon(z.cx, z.cy) : [18.6435, 79.5725];
      var red = L.circle(c, { radius: z.r_red, color: '#FF3B3B', weight: 2, dashArray: '6 4', fillColor: '#FFAA00', fillOpacity: 0.22, interactive: true });
      red.bindTooltip('WARNING ZONE (' + Math.round(z.r_red) + 'm)', { className: 'node-tooltip' });
      var white = L.circle(c, { radius: z.r_white, color: '#FFFFFF', weight: 2.5, fillColor: '#FF2222', fillOpacity: 0.35, interactive: true });
      white.bindTooltip('CRITICAL IMPACT ZONE (' + Math.round(z.r_white) + 'm)', { className: 'node-tooltip' });
      red.addTo(eventHazardLayer);
      white.addTo(eventHazardLayer);
    });
  }

  function renderCracks(cracks) {
    if (!currentMap || !eventHazardLayer || !Array.isArray(cracks)) return;
    cracks.forEach(function (c) {
      if (c && Number.isFinite(c.x0) && Number.isFinite(c.y0) && Number.isFinite(c.x1) && Number.isFinite(c.y1)) {
        var p0 = typeof mapView !== 'undefined' ? mapView.xyToLatLon(c.x0, c.y0) : [18.6435, 79.5725];
        var p1 = typeof mapView !== 'undefined' ? mapView.xyToLatLon(c.x1, c.y1) : [18.6435, 79.5725];
        var line = L.polyline([p0, p1], {
          color: c.isNew ? '#FF2222' : '#FFAA00',
          weight: Math.max(2, Math.min(8, (c.width_mm || 50) / 10)),
          opacity: 0.8
        });
        line.addTo(eventHazardLayer);
      }
    });
  }

  return {
    loadPanelOutline: loadPanelOutline,
    loadRiskZones: loadRiskZones,
    initEventHazardLayer: initEventHazardLayer,
    clearEventHazardLayer: clearEventHazardLayer,
    getPanelOutline: getPanelOutline,
    getRiskZones: getRiskZones
  };
})();
