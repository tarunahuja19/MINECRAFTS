'use strict';

var nodeSensors = (function () {

  function render(containerId, nodeId) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var nd = nodeMarkers.getNodeData(nodeId);
    var t = nd ? nd.lastTelemetry : null;

    if (!t && typeof fixtureProvider !== 'undefined') {
      var allT = fixtureProvider.getTelemetry();
      if (allT) {
        for (var k = allT.length - 1; k >= 0; k--) {
          if (allT[k].node_id === nodeId) {
            t = allT[k];
            if (nd) nd.lastTelemetry = t;
            break;
          }
        }
      }
    }

    container.innerHTML =
      buildVibrationBar(t) +
      '<div class="section-sep"></div>' +
      buildBatteryGauge(t) +
      '<div class="section-sep"></div>' +
      buildTemperature(t) +
      '<div class="section-sep"></div>' +
      buildFlags(t);
  }

  function update(containerId, t) {
    render(containerId, t._node_id || t.node_id);
  }

  function buildVibrationBar(t) {
    var rms = t ? t.vib_rms : 0;
    var level = 0;
    if (rms > 5) level = 1;
    if (rms > 15) level = 2;
    if (rms > 30) level = 3;

    var colors = ['green', 'amber', 'red'];
    var segs = '';
    for (var i = 0; i < 3; i++) {
      var filled = i < level ? ' filled ' + colors[i] : '';
      segs += '<div class="sensor-bar-seg' + filled + '"></div>';
    }

    return '<div class="readout-label">VIBRATION RMS</div>' +
           '<div style="display:flex;align-items:center;gap:8px;">' +
             '<div class="sensor-bar" style="flex:1;">' + segs + '</div>' +
             '<span class="mono" style="font-size:11px;">' + (t ? rms : '--') + '</span>' +
           '</div>';
  }

  function buildBatteryGauge(t) {
    var mv = t ? t.vbat_mv : 0;
    var pct = 0;
    if (mv >= 2800) {
      pct = Math.min(100, Math.round(((mv - 2800) / (4200 - 2800)) * 100));
    }
    var segsCount = Math.ceil(pct / 20);

    var segs = '';
    for (var i = 0; i < 5; i++) {
      var color = 'green';
      if (segsCount <= 2) color = 'red';
      else if (segsCount <= 3) color = 'amber';
      var filled = i < segsCount ? ' filled ' + color : '';
      segs += '<div class="sensor-bar-seg' + filled + '"></div>';
    }

    return '<div class="readout-label">BATTERY</div>' +
           '<div style="display:flex;align-items:center;gap:8px;">' +
             '<div class="sensor-bar" style="flex:1;">' + segs + '</div>' +
             '<span class="mono" style="font-size:11px;">' + (t ? mv + ' mV' : '--') + '</span>' +
           '</div>';
  }

  function buildTemperature(t) {
    var tempC = t ? (t.temp_c_x10 / 10).toFixed(1) : '--';
    return '<div class="readout-label">TEMPERATURE</div>' +
           '<div class="readout mono">' + tempC + ' C</div>';
  }

  function buildFlags(t) {
    var flags = t ? t.flags : 0;
    var items = [
      { label: 'LAST GASP', bit: 0 },
      { label: 'SELF-TEST FAIL', bit: 1 },
      { label: 'BLAST WINDOW', bit: 2 },
      { label: 'LOW BATTERY', bit: 3 }
    ];

    var html = '<div class="readout-label">FLAGS</div><div class="flag-row">';
    for (var i = 0; i < items.length; i++) {
      var set = (flags >> items[i].bit) & 1;
      html += '<div class="flag-item">' +
                '<div class="flag-rect ' + (set ? 'flagged' : 'clear') + '"></div>' +
                '<span class="mono" style="font-size:9px;">' + items[i].label + '</span>' +
              '</div>';
    }
    html += '</div>';
    return html;
  }

  return {
    render: render,
    update: update
  };
})();
