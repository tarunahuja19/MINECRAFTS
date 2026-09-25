'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

function httpPut(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'PUT'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('=====================================================');
  console.log('[TEST SUITE] SIM SANDBOX ISOLATION & CAMERA VERIFICATION');
  console.log('=====================================================\n');

  // STEP 1: STATIC GREP CONSTRAINT CHECK
  console.log('[STEP 1] Checking static constraints on sim-tab.js...');
  const simTabPath = path.join(__dirname, '../renderer/js/sim/sim-tab.js');
  const simTabCode = fs.readFileSync(simTabPath, 'utf8');

  const forbiddenPattern = /mapView\.|troughOverlay\.|nodeMarkers\.getAllNodes/g;
  const matches = simTabCode.match(forbiddenPattern) || [];
  if (matches.length > 0) {
    throw new Error('Forbidden pattern match found in sim-tab.js: ' + matches.join(', '));
  }
  console.log('✓ PASS: Grep check clean — 0 occurrences of mapView., troughOverlay., nodeMarkers.getAllNodes');

  const allNodeMarkerCalls = simTabCode.match(/nodeMarkers\.[a-zA-Z0-9_]+/g) || [];
  console.log('[STEP 1] nodeMarkers calls in sim-tab.js:', allNodeMarkerCalls);
  for (const call of allNodeMarkerCalls) {
    if (call !== 'nodeMarkers.getNodeData') {
      throw new Error('Only getNodeData (single-node inspect) may remain; found: ' + call);
    }
  }
  console.log('✓ PASS: Only getNodeData (single-node inspect) remains in sim-tab.js; all bulk reads use sandbox clone.\n');

  // STEP 2: HEADLESS CHROME LAUNCH & CONNECTION
  console.log('[STEP 2] Launching headless Chrome...');
  const tempProfile = `/tmp/chrome_test_profile_${Date.now()}`;
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--use-gl=angle',
    '--enable-webgl',
    '--remote-debugging-port=9224',
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
    'about:blank'
  ]);

  let ready = false;
  for (let i = 0; i < 30; i++) {
    await sleep(250);
    try {
      await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9224/json/version', (r) => {
          if (r.statusCode === 200) resolve();
          else reject(new Error('Status ' + r.statusCode));
        }).on('error', reject);
      });
      ready = true;
      break;
    } catch (_) {}
  }
  if (!ready) throw new Error('Chrome remote debugging port 9224 failed to respond');

  try {
    const newPage = await httpPut('http://127.0.0.1:9224/json/new?http://127.0.0.1:8085/renderer/index.html');
    console.log('[TEST] Chrome target page created:', newPage.id);

    const ws = new WebSocket(newPage.webSocketDebuggerUrl);
    let msgId = 1;
    const pending = new Map();

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = msg.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' ');
        if (text.includes('[SEND_TO_SIM') || text.includes('[SIM_TAB]') || text.includes('[SIM_SANDBOX]')) {
          console.log('[BROWSER_LOG]', text);
        }
      }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    });

    await new Promise(resolve => ws.on('open', resolve));

    function sendCmd(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    }

    async function evaluate(expression, awaitPromise = true) {
      const res = await sendCmd('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise
      });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
      }
      return res.result ? res.result.value : undefined;
    }

    await sendCmd('Page.enable');
    await sendCmd('Runtime.enable');
    await sendCmd('Console.enable');

    console.log('[TEST] Waiting for page load and dashboard readiness...');
    await sleep(3500);

    // Verify #sim-recenter-btn exists in DOM
    const recenterBtnInfo = await evaluate(`
      (function() {
        var btn = document.getElementById('sim-recenter-btn');
        return {
          exists: !!btn,
          text: btn ? btn.textContent.trim() : null,
          title: btn ? btn.title : null
        };
      })()
    `);
    console.log('[STEP 2] #sim-recenter-btn in DOM:', recenterBtnInfo);
    if (!recenterBtnInfo.exists) {
      throw new Error('#sim-recenter-btn does not exist in DOM!');
    }
    console.log('✓ PASS: #sim-recenter-btn is rendered in .sim-toolbar\n');

    // STEP 3: BEFORE / AFTER CHECK ON SEND TO SIM
    console.log('[STEP 3] Capture dashboard map center+zoom and troughOverlay state BEFORE Send to Sim...');
    const preDashboardState = await evaluate(`
      (function() {
        var map = (typeof mapView !== 'undefined' && mapView.getMap) ? mapView.getMap() : null;
        var center = map ? map.getCenter() : null;
        var zoom = map ? map.getZoom() : null;
        var troughState = (typeof troughOverlay !== 'undefined' && typeof troughOverlay.getState === 'function')
          ? troughOverlay.getState()
          : null;
        var troughSvg = document.querySelector('#map-container svg.leaflet-zoom-animated');
        var troughHtml = troughSvg ? troughSvg.innerHTML : '';
        return {
          hasMap: !!map,
          center: center ? { lat: center.lat, lng: center.lng } : null,
          zoom: zoom,
          troughState: troughState,
          troughPathCount: (troughHtml.match(/<path/g) || []).length
        };
      })()
    `);
    console.log('[STEP 3] Pre-Send Dashboard State:', preDashboardState);

    // Register selection and trigger Send to Sim
    console.log('[STEP 3] Setting selectionStore and clicking #btn-send-to-sim...');
    await evaluate(`
      (function() {
        var sampleSector = {
          id: 'E5',
          title: '3D: SECTOR E5 (Active Face)',
          center: [18.6435, 79.5725],
          latRange: [18.6415, 18.6455],
          lngRange: [79.5705, 79.5745],
          bounds: [[18.6415, 79.5705], [18.6455, 79.5745]],
          nodeCount: 4,
          nodes: ['N23', 'N24', 'N25', 'N31']
        };
        selectionStore.set(sampleSector);
        var btn = document.getElementById('btn-send-to-sim');
        btn.click();
      })()
    `);

    // Wait for sandbox loading pipeline to finish
    console.log('[STEP 3] Waiting for sandbox loading overlay to complete...');
    let pipelineDone = false;
    for (let i = 0; i < 30; i++) {
      await sleep(300);
      pipelineDone = await evaluate(`
        (function() {
          var res = window.__sendToSimAssertResult;
          var overlay = document.getElementById('sim-loading-overlay');
          var overlayGone = overlay ? (overlay.style.display === 'none' && !overlay.classList.contains('fade-out')) : true;
          var session = typeof simTab !== 'undefined' && simTab.getSandboxSession ? simTab.getSandboxSession() : null;
          return !!res && overlayGone && !!session;
        })()
      `);
      if (pipelineDone) break;
    }
    if (!pipelineDone) {
      throw new Error('Sandbox loading pipeline timed out');
    }


    // Verify sandbox loaded state
    const sandboxLoadState = await evaluate(`
      (function() {
        var session = simTab.getSandboxSession();
        var markers = document.querySelectorAll('.sim-cloned-marker').length;
        var banner = document.getElementById('sim-sandbox-banner');
        var mapLibre = simTab.getMap();
        var center = mapLibre ? mapLibre.getCenter() : null;
        return {
          sessionExists: !!session,
          sessionId: session ? session.id : null,
          nodeCount: session && session.nodes ? session.nodes.length : 0,
          clonedMarkersCount: markers,
          bannerVisible: banner ? banner.style.display !== 'none' : false,
          simCameraCenter: center ? { lng: center.lng, lat: center.lat } : null
        };
      })()
    `);
    console.log('[STEP 3] Sandbox Loaded State:', sandboxLoadState);
    if (!sandboxLoadState.sessionExists || sandboxLoadState.clonedMarkersCount !== 4) {
      throw new Error('Sandbox failed to load with cloned nodes');
    }

    // Assert before/after check
    const assertResult = await evaluate(`window.__sendToSimAssertResult`);
    console.log('[STEP 3] window.__sendToSimAssertResult:', assertResult);
    if (!assertResult || !assertResult.passed) {
      throw new Error('Send to Sim before/after assertion failed or was not recorded!');
    }

    const postLoadDashboardState = await evaluate(`
      (function() {
        var map = (typeof mapView !== 'undefined' && mapView.getMap) ? mapView.getMap() : null;
        var center = map ? map.getCenter() : null;
        var zoom = map ? map.getZoom() : null;
        var troughState = (typeof troughOverlay !== 'undefined' && typeof troughOverlay.getState === 'function')
          ? troughOverlay.getState()
          : null;
        return {
          center: center ? { lat: center.lat, lng: center.lng } : null,
          zoom: zoom,
          troughState: troughState
        };
      })()
    `);
    console.log('[STEP 3] Post-Load Dashboard State:', postLoadDashboardState);

    const centerUnchanged = Math.abs(preDashboardState.center.lat - postLoadDashboardState.center.lat) < 1e-4 &&
                            Math.abs(preDashboardState.center.lng - postLoadDashboardState.center.lng) < 1e-4;
    const zoomUnchanged = preDashboardState.zoom === postLoadDashboardState.zoom;
    const troughUnchanged = JSON.stringify(preDashboardState.troughState) === JSON.stringify(postLoadDashboardState.troughState);

    if (!centerUnchanged || !zoomUnchanged || !troughUnchanged) {
      throw new Error('Direct assertion failed: Dashboard state mutated after sandbox load!');
    }
    console.log('✓ PASS: Dashboard map center+zoom and troughOverlay state unchanged after sandbox load.\n');

    // STEP 4: PAN SIM FREELY & RECENTER BUTTON
    console.log('[STEP 4] Testing Sim free camera pan and #sim-recenter-btn...');
    const initialSimCam = await evaluate(`
      (function() {
        var m = simTab.getMap();
        var c = m.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
      })()
    `);
    console.log('[STEP 4] Initial Sim Camera:', initialSimCam);

    // Pan sim camera away freely
    console.log('[STEP 4] Freely panning sim camera to [79.6200, 18.6800]...');
    await evaluate(`
      (function() {
        var m = simTab.getMap();
        m.jumpTo({ center: [79.6200, 18.6800], zoom: 12, pitch: 45 });
      })()
    `);
    await sleep(300);

    const pannedSimCam = await evaluate(`
      (function() {
        var m = simTab.getMap();
        var c = m.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
      })()
    `);
    console.log('[STEP 4] Panned Sim Camera:', pannedSimCam);
    if (Math.abs(pannedSimCam.lng - initialSimCam.lng) < 0.01) {
      throw new Error('Sim camera did not move during free pan');
    }

    // Verify dashboard map NEVER moved during sim free pan
    const dashCamDuringPan = await evaluate(`
      (function() {
        var map = mapView.getMap();
        var c = map.getCenter();
        return { lat: c.lat, lng: c.lng, zoom: map.getZoom() };
      })()
    `);
    if (Math.abs(dashCamDuringPan.lat - preDashboardState.center.lat) > 1e-4 ||
        Math.abs(dashCamDuringPan.lng - preDashboardState.center.lng) > 1e-4 ||
        dashCamDuringPan.zoom !== preDashboardState.zoom) {
      throw new Error('Dashboard map moved during sim free pan!');
    }
    console.log('✓ PASS: Dashboard map never moved during sim free pan');

    // Click #sim-recenter-btn to re-fit sim camera to session bounds
    console.log('[STEP 4] Clicking #sim-recenter-btn...');
    await evaluate(`document.getElementById('sim-recenter-btn').click()`);
    await sleep(1200);

    const recenteredSimCam = await evaluate(`
      (function() {
        var m = simTab.getMap();
        var c = m.getCenter();
        return { lng: c.lng, lat: c.lat, zoom: m.getZoom() };
      })()
    `);
    console.log('[STEP 4] Recentered Sim Camera:', recenteredSimCam);
    if (Math.abs(recenteredSimCam.lng - initialSimCam.lng) > 0.008 ||
        Math.abs(recenteredSimCam.lat - initialSimCam.lat) > 0.008) {
      throw new Error('Sim camera did not re-fit to session bounds after clicking #sim-recenter-btn!');
    }
    console.log('✓ PASS: #sim-recenter-btn re-fitted sim camera to session bounds successfully.\n');

    // STEP 5: RUN SCENARIO & VERIFY CLONE PERSISTENCE
    console.log('[STEP 5] Running scenario in sandbox...');
    await evaluate(`
      (function() {
        var crackBtn = document.querySelector('.sim-scenario-btn[data-type="crack"]') || document.querySelectorAll('.sim-scenario-btn')[0];
        if (crackBtn) crackBtn.click();
        var runBtn = document.getElementById('btn-sim-run-scenario');
        if (runBtn) runBtn.click();
      })()
    `);

    let scenarioDone = false;
    for (let i = 0; i < 25; i++) {
      await sleep(400);
      scenarioDone = await evaluate(`
        (function() {
          var btn = document.getElementById('btn-sim-run-scenario');
          var resBody = document.getElementById('sim-scenario-result-body');
          return btn && btn.textContent === 'RUN SCENARIO' && !btn.disabled && resBody && resBody.innerHTML.trim().length > 30;
        })()
      `);
      if (scenarioDone) break;
    }
    if (!scenarioDone) throw new Error('Scenario run did not finish in time!');

    const postScenarioState = await evaluate(`
      (function() {
        var session = simTab.getSandboxSession();
        var cracksSource = simTab.getMap().getSource('sim-cracks-overlay');
        var cracksFeatures = cracksSource && cracksSource._data && cracksSource._data.features ? cracksSource._data.features.length : 0;
        var markers = document.querySelectorAll('.sim-cloned-marker').length;
        var dashMap = mapView.getMap();
        var c = dashMap.getCenter();
        return {
          sessionExists: !!session,
          sessionId: session ? session.id : null,
          nodeCount: session && session.nodes ? session.nodes.length : 0,
          cracksFeatures: cracksFeatures,
          markers: markers,
          dashCenter: { lat: c.lat, lng: c.lng },
          dashZoom: dashMap.getZoom()
        };
      })()
    `);
    console.log('[STEP 5] Post-Scenario State:', postScenarioState);
    if (!postScenarioState.sessionExists || postScenarioState.nodeCount !== 4 || postScenarioState.markers !== 4) {
      throw new Error('Sandbox session or cloned nodes lost after running scenario!');
    }
    if (Math.abs(postScenarioState.dashCenter.lat - preDashboardState.center.lat) > 1e-4 ||
        Math.abs(postScenarioState.dashCenter.lng - preDashboardState.center.lng) > 1e-4 ||
        postScenarioState.dashZoom !== preDashboardState.zoom) {
      throw new Error('Dashboard map moved after running scenario!');
    }
    console.log('✓ PASS: Scenario ran; sandbox session persists with its clone; dashboard map never moved.\n');

    // STEP 6: RESET LIVE SYSTEM & VERIFY ISOLATION
    console.log('[STEP 6] Testing live system reset...');
    const postResetState = await evaluate(`
      (function() {
        var preId = simTab.getSandboxSession().id;
        bus.emit('system-reset', {});
        var postSession = simTab.getSandboxSession();
        var markers = document.querySelectorAll('.sim-cloned-marker').length;
        var banner = document.getElementById('sim-sandbox-banner');
        var dashMap = mapView.getMap();
        var c = dashMap.getCenter();
        return {
          sessionSurvived: postSession && postSession.id === preId,
          nodeCount: postSession && postSession.nodes ? postSession.nodes.length : 0,
          markers: markers,
          bannerVisible: banner ? banner.style.display !== 'none' : false,
          dashCenter: { lat: c.lat, lng: c.lng },
          dashZoom: dashMap.getZoom()
        };
      })()
    `);
    console.log('[STEP 6] Post-Reset State:', postResetState);
    if (!postResetState.sessionSurvived || postResetState.markers !== 4) {
      throw new Error('Sandbox session did not survive live system reset!');
    }
    if (Math.abs(postResetState.dashCenter.lat - preDashboardState.center.lat) > 1e-4 ||
        Math.abs(postResetState.dashCenter.lng - preDashboardState.center.lng) > 1e-4 ||
        postResetState.dashZoom !== preDashboardState.zoom) {
      throw new Error('Dashboard map moved after live system reset!');
    }
    console.log('✓ PASS: Live system reset ignored by sandbox; clone persists; dashboard map never moved.\n');

    console.log('=====================================================');
    console.log('✓ ALL SPECIFICATION CHECKS & VERIFICATIONS PASSED!');
    console.log('=====================================================\n');
  } finally {
    chromeProc.kill('SIGKILL');
  }
}

runTest().catch((err) => {
  console.error('\n❌ [TEST FAILURE]', err);
  process.exit(1);
});
