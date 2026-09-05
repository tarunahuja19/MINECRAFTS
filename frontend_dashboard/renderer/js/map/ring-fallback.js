'use strict';

var ringFallback = (function () {
  var bannerEl = null;
  var highlightLayers = [];
  var map = null;

  function init(mapInstance) {
    map = mapInstance;

    bannerEl = document.createElement('div');
    bannerEl.id = 'inner-ring-lost-banner';
    bannerEl.style.cssText = 'display:none;position:absolute;top:6px;left:50%;transform:translateX(-50%);' +
      'z-index:1000;padding:4px 14px;background:#B71C1C;color:#FFF;font-family:Courier New,monospace;' +
      'font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.05em;border:1px solid #FF8A80;' +
      'box-shadow:0 2px 6px rgba(0,0,0,0.6);';
    bannerEl.textContent = 'INNER RING LOST — OUTER RING ACTIVE';

    var mapContainer = document.getElementById('map-container');
    if (mapContainer) {
      mapContainer.style.position = 'relative';
      mapContainer.appendChild(bannerEl);
    }

    bus.on('alarm', function (alarm) {
      checkInnerRing(alarm);
    });

    bus.on('alarm-ack', function () {
      hideBanner();
      clearHighlights();
    });

    bus.on('fixture-started', function () {
      hideBanner();
      clearHighlights();
    });

    bus.on('replay-started', function () {
      hideBanner();
      clearHighlights();
    });
  }

  function checkInnerRing(alarm) {
    if (!alarm.affected_nodes) return;

    var nodes = fixtureProvider.getNodes();
    if (!nodes) return;

    var innerNodes = [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].ring === 'inner') innerNodes.push(nodes[i].node_id);
    }

    var affectedInner = 0;
    for (var j = 0; j < alarm.affected_nodes.length; j++) {
      if (innerNodes.indexOf(alarm.affected_nodes[j]) !== -1) affectedInner++;
    }

    var lostRatio = innerNodes.length > 0 ? (affectedInner / innerNodes.length) : 0;
    if (lostRatio >= 0.5) {
      showBanner();
      highlightOuterRing(nodes);
    } else {
      hideBanner();
      clearHighlights();
    }
  }

  function showBanner() {
    if (bannerEl) bannerEl.style.display = 'block';
  }

  function hideBanner() {
    if (bannerEl) bannerEl.style.display = 'none';
  }

  function highlightOuterRing(nodes) {
    clearHighlights();
    if (!map) return;

    var outerNodes = [];
    var cLat = 0, cLng = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].ring === 'outer') {
        outerNodes.push(nodes[i]);
        cLat += nodes[i].lat;
        cLng += nodes[i].lng;
      }
    }

    if (outerNodes.length === 0) return;
    cLat /= outerNodes.length;
    cLng /= outerNodes.length;

    // Order outer nodes angularly to form a clean perimeter boundary loop
    outerNodes.sort(function (a, b) {
      var angleA = Math.atan2(a.lat - cLat, a.lng - cLng);
      var angleB = Math.atan2(b.lat - cLat, b.lng - cLng);
      return angleA - angleB;
    });

    var polyCoords = outerNodes.map(function (n) { return [n.lat, n.lng]; });

    // Draw single sleek fallback perimeter polygon instead of 10 giant colliding circles
    var perimeter = L.polygon(polyCoords, {
      color: '#FFD700',
      weight: 1.5,
      dashArray: '6, 4',
      fillColor: 'rgba(255, 215, 0, 0.03)',
      fillOpacity: 1,
      interactive: false
    });
    perimeter.addTo(map);
    highlightLayers.push(perimeter);

    // Concentric targeting ring around circular outer nodes
    for (var k = 0; k < outerNodes.length; k++) {
      var markerHalo = L.circleMarker([outerNodes[k].lat, outerNodes[k].lng], {
        radius: 9,
        color: '#FFD700',
        weight: 1.5,
        opacity: 0.9,
        dashArray: '3, 3',
        fill: false,
        interactive: false
      });
      markerHalo.addTo(map);
      highlightLayers.push(markerHalo);
    }
  }

  function clearHighlights() {
    for (var i = 0; i < highlightLayers.length; i++) {
      map.removeLayer(highlightLayers[i]);
    }
    highlightLayers = [];
  }

  return {
    init: init,
    checkInnerRing: checkInnerRing,
    clearHighlights: clearHighlights
  };
})();
