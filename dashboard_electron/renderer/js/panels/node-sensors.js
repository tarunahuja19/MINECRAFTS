'use strict';

var nodeSensors = (function () {

  function render(containerId, nodeId, optReading, optProfile) {
    var container = document.getElementById(containerId);
    if (!container) return;

    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(nodeId) : null;
    var t = optReading || (nd ? nd.lastTelemetry : null);

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

    var extraChannelsHtml = buildExtraChannels(t, optProfile);

    container.innerHTML =
      buildVibrationBar(t) +
      '<div class="section-sep"></div>' +
      buildBatteryGauge(t) +
      '<div class="section-sep"></div>' +
      buildTemperature(t) +
      (extraChannelsHtml ? '<div class="section-sep"></div>' + extraChannelsHtml : '') +
      '<div class="section-sep"></div>' +
      buildFlags(t);
  }

  function update(containerId, t) {
    render(containerId, t._node_id || t.node_id, t);
  }

  function buildVibrationBar(t) {
    // An idle node reports no vibration at all. Distinguish "no reading"
    // (null/undefined -> em-dash, no bars) from a genuine 0 mm/s.
    var isMmS = (t && t.vib_rms_mm_s != null);
    var rms = isMmS ? t.vib_rms_mm_s
            : (t && t.vib_rms != null) ? t.vib_rms
            : null;
    var level = 0;
    if (rms !== null) {
      if (isMmS) {
        if (rms > 0.15) level = 1;
        if (rms > 0.40) level = 2;
        if (rms > 0.80) level = 3;
      } else {
        if (rms > 5) level = 1;
        if (rms > 15) level = 2;
        if (rms > 30) level = 3;
      }
    }

    var colors = ['green', 'amber', 'red'];
    var segs = '';
    for (var i = 0; i < 3; i++) {
      var filled = i < level ? ' filled ' + colors[i] : '';
      segs += '<div class="sensor-bar-seg' + filled + '"></div>';
    }

    var unit = isMmS ? ' mm/s' : '';

    return '<div class="readout-label">VIBRATION RMS</div>' +
           '<div style="display:flex;align-items:center;gap:8px;">' +
             '<div class="sensor-bar" style="flex:1;">' + segs + '</div>' +
             '<span class="mono" style="font-size:11px;">' + (rms !== null ? rms + unit : '--') + '</span>' +
           '</div>';
  }

  function buildBatteryGauge(t) {
    // Never substitute a nominal voltage for a missing reading: an idle
    // node shows no battery at all rather than a healthy-looking 4120 mV.
    var mv = (t && t.vbat_mv != null) ? t.vbat_mv : null;
    var pct = 0;
    if (mv !== null && mv >= 2800) {
      pct = Math.min(100, Math.round(((mv - 2800) / (4200 - 2800)) * 100));
    }
    var segsCount = (mv !== null) ? Math.ceil(pct / 20) : 0;

    var segs = '';
    for (var i = 0; i < 5; i++) {
      var color = 'green';
      if (segsCount <= 2) color = 'red';
      else if (segsCount <= 3) color = 'amber';
      var filled = i < segsCount ? ' filled ' + color : '';
      segs += '<div class="sensor-bar-seg' + filled + '"></div>';
    }

    return '<div class="readout-label">BATTERY POWER</div>' +
           '<div style="display:flex;align-items:center;gap:8px;">' +
             '<div class="sensor-bar" style="flex:1;">' + segs + '</div>' +
             '<span class="mono" style="font-size:11px;">' + (mv !== null ? mv + ' mV' : '--') + '</span>' +
           '</div>';
  }

  function buildTemperature(t) {
    var tempC = '--';
    if (t) {
      if (t.die_temp_c !== undefined && t.die_temp_c !== null) {
        tempC = Number(t.die_temp_c).toFixed(1);
      } else if (t.temp_c_x10 !== undefined && t.temp_c_x10 !== null) {
        tempC = (t.temp_c_x10 / 10).toFixed(1);
      }
    }
    return '<div class="readout-label">TEMPERATURE</div>' +
           '<div class="readout mono">' + (tempC !== '--' ? tempC + ' °C' : '--') + '</div>';
  }

  function buildExtraChannels(t, profile) {
    if (!t) return '';
    var items = [];

    if (t.fissure_mm !== undefined && t.fissure_mm !== null) {
      items.push({ label: 'CRACKMETER FISSURE', val: Number(t.fissure_mm).toFixed(2) + ' mm' });
    }
    if (t.ext_delta_mm !== undefined && t.ext_delta_mm !== null) {
      items.push({ label: 'EXTENSOMETER DELTA', val: Number(t.ext_delta_mm).toFixed(2) + ' mm' });
    }
    if (t.moisture_pct !== undefined && t.moisture_pct !== null) {
      items.push({ label: 'SOIL MOISTURE', val: Number(t.moisture_pct).toFixed(1) + ' %' });
    }
    if (t.pore_pressure_kpa !== undefined && t.pore_pressure_kpa !== null) {
      items.push({ label: 'PORE PRESSURE (VW)', val: Number(t.pore_pressure_kpa).toFixed(1) + ' kPa' });
    }
    if (t.gps_dx_mm !== undefined && t.gps_dx_mm !== null) {
      items.push({
        label: 'RTK DISPLACEMENT',
        val: 'dX: ' + Number(t.gps_dx_mm).toFixed(1) + ' · dY: ' + Number(t.gps_dy_mm || 0).toFixed(1) + ' · dZ: ' + Number(t.gps_dz_mm || 0).toFixed(1) + ' mm'
      });
    }

    if (items.length === 0) return '';

    var html = '<div class="panel-inset" style="margin-bottom:4px;">';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="meta-row">' +
                '<span class="readout-label">' + items[i].label + '</span>' +
                '<span class="readout-val mono">' + items[i].val + '</span>' +
              '</div>';
    }
    html += '</div>';
    return html;
  }

  function buildFlags(t) {
    var flags = t ? (t.flags || 0) : 0;
    var items = [
      { label: 'LAST GASP', bit: 0 },
      { label: 'SELF-TEST FAIL', bit: 1 },
      { label: 'BLAST WINDOW', bit: 2 },
      { label: 'LOW BATTERY', bit: 3 }
    ];

    var html = '<div class="readout-label">HARDWARE DIAGNOSTIC FLAGS</div><div class="flag-row">';
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
