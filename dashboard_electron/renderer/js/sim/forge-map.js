'use strict';

// FORGE mini map: the MAP tab's Leaflet view (same tiles, projection, panel
// outline and node icons) with FORGE state painted on top. sim-tab.js owns the
// state and calls update(); clicks go back through simTab.
var forgeMap = (function () {
  var SITE_HALF_M = 300;   // FORGE terrain is the 600 m district square
  var PAN_HALF_M = 400;

  var RED = '#FF3B3B';
  var HOT = '#FFAA00';
  var STATE_KEY = { ACTIVE: 'active', WARNING: 'warning', CRITICAL: 'critical' };

  var map = null;
  var fitted = false;
  var markers = {};        // 'N12' -> { marker, state }
  var selectedRing = null;
  var targetMarker = null;
  var previewLayer = null;
  var zoneLayers = [];     // circles and thick polylines, rebuilt when zones change
  var crackLayers = [];
  var zoneKey = '';
  var crackKey = '';
  var crackZones = [];     // { line, radius } so weights follow zoom

  function ll(x, y) { return mapView.xyToLatLon(x, y); }

  function bounds(half) {
    return L.latLngBounds(ll(-half, -half), ll(half, half));
  }

  function init(containerId) {
    if (map) return map;
    var el = document.getElementById(containerId);
    if (!el || typeof L === 'undefined') return null;
    map = L.map(containerId, {
      center: ll(0, 0),
      zoom: 16,
      minZoom: 14,
      maxZoom: 19,
      maxBounds: bounds(PAN_HALF_M),
      maxBoundsViscosity: 0.9,
      zoomControl: true,
      attributionControl: false
    });

    // Same tile sources as mapView.init; only :8085 is ever contacted.
    L.tileLayer('http://127.0.0.1:8085/tiles/satellite/{z}/{x}/{y}.png',
      { minZoom: 12, maxZoom: 19, maxNativeZoom: 19 }).addTo(map);
    L.tileLayer('http://127.0.0.1:8085/tiles/labels/{z}/{x}/{y}.png',
      { minZoom: 12, maxZoom: 19, opacity: 0.85 }).addTo(map);

    // Own layer: mapLayers.loadPanelOutline keeps a single module-level layer
    // for the MAP tab, so it cannot be called for a second map.
    fetch('../fixtures/panel_outline.geojson')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!map) return;
        L.geoJSON(data, {
          filter: function (f) { return !f.properties.grid_id; },
          interactive: false,
          style: {
            color: '#5A8FA8', weight: 1.8, dashArray: '8 4', fill: true,
            fillColor: 'rgba(90, 143, 168, 0.03)', fillOpacity: 0.03, opacity: 0.85
          }
        }).addTo(map);
      })
      .catch(function (e) { console.warn('[forge-map] panel outline failed:', e); });

    map.on('click', function (e) {
      var p = mapView.latLonToXY(e.latlng.lat, e.latlng.lng);
      var x = Math.max(-SITE_HALF_M, Math.min(SITE_HALF_M, p[0]));
      var y = Math.max(-SITE_HALF_M, Math.min(SITE_HALF_M, p[1]));
      if (typeof simTab !== 'undefined' && simTab.setForgeTarget) simTab.setForgeTarget({ x: x, y: y });
    });
    map.on('zoomend', applyCrackZoneWeights);
    return map;
  }

  // Leaflet line weights are pixels; a crack zone is metres wide.
  function applyCrackZoneWeights() {
    if (!map) return;
    var mPerPx = 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / Math.pow(2, map.getZoom() + 8);
    crackZones.forEach(function (z) { z.line.setStyle({ weight: Math.max(2, 2 * z.radius / mPerPx) }); });
  }

  // Called whenever the FORGE tab becomes visible or the layout changes.
  function invalidate() {
    if (!map) return;
    map.invalidateSize({ animate: false });
    var s = map.getSize();
    if (!fitted && s.x > 0 && s.y > 0) {
      map.fitBounds(bounds(SITE_HALF_M), { animate: false });
      fitted = true;
    }
    applyCrackZoneWeights();
  }

  function clear(list) {
    list.forEach(function (l) { map.removeLayer(l); });
    list.length = 0;
  }

  function crosshairIcon() {
    return L.divIcon({
      className: 'forge-target-icon',
      html: '<svg width="22" height="22" viewBox="0 0 22 22" stroke="#FFFFFF" stroke-width="1.6" fill="none" style="display:block;filter:drop-shadow(0 0 1px #000);">' +
        '<line x1="1" y1="11" x2="8" y2="11"/><line x1="14" y1="11" x2="21" y2="11"/>' +
        '<line x1="11" y1="1" x2="11" y2="8"/><line x1="11" y1="14" x2="11" y2="21"/></svg>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });
  }

  function syncNodes(nodes, states) {
    var seen = {};
    nodes.forEach(function (n) {
      var nid = n.node_id || n.id;
      seen[nid] = true;
      var state = STATE_KEY[states[nid]] || 'active';
      var entry = markers[nid];
      if (!entry) {
        var m = L.marker(ll(n.x, n.y), {
          icon: nodeMarkers.createIcon(state, nodeMarkers.roleOf(n), nodeMarkers.tierLetterOf(n)),
          title: nid
        });
        m.on('click', function () {
          if (typeof simTab !== 'undefined' && simTab.selectNode) simTab.selectNode(nid, 'forge');
        });
        m.bindTooltip(nid, { direction: 'top', offset: [0, -10], className: 'node-tooltip' });
        m.addTo(map);
        entry = markers[nid] = { marker: m, state: state, node: n };
      } else if (entry.state !== state) {
        entry.marker.setIcon(nodeMarkers.createIcon(state, nodeMarkers.roleOf(n), nodeMarkers.tierLetterOf(n)));
        entry.state = state;
      }
      entry.marker.setTooltipContent(nid + ' · ' + (states[nid] || 'ACTIVE'));
    });
    Object.keys(markers).forEach(function (nid) {
      if (seen[nid]) return;
      map.removeLayer(markers[nid].marker);
      delete markers[nid];
    });
  }

  function syncSelected(selected) {
    var entry = selected ? markers[selected] : null;
    if (!entry) {
      if (selectedRing) { map.removeLayer(selectedRing); selectedRing = null; }
      return;
    }
    var pos = entry.marker.getLatLng();
    if (!selectedRing) {
      selectedRing = L.circleMarker(pos, {
        radius: 15, color: '#FFFFFF', weight: 2, fill: false, interactive: false
      }).addTo(map);
    } else {
      selectedRing.setLatLng(pos);
    }
  }

  // White ring at r_white (red 20% fill), red ring at r_red (yellow 20% fill in
  // the band). Red is drawn first so the white ring sits on top of it.
  function syncZones(zones) {
    var key = JSON.stringify(zones);
    if (key === zoneKey) return;
    zoneKey = key;
    clear(zoneLayers);
    crackZones = [];
    zones.forEach(function (z) {
      if (z.kind === 'crack' && Array.isArray(z.polyline)) {
        var pts = z.polyline.map(function (p) { return ll(p[0], p[1]); });
        // Round caps make the thick line a capsule, like the 3D view.
        var band = L.polyline(pts, { color: '#FFD400', opacity: 0.25, lineCap: 'round', lineJoin: 'round', interactive: false });
        var core = L.polyline(pts, { color: RED, opacity: 0.3, lineCap: 'round', lineJoin: 'round', interactive: false });
        crackZones.push({ line: band, radius: z.r_red }, { line: core, radius: z.r_white });
        [band, core].forEach(function (l) { l.addTo(map); zoneLayers.push(l); });
        return;
      }
      var c = ll(z.cx, z.cy);
      var red = L.circle(c, { radius: z.r_red, color: RED, weight: 1.5, fillColor: '#FFD400', fillOpacity: 0.2, interactive: false });
      var white = L.circle(c, { radius: z.r_white, color: '#FFFFFF', weight: 1.5, fillColor: RED, fillOpacity: 0.2, interactive: false });
      [red, white].forEach(function (l) { l.addTo(map); zoneLayers.push(l); });
    });
    applyCrackZoneWeights();
  }

  // Strain cracks: thin red when new, orange when older. One multi-line layer per colour.
  function syncCracks(cracks) {
    var key = JSON.stringify(cracks);
    if (key === crackKey) return;
    crackKey = key;
    clear(crackLayers);
    var fresh = [], old = [];
    cracks.forEach(function (c) {
      (c.isNew ? fresh : old).push([ll(c.x0, c.y0), ll(c.x1, c.y1)]);
    });
    [[old, '#FF8C00'], [fresh, RED]].forEach(function (g) {
      if (!g[0].length) return;
      var l = L.polyline(g[0], { color: g[1], weight: 1.5, opacity: 0.95, interactive: false }).addTo(map);
      crackLayers.push(l);
    });
  }

  // preview: null | { circle: {x, y, r} } | { line: {x0, y0, x1, y1, width_m} }
  function syncPreview(preview) {
    if (previewLayer) { map.removeLayer(previewLayer); previewLayer = null; }
    if (!preview) return;
    var dash = { color: HOT, weight: 1.6, dashArray: '6 4', interactive: false };
    if (preview.circle) {
      previewLayer = L.circle(ll(preview.circle.x, preview.circle.y),
        Object.assign({ radius: preview.circle.r, fill: false }, dash));
    } else if (preview.line) {
      previewLayer = L.polyline([ll(preview.line.x0, preview.line.y0), ll(preview.line.x1, preview.line.y1)], dash);
    }
    if (previewLayer) previewLayer.addTo(map);
  }

  function syncTarget(target) {
    if (!target) {
      if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
      return;
    }
    var pos = ll(target.x, target.y);
    if (!targetMarker) {
      targetMarker = L.marker(pos, { icon: crosshairIcon(), interactive: false, keyboard: false, zIndexOffset: 500 }).addTo(map);
    } else {
      targetMarker.setLatLng(pos);
    }
  }

  function update(s) {
    if (!map) return;
    invalidate();
    syncZones(s.zones || []);
    syncCracks(s.cracks || []);
    syncNodes(s.nodes || [], s.states || {});
    syncPreview(s.preview || null);
    syncTarget(s.target || null);
    syncSelected(s.selected || null);
  }

  return {
    init: init,
    update: update,
    invalidate: invalidate,
    // Test hooks
    getMap: function () { return map; },
    getMarkerStates: function () {
      var out = {};
      Object.keys(markers).forEach(function (nid) { out[nid] = markers[nid].state; });
      return out;
    },
    getPreviewLayer: function () { return previewLayer; },
    getPreviewRadius: function () {
      return previewLayer && previewLayer.getRadius ? previewLayer.getRadius() : null;
    }
  };
})();

if (typeof window !== 'undefined') {
  window.forgeMap = forgeMap;
}
