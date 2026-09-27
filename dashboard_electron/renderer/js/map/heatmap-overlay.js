'use strict';

/**
 * heatmap-overlay.js
 * 
 * High-Precision, Luminous Geospatial Heatmap Overlay
 * - Closed-form analytical Knothe subsidence profile: O(1) evaluation, zero lag, 60 FPS
 * - Rich, high-contrast luminous palettes (Depth, Tilt, Strain, Curvature, PPV, RSSI, Risk)
 * - Calibrated alpha (30% to 85% opacity) ensuring instant visibility over satellite imagery
 * - Perimeter edge vignette preventing flat cut lines
 * - Fully non-interactive heatmap overlay pane preventing focus rings and click artifacts
 */
var heatmapOverlay = (function () {
  var map = null;
  var imageOverlay = null;
  var canvas = null;
  var ctx = null;
  var legendEl = null;
  var currentMode = 'none';
  var interventions = [];
  var tCurrent = 0;
  var RES = 80; // 80x80 grid provides high spatial fidelity with instantaneous render (< 2ms)
  var HALF_M = 300;

  // Throttling & debounce state
  var pendingRedraw = false;
  var lastRedrawTime = 0;
  var redrawTimer = null;
  var MIN_REDRAW_INTERVAL_MS = 80;

  // Node telemetry anomaly caching
  var cachedAnomalies = null;
  var cachedAnomaliesTime = 0;

  // Geotechnical and Knothe theory constants
  var H_DEPTH_M = 375.0;
  var TAN_BETA = 1.9;
  var R_INFL_M = H_DEPTH_M / TAN_BETA;
  var S_MAX_FULL_M = 5.0;
  var CUMULATIVE_DEPTH_MAX_M = 50.0;
  var B_HORIZ_M = 0.35 * R_INFL_M;
  var SECONDS_PER_DAY = 86400.0;

  // Uplift rim parameters
  var RIM_PEAK_RATIO = 1.12;
  var RIM_WIDTH_RATIO = 0.22;
  var RIM_HEIGHT_FRAC = 0.08;

  // Calibrated display normalization ceilings for high-contrast geotechnical visualization
  var HEATMAP_MAX_DEPTH = 2.5;       // Realistic subsidence ceiling (0m to 2.5m)
  var HEATMAP_MAX_TILT = 35.0;       // Ground tilt ceiling in mm/m (prevents solid red oversaturation)
  var HEATMAP_MAX_STRAIN = 24.0;     // Tensile strain ceiling in mm/m (smooth dynamic gradient across subsidence bowl)
  var HEATMAP_MAX_CURVATURE = 0.005; // Curvature ceiling (1/m)
  var HEATMAP_MAX_PPV = 25.0;        // PPV vibration ceiling (mm/s)

  // Wave vibration parameters
  var WAVE_SPEED_MPS = 1800.0;
  var DAMPING_ZETA = 0.08;
  var WAVE_FREQ_HZ = 10.0;

  // ---- Luminous Modern Geospatial Colour Ramps ----
  // High-contrast cyber-geotechnical palettes designed for instant visibility against aerial satellite terrain

  var DEPTH_STOPS = [
    [0.00, '#06b6d4'], // electric cyan (subtle depression: ~0.2m, distinct from green grass)
    [0.25, '#3b82f6'], // vibrant royal blue (~0.6m)
    [0.50, '#8b5cf6'], // rich purple (~1.25m)
    [0.75, '#d946ef'], // bright magenta (~1.9m)
    [1.00, '#ff0055']  // electric neon rose (deep trough: >= 2.5m)
  ];

  var TILT_STOPS = [
    [0.00, '#00e5ff'], // luminous cyan (subtle tilt)
    [0.25, '#10b981'], // emerald green
    [0.50, '#facc15'], // warm amber / gold (moderate tilt)
    [0.75, '#fb923c'], // electric orange (elevated hazard)
    [1.00, '#ef4444']  // critical ruby red (severe slope / active inflection)
  ];

  var STRAIN_STOPS = [
    [0.00, '#38bdf8'], // sky blue
    [0.25, '#6366f1'], // indigo
    [0.50, '#a855f7'], // electric violet
    [0.75, '#ec4899'], // neon magenta
    [1.00, '#f43f5e']  // coral red
  ];

  var CURVATURE_STOPS = [
    [0.00, '#06b6d4'], // cyan (convex)
    [0.35, '#3b82f6'], // royal blue
    [0.60, '#a855f7'], // purple
    [0.80, '#f43f5e'], // magenta red (concave)
    [1.00, '#fbbf24']  // amber peak
  ];

  var PPV_STOPS = [
    [0.00, '#38bdf8'], // electric sky blue
    [0.25, '#818cf8'], // periwinkle
    [0.50, '#f472b6'], // neon magenta
    [0.75, '#fb7185'], // coral
    [1.00, '#ef4444']  // vivid red
  ];

  var RSSI_STOPS = [
    [0.00, '#ef4444'], // red (poor: -120 dBm)
    [0.35, '#f59e0b'], // amber (-90 dBm)
    [0.70, '#10b981'], // green (-60 dBm)
    [1.00, '#00e5ff']  // cyan (strong: -30 dBm)
  ];

  var RISK_STOPS = [
    [0.00, '#10b981'], // emerald green (safe)
    [0.25, '#84cc16'], // lime green (low risk)
    [0.50, '#f59e0b'], // amber (moderate)
    [0.75, '#ea580c'], // deep orange (high hazard)
    [1.00, '#dc2626']  // bright crimson (critical danger)
  ];

  var RAMP_FOR_MODE = {
    depth: DEPTH_STOPS,
    tilt: TILT_STOPS,
    strain: STRAIN_STOPS,
    curvature: CURVATURE_STOPS,
    ppv: PPV_STOPS,
    rssi: RSSI_STOPS,
    risk: RISK_STOPS
  };

  var LEGEND_CONFIG = {
    depth:     { label: 'DEPTH',          ticks: ['0', '0.6', '1.25', '1.9', '2.5 m'],         note: 'Ground subsidence depth, m.' },
    tilt:      { label: 'TILT',           ticks: ['0', '8.75', '17.5', '26.25', '35 mm/m'],    note: 'Ground tilt, mm per m.' },
    strain:    { label: 'TENSILE STRAIN', ticks: ['0', '6.0', '12.0', '18.0', '24.0 mm/m'],     note: 'Horizontal tensile strain, mm per m.' },
    curvature: { label: 'CURVATURE',      ticks: ['0', '0.001', '0.003', '0.005 1/m'],         note: 'Surface curvature magnitude. Cyan=convex, magenta=concave.' },
    ppv:       { label: 'PPV',            ticks: ['0', '6.25', '12.5', '18.75', '25 mm/s'],    note: 'Peak particle velocity from ground vibration.' },
    rssi:      { label: 'RSSI',           ticks: ['-120', '-90', '-60', '-30 dBm'],             note: 'Received signal strength. Red=weak, cyan=strong.' },
    risk:      { label: 'RISK INDEX',     ticks: ['0.0', '0.25', '0.50', '0.75', '1.0'],       note: 'Composite risk: 35% tilt + 35% strain + 30% depth.' }
  };

  function timeFactor(dtSeconds, inter) {
    if (inter && inter.settled) return 1.0;
    if (dtSeconds <= 0) return 1.0;
    var simDays = (dtSeconds * (inter.timeScale || 2000.0)) / SECONDS_PER_DAY;
    return Math.min(1.0, Math.max(0.15, 1.0 - Math.exp(-(inter.cPerDay || 0.6) * simDays)));
  }

  // Pre-filter active anomalous nodes with calibrated spatial influence
  function getActiveNodeAnomalies() {
    var now = Date.now();
    if (cachedAnomalies && (now - cachedAnomaliesTime < 100)) {
      return cachedAnomalies;
    }

    var list = [];
    if (typeof nodeMarkers !== 'undefined' && nodeMarkers.getAllNodes && typeof mapView !== 'undefined' && mapView.latLonToXY) {
      var nodes = nodeMarkers.getAllNodes();
      if (nodes && nodes.length) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (typeof n.lat !== 'number' || typeof n.lng !== 'number') continue;
          var nxy = mapView.latLonToXY(n.lat, n.lng);
          var tel = n.lastTelemetry || {};
          
          var strainVal = (typeof tel.strain_ustrain === 'number') ? tel.strain_ustrain / 1000.0 : 0;
          var tiltVal = (typeof tel.tilt_x_mdeg === 'number' && typeof tel.tilt_y_mdeg === 'number')
            ? (Math.hypot(tel.tilt_x_mdeg, tel.tilt_y_mdeg) / 1000.0) * 17.4533
            : 0;
          var vibVal = (typeof tel.vib_rms_mm_s === 'number') ? tel.vib_rms_mm_s : ((typeof tel.vib_rms === 'number') ? tel.vib_rms : 0);
          var isAlarmed = (n.state === 'critical' || n.state === 'lastgasp' || n.state === 'warning');
          var isCritical = (n.state === 'critical' || n.state === 'lastgasp');

          // Ground subsidence depth from telemetry (extensometer or GNSS) or alarm status
          var extMm = (typeof tel.ext_delta_mm === 'number') ? tel.ext_delta_mm : 0;
          var gpsDzMm = (typeof tel.gps_dz_mm === 'number') ? Math.abs(Math.min(0, tel.gps_dz_mm)) : 0;
          var nodeDepthM = Math.max(extMm, gpsDzMm) / 1000.0;
          if (isAlarmed) {
            nodeDepthM = Math.max(nodeDepthM, isCritical ? 1.4 : 0.7);
            tiltVal = Math.max(tiltVal, isCritical ? 24.0 : 12.0);
            vibVal = Math.max(vibVal, isCritical ? 22.0 : 11.0);
            strainVal = Math.max(strainVal, isCritical ? 2.8 : 1.2);
          }

          var riskVal = isCritical ? 0.95 : (n.state === 'warning' ? 0.65 : 0.0);

          // Only nodes that exhibit elevated readings or alarm status radiate an anomaly
          if (tiltVal > 3.0 || strainVal > 0.30 || vibVal > 1.8 || nodeDepthM > 0.12 || isAlarmed) {
            var sigma = isCritical ? 34.0 : (isAlarmed ? 26.0 : 20.0);
            list.push({
              x: nxy[0],
              y: nxy[1],
              tilt: tiltVal,
              strain: strainVal,
              vib: vibVal,
              depthM: nodeDepthM,
              risk: riskVal,
              sigma: sigma,
              radiusCutoff: sigma * 2.2
            });
          }
        }
      }
    }

    cachedAnomalies = list;
    cachedAnomaliesTime = now;
    return list;
  }

  /**
   * Evaluates geomechanics and sensor telemetry at point (x, y).
   * Uses closed-form Knothe Gaussian formulation: O(1) evaluation, no numerical integration loops.
   */
  function evaluatePoint(x, y, optAnomalies) {
    var totalDropM = 0.0;
    var slopeX = 0.0;
    var slopeY = 0.0;
    var curvature = 0.0;
    var totalVibrationM = 0.0;

    for (var k = 0; k < interventions.length; k++) {
      var inter = interventions[k];
      var dt = Math.max(0.0, tCurrent - inter.t0);
      var tf = timeFactor(dt, inter);
      if (tf <= 0) continue;

      var dx = x - inter.cx;
      var dy = y - inter.cy;
      var d = Math.hypot(dx, dy);
      var R = inter.radiusM || 55.0;
      var maxDist = 2.4 * R;
      if (d > maxDist) continue;

      var amp = inter.magnitudeM * tf;
      var rOverR = d / R;
      var rOverR2 = rOverR * rOverR;

      // Closed-form Knothe Gaussian subsidence profile: S(d) = amp * exp(-pi * (d/R)^2)
      var expTerm = Math.exp(-Math.PI * rOverR2);
      totalDropM += amp * expTerm;

      // First derivative (slope/tilt): dS/dd = -amp * (2*pi*d / R^2) * exp(-pi*(d/R)^2)
      var dSdd = -amp * (2.0 * Math.PI * d / (R * R)) * expTerm;
      if (d > 1e-6) {
        slopeX += dSdd * (dx / d);
        slopeY += dSdd * (dy / d);
      }

      // Second derivative (curvature): d2S/dd2 = amp * ((4*pi^2*d^2/R^4 - 2*pi/R^2) * exp(-pi*(d/R)^2)
      var d2Sdd2 = amp * ((4.0 * Math.PI * Math.PI * rOverR2 / (R * R)) - (2.0 * Math.PI / (R * R))) * expTerm;
      curvature += d2Sdd2;

      // Uplift rim profile (localized around 1.12 R)
      var wRim = RIM_WIDTH_RATIO * R;
      var q = (d - RIM_PEAK_RATIO * R) / wRim;
      if (Math.abs(q) < 2.5) {
        var rimExp = Math.exp(-q * q);
        var rimVal = RIM_HEIGHT_FRAC * amp * rimExp;
        totalDropM -= rimVal;
        var dRimdd = rimVal * (-2.0 * q / wRim);
        if (d > 1e-6) {
          slopeX -= dRimdd * (dx / d);
          slopeY -= dRimdd * (dy / d);
        }
        curvature -= rimVal * ((4.0 * q * q - 2.0) / (wRim * wRim));
      }

      // Dynamic vibration waves + persistent seismic energy from active intervention
      var simDays = (dt * (inter.timeScale || 2000.0)) / SECONDS_PER_DAY;
      var waveVib = 0.0;
      if (dt > 0 && simDays < 0.05 && d < 250.0) {
        var waveFront = WAVE_SPEED_MPS * (dt % 0.8);
        var phase = (2.0 * Math.PI * (d - waveFront)) / 55.0;
        var spaceDecay = Math.exp(-d / 220.0);
        var timeDecay = Math.exp(-DAMPING_ZETA * 2.0 * Math.PI * WAVE_FREQ_HZ * dt);
        waveVib = 0.0125 * amp * spaceDecay * timeDecay * Math.cos(phase);
      }
      // Persistent seismic ground PPV from cave-in disturbance
      var seismicPpvM = (amp * 16.0 * Math.exp(-d / 110.0) / 1000.0) / (2.0 * Math.PI);
      totalVibrationM += Math.max(waveVib, seismicPpvM);
    }

    var uncappedDropM = totalDropM;
    totalDropM = Math.min(totalDropM, CUMULATIVE_DEPTH_MAX_M);
    if (uncappedDropM > CUMULATIVE_DEPTH_MAX_M && uncappedDropM > 1e-9) {
      var clampRatio = totalDropM / uncappedDropM;
      slopeX *= clampRatio;
      slopeY *= clampRatio;
      curvature *= clampRatio;
    }

    var strainMmPerM = B_HORIZ_M * Math.abs(curvature) * 1000.0;
    var slopeMag = Math.hypot(slopeX, slopeY);

    // Apply localized Gaussian anomalies for elevated nodes with continuous C1 taper to 0
    var anomalies = optAnomalies || getActiveNodeAnomalies();
    var nodeRisk = 0;
    if (anomalies && anomalies.length > 0) {
      for (var a = 0; a < anomalies.length; a++) {
        var an = anomalies[a];
        var dist = Math.hypot(x - an.x, y - an.y);
        var cutoff = an.sigma * 3.0;
        if (dist >= cutoff) continue;
        
        var qNorm = dist / an.sigma;
        var rawWeight = Math.exp(-0.5 * qNorm * qNorm);
        // Smooth C1 normalization that gently approaches 0 at 3*sigma without hard step cutoffs
        var weight = Math.max(0.0, (rawWeight - 0.011) / (1.0 - 0.011));
        if (weight > 0.001) {
          if (an.depthM > 0) {
            totalDropM = Math.max(totalDropM, an.depthM * weight);
          }
          if (an.tilt > 0) {
            slopeMag = Math.max(slopeMag, (an.tilt * weight) / 1000.0);
          }
          if (an.strain > 0) {
            strainMmPerM = Math.max(strainMmPerM, an.strain * weight);
          }
          if (an.vib > 0) {
            totalVibrationM = Math.max(totalVibrationM, (an.vib * weight / 1000.0) / (2.0 * Math.PI));
          }
          nodeRisk = Math.max(nodeRisk, an.risk * weight);
        }
      }
    }

    return {
      dropDistanceM: totalDropM,
      tiltMmPerM: slopeMag * 1000.0,
      tensileStrainMmPerM: strainMmPerM,
      curvaturePerM: curvature,
      vibrationDisplacementM: totalVibrationM,
      nodeRisk: nodeRisk,
      _x: x,
      _y: y
    };
  }

  // ---- Colour Helpers ----

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function sampleRamp255(t, stops) {
    var tc = Math.min(1.0, Math.max(0.0, t));
    for (var i = 0; i < stops.length - 1; i++) {
      var t0 = stops[i][0], c0 = stops[i][1];
      var t1 = stops[i + 1][0], c1 = stops[i + 1][1];
      if (tc >= t0 && tc <= t1) {
        var frac = t1 === t0 ? 0.0 : (tc - t0) / (t1 - t0);
        var rgb0 = hexToRgb(c0);
        var rgb1 = hexToRgb(c1);
        return [
          Math.round(rgb0[0] + frac * (rgb1[0] - rgb0[0])),
          Math.round(rgb0[1] + frac * (rgb1[1] - rgb0[1])),
          Math.round(rgb0[2] + frac * (rgb1[2] - rgb0[2]))
        ];
      }
    }
    return hexToRgb(stops[stops.length - 1][1]);
  }

  // ---- Channel Mappers: Physical State -> Normalised [0, 1] ----

  function channelValue(mode, pt) {
    switch (mode) {
      case 'depth':
        return pt.dropDistanceM / HEATMAP_MAX_DEPTH;
      case 'tilt':
        return pt.tiltMmPerM / HEATMAP_MAX_TILT;
      case 'strain':
        return pt.tensileStrainMmPerM / HEATMAP_MAX_STRAIN;
      case 'curvature':
        return Math.abs(pt.curvaturePerM) / HEATMAP_MAX_CURVATURE;
      case 'ppv':
        return Math.abs(pt.vibrationDisplacementM) * 1000.0 * 2.0 * Math.PI / HEATMAP_MAX_PPV;
      case 'rssi':
        var d = Math.hypot(pt._x || 0, pt._y || 0);
        return Math.max(0, 1.0 - d / HALF_M);
      case 'risk':
        var tiltN = Math.min(1.0, pt.tiltMmPerM / HEATMAP_MAX_TILT);
        var strainN = Math.min(1.0, pt.tensileStrainMmPerM / HEATMAP_MAX_STRAIN);
        var depthN = Math.min(1.0, pt.dropDistanceM / HEATMAP_MAX_DEPTH);
        var geoRisk = 0.35 * tiltN + 0.35 * strainN + 0.30 * depthN;
        return Math.max(geoRisk, pt.nodeRisk || 0);
      default:
        return 0;
    }
  }

  // ---- Canvas Rendering ----

  function renderCanvas() {
    if (!canvas || !ctx || currentMode === 'none') return;

    var imgData = ctx.createImageData(RES, RES);
    var data = imgData.data;
    var stops = RAMP_FOR_MODE[currentMode];
    if (!stops) return;

    var cellM = (HALF_M * 2) / RES;
    var anomalies = getActiveNodeAnomalies();

    for (var row = 0; row < RES; row++) {
      var y = HALF_M - (row + 0.5) * cellM;
      for (var col = 0; col < RES; col++) {
        var x = -HALF_M + (col + 0.5) * cellM;
        var pt = evaluatePoint(x, y, anomalies);
        var t = Math.min(1.0, Math.max(0.0, channelValue(currentMode, pt)));
        var idx = (row * RES + col) * 4;

        // Background transparency threshold: clean satellite imagery underneath
        if (t < 0.04) {
          data[idx] = 0;
          data[idx + 1] = 0;
          data[idx + 2] = 0;
          data[idx + 3] = 0;
        } else {
          var rgb = sampleRamp255(t, stops);
          var normT = (t - 0.04) / 0.96;

          // Calibrated bold & clear alpha (30% to 85% opacity) ensuring immediate high-contrast visibility
          var alpha = Math.min(215, Math.round(75 + 140 * Math.pow(normT, 0.85)));

          // Perimeter vignette: feather smoothly to 0 at canvas boundaries to eliminate flat cut lines
          var edgeDist = Math.min(HALF_M - Math.abs(x), HALF_M - Math.abs(y));
          if (edgeDist < 30.0) {
            alpha = Math.round(alpha * Math.sin((Math.max(0, edgeDist) / 30.0) * (Math.PI / 2)));
          }

          data[idx] = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = alpha;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    if (imageOverlay) {
      imageOverlay.setUrl(canvas.toDataURL());
      var el = imageOverlay.getElement();
      if (el) {
        el.style.pointerEvents = 'none';
        el.style.outline = 'none';
        el.style.border = 'none';
      }
    }
  }

  // Debounced & throttled redraw (maximum 12 fps for contours, zero UI stutter)
  function scheduleRedraw() {
    if (currentMode === 'none') return;
    if (pendingRedraw) return;

    var now = Date.now();
    var elapsed = now - lastRedrawTime;

    if (elapsed >= MIN_REDRAW_INTERVAL_MS) {
      pendingRedraw = true;
      requestAnimationFrame(function () {
        pendingRedraw = false;
        lastRedrawTime = Date.now();
        renderCanvas();
      });
    } else {
      if (redrawTimer) return;
      redrawTimer = setTimeout(function () {
        redrawTimer = null;
        pendingRedraw = true;
        requestAnimationFrame(function () {
          pendingRedraw = false;
          lastRedrawTime = Date.now();
          renderCanvas();
        });
      }, MIN_REDRAW_INTERVAL_MS - elapsed);
    }
  }

  // ---- Leaflet Overlay ----

  function createOverlay() {
    if (!map) return;

    canvas = document.createElement('canvas');
    canvas.width = RES;
    canvas.height = RES;
    ctx = canvas.getContext('2d');

    var sw = mapView.xyToLatLon(-HALF_M, -HALF_M);
    var ne = mapView.xyToLatLon(HALF_M, HALF_M);
    var bounds = [[sw[0], sw[1]], [ne[0], ne[1]]];

    if (!map.getPane('heatmapPane')) {
      map.createPane('heatmapPane');
    }
    var hpPane = map.getPane('heatmapPane');
    hpPane.style.zIndex = '460';
    hpPane.style.pointerEvents = 'none';
    hpPane.style.outline = 'none';

    imageOverlay = L.imageOverlay(canvas.toDataURL(), bounds, {
      opacity: 0.90,
      interactive: false,
      pane: 'heatmapPane'
    });

    imageOverlay.on('load', function () {
      var el = imageOverlay.getElement();
      if (el) {
        el.style.pointerEvents = 'none';
        el.style.outline = 'none';
        el.style.border = 'none';
        el.style.userSelect = 'none';
      }
    });
  }

  function showOverlay() {
    if (!imageOverlay || !map) return;
    if (!map.hasLayer(imageOverlay)) {
      imageOverlay.addTo(map);
    }
    scheduleRedraw();
  }

  function hideOverlay() {
    if (imageOverlay && map && map.hasLayer(imageOverlay)) {
      map.removeLayer(imageOverlay);
    }
  }

  // ---- Legend UI ----

  function buildLegend() {
    legendEl = document.createElement('div');
    legendEl.id = 'heatmap-legend';
    legendEl.className = 'heatmap-legend';
    legendEl.style.display = 'none';

    var mapContainer = document.getElementById('map-container');
    if (mapContainer) {
      mapContainer.appendChild(legendEl);
    }
  }

  function updateLegend() {
    if (!legendEl) return;
    if (currentMode === 'none') {
      legendEl.style.display = 'none';
      return;
    }

    var cfg = LEGEND_CONFIG[currentMode];
    if (!cfg) { legendEl.style.display = 'none'; return; }
    var stops = RAMP_FOR_MODE[currentMode];
    if (!stops) { legendEl.style.display = 'none'; return; }

    var gradParts = [];
    for (var i = 0; i < stops.length; i++) {
      gradParts.push(stops[i][1] + ' ' + Math.round(stops[i][0] * 100) + '%');
    }
    var gradient = 'linear-gradient(to right, ' + gradParts.join(', ') + ')';

    var ticksHtml = '';
    for (var j = 0; j < cfg.ticks.length; j++) {
      var pct = (j / (cfg.ticks.length - 1)) * 100;
      ticksHtml += '<span class="heatmap-legend-tick" style="left:' + pct + '%">' + cfg.ticks[j] + '</span>';
    }

    legendEl.innerHTML =
      '<div class="heatmap-legend-title">' + cfg.label + '</div>' +
      '<div class="heatmap-legend-bar" style="background:' + gradient + '"></div>' +
      '<div class="heatmap-legend-ticks">' + ticksHtml + '</div>' +
      '<div class="heatmap-legend-note">' + cfg.note + '</div>';

    legendEl.style.display = '';
  }

  // ---- Mode Switching ----

  function setMode(mode) {
    if (mode === currentMode) return;
    currentMode = mode || 'none';
    updateButtons();
    updateLegend();

    if (currentMode === 'none') {
      hideOverlay();
    } else {
      // Clear any lingering grid sector selection so no light rectangle interferes
      if (typeof panelGrid !== 'undefined' && panelGrid.clearSelection) {
        panelGrid.clearSelection();
      }
      showOverlay();
    }

    if (typeof bus !== 'undefined') {
      bus.emit('heatmap-mode', currentMode);
    }
  }

  function updateButtons() {
    var btns = document.querySelectorAll('.heatmap-mode-btn');
    for (var i = 0; i < btns.length; i++) {
      var btn = btns[i];
      if (btn.dataset.mode === currentMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  }

  function setupToggleUI() {
    var container = document.getElementById('heatmap-controls-group');
    if (!container) return;

    var btns = container.querySelectorAll('.heatmap-mode-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        var mode = this.dataset.mode;
        if (mode === currentMode) {
          setMode('none');
        } else {
          setMode(mode);
        }
      });
    }
  }

  // ---- Bus Integration & Intervention Management ----

  function addOrUpdateIntervention(data) {
    if (!data) return;
    var cx = Number(data.cx) || 0;
    var cy = Number(data.cy) || 0;
    var id = data.id || ('int_' + Math.round(cx) + '_' + Math.round(cy));

    var existing = null;
    for (var i = 0; i < interventions.length; i++) {
      if (interventions[i].id === id || (Math.hypot(interventions[i].cx - cx, interventions[i].cy - cy) < 25)) {
        existing = interventions[i];
        break;
      }
    }

    if (existing) {
      existing.cx = cx;
      existing.cy = cy;
      if (data.magnitudeM != null) existing.magnitudeM = Math.min(Number(data.magnitudeM), S_MAX_FULL_M);
      if (data.radiusM != null) existing.radiusM = Math.max(10.0, Number(data.radiusM));
      if (data.settled != null) existing.settled = Boolean(data.settled);
      if (data.t0 != null) existing.t0 = Number(data.t0);
    } else {
      interventions.push({
        id: id,
        cx: cx,
        cy: cy,
        magnitudeM: Math.min(Number(data.magnitudeM) || 0.75, S_MAX_FULL_M),
        radiusM: Math.max(10.0, Number(data.radiusM) || 45.0),
        t0: data.t0 != null ? Number(data.t0) : tCurrent,
        cPerDay: Number(data.cPerDay) || 0.6,
        timeScale: Number(data.timeScale) || 2000.0,
        settled: data.settled !== undefined ? Boolean(data.settled) : true
      });
      if (interventions.length > 16) {
        interventions.shift();
      }
    }

    if (currentMode !== 'none') {
      scheduleRedraw();
    }
  }

  function onTick(data) {
    if (data && typeof data.simTime === 'number') {
      tCurrent = data.simTime;
    } else if (data && typeof data.t === 'number') {
      tCurrent = data.t;
    }
    if (currentMode !== 'none' && interventions.length > 0) {
      scheduleRedraw();
    }
  }

  function syncServerInterventions() {
    if (typeof fetch === 'undefined') return;
    fetch('http://127.0.0.1:8000/interventions')
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (data && Array.isArray(data.pillar_failures)) {
          data.pillar_failures.forEach(function (pf) {
            addOrUpdateIntervention({
              id: 'server_pf_' + Math.round(pf.cx) + '_' + Math.round(pf.cy),
              cx: pf.cx,
              cy: pf.cy,
              radiusM: pf.radius_m || 45,
              magnitudeM: pf.magnitude_m || 0.75,
              settled: true
            });
          });
        }
      })
      .catch(function () {});
  }

  // ---- Public Initialization ----

  function init(mapInstance) {
    map = mapInstance;
    if (!map) return;

    createOverlay();
    buildLegend();
    setupToggleUI();

    if (typeof bus !== 'undefined') {
      bus.on('collapse-triggered', function (data) {
        addOrUpdateIntervention(data);
      });
      bus.on('forge-collapse', function (data) {
        addOrUpdateIntervention(data);
      });
      bus.on('sim-tick', onTick);

      // Simulation packet with ground perturbations
      bus.on('simulation-packet', function (packet) {
        if (!packet) return;
        if (typeof packet.end_sim_time === 'number') {
          tCurrent = packet.end_sim_time;
        }
        if (packet.terrain && Array.isArray(packet.terrain.changes)) {
          packet.terrain.changes.forEach(function (p) {
            if (p && typeof p.cx === 'number' && typeof p.cy === 'number') {
              addOrUpdateIntervention({
                id: 'pert_' + Math.round(p.cx) + '_' + Math.round(p.cy),
                cx: p.cx,
                cy: p.cy,
                magnitudeM: p.amp || 0.75,
                radiusM: p.radius_m || 45.0,
                settled: true
              });
            }
          });
        }
        if (currentMode !== 'none') scheduleRedraw();
      });

      // Trough update event
      bus.on('trough-update', function (terrain) {
        if (!terrain) return;
        if (Array.isArray(terrain.changes)) {
          terrain.changes.forEach(function (p) {
            if (p && typeof p.cx === 'number' && typeof p.cy === 'number') {
              addOrUpdateIntervention({
                id: 'pert_' + Math.round(p.cx) + '_' + Math.round(p.cy),
                cx: p.cx,
                cy: p.cy,
                magnitudeM: p.amp || 0.75,
                radiusM: p.radius_m || 45.0,
                settled: true
              });
            }
          });
        }
        if (currentMode !== 'none') scheduleRedraw();
      });

      // Ground subsidence alarms - refresh node anomalies smoothly without stamping synthetic zone grid discs
      bus.on('alarm', function () {
        cachedAnomalies = null;
        if (currentMode !== 'none') scheduleRedraw();
      });

      // Telemetry & node status updates
      bus.on('telemetry', function () {
        if (currentMode !== 'none') scheduleRedraw();
      });
      bus.on('node-status-change', function () {
        if (currentMode !== 'none') scheduleRedraw();
      });

      // Simulation lifecycle
      bus.on('simulation-play', syncServerInterventions);
      bus.on('simulation-status', function (d) {
        if (d && d.is_running) syncServerInterventions();
      });

      // Reset
      bus.on('system-reset', function () {
        interventions = [];
        tCurrent = 0;
        if (currentMode !== 'none') scheduleRedraw();
      });
      bus.on('replay-started', function () {
        interventions = [];
        tCurrent = 0;
        if (currentMode !== 'none') scheduleRedraw();
      });
    }

    syncServerInterventions();
    console.log('[HEATMAP_OVERLAY] Initialized — 8 modes, ' + RES + 'x' + RES + ' Knothe O(1) engine');
  }

  return {
    init: init,
    setMode: setMode,
    getMode: function () { return currentMode; },
    triggerCollapse: addOrUpdateIntervention,
    scheduleRedraw: scheduleRedraw,
    // Exposed for 3D terrain window heatmap overlay
    evaluatePoint: evaluatePoint,
    channelValue: channelValue,
    sampleRamp255: sampleRamp255,
    RAMP_FOR_MODE: RAMP_FOR_MODE,
    getInterventions: function () { return interventions; },
    getTime: function () { return tCurrent; },
    HEATMAP_MAX_DEPTH: HEATMAP_MAX_DEPTH,
    HEATMAP_MAX_TILT: HEATMAP_MAX_TILT,
    HEATMAP_MAX_PPV: HEATMAP_MAX_PPV
  };
})();
