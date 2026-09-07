'use strict';

var nodeSensors = (function () {
  var activeNodeId = null;
  var nodeTelemetryCache = {};

  function getMergedTelemetry(nodeId, incoming, nd) {
    // If node is dead, strictly return null so all SCADA instruments display offline
    if (nd && nd.state === 'dead') {
      return null;
    }

    var cached = nodeTelemetryCache[nodeId] || null;

    // Check fixture history for any existing records if not in cache
    if (!cached && !incoming) {
      if (typeof fixtureProvider !== 'undefined' && fixtureProvider.getTelemetry) {
        var allT = fixtureProvider.getTelemetry();
        if (allT && allT.length) {
          for (var k = allT.length - 1; k >= 0; k--) {
            if (allT[k].node_id === nodeId) {
              cached = Object.assign({}, allT[k]);
              break;
            }
          }
        }
      }
    }

    if (incoming) {
      if (!cached) cached = {};
      for (var prop in incoming) {
        if (incoming[prop] !== null && incoming[prop] !== undefined) {
          cached[prop] = incoming[prop];
        }
      }
    }

    if (!cached) {
      return null;
    }

    nodeTelemetryCache[nodeId] = cached;
    return cached;
  }

  if (typeof bus !== 'undefined' && bus.on) {
    bus.on('simulation-status', function (data) {
      if (!data || !data.is_running) {
        nodeTelemetryCache = {};
      }
    });
    bus.on('system-reset', function () {
      nodeTelemetryCache = {};
    });
  }

  function triggerFlash(el) {
    if (!el) return;
    el.classList.remove('flash-val');
    void el.offsetWidth;
    el.classList.add('flash-val');
  }

  function render(containerId, nodeId, optReading, optProfile) {
    var container = document.getElementById(containerId);
    if (!container) return;

    activeNodeId = nodeId;
    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(nodeId) : null;
    if (optProfile) nd = Object.assign({}, nd || {}, optProfile);

    var t = getMergedTelemetry(nodeId, optReading || (nd ? nd.lastTelemetry : null), nd);
    if (nd && t) nd.lastTelemetry = t;

    var extraChannelsHtml = buildExtraChannels(t, optProfile);

    // Hardware status flags removed from display as requested
    container.innerHTML =
      buildTiltCard(t) +
      buildStrainCard(t, nd) +
      buildVibrationCard(t) +
      buildTemperatureCard(t) +
      buildBatteryCard(t) +
      (extraChannelsHtml ? extraChannelsHtml : '');

    // Mount embedded live rolling waveform charts inside the cards
    if (typeof tiltChart !== 'undefined' && tiltChart.init) {
      tiltChart.init('tilt-chart-container', nodeId, t);
    }
    if (typeof strainChart !== 'undefined' && strainChart.init) {
      strainChart.init('strain-chart-container', nodeId, t);
    }
  }

  function update(containerId, t) {
    if (!t) return;
    var nodeId = t._node_id || t.node_id || activeNodeId;
    if (!nodeId) return;

    var nd = (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) ? nodeMarkers.getNodeData(nodeId) : null;
    var merged = getMergedTelemetry(nodeId, t, nd);
    if (nd) nd.lastTelemetry = merged;

    // If detail panel is viewing a different node, or DOM isn't mounted yet, render fresh
    if (nodeId !== activeNodeId || !document.getElementById('tilt-mag-val')) {
      render(containerId, nodeId, merged, nd);
      return;
    }

    // Direct in-place DOM overwriting (no innerHTML wipe, preserving canvas & animations)
    updateTiltDOM(merged);
    updateStrainDOM(merged, nd);
    updateVibrationDOM(merged);
    updateTemperatureDOM(merged);
    updateBatteryDOM(merged);
    updateFlagsDOM(merged);

    // Feed new telemetry point into live charts
    if (typeof tiltChart !== 'undefined' && tiltChart.addPoint) {
      tiltChart.addPoint(merged);
    }
    if (typeof strainChart !== 'undefined' && strainChart.addPoint) {
      strainChart.addPoint(merged);
    }
  }

  // ---------------------------------------------------------------------
  // 1. Tilt X / Y / Z Card & DOM Updates
  // ---------------------------------------------------------------------

  function calcTiltValues(t) {
    if (!t) {
      return { tx: null, ty: null, tz: null, mag: null, statusClass: 'dead', statusText: 'OFFLINE' };
    }

    var tx = (t.tilt_x_mdeg != null) ? t.tilt_x_mdeg :
             (t.tilt_x != null) ? (Math.abs(t.tilt_x) < 10 ? Math.round(t.tilt_x * 1000) : Math.round(t.tilt_x)) :
             (t.channels && t.channels.tilt_x != null) ? Math.round(t.channels.tilt_x) : null;

    var ty = (t.tilt_y_mdeg != null) ? t.tilt_y_mdeg :
             (t.tilt_y != null) ? (Math.abs(t.tilt_y) < 10 ? Math.round(t.tilt_y * 1000) : Math.round(t.tilt_y)) :
             (t.channels && t.channels.tilt_y != null) ? Math.round(t.channels.tilt_y) : null;

    var tz = (t.tilt_z_mdeg != null) ? t.tilt_z_mdeg :
             (t.tilt_z != null) ? (Math.abs(t.tilt_z) < 10 ? Math.round(t.tilt_z * 1000) : Math.round(t.tilt_z)) :
             (t.channels && t.channels.tilt_z != null) ? Math.round(t.channels.tilt_z) : 0;

    if (tx == null || ty == null || !isFinite(tx) || !isFinite(ty)) {
      return { tx: null, ty: null, tz: null, mag: null, statusClass: 'dead', statusText: 'OFFLINE' };
    }

    var mag = Math.round(Math.hypot(tx, ty));

    var statusClass = 'nominal';
    var statusText = 'LEVEL';
    if (mag > 1200) { statusClass = 'critical'; statusText = 'CRITICAL TILT'; }
    else if (mag > 400) { statusClass = 'warning'; statusText = 'ELEVATED'; }

    return { tx: tx, ty: ty, tz: tz, mag: mag, statusClass: statusClass, statusText: statusText };
  }

  function renderBalanceMetrics(val) {
    if (val == null || !isFinite(val)) {
      return { left: 50, width: 0, color: '#5A6A72', text: '--' };
    }

    var clamped = Math.max(-1000, Math.min(1000, val));
    var span = (clamped / 1000) * 48;
    var barLeft = 50;
    var barWidth = 0;
    var barColor = '#00CC44';

    if (span >= 0) {
      barLeft = 50;
      barWidth = span;
    } else {
      barLeft = 50 + span;
      barWidth = -span;
    }

    if (Math.abs(clamped) > 600) barColor = '#FF2222';
    else if (Math.abs(clamped) > 250) barColor = '#FFA500';

    var displayVal = (val >= 0 ? '+' : '') + val + ' mdeg';
    return { left: barLeft, width: barWidth, color: barColor, text: displayVal };
  }

  function buildTiltCard(t) {
    var d = calcTiltValues(t);
    var isLive = (d.mag !== null && d.mag !== undefined);
    var magStr = isLive ? String(d.mag) : '--';
    var xyStr = isLive ? ('X ' + (d.tx >= 0 ? '+' : '') + d.tx + ' · Y ' + (d.ty >= 0 ? '+' : '') + d.ty + ' mdeg') : 'X -- · Y -- mdeg';
    var bx = renderBalanceMetrics(d.tx);
    var by = renderBalanceMetrics(d.ty);
    var bz = renderBalanceMetrics(d.tz);

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">TILT ORIENTATION (X / Y / Z)</span>' +
               '<span id="tilt-status-badge" class="glass-metric-badge ' + d.statusClass + '">' + d.statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span id="tilt-mag-val" class="glass-metric-val">' + magStr + '</span>' +
                 '<span class="glass-metric-unit">mdeg |θ|</span>' +
               '</div>' +
               '<span id="tilt-xy-val" style="font-family:monospace;font-size:10.5px;color:#8BA0AC;">' + xyStr + '</span>' +
             '</div>' +
             '<div style="margin-top:2px;">' +
               '<div class="glass-balance-row">' +
                 '<span class="glass-balance-label">X</span>' +
                 '<div class="glass-balance-track">' +
                   '<div class="glass-balance-center"></div>' +
                   '<div id="tilt-bar-x" class="glass-balance-bar" style="left:' + bx.left + '%;width:' + bx.width + '%;background:' + bx.color + ';' + (isLive ? ('box-shadow:0 0 6px ' + bx.color + ';') : '') + '"></div>' +
                 '</div>' +
                 '<span id="tilt-val-x" class="glass-balance-val">' + bx.text + '</span>' +
               '</div>' +
               '<div class="glass-balance-row">' +
                 '<span class="glass-balance-label">Y</span>' +
                 '<div class="glass-balance-track">' +
                   '<div class="glass-balance-center"></div>' +
                   '<div id="tilt-bar-y" class="glass-balance-bar" style="left:' + by.left + '%;width:' + by.width + '%;background:' + by.color + ';' + (isLive ? ('box-shadow:0 0 6px ' + by.color + ';') : '') + '"></div>' +
                 '</div>' +
                 '<span id="tilt-val-y" class="glass-balance-val">' + by.text + '</span>' +
               '</div>' +
               '<div class="glass-balance-row">' +
                 '<span class="glass-balance-label">Z</span>' +
                 '<div class="glass-balance-track">' +
                   '<div class="glass-balance-center"></div>' +
                   '<div id="tilt-bar-z" class="glass-balance-bar" style="left:' + bz.left + '%;width:' + bz.width + '%;background:' + bz.color + ';' + (isLive ? ('box-shadow:0 0 6px ' + bz.color + ';') : '') + '"></div>' +
                 '</div>' +
                 '<span id="tilt-val-z" class="glass-balance-val">' + bz.text + '</span>' +
               '</div>' +
             '</div>' +
             '<div class="live-chart-container" id="tilt-chart-container"></div>' +
           '</div>';
  }

  function updateTiltDOM(t) {
    var d = calcTiltValues(t);
    var isLive = (d.mag !== null && d.mag !== undefined);
    var valStr = isLive ? String(d.mag) : '--';

    var magEl = document.getElementById('tilt-mag-val');
    if (magEl && magEl.textContent !== valStr) {
      magEl.textContent = valStr;
      if (isLive) triggerFlash(magEl);
    }

    var xyEl = document.getElementById('tilt-xy-val');
    if (xyEl) {
      xyEl.textContent = isLive ? ('X ' + (d.tx >= 0 ? '+' : '') + d.tx + ' · Y ' + (d.ty >= 0 ? '+' : '') + d.ty + ' mdeg') : 'X -- · Y -- mdeg';
    }

    var badge = document.getElementById('tilt-status-badge');
    if (badge) {
      badge.className = 'glass-metric-badge ' + d.statusClass;
      badge.textContent = d.statusText;
    }

    var bx = renderBalanceMetrics(d.tx);
    var barX = document.getElementById('tilt-bar-x');
    if (barX) {
      barX.style.left = bx.left + '%';
      barX.style.width = bx.width + '%';
      barX.style.background = bx.color;
      barX.style.boxShadow = isLive ? ('0 0 6px ' + bx.color) : 'none';
    }
    var valX = document.getElementById('tilt-val-x');
    if (valX) valX.textContent = bx.text;

    var by = renderBalanceMetrics(d.ty);
    var barY = document.getElementById('tilt-bar-y');
    if (barY) {
      barY.style.left = by.left + '%';
      barY.style.width = by.width + '%';
      barY.style.background = by.color;
      barY.style.boxShadow = isLive ? ('0 0 6px ' + by.color) : 'none';
    }
    var valY = document.getElementById('tilt-val-y');
    if (valY) valY.textContent = by.text;

    var bz = renderBalanceMetrics(d.tz);
    var barZ = document.getElementById('tilt-bar-z');
    if (barZ) {
      barZ.style.left = bz.left + '%';
      barZ.style.width = bz.width + '%';
      barZ.style.background = bz.color;
      barZ.style.boxShadow = isLive ? ('0 0 6px ' + bz.color) : 'none';
    }
    var valZ = document.getElementById('tilt-val-z');
    if (valZ) valZ.textContent = bz.text;
  }

  // ---------------------------------------------------------------------
  // 2. Ground Strain Card & DOM Updates
  // ---------------------------------------------------------------------

  function calcStrainValues(t, nd) {
    if (!t) {
      return { strain: null, pct: 0, statusClass: 'dead', statusText: 'OFFLINE', barColor: '#5A6A72' };
    }

    var strain = (t.strain_ustrain != null) ? t.strain_ustrain :
                 (t.strain_ue != null) ? t.strain_ue :
                 (t.strain != null) ? t.strain :
                 (t.channels && t.channels.strain_ue != null) ? t.channels.strain_ue : null;

    if (strain == null || !isFinite(strain)) {
      return { strain: null, pct: 0, statusClass: 'dead', statusText: 'OFFLINE', barColor: '#5A6A72' };
    }

    strain = Math.round(strain);
    var pct = Math.min(100, Math.max(0, (strain / 2000) * 100));

    var statusClass = 'nominal';
    var statusText = 'SAFE (<500 µε)';
    var barColor = '#00CC44';

    if (strain >= 1500) {
      statusClass = 'critical';
      statusText = 'CRITICAL (>1500 µε)';
      barColor = '#FF2222';
    } else if (strain >= 500) {
      statusClass = 'warning';
      statusText = 'TENSION (>500 µε)';
      barColor = '#FFA500';
    }

    return { strain: strain, pct: pct, statusClass: statusClass, statusText: statusText, barColor: barColor };
  }

  function buildStrainCard(t, nd) {
    var d = calcStrainValues(t, nd);
    var isLive = (d.strain !== null);
    var valStr = isLive ? String(d.strain) : '--';
    var subStr = isLive ? (d.pct.toFixed(0) + '% rupture limit') : '--';

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">GROUND STRAIN</span>' +
               '<span id="strain-status-badge" class="glass-metric-badge ' + d.statusClass + '">' + d.statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span id="strain-val" class="glass-metric-val">' + valStr + '</span>' +
                 '<span class="glass-metric-unit">µε (ustrain)</span>' +
               '</div>' +
               '<span id="strain-sub-val" style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">' + subStr + '</span>' +
             '</div>' +
             '<div class="glass-track">' +
               '<div id="strain-bar-fill" class="glass-track-fill" style="width:' + d.pct + '%;background:' + d.barColor + ';' + (isLive ? ('box-shadow:0 0 8px ' + d.barColor + ';') : '') + '"></div>' +
             '</div>' +
             '<div class="live-chart-container" id="strain-chart-container"></div>' +
           '</div>';
  }

  function updateStrainDOM(t, nd) {
    var d = calcStrainValues(t, nd);
    var isLive = (d.strain !== null);
    var valStr = isLive ? String(d.strain) : '--';

    var strainEl = document.getElementById('strain-val');
    if (strainEl && strainEl.textContent !== valStr) {
      strainEl.textContent = valStr;
      if (isLive) triggerFlash(strainEl);
    }

    var subEl = document.getElementById('strain-sub-val');
    if (subEl) {
      subEl.textContent = isLive ? (d.pct.toFixed(0) + '% rupture limit') : '--';
    }

    var badge = document.getElementById('strain-status-badge');
    if (badge) {
      badge.className = 'glass-metric-badge ' + d.statusClass;
      badge.textContent = d.statusText;
    }

    var bar = document.getElementById('strain-bar-fill');
    if (bar) {
      bar.style.width = d.pct + '%';
      bar.style.background = d.barColor;
      bar.style.boxShadow = isLive ? ('0 0 8px ' + d.barColor) : 'none';
    }
  }

  // ---------------------------------------------------------------------
  // 3. Vibration RMS Card & DOM Updates
  // ---------------------------------------------------------------------

  function calcVibValues(t) {
    if (!t) {
      return { rms: null, valStr: '--', unit: 'mm/s PPV', pct: 0, statusClass: 'dead', statusText: 'OFFLINE' };
    }

    var isMmS = (t.vib_rms_mm_s != null);
    var rms = isMmS ? t.vib_rms_mm_s :
              (t.vib_rms != null) ? t.vib_rms :
              (t.channels && t.channels.vibration_rms != null) ? t.channels.vibration_rms : null;

    if (rms == null || !isFinite(rms)) {
      return { rms: null, valStr: '--', unit: 'mm/s PPV', pct: 0, statusClass: 'dead', statusText: 'OFFLINE' };
    }

    if (typeof rms === 'number') rms = parseFloat(rms.toFixed(2));

    var statusClass = 'nominal';
    var statusText = 'QUIET';
    var pct = 0;
    var barColor = '#00CC44';

    if (isMmS) {
      pct = Math.min(100, Math.max(0, (rms / 1.0) * 100));
      if (rms > 0.60) { statusClass = 'critical'; statusText = 'HIGH TRANSIENT'; barColor = '#FF2222'; }
      else if (rms > 0.20) { statusClass = 'warning'; statusText = 'ELEVATED'; barColor = '#FFA500'; }
    } else {
      pct = Math.min(100, Math.max(0, (rms / 40.0) * 100));
      if (rms > 25) { statusClass = 'critical'; statusText = 'HIGH TRANSIENT'; barColor = '#FF2222'; }
      else if (rms > 10) { statusClass = 'warning'; statusText = 'ELEVATED'; barColor = '#FFA500'; }
    }

    var valStr = (typeof rms === 'number') ? rms.toFixed(2) : String(rms);
    var unit = isMmS ? 'mm/s PPV' : 'RMS';
    return { rms: rms, valStr: valStr, unit: unit, pct: pct, statusClass: statusClass, statusText: statusText };
  }

  function renderEqBarsHtml(pct) {
    var numBars = 8;
    var activeBars = Math.ceil((pct / 100) * numBars);
    var eqHtml = '';
    for (var b = 0; b < numBars; b++) {
      var h = 4 + (b * 1.1);
      var segCol = '#253540';
      if (b < activeBars && pct > 0) {
        segCol = (b >= 6) ? '#FF2222' : ((b >= 4) ? '#FFA500' : '#00CC44');
      }
      eqHtml += '<div style="flex:1;height:' + h + 'px;background:' + segCol + ';border-radius:1px;"></div>';
    }
    return eqHtml;
  }

  function buildVibrationCard(t) {
    var d = calcVibValues(t);
    var eqHtml = '<div id="vib-eq-bars" style="display:flex;gap:3px;align-items:flex-end;height:12px;margin-top:4px;">' +
                   renderEqBarsHtml(d.pct) +
                 '</div>';

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">SEISMIC VIBRATION RMS</span>' +
               '<span id="vib-status-badge" class="glass-metric-badge ' + d.statusClass + '">' + d.statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span id="vib-val" class="glass-metric-val">' + d.valStr + '</span>' +
                 '<span id="vib-unit" class="glass-metric-unit">' + d.unit + '</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">3-AXIS ACCEL</span>' +
             '</div>' +
             eqHtml +
           '</div>';
  }

  function updateVibrationDOM(t) {
    var d = calcVibValues(t);
    var isLive = (d.rms !== null);

    var vibEl = document.getElementById('vib-val');
    if (vibEl && vibEl.textContent !== d.valStr) {
      vibEl.textContent = d.valStr;
      if (isLive) triggerFlash(vibEl);
    }

    var unitEl = document.getElementById('vib-unit');
    if (unitEl) unitEl.textContent = d.unit;

    var badge = document.getElementById('vib-status-badge');
    if (badge) {
      badge.className = 'glass-metric-badge ' + d.statusClass;
      badge.textContent = d.statusText;
    }

    var eqEl = document.getElementById('vib-eq-bars');
    if (eqEl) {
      eqEl.innerHTML = renderEqBarsHtml(d.pct);
    }
  }

  // ---------------------------------------------------------------------
  // 4. Core Temperature Card & DOM Updates
  // ---------------------------------------------------------------------

  function calcTempValues(t) {
    if (!t) {
      return { temp: null, valStr: '--', pct: 0, statusClass: 'dead', statusText: 'OFFLINE', barColor: '#5A6A72' };
    }

    var temp = (t.die_temp_c != null) ? t.die_temp_c :
               (t.temp_c_x10 != null) ? (t.temp_c_x10 / 10) :
               (t.temperature_c != null) ? t.temperature_c :
               (t.channels && t.channels.temperature_c != null) ? t.channels.temperature_c : null;

    if (temp == null || !isFinite(temp)) {
      return { temp: null, valStr: '--', pct: 0, statusClass: 'dead', statusText: 'OFFLINE', barColor: '#5A6A72' };
    }

    var statusClass = 'nominal';
    var statusText = 'NORMAL (20-45°C)';
    var pct = Math.min(100, Math.max(0, ((temp - 10) / 50) * 100));
    var barColor = '#00CC44';

    if (temp > 50) { statusClass = 'critical'; statusText = 'OVERHEAT'; barColor = '#FF2222'; }
    else if (temp > 40) { statusClass = 'warning'; statusText = 'WARM'; barColor = '#FFA500'; }

    var valStr = (typeof temp === 'number') ? temp.toFixed(1) : String(temp);
    return { temp: temp, valStr: valStr, pct: pct, statusClass: statusClass, statusText: statusText, barColor: barColor };
  }

  function buildTemperatureCard(t) {
    var d = calcTempValues(t);
    var isLive = (d.temp !== null);

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">CORE TEMPERATURE</span>' +
               '<span id="temp-status-badge" class="glass-metric-badge ' + d.statusClass + '">' + d.statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span id="temp-val" class="glass-metric-val">' + d.valStr + '</span>' +
                 '<span class="glass-metric-unit">°C</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">ENVELOPE 25-40°C</span>' +
             '</div>' +
             '<div class="glass-track">' +
               '<div id="temp-bar-fill" class="glass-track-fill" style="width:' + d.pct + '%;background:' + d.barColor + ';' + (isLive ? ('box-shadow:0 0 8px ' + d.barColor + ';') : '') + '"></div>' +
             '</div>' +
           '</div>';
  }

  function updateTemperatureDOM(t) {
    var d = calcTempValues(t);
    var isLive = (d.temp !== null);

    var tempEl = document.getElementById('temp-val');
    if (tempEl && tempEl.textContent !== d.valStr) {
      tempEl.textContent = d.valStr;
      if (isLive) triggerFlash(tempEl);
    }

    var badge = document.getElementById('temp-status-badge');
    if (badge) {
      badge.className = 'glass-metric-badge ' + d.statusClass;
      badge.textContent = d.statusText;
    }

    var bar = document.getElementById('temp-bar-fill');
    if (bar) {
      bar.style.width = d.pct + '%';
      bar.style.background = d.barColor;
      bar.style.boxShadow = isLive ? ('0 0 8px ' + d.barColor) : 'none';
    }
  }

  // ---------------------------------------------------------------------
  // 5. Battery & Power Card & DOM Updates
  // ---------------------------------------------------------------------

  function calcBatteryValues(t) {
    if (!t) {
      return { mv: null, pct: 0, valStr: '--', statusClass: 'dead', statusText: 'OFFLINE', barColor: '#5A6A72' };
    }

    var mv = (t.vbat_mv != null) ? t.vbat_mv :
             (t.battery_mv != null) ? t.battery_mv :
             (t.channels && t.channels.battery_voltage != null) ? Math.round(t.channels.battery_voltage * 1000) : null;

    if (mv == null || !isFinite(mv)) {
      return { mv: null, pct: 0, valStr: '--', statusClass: 'dead', statusText: 'OFFLINE', barColor: '#5A6A72' };
    }

    var pct = 0;
    var statusClass = 'nominal';
    var statusText = 'HEALTHY';
    var barColor = '#00CC44';

    if (mv >= 2800) {
      pct = Math.min(100, Math.round(((mv - 2800) / (4200 - 2800)) * 100));
      if (pct <= 20) { statusClass = 'critical'; statusText = 'CRITICAL LOW'; barColor = '#FF2222'; }
      else if (pct <= 40) { statusClass = 'warning'; statusText = 'LOW BATTERY'; barColor = '#FFA500'; }
    } else {
      statusClass = 'critical';
      statusText = 'DEPLETED';
      barColor = '#FF2222';
    }

    var valStr = mv + ' mV (' + pct + '%)';
    return { mv: mv, pct: pct, valStr: valStr, statusClass: statusClass, statusText: statusText, barColor: barColor };
  }

  function buildBatteryCard(t) {
    var d = calcBatteryValues(t);
    var isLive = (d.mv !== null);

    return '<div class="glass-card">' +
             '<div class="glass-metric-header">' +
               '<span class="glass-metric-label">BATTERY & POWER</span>' +
               '<span id="vbat-status-badge" class="glass-metric-badge ' + d.statusClass + '">' + d.statusText + '</span>' +
             '</div>' +
             '<div class="glass-metric-top">' +
               '<div>' +
                 '<span id="vbat-val" class="glass-metric-val">' + d.valStr + '</span>' +
               '</div>' +
               '<span style="font-family:monospace;font-size:10.5px;color:#7A9BAA;">LiFePO4 3.7V</span>' +
             '</div>' +
             '<div class="glass-track">' +
               '<div id="vbat-bar-fill" class="glass-track-fill" style="width:' + d.pct + '%;background:' + d.barColor + ';' + (isLive ? ('box-shadow:0 0 8px ' + d.barColor + ';') : '') + '"></div>' +
             '</div>' +
           '</div>';
  }

  function updateBatteryDOM(t) {
    var d = calcBatteryValues(t);
    var isLive = (d.mv !== null);

    var batEl = document.getElementById('vbat-val');
    if (batEl && batEl.textContent !== d.valStr) {
      batEl.textContent = d.valStr;
      if (isLive) triggerFlash(batEl);
    }

    var badge = document.getElementById('vbat-status-badge');
    if (badge) {
      badge.className = 'glass-metric-badge ' + d.statusClass;
      badge.textContent = d.statusText;
    }

    var bar = document.getElementById('vbat-bar-fill');
    if (bar) {
      bar.style.width = d.pct + '%';
      bar.style.background = d.barColor;
      bar.style.boxShadow = isLive ? ('0 0 8px ' + d.barColor) : 'none';
    }
  }

  // ---------------------------------------------------------------------
  // 6. Auxiliary Sensor Channels
  // ---------------------------------------------------------------------

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

  // ---------------------------------------------------------------------
  // 7. Diagnostic Flags & DOM Updates
  // ---------------------------------------------------------------------

  function renderFlagItemsHtml(flags) {
    var items = [
      { label: 'LAST GASP', bit: 0 },
      { label: 'SELF-TEST FAIL', bit: 1 },
      { label: 'BLAST WINDOW', bit: 2 },
      { label: 'LOW BATTERY', bit: 3 }
    ];

    var html = '';
    for (var i = 0; i < items.length; i++) {
      var set = (flags >> items[i].bit) & 1;
      html += '<div class="flag-item">' +
                '<div class="flag-rect ' + (set ? 'flagged' : 'clear') + '"></div>' +
                '<span class="mono" style="font-size:9.5px;color:' + (set ? '#FF4400' : '#8AA0AC') + ';">' + items[i].label + '</span>' +
              '</div>';
    }
    return html;
  }

  function buildFlagsCard(t) {
    var flags = t ? (t.flags || 0) : 0;
    return '<div class="glass-card">' +
             '<div class="glass-metric-label" style="margin-bottom:6px;">HARDWARE STATUS FLAGS</div>' +
             '<div id="flags-row-container" class="flag-row">' +
               renderFlagItemsHtml(flags) +
             '</div>' +
           '</div>';
  }

  function updateFlagsDOM(t) {
    var el = document.getElementById('flags-row-container');
    if (el) {
      el.innerHTML = renderFlagItemsHtml(t ? (t.flags || 0) : 0);
    }
  }

  return {
    render: render,
    update: update,
    getCachedTelemetry: function (nodeId) {
      return nodeTelemetryCache[nodeId] || null;
    }
  };
})();
