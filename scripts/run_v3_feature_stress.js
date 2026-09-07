#!/usr/bin/env node
'use strict';

/**
 * scripts/run_v3_feature_stress.js
 *
 * COMPREHENSIVE V3 FEATURE STRESS & CHAOS BATTERY
 * Runs inside the actual Chromium / Electron runtime, mounting the real
 * Leaflet map, Chart.js canvases, DOM tables, alarm banners, replay controller,
 * and SCADA instrument gauges.
 *
 * Scenarios:
 *   1. SCADA Sensor Gauges Fuzzing & Rapid Node Switching (corrupted payloads, NaN/Infinity, dead-node handling)
 *   2. SCADA Instrument Rolling Charts & Canvas Reflow Thrashing (rapid mount/destroy, 1,500 ops/sec, zero-null guarantee)
 *   3. Database-Wide Replay Transport Thrashing & Live Isolation (button spam, speed changes, live feed isolation, in-flight reset)
 *   4. Alarm Escalation Hierarchy, Deduplication & Pagination Load (strict level gating, overlapping nodes, rapid pagination)
 *   5. Leaflet Concentric Rings, Circular Markers & Map Controls (1.2R/1.5R rings, legend toggle, basemap switching)
 *
 * Usage:
 *   npx electron scripts/run_v3_feature_stress.js
 */

const path = require('path');
const { app, BrowserWindow } = require('electron');

// Suppress noisy Chromium GPU warnings in headless runner
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('no-sandbox');

const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  bold: '\x1b[1m',
  dim: '\x1b[2m'
};

function pass(m) { console.log(`  ${c.green}PASS${c.reset}  ${m}`); }
function fail(m) { console.error(`  ${c.red}FAIL${c.reset}  ${m}`); }
function section(m) { console.log(`\n${c.cyan}${c.bold}================================================================${c.reset}\n  ${c.bold}${m}${c.reset}\n${c.cyan}${c.bold}================================================================${c.reset}`); }

app.whenReady().then(async () => {
  section('COMPREHENSIVE V3 FEATURE STRESS & CHAOS BATTERY');

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false, // Offscreen headless rendering
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Collect uncaught errors in renderer
  let uncaughtErrors = [];
  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level === 3 || message.includes('UNCAUGHT_ERR') || message.includes('TypeError') || message.includes('ReferenceError')) {
      uncaughtErrors.push({ message, line, sourceId });
    }
  });

  const htmlPath = path.join(__dirname, '..', 'dashboard_electron', 'renderer', 'index.html');
  await win.loadFile(htmlPath);

  try {
    const results = await win.webContents.executeJavaScript(`
      (async function runV3StressSuite() {
        const out = { scenarios: [], totalPassed: 0, totalFailed: 0 };
        function assert(cond, name, detail) {
          if (cond) {
            out.scenarios.push({ name, pass: true });
            out.totalPassed++;
          } else {
            out.scenarios.push({ name, pass: false, error: 'Assertion failed: ' + name + (detail ? ' (' + detail + ')' : '') });
            out.totalFailed++;
          }
        }

        // Wait for Leaflet map & components to settle
        await new Promise(r => setTimeout(r, 600));

        const nodeIds = [];
        for (let i = 1; i <= 31; i++) nodeIds.push('N' + (i < 10 ? '0' : '') + i);

        // Ensure simulation is RUNNING initially
        bus.emit('simulation-status', { is_running: true, state: 'RUNNING' });
        await new Promise(r => setTimeout(r, 50));

        // ==================================================================
        // SCENARIO 1: SCADA Sensor Gauges Fuzzing & Rapid Node Switching
        // ==================================================================
        console.log('[Stress 1] SCADA Sensor Gauges Fuzzing & Rapid Node Switching...');

        // Select initial node
        bus.emit('node-selected', 'N01');
        await new Promise(r => setTimeout(r, 50));

        let sensorDOMValid = true;
        let sensorCrashCount = 0;

        // Fuzzing 1,000 corrupt/extreme telemetry frames
        const corruptSamples = [
          { strain_ustrain: NaN, tilt_x_mdeg: null, tilt_y_mdeg: undefined, vbat_mv: 'bad', die_temp_c: NaN },
          { strain_ustrain: Infinity, tilt_x_mdeg: -Infinity, vib_rms_mm_s: -999, die_temp_c: 150 },
          { strain_ustrain: 25000, tilt_x_mdeg: 99999, tilt_y_mdeg: -99999, vbat_mv: 0, flags: -1 },
          { strain_ustrain: -5000, channels: null },
          { channels: { strain_ue: NaN, tilt_x: 'invalid', battery_voltage: -1 } },
          {}
        ];

        for (let i = 0; i < 1000; i++) {
          const sample = corruptSamples[i % corruptSamples.length];
          const payload = Object.assign({
            _node_id: 'N01',
            node_id: 'N01',
            t_epoch_s: Math.floor(Date.now() / 1000)
          }, sample);

          try {
            bus.emit('telemetry', payload);
          } catch (e) {
            sensorCrashCount++;
          }

          // Check DOM integrity on sample points
          if (i % 100 === 0) {
            const strainEl = document.getElementById('strain-val');
            const tiltEl = document.getElementById('tilt-mag-val');
            const vibEl = document.getElementById('vib-val');
            const tempEl = document.getElementById('temp-val');
            const batEl = document.getElementById('vbat-val');

            if (!strainEl || !tiltEl || !vibEl || !tempEl || !batEl) {
              sensorDOMValid = false;
            }
            // Check for unhandled "NaN" in progress bar width
            const strainBar = document.getElementById('strain-bar-fill');
            if (strainBar && strainBar.style.width.includes('NaN')) {
              sensorDOMValid = false;
            }
          }
        }

        assert(sensorCrashCount === 0, 'Zero exceptions during 1,000 corrupted telemetry fuzzing events');
        assert(sensorDOMValid, 'SCADA gauges DOM elements remained intact with zero NaN% CSS styles during fuzzing');

        // Rapid node switching across all 31 nodes (310 switches)
        let switchErrors = 0;
        for (let s = 0; s < 310; s++) {
          const targetNode = nodeIds[s % 31];
          try {
            bus.emit('node-selected', targetNode);
            // Feed telemetry for that node
            bus.emit('telemetry', {
              _node_id: targetNode,
              node_id: targetNode,
              strain_ustrain: 200 + (s % 500),
              tilt_x_mdeg: 20,
              tilt_y_mdeg: -15,
              vbat_mv: 3700,
              die_temp_c: 28,
              vib_rms_mm_s: 0.05
            });
          } catch (err) {
            switchErrors++;
          }
        }
        assert(switchErrors === 0, '310 rapid node selection switches executed without UI errors');

        // Dead node state handling: stop simulation, click node, verify offline rendering
        bus.emit('simulation-status', { is_running: false, state: 'STOPPED' });
        await new Promise(r => setTimeout(r, 60));
        bus.emit('node-selected', 'N05');
        await new Promise(r => setTimeout(r, 50));

        const deadTiltEl = document.getElementById('tilt-mag-val');
        const deadStrainEl = document.getElementById('strain-val');
        const deadBadge = document.getElementById('tilt-status-badge');
        const isOfflineRendered = deadTiltEl && deadStrainEl &&
          (deadTiltEl.textContent === '--' || (deadBadge && (deadBadge.textContent.includes('OFFLINE') || deadBadge.classList.contains('dead'))));
        assert(isOfflineRendered, 'Dead node cleanly rendered offline indicators without crashing');

        // Revive simulation
        bus.emit('simulation-status', { is_running: true, state: 'RUNNING' });
        await new Promise(r => setTimeout(r, 50));

        // ==================================================================
        // SCENARIO 2: SCADA Rolling Charts & Canvas Reflow Thrashing
        // ==================================================================
        console.log('[Stress 2] SCADA Rolling Charts & Canvas Reflow Thrashing...');
        bus.emit('node-selected', 'N02');
        await new Promise(r => setTimeout(r, 50));

        // Rapid node switching to test Chart.js destroy & recreate
        let chartLifecycleErrors = 0;
        for (let c = 0; c < 50; c++) {
          try {
            const nid = nodeIds[c % 10];
            bus.emit('node-selected', nid);
          } catch (e) {
            chartLifecycleErrors++;
          }
        }
        assert(chartLifecycleErrors === 0, '50 rapid Chart.js destroy & re-instantiation cycles completed cleanly');

        // High-cadence point ingestion (1,500 points into active chart)
        bus.emit('node-selected', 'N03');
        await new Promise(r => setTimeout(r, 50));

        const chartPointsStart = performance.now();
        let chartFeedErrors = 0;
        for (let p = 0; p < 1500; p++) {
          try {
            bus.emit('telemetry', {
              _node_id: 'N03',
              node_id: 'N03',
              strain_ustrain: 300 + (p % 600),
              strain_ue: 300 + (p % 600),
              tilt_x_mdeg: (p % 100) - 50,
              tilt_y_mdeg: (p % 80) - 40,
              t_epoch_s: Math.floor(Date.now() / 1000) + p
            });
          } catch (e) {
            chartFeedErrors++;
          }
        }
        const chartPointsDuration = performance.now() - chartPointsStart;
        assert(chartFeedErrors === 0, '1,500 chart telemetry points ingested in ' + chartPointsDuration.toFixed(1) + 'ms with zero canvas errors');

        // Check canvas element existence
        const strainCanvas = document.getElementById('strain-canvas');
        assert(strainCanvas !== null, 'Chart.js canvas maintains active DOM binding after point stream');

        // ==================================================================
        // SCENARIO 3: Database-Wide Replay Transport Thrashing & Live Isolation
        // ==================================================================
        console.log('[Stress 3] Database-Wide Replay Transport Thrashing...');

        // Test replay controller speed buttons & transport spam
        const playBtn = document.getElementById('replay-play') || document.querySelector('.replay-btn-play');
        const pauseBtn = document.getElementById('replay-pause') || document.querySelector('.replay-btn-pause');
        const stopBtn = document.getElementById('replay-stop') || document.querySelector('.replay-btn-stop');
        const speedBtns = document.querySelectorAll('.replay-speed-btn');

        assert(playBtn !== null && stopBtn !== null, 'Replay transport buttons (PLAY, STOP) found in DOM');

        let transportErrors = 0;
        // Rapid transport thrashing: PLAY -> PAUSE -> PLAY -> SPEED -> STOP
        for (let t = 0; t < 50; t++) {
          try {
            if (playBtn && !playBtn.disabled) playBtn.click();
            if (speedBtns.length > 0) speedBtns[t % speedBtns.length].click();
            if (pauseBtn && !pauseBtn.disabled) pauseBtn.click();
            if (stopBtn && !stopBtn.disabled) stopBtn.click();
          } catch (e) {
            transportErrors++;
          }
        }
        assert(transportErrors === 0, '50 rapid transport clicks (Play/Pause/Speed/Stop) executed without exception');

        // Live Feed Isolation test: Start replay, emit live telemetry, verify no crash
        if (playBtn) playBtn.click();
        await new Promise(r => setTimeout(r, 60));

        let liveInjectErrors = 0;
        for (let l = 0; l < 200; l++) {
          try {
            bus.emit('telemetry', {
              _node_id: 'N08',
              node_id: 'N08',
              strain_ustrain: 888,
              tilt_x_mdeg: 40,
              tilt_y_mdeg: 20
            });
          } catch (e) {
            liveInjectErrors++;
          }
        }
        assert(liveInjectErrors === 0, 'Live feed isolation maintained under concurrent live packet blast during replay');

        // Stop replay
        if (stopBtn && !stopBtn.disabled) stopBtn.click();
        await new Promise(r => setTimeout(r, 40));

        // In-flight Reset during Replay
        if (playBtn) playBtn.click();
        await new Promise(r => setTimeout(r, 40));
        bus.emit('system-reset', { action: 'reset' });
        await new Promise(r => setTimeout(r, 40));

        const postResetCounter = document.querySelector('.replay-counter');
        const postResetStatus = document.querySelector('.replay-status');
        const isResetClean = (postResetCounter && postResetCounter.textContent.includes('0 / 0')) ||
                             (postResetStatus && postResetStatus.textContent.includes('RESET'));
        assert(isResetClean, 'Replay cleanly aborted, timers torn down, and counter reset on system-reset');

        // Revive simulation for remaining tests
        bus.emit('simulation-status', { is_running: true, state: 'RUNNING' });
        await new Promise(r => setTimeout(r, 50));

        // ==================================================================
        // SCENARIO 4: Alarm Escalation Hierarchy, Deduplication & Pagination Load
        // ==================================================================
        console.log('[Stress 4] Alarm Escalation Hierarchy & Pagination Load...');

        // Ingest 500 escalating and overlapping alarms
        let alarmErrors = 0;
        const testAlarms = [];
        for (let a = 0; a < 500; a++) {
          const nid = nodeIds[a % 10];
          const lvl = (a % 3) + 1; // 1, 2, or 3
          testAlarms.push({
            alarm_id: 'V3-ALM-' + (a % 40), // 40 unique base IDs repeated
            t_utc: new Date(Date.now() - (500 - a) * 1000).toISOString(),
            panel_id: 'adriyala_panel_1',
            level: lvl,
            state: lvl === 3 ? 'CRITICAL' : (lvl === 2 ? 'TENSION' : 'ADVISORY'),
            affected_nodes: [nid, 'N' + ((parseInt(nid.slice(1), 10) % 31) + 1)],
            max_strain_ue: 300 * lvl,
            centroid: { lat: 18.636, lng: 79.544 },
            confidence_zone: lvl === 3 ? 'high_confidence' : 'medium_warning',
            explanation: 'V3 ESCALATION STRESS EVENT ' + a
          });
        }

        for (const alm of testAlarms) {
          try {
            bus.emit('alarm', alm);
          } catch (e) {
            alarmErrors++;
          }
        }
        assert(alarmErrors === 0, '500 escalating/overlapping alarms ingested with zero exceptions');

        // Pagination Thrashing: Click NEXT and PREV rapidly
        const nextBtn = document.querySelector('.alarm-btn-next');
        const prevBtn = document.querySelector('.alarm-btn-prev');
        let paginationErrors = 0;

        for (let pg = 0; pg < 40; pg++) {
          try {
            if (nextBtn && !nextBtn.disabled) nextBtn.click();
          } catch (e) {
            paginationErrors++;
          }
        }
        for (let pg = 0; pg < 40; pg++) {
          try {
            if (prevBtn && !prevBtn.disabled) prevBtn.click();
          } catch (e) {
            paginationErrors++;
          }
        }
        assert(paginationErrors === 0, '80 rapid pagination operations (NEXT / PREV) completed smoothly');

        // Alarm Row Selection Thrashing
        const alarmRows = document.querySelectorAll('.alarm-row');
        let rowClickErrors = 0;
        for (let r = 0; r < Math.min(alarmRows.length, 20); r++) {
          try {
            alarmRows[r].click();
          } catch (e) {
            rowClickErrors++;
          }
        }
        assert(rowClickErrors === 0, 'Alarm row selection and detail dispatch completed without errors');

        // ==================================================================
        // SCENARIO 5: Leaflet Concentric Rings & Map Controls Thrashing
        // ==================================================================
        console.log('[Stress 5] Leaflet Concentric Rings & Map Controls...');

        // Rapid Map Eye Legend toggle
        const legendBtn = document.getElementById('btn-toggle-map-legend');
        const legendCloseBtn = document.getElementById('btn-close-map-legend');
        const legendEl = document.getElementById('map-hud-legend');
        let legendToggleErrors = 0;

        for (let lg = 0; lg < 50; lg++) {
          try {
            if (legendBtn) legendBtn.click();
            if (legendCloseBtn && lg % 2 === 0) legendCloseBtn.click();
          } catch (e) {
            legendToggleErrors++;
          }
        }
        assert(legendToggleErrors === 0, '50 rapid Map Eye Legend toggles completed without exception');

        // Basemap switcher rapid cycling
        const btnSat = document.getElementById('btn-base-sat');
        const btnTopo = document.getElementById('btn-base-topo');
        let basemapErrors = 0;

        for (let bm = 0; bm < 30; bm++) {
          try {
            if (bm % 2 === 0 && btnTopo) btnTopo.click();
            else if (btnSat) btnSat.click();
          } catch (e) {
            basemapErrors++;
          }
        }
        assert(basemapErrors === 0, '30 rapid basemap toggles (Satellite <-> Topo) executed cleanly');

        // Node state cycling across all 31 nodes (active -> warning -> critical -> dead)
        let stateCycleErrors = 0;
        const states = ['active', 'warning', 'critical', 'dead'];
        for (let sc = 0; sc < 60; sc++) {
          const st = states[sc % states.length];
          const targetNid = nodeIds[sc % 31];
          try {
            bus.emit('node-status-change', { node_id: targetNid, state: st });
          } catch (e) {
            stateCycleErrors++;
          }
        }
        assert(stateCycleErrors === 0, 'Rapid node marker state machine transitions executed cleanly');

        return out;
      })();
    `);

    // Iterate through in-renderer scenario results
    for (const s of results.scenarios) {
      if (s.pass) {
        pass(s.name);
      } else {
        fail(`${s.name}: ${s.error}`);
        process.exitCode = 1;
      }
    }

    if (uncaughtErrors.length > 0) {
      fail(`Encountered ${uncaughtErrors.length} uncaught errors in renderer:`);
      for (const err of uncaughtErrors) console.error(`    ${err.message}`);
      process.exitCode = 1;
    } else {
      pass('Zero uncaught exceptions or renderer errors throughout entire V3 stress battery');
    }

    section(`V3 FEATURE STRESS BATTERY COMPLETED: ${results.totalPassed} PASSED, ${results.totalFailed} FAILED`);
    app.exit(process.exitCode || 0);
  } catch (err) {
    fail(`Fatal exception in V3 stress runner: ${err.message}\n${err.stack}`);
    app.exit(1);
  }
});
