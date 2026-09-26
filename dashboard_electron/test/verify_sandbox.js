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
  console.log('[STEP 1] Checking static constraints on sim-tab.js + sim-embed.js...');
  const simTabPath = path.join(__dirname, '../renderer/js/sim/sim-tab.js');
  const simTabCode = fs.readFileSync(simTabPath, 'utf8');
  const simEmbedPath = path.join(__dirname, '../renderer/js/sim/sim-embed.js');
  const simEmbedCode = fs.existsSync(simEmbedPath) ? fs.readFileSync(simEmbedPath, 'utf8') : '';

  const forbiddenPattern = /mapView\.|troughOverlay\.|nodeMarkers\.getAllNodes/g;
  const matches = (simTabCode.match(forbiddenPattern) || [])
    .concat(simEmbedCode.match(forbiddenPattern) || []);
  if (matches.length > 0) {
    throw new Error('Forbidden pattern match found in sim-tab.js/sim-embed.js: ' + matches.join(', '));
  }
  console.log('✓ PASS: Grep check clean — 0 occurrences of mapView., troughOverlay., nodeMarkers.getAllNodes');

  const allNodeMarkerCalls = (simTabCode.match(/nodeMarkers\.[a-zA-Z0-9_]+/g) || [])
    .concat(simEmbedCode.match(/nodeMarkers\.[a-zA-Z0-9_]+/g) || []);
  console.log('[STEP 1] nodeMarkers calls in sim-tab.js + sim-embed.js:', allNodeMarkerCalls);
  for (const call of allNodeMarkerCalls) {
    if (call !== 'nodeMarkers.getNodeData') {
      throw new Error('Only getNodeData (single-node inspect) may remain; found: ' + call);
    }
  }
  console.log('✓ PASS: Only getNodeData (single-node inspect) remains; all bulk reads use fixture pool or sandbox clone.\n');

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
        console.log('[BROWSER_LOG]', text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[BROWSER_EXCEPTION]', JSON.stringify(msg.params));
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


    // Verify sandbox loaded state (protocol-level: slot clip + allowlist)
    const sandboxLoadState = await evaluate(`
      (function() {
        var session = simTab.getSandboxSession();
        var banner = document.getElementById('sim-sandbox-banner');
        var forge = simEmbed.getSlotInfo('forge');
        var sim = simEmbed.getSlotInfo('sim');
        return {
          sessionExists: !!session,
          sessionId: session ? session.id : null,
          nodeCount: session && session.nodes ? session.nodes.length : 0,
          bannerVisible: banner ? banner.style.display !== 'none' : false,
          forgeLoaded: forge ? forge.loaded : false,
          forgeNodes: forge ? forge.nodes : null,
          forgeClip: forge ? forge.clip : null,
          simClip: sim ? sim.clip : null,
          simCmds: simEmbed.getCommands('sim')
        };
      })()
    `);
    console.log('[STEP 3] Sandbox Loaded State:', sandboxLoadState);
    if (!sandboxLoadState.sessionExists || sandboxLoadState.nodeCount !== 4) {
      throw new Error('Sandbox failed to load with cloned nodes');
    }
    if (!sandboxLoadState.forgeLoaded || JSON.stringify(sandboxLoadState.forgeNodes) !== JSON.stringify([23, 24, 25, 31])) {
      throw new Error('FORGE slot did not receive the N23/N24/N25/N31 allowlist! Got ' + JSON.stringify(sandboxLoadState.forgeNodes));
    }
    if (!sandboxLoadState.forgeClip) {
      throw new Error('FORGE slot did not receive the selection clip!');
    }
    if (sandboxLoadState.simClip !== null) {
      throw new Error('SIM slot got clipped by the selection! Selection-proof rule violated.');
    }
    if (sandboxLoadState.simCmds.indexOf('set-bounds') !== -1) {
      throw new Error('SIM slot received set-bounds! Selection-proof rule violated.');
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

    // STEP 4: RECENTER BUTTONS (protocol-level; cameras live in iframes)
    console.log('[STEP 4] Testing #sim-recenter-btn and #forge-recenter-btn...');
    // Slots load lazily: open SIM first and wait for its ready handshake.
    await evaluate(`document.querySelector('#tab-bar .tab-btn[data-tab="sim"]').click()`);
    let simReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      simReady = await evaluate(`simEmbed.isReady('sim')`);
      if (simReady) break;
    }
    if (!simReady) throw new Error('SIM slot did not become ready!');
    console.log('[STEP 4] SIM slot ready.');
    console.log('[STEP 4] Clicking #sim-recenter-btn...');
    await evaluate(`document.getElementById('sim-recenter-btn').click()`);
    await sleep(600);

    const simRecenter = await evaluate(`
      (function() {
        return {
          cmds: simEmbed.getCommands('sim'),
          clip: (simEmbed.getSlotInfo('sim') || {}).clip || null
        };
      })()
    `);
    console.log('[STEP 4] SIM slot after recenter:', simRecenter);
    if (simRecenter.cmds.indexOf('recenter') === -1) {
      throw new Error('SIM slot did not receive the recenter command!');
    }
    if (simRecenter.clip !== null) {
      throw new Error('SIM slot clip is not full-district after recenter!');
    }
    console.log('✓ PASS: #sim-recenter-btn recentered the SIM slot (full district).');

    console.log('[STEP 4] Clicking #forge-recenter-btn...');
    await evaluate(`document.getElementById('forge-recenter-btn').click()`);
    await sleep(600);
    const forgeRecenter = await evaluate(`
      (function() {
        return {
          cmds: simEmbed.getCommands('forge'),
          clip: (simEmbed.getSlotInfo('forge') || {}).clip || null
        };
      })()
    `);
    console.log('[STEP 4] FORGE slot after recenter:', forgeRecenter);
    if (forgeRecenter.cmds.indexOf('recenter') === -1) {
      throw new Error('FORGE slot did not receive the recenter command!');
    }
    if (!forgeRecenter.clip) {
      throw new Error('FORGE slot lost its selection clip after recenter!');
    }
    console.log('✓ PASS: #forge-recenter-btn reframed the FORGE slot on the selection.\n');

    // STEP 5: RUN EXPERIMENTS & VERIFY FORGE-ONLY 3D EFFECTS (protocol)
    // FORGE tab must be visible for RUN (open it back after STEP 4's SIM visit).
    await evaluate(`document.querySelector('#tab-bar .tab-btn[data-tab="forge"]').click()`);
    let forgeReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      forgeReady = await evaluate(`simEmbed.isReady('forge')`);
      if (forgeReady) break;
    }
    if (!forgeReady) throw new Error('FORGE slot did not become ready!');
    console.log('[STEP 5] FORGE slot ready. Running CRACK...');

    async function runExperiment(dataType) {
      await evaluate(`
        (function() {
          var btn = document.querySelector('.sim-scenario-btn[data-type="${dataType}"]');
          if (btn) btn.click();
          var runBtn = document.getElementById('btn-sim-run-scenario');
          if (runBtn) runBtn.click();
        })()
      `);
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const pollState = await evaluate(`
          (function() {
            var btn = document.getElementById('btn-sim-run-scenario');
            var resBody = document.getElementById('sim-scenario-result-body');
            return {
              text: btn ? btn.textContent : null,
              disabled: btn ? btn.disabled : null,
              resLen: resBody ? resBody.innerHTML.trim().length : 0
            };
          })()
        `);
        if (pollState.text === 'RUN EXPERIMENT' && !pollState.disabled && pollState.resLen > 30) {
          return;
        }
      }
      throw new Error('Experiment ' + dataType + ' did not finish in time!');
    }

    await runExperiment('crack');
    let cmds = await evaluate(`
      (function() {
        return { forge: simEmbed.getCommands('forge'), sim: simEmbed.getCommands('sim') };
      })()
    `);
    console.log('[STEP 5] Commands after CRACK:', cmds);
    if (cmds.forge.indexOf('set-cracks') === -1) {
      throw new Error('CRACK did not post set-cracks to the FORGE slot!');
    }

    console.log('[STEP 5] Running CAVE-IN...');
    await runExperiment('sudden_sinking');
    cmds = await evaluate(`
      (function() {
        var session = simTab.getSandboxSession();
        var dashMap = mapView.getMap();
        var c = dashMap.getCenter();
        return {
          forge: simEmbed.getCommands('forge'),
          sim: simEmbed.getCommands('sim'),
          sessionExists: !!session,
          nodeCount: session && session.nodes ? session.nodes.length : 0,
          dashCenter: { lat: c.lat, lng: c.lng },
          dashZoom: dashMap.getZoom()
        };
      })()
    `);
    console.log('[STEP 5] Post-Scenario State:', cmds);
    if (!cmds.sessionExists || cmds.nodeCount !== 4) {
      throw new Error('Sandbox session or cloned nodes lost after running scenario!');
    }
    if (cmds.forge.indexOf('trigger') === -1) {
      throw new Error('CAVE-IN did not post a trigger to the FORGE slot!');
    }
    if (cmds.sim.indexOf('trigger') !== -1 || cmds.sim.indexOf('set-cracks') !== -1) {
      throw new Error('Experiment visuals leaked to the SIM slot! FORGE-only rule violated.');
    }
    if (Math.abs(cmds.dashCenter.lat - preDashboardState.center.lat) > 1e-4 ||
        Math.abs(cmds.dashCenter.lng - preDashboardState.center.lng) > 1e-4 ||
        cmds.dashZoom !== preDashboardState.zoom) {
      throw new Error('Dashboard map moved after running scenario!');
    }
    console.log('✓ PASS: Experiments ran FORGE-only; session persists; dashboard map never moved.\n');

    // STEP 6: RESET LIVE SYSTEM & VERIFY ISOLATION
    console.log('[STEP 6] Testing live system reset...');
    const postResetState = await evaluate(`
      (function() {
        var preId = simTab.getSandboxSession().id;
        bus.emit('system-reset', {});
        var postSession = simTab.getSandboxSession();
        var banner = document.getElementById('sim-sandbox-banner');
        var dashMap = mapView.getMap();
        var c = dashMap.getCenter();
        return {
          sessionSurvived: postSession && postSession.id === preId,
          nodeCount: postSession && postSession.nodes ? postSession.nodes.length : 0,
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
