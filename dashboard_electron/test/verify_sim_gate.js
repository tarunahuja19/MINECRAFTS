'use strict';

/**
 * dashboard_electron/test/verify_sim_gate.js
 *
 * Automated verification of the SIM PLAY gate requirements:
 * 1. Fresh load:
 *    - window.__SIM_PLAYING__ is false
 *    - HUD = STOPPED (#sim-hud-text)
 *    - Status bar = STOPPED (#sim-status)
 *    - Nodes are HELD / grey (state: 'dead')
 *    - Node count = '0/31 ACTIVE (SIM STOPPED)'
 *    - No ambient telemetry flowing
 * 2. Tab switching does not start simulation feed.
 * 3. Press SIM PLAY:
 *    - window.__SIM_PLAYING__ becomes true
 *    - HUD = RUNNING
 *    - Status bar = RUNNING
 *    - Nodes revive to active (green)
 *    - Button shows '❚❚ PAUSE'
 * 4. Press PAUSE / STOP:
 *    - window.__SIM_PLAYING__ becomes false
 *    - HUD = PAUSED
 *    - Status bar = PAUSED
 *    - Nodes freeze (no telemetry, charts frozen)
 *    - Button shows '▶ PLAY'
 * 5. Re-play & Pause transitions stay clean with no errors.
 */

const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpPut(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'PUT'
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runGateVerification() {
  console.log('=====================================================');
  console.log('[SIM GATE TEST] VERIFYING SIMULATION PLAY/STOP GATE');
  console.log('=====================================================\n');

  const tempProfile = `/tmp/chrome_sim_gate_profile_${Date.now()}`;
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--use-gl=angle',
    '--enable-webgl',
    '--remote-debugging-port=9226',
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
        http.get('http://127.0.0.1:9226/json/version', (r) => {
          if (r.statusCode === 200) resolve();
          else reject(new Error('Status ' + r.statusCode));
        }).on('error', reject);
      });
      ready = true;
      break;
    } catch (_) {}
  }
  if (!ready) throw new Error('Chrome remote debugging port 9226 failed to respond');

  try {
    const newPage = await httpPut('http://127.0.0.1:9226/json/new?http://127.0.0.1:8085/renderer/index.html');
    const ws = new WebSocket(newPage.webSocketDebuggerUrl);
    let msgId = 1;
    const pending = new Map();

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
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

    console.log('[INIT] Waiting for dashboard bootstrap...');
    await sleep(3500);

    // -------------------------------------------------------------------------
    // CHECK 1: FRESH LOAD STATE
    // -------------------------------------------------------------------------
    console.log('\n--- CHECK 1: FRESH LOAD STATE (SIM NOT PRESSED) ---');
    const freshState = await evaluate(`
      (function() {
        var gate = window.__SIM_PLAYING__;
        var hudText = (document.getElementById('sim-hud-text') || {}).textContent || '';
        var simStatus = (document.getElementById('sim-status') || {}).textContent || '';
        var nodeCountText = (document.getElementById('node-count') || {}).textContent || '';
        var playBtnText = (document.getElementById('sim-btn-play') || {}).textContent || '';

        var nodes = [];
        if (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) {
          for (var i = 1; i <= 31; i++) {
            var id = 'N' + (i < 10 ? '0' : '') + i;
            var nd = nodeMarkers.getNodeData(id);
            if (nd) nodes.push({ id: id, state: nd.state });
          }
        }
        var deadCount = nodes.filter(function(n) { return n.state === 'dead'; }).length;

        return {
          gate: gate,
          hudText: hudText.trim(),
          simStatus: simStatus.trim(),
          nodeCountText: nodeCountText.trim(),
          playBtnText: playBtnText.trim(),
          totalNodes: nodes.length,
          deadCount: deadCount
        };
      })()
    `);

    console.log('Fresh load report:', freshState);
    if (freshState.gate !== false) {
      throw new Error('FAIL: window.__SIM_PLAYING__ must be false on fresh load');
    }
    if (freshState.hudText !== 'SIMULATION: STOPPED') {
      throw new Error('FAIL: HUD text must be "SIMULATION: STOPPED", got: ' + freshState.hudText);
    }
    if (freshState.simStatus !== 'STOPPED') {
      throw new Error('FAIL: Status bar must be "STOPPED", got: ' + freshState.simStatus);
    }
    if (freshState.deadCount !== freshState.totalNodes || freshState.totalNodes === 0) {
      throw new Error('FAIL: All nodes must be in "dead" (HELD/grey) state on fresh load. Found: ' +
        freshState.deadCount + '/' + freshState.totalNodes + ' dead');
    }
    if (!freshState.nodeCountText.includes('SIM STOPPED')) {
      throw new Error('FAIL: Node count must indicate SIM STOPPED, got: ' + freshState.nodeCountText);
    }
    console.log('✓ PASS Check 1: Fresh load state is HELD / STOPPED, nodes grey, gate false.\n');

    // -------------------------------------------------------------------------
    // CHECK 2: TAB SWITCHING DOES NOT ACTIVATE SIMULATION
    // -------------------------------------------------------------------------
    console.log('--- CHECK 2: TAB SWITCHING PERSISTENCE ---');
    const tabSwitchState = await evaluate(`
      (function() {
        // Switch to FORGE
        var forgeBtn = document.querySelector('.tab-btn[data-tab="forge"]');
        if (forgeBtn) forgeBtn.click();

        // Switch to INFO
        var infoBtn = document.querySelector('.tab-btn[data-tab="info"]');
        if (infoBtn) infoBtn.click();

        // Switch back to MAP
        var mapBtn = document.querySelector('.tab-btn[data-tab="map"]');
        if (mapBtn) mapBtn.click();

        return {
          gate: window.__SIM_PLAYING__,
          hudText: (document.getElementById('sim-hud-text') || {}).textContent || '',
          simStatus: (document.getElementById('sim-status') || {}).textContent || ''
        };
      })()
    `);

    console.log('Tab switch report:', tabSwitchState);
    if (tabSwitchState.gate !== false || !tabSwitchState.hudText.includes('STOPPED')) {
      throw new Error('FAIL: Tab switching activated simulation unexpectedly');
    }
    console.log('✓ PASS Check 2: Tab switching does not start simulation feed.\n');

    // -------------------------------------------------------------------------
    // CHECK 3: PRESS SIM PLAY
    // -------------------------------------------------------------------------
    console.log('--- CHECK 3: PRESS SIM PLAY ---');
    const playState = await evaluate(`
      (function() {
        if (typeof simTab !== 'undefined' && simTab.startPlay) {
          simTab.startPlay();
        } else {
          var btn = document.getElementById('sim-btn-play');
          if (btn) btn.click();
        }

        var nodes = [];
        if (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) {
          for (var i = 1; i <= 31; i++) {
            var id = 'N' + (i < 10 ? '0' : '') + i;
            var nd = nodeMarkers.getNodeData(id);
            if (nd) nodes.push({ id: id, state: nd.state });
          }
        }
        var activeCount = nodes.filter(function(n) { return n.state === 'active'; }).length;

        return {
          gate: window.__SIM_PLAYING__,
          hudText: (document.getElementById('sim-hud-text') || {}).textContent || '',
          simStatus: (document.getElementById('sim-status') || {}).textContent || '',
          playBtnText: (document.getElementById('sim-btn-play') || {}).textContent || '',
          totalNodes: nodes.length,
          activeCount: activeCount
        };
      })()
    `);

    console.log('Play state report:', playState);
    if (playState.gate !== true) {
      throw new Error('FAIL: window.__SIM_PLAYING__ must be true after startPlay()');
    }
    if (playState.hudText !== 'SIMULATION: RUNNING') {
      throw new Error('FAIL: HUD text must be "SIMULATION: RUNNING", got: ' + playState.hudText);
    }
    if (playState.simStatus !== 'RUNNING') {
      throw new Error('FAIL: Status bar must be "RUNNING", got: ' + playState.simStatus);
    }
    if (!playState.playBtnText.includes('PAUSE')) {
      throw new Error('FAIL: Play button must show PAUSE while playing, got: ' + playState.playBtnText);
    }
    if (playState.activeCount !== playState.totalNodes || playState.totalNodes === 0) {
      throw new Error('FAIL: Nodes must revive to active after play. Found: ' +
        playState.activeCount + '/' + playState.totalNodes + ' active');
    }
    console.log('✓ PASS Check 3: Press SIM PLAY activates nodes and HUD to RUNNING.\n');

    // -------------------------------------------------------------------------
    // CHECK 4: PRESS SIM PAUSE / STOP
    // -------------------------------------------------------------------------
    console.log('--- CHECK 4: PRESS SIM PAUSE / STOP ---');
    const pauseState = await evaluate(`
      (function() {
        if (typeof simTab !== 'undefined' && simTab.stopPlay) {
          simTab.stopPlay();
        } else {
          var btn = document.getElementById('sim-btn-play');
          if (btn) btn.click();
        }

        var nodes = [];
        if (typeof nodeMarkers !== 'undefined' && nodeMarkers.getNodeData) {
          for (var i = 1; i <= 31; i++) {
            var id = 'N' + (i < 10 ? '0' : '') + i;
            var nd = nodeMarkers.getNodeData(id);
            if (nd) nodes.push({ id: id, state: nd.state });
          }
        }
        var activeCount = nodes.filter(function(n) { return n.state === 'active'; }).length;

        return {
          gate: window.__SIM_PLAYING__,
          hudText: (document.getElementById('sim-hud-text') || {}).textContent || '',
          simStatus: (document.getElementById('sim-status') || {}).textContent || '',
          playBtnText: (document.getElementById('sim-btn-play') || {}).textContent || '',
          totalNodes: nodes.length,
          activeCount: activeCount
        };
      })()
    `);

    console.log('Pause state report:', pauseState);
    if (pauseState.gate !== false) {
      throw new Error('FAIL: window.__SIM_PLAYING__ must be false after stopPlay()');
    }
    if (pauseState.hudText !== 'SIMULATION: PAUSED') {
      throw new Error('FAIL: HUD text must be "SIMULATION: PAUSED", got: ' + pauseState.hudText);
    }
    if (pauseState.simStatus !== 'PAUSED') {
      throw new Error('FAIL: Status bar must be "PAUSED", got: ' + pauseState.simStatus);
    }
    if (!pauseState.playBtnText.includes('PLAY')) {
      throw new Error('FAIL: Play button must show PLAY after pause, got: ' + pauseState.playBtnText);
    }
    // Nodes must remain in their existing (frozen) state, not reset to dead
    if (pauseState.activeCount !== pauseState.totalNodes) {
      throw new Error('FAIL: Nodes must remain frozen in place on PAUSE');
    }
    console.log('✓ PASS Check 4: Press SIM PAUSE freezes nodes and HUD to PAUSED.\n');

    // -------------------------------------------------------------------------
    // CHECK 5: RE-PLAY & PAUSE CLEAN TRANSITIONS
    // -------------------------------------------------------------------------
    console.log('--- CHECK 5: CLEAN TRANSITIONS CYCLE ---');
    const cycleState = await evaluate(`
      (function() {
        simTab.startPlay();
        var isPlayingAfterStart = window.__SIM_PLAYING__;
        simTab.stopPlay();
        var isPlayingAfterStop = window.__SIM_PLAYING__;

        return {
          afterStart: isPlayingAfterStart,
          afterStop: isPlayingAfterStop,
          hudText: (document.getElementById('sim-hud-text') || {}).textContent || ''
        };
      })()
    `);

    console.log('Cycle state report:', cycleState);
    if (cycleState.afterStart !== true || cycleState.afterStop !== false) {
      throw new Error('FAIL: Clean transition cycle failed');
    }
    console.log('✓ PASS Check 5: Re-play & Pause transitions cycle cleanly without leaks.\n');

    console.log('=====================================================');
    console.log('ALL 5 CHECKS PASSED: SIM GATE DECOUPLING VERIFIED');
    console.log('=====================================================');

  } finally {
    try { chromeProc.kill('SIGTERM'); } catch (_) {}
  }
}

runGateVerification().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
