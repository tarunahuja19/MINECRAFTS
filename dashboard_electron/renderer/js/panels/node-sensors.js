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
      buildTiltCard(t) +
      buildStrainCard(t, nd) +
      buildVibrationCard(t) +
      buildTemperatureCard(t) +
      buildBatteryCard(t) +
      (extraChannelsHtml ? extraChannelsHtml : '') +
      buildFlagsCard(t);
  }

  function update(containerId, t) {
    render(containerId, t._node_id || t.node_id, t);
  }

  // 1. Tilt X / Y / Z Card with Horizon Balance Meters
  function buildTiltCard(t) {
    var tx = (t && t.tilt_x_mdeg != null) ? t.tilt_x_mdeg :
             (t && t.tilt_x != null) ? (Math.abs(t.tilt_x) < 10 ? Math.round(t.tilt_x * 1000) : t.tilt_x) :
             (t && t.channels && t.channels.tilt_x != null) ? t.channels.tilt_x : null;
    var ty = (t && t.tilt_y_mdeg != null) ? t.tilt_y_mdeg :
             (t && t.tilt_y != null) ? (Math.abs(t.tilt_y) < 10 ? Math.round(t.tilt_y * 1000) : t.tilt_y) :
             (t && t.channels && t.channels.tilt_y != null) ? t.channels.tilt_y : null;
    var tz = (t && t.tilt_z_mdeg != null) ? t.tilt_z_mdeg :
             (t && t.tilt_z != null) ? (Math.abs(t.tilt_z) < 10 ? Math.round(t.tilt_z * 1000) : t.tilt_z) :
             (t && t.channels && t.channels.tilt_z != null) ? t.channels.tilt_z : 0;

    var hasData = (tx != null && ty != null);
    var mag = hasData ? Math.hypot(tx, ty) : null;

    var statusClass = 'nominal';
    var statusText = 'LEVEL';
    if (mag !== null) {
      if (mag > 1200) { statusClass = 'critical'; statusText = 'CRITICAL TILT'; }
      else if (mag > 400) { statusClass = 'warning'; statusText = 'ELEVATED'; }
    } else {
      statusClass = 'muted';
      statusText = 'NO TELEMETRY';
    }

    var txStr = (tx != null) ? (tx >= 0 ? '+' : '') + tx + ' mdeg' : '--';
    var tyStr = (ty != null) ? (ty >= 0 ? '+' : '') + ty + ' mdeg' : '--';
    var tzStr = (tz != null) ? (tz >= 0 ? '+' : '') + tz + ' mdeg' : '--';
    var magStr = (mag != null) ? mag.toFixed(0) : '--';

    function renderBalanceRow(axis, val) {
      var barLeft = 50;
      var barWidth = 0;
      var barColor = '#00CC44';

      if (val != null) {
        var clamped = Math.max(-1000, Math.min(1000, val));
        var span = (clamped / 1000) * 48; // max 48% deviation from center
        if (span >= 0) {
          barLeft = 50;
          barWidth = span;
        } else {
          barLeft = 50 + span;
          barWidth = -span;
        }
        if (Math.abs(clamped) > 600) barColor = '#FF2222';
        else if (Math.abs(clamped) > 250) barColor = '#FFA500';
      }

      var displayVal = (val != null) ? ((val >= 0 ? '+' : '') + val + ' mdeg') : '--';

      return '<div class="glass-balance-row">' +
               '<span class="glass-balance-label">' + axis + '</span>' +
               '<div class="glass-balance-track">' +
                 '<div class="glass-balance-center"></div>' +
                 '<div class="glass-balance-bar" style="left:' + barLeft + '%;width:' + barWidth + '%;background:' + barColor + ';box-shadow:0 0 6px ' + barColor + ';"></div>' +
               '</div>' +
               '<span class="glass-balance-val">' + displayVal + '</span>' +
             '</div>';
    }

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">TILT ORIENTATION (X / Y / Z)</span>' +
               '<span class="glass-metric-badge ' + statusClass + '">' + statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span class="glass-metric-val">' + magStr + '</span>' +
                 '<span class="glass-metric-unit">mdeg |θ|</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#8BA0AC;">X ' + txStr + ' · Y ' + tyStr + '</span>' +
             '</div>' +
             '<div style="margin-top:2px;">' +
               renderBalanceRow('X', tx) +
               renderBalanceRow('Y', ty) +
               renderBalanceRow('Z', tz) +
             '</div>' +
           '</div>';
  }

  // 2. Ground Strain Card
  function buildStrainCard(t, nd) {
    var strain = (t && t.strain_ustrain != null) ? t.strain_ustrain :
                 (t && t.strain_ue != null) ? t.strain_ue :
                 (t && t.strain != null) ? t.strain :
                 (t && t.channels && t.channels.strain_ue != null) ? t.channels.strain_ue : null;

    var carriesStrain = true;
    if (nd && nd.tier && nd.tier !== '1B') {
      // In this mine network, only Tier 1B tension scouts natively carry foil strain gauges
      if (strain == null) carriesStrain = false;
    }

    var statusClass = 'nominal';
    var statusText = 'SAFE (<500 µε)';
    var pct = 0;
    var barColor = '#00CC44';

    if (!carriesStrain && strain == null) {
      statusClass = 'muted';
      statusText = 'NOT FITTED';
    } else if (strain != null) {
      pct = Math.min(100, Math.max(0, (strain / 2000) * 100));
      if (strain >= 1500) {
        statusClass = 'critical';
        statusText = 'CRITICAL (>1500 µε)';
        barColor = '#FF2222';
      } else if (strain >= 500) {
        statusClass = 'warning';
        statusText = 'TENSION (>500 µε)';
        barColor = '#FFA500';
      }
    } else {
      statusClass = 'muted';
      statusText = '--';
    }

    var valStr = (strain != null) ? String(strain) : '--';

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">GROUND STRAIN</span>' +
               '<span class="glass-metric-badge ' + statusClass + '">' + statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span class="glass-metric-val">' + valStr + '</span>' +
                 '<span class="glass-metric-unit">µε (ustrain)</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">' + (strain != null ? (pct.toFixed(0) + '% rupture') : 'Tier ' + (nd ? nd.tier : '1A')) + '</span>' +
             '</div>' +
             '<div class="glass-track">' +
               '<div class="glass-track-fill" style="width:' + pct + '%;background:' + barColor + ';box-shadow:0 0 8px ' + barColor + ';"></div>' +
             '</div>' +
           '</div>';
  }

  // 3. Vibration RMS Card
  function buildVibrationCard(t) {
    var isMmS = (t && t.vib_rms_mm_s != null);
    var rms = isMmS ? t.vib_rms_mm_s :
              (t && t.vib_rms != null) ? t.vib_rms :
              (t && t.channels && t.channels.vibration_rms != null) ? t.channels.vibration_rms : null;

    var statusClass = 'nominal';
    var statusText = 'QUIET';
    var pct = 0;
    var barColor = '#00CC44';

    if (rms != null) {
      if (isMmS) {
        pct = Math.min(100, Math.max(0, (rms / 1.0) * 100));
        if (rms > 0.60) { statusClass = 'critical'; statusText = 'HIGH TRANSIENT'; barColor = '#FF2222'; }
        else if (rms > 0.20) { statusClass = 'warning'; statusText = 'ELEVATED'; barColor = '#FFA500'; }
      } else {
        pct = Math.min(100, Math.max(0, (rms / 40.0) * 100));
        if (rms > 25) { statusClass = 'critical'; statusText = 'HIGH TRANSIENT'; barColor = '#FF2222'; }
        else if (rms > 10) { statusClass = 'warning'; statusText = 'ELEVATED'; barColor = '#FFA500'; }
      }
    } else {
      statusClass = 'muted';
      statusText = 'IDLE';
    }

    var valStr = (rms != null) ? (typeof rms === 'number' ? rms.toFixed(2) : rms) : '--';
    var unit = isMmS ? 'mm/s PPV' : 'RMS';

    // 8-segment equalizer
    var numBars = 8;
    var activeBars = rms != null ? Math.ceil((pct / 100) * numBars) : 0;
    var eqHtml = '<div style="display:flex;gap:3px;align-items:flex-end;height:12px;margin-top:4px;">';
    for (var b = 0; b < numBars; b++) {
      var h = 4 + (b * 1.1);
      var segCol = '#253540';
      if (b < activeBars) {
        segCol = (b >= 6) ? '#FF2222' : ((b >= 4) ? '#FFA500' : '#00CC44');
      }
      eqHtml += '<div style="flex:1;height:' + h + 'px;background:' + segCol + ';border-radius:1px;"></div>';
    }
    eqHtml += '</div>';

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">SEISMIC VIBRATION RMS</span>' +
               '<span class="glass-metric-badge ' + statusClass + '">' + statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span class="glass-metric-val">' + valStr + '</span>' +
                 '<span class="glass-metric-unit">' + unit + '</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">3-AXIS ACCEL</span>' +
             '</div>' +
             eqHtml +
           '</div>';
  }

  // 4. Temperature Card
  function buildTemperatureCard(t) {
    var temp = (t && t.die_temp_c != null) ? t.die_temp_c :
               (t && t.temp_c_x10 != null) ? (t.temp_c_x10 / 10) :
               (t && t.temperature_c != null) ? t.temperature_c :
               (t && t.channels && t.channels.temperature_c != null) ? t.channels.temperature_c : null;

    var statusClass = 'nominal';
    var statusText = 'NORMAL (20-45°C)';
    var pct = 0;
    var barColor = '#00CC44';

    if (temp != null) {
      pct = Math.min(100, Math.max(0, ((temp - 10) / 50) * 100)); // 10°C to 60°C range
      if (temp > 50) { statusClass = 'critical'; statusText = 'OVERHEAT'; barColor = '#FF2222'; }
      else if (temp > 40) { statusClass = 'warning'; statusText = 'WARM'; barColor = '#FFA500'; }
    } else {
      statusClass = 'muted';
      statusText = '--';
    }

    var valStr = (temp != null) ? (typeof temp === 'number' ? temp.toFixed(1) : temp) : '--';

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">CORE TEMPERATURE</span>' +
               '<span class="glass-metric-badge ' + statusClass + '">' + statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span class="glass-metric-val">' + valStr + '</span>' +
                 '<span class="glass-metric-unit">°C</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">ENVELOPE 25-40°C</span>' +
             '</div>' +
             '<div class="glass-track">' +
               '<div class="glass-track-fill" style="width:' + pct + '%;background:' + barColor + ';box-shadow:0 0 8px ' + barColor + ';"></div>' +
             '</div>' +
           '</div>';
  }

  // 5. Battery Power Card
  function buildBatteryCard(t) {
    var mv = (t && t.vbat_mv != null) ? t.vbat_mv :
             (t && t.battery_mv != null) ? t.battery_mv :
             (t && t.channels && t.channels.battery_voltage != null) ? Math.round(t.channels.battery_voltage * 1000) : null;

    var pct = 0;
    var statusClass = 'nominal';
    var statusText = 'HEALTHY';
    var barColor = '#00CC44';

    if (mv != null && mv >= 2800) {
      pct = Math.min(100, Math.round(((mv - 2800) / (4200 - 2800)) * 100));
      if (pct <= 20) { statusClass = 'critical'; statusText = 'CRITICAL LOW'; barColor = '#FF2222'; }
      else if (pct <= 40) { statusClass = 'warning'; statusText = 'LOW BATTERY'; barColor = '#FFA500'; }
    } else if (mv != null) {
      statusClass = 'critical';
      statusText = 'DEPLETED';
      barColor = '#FF2222';
    } else {
      statusClass = 'muted';
      statusText = '--';
    }

    var valStr = (mv != null) ? (mv + ' mV (' + pct + '%)') : '--';

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">BATTERY & POWER</span>' +
               '<span class="glass-metric-badge ' + statusClass + '">' + statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span class="glass-metric-val">' + valStr + '</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">LiFePO4 3.7V</span>' +
             '</div>' +
             '<div class="glass-track">' +
               '<div class="glass-track-fill" style="width:' + pct + '%;background:' + barColor + ';box-shadow:0 0 8px ' + barColor + ';"></div>' +
             '</div>' +
           '</div>';
  }

  // 6. Auxiliary Sensor Channels (if equipped)
  function buildExtraChannels(t, profile) {
    if (!t) return '';
    var items = [];

    if (t.fissure_mm != null) {
      items.push({ label: 'CRACKMETER FISSURE', val: Number(t.fissure_mm).toFixed(2) + ' mm' });
    }
    if (t.ext_delta_mm != null) {
      items.push({ label: 'EXTENSOMETER DELTA', val: Number(t.ext_delta_mm).toFixed(2) + ' mm' });
    }
    if (t.moisture_pct != null) {
      items.push({ label: 'SOIL MOISTURE', val: Number(t.moisture_pct).toFixed(1) + ' %' });
    }
    if (t.pore_pressure_kpa != null) {
      items.push({ label: 'PORE PRESSURE (VW)', val: Number(t.pore_pressure_kpa).toFixed(1) + ' kPa' });
    }
    if (t.gps_dx_mm != null) {
      items.push({
        label: 'RTK DISPLACEMENT',
        val: 'dX: ' + Number(t.gps_dx_mm).toFixed(1) + ' · dY: ' + Number(t.gps_dy_mm || 0).toFixed(1) + ' · dZ: ' + Number(t.gps_dz_mm || 0).toFixed(1) + ' mm'
      });
    }

    if (items.length === 0) return '';

    var html = '<div class="glass-card"><div class="glass-metric-label" style="margin-bottom:6px;">SPECIALIZED SENSOR CHANNELS</div>';
    for (var i = 0; i < items.length; i++) {
      html += '<div class="meta-row">' +
                '<span class="readout-label">' + items[i].label + '</span>' +
                '<span class="readout-val mono" style="font-weight:700;color:#00CC44;">' + items[i].val + '</span>' +
              '</div>';
    }
    html += '</div>';
    return html;
  }

  // 7. Diagnostic Flags
  function buildFlagsCard(t) {
    var flags = t ? (t.flags || 0) : 0;
    var items = [
      { label: 'LAST GASP', bit: 0 },
      { label: 'SELF-TEST FAIL', bit: 1 },
      { label: 'BLAST WINDOW', bit: 2 },
      { label: 'LOW BATTERY', bit: 3 }
    ];

    var html = '<div class="glass-card">' +
                 '<div class="glass-metric-label" style="margin-bottom:6px;">HARDWARE STATUS FLAGS</div>' +
                 '<div class="flag-row">';
    for (var i = 0; i < items.length; i++) {
      var set = (flags >> items[i].bit) & 1;
      html += '<div class="flag-item">' +
                '<div class="flag-rect ' + (set ? 'flagged' : 'clear') + '"></div>' +
                '<span class="mono" style="font-size:9.5px;color:' + (set ? '#FF4400' : '#8AA0AC') + ';">' + items[i].label + '</span>' +
              '</div>';
    }
    html += '</div></div>';
    return html;
  }

  return {
    render: render,
    update: update
  };
})();
