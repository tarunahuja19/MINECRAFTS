'use strict';

/**
 * verify_no_beacon_on_load.js — Regression test for the stray targeting-ring bug (FORGE v3, Q1)
 *
 * simulation/frontend's App.tsx used to default `beaconHidden` to `false`
 * regardless of embed mode, so the hardcoded default `targetLocation` beacon
 * rendered on first paint in both the SIM and FORGE embedded viewports.
 * `beaconHidden` must now initialise to `isEmbed`, so a fresh load of either
 * embedded slot renders no beacon mesh at all until the slot's own trigger
 * (a `trigger` command for SIM, a terrain click or `forge-preview` for
 * FORGE) asks for one.
 *
 * This starts simulation/frontend's own Vite dev server (isolated on a test
 * port — never the developer's :5173) and drives a headless Chrome tab per
 * embed slot. The beacon is 3D content inside a react-three-fiber <Canvas>,
 * not the DOM, so DOM inspection can't see it; this reaches the actual
 * THREE.Scene via @react-three/fiber's exported `_roots` map (keyed by the
 * canvas element), found by re-`import()`-ing the exact resolved module URL
 * Vite already loaded (browsers cache ES modules per URL, so this returns
 * the live, already-running module instance) — then traverses the scene
 * for the beacon crystal's distinctive `OctahedronGeometry`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const WebSocket = require(path.join(__dirname, '..', '..', 'backend', 'node_modules', 'ws'));

const TEST_VITE_PORT = 5199;
const TEST_CDP_PORT_BASE = 9330;

const repoRoot = path.join(__dirname, '..', '..');
const simFrontendDir = path.join(repoRoot, 'simulation', 'frontend');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (_) { resolve(data); }
      });
    }).on('error', reject);
  });
}

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
        try { resolve(JSON.parse(data)); } catch (_) { resolve(data); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Finds the beacon's THREE.Scene via @react-three/fiber's `_roots` map and
// reports whether the octahedron "crystal" mesh — unique to TargetBeacon —
// is anywhere in it.
const BEACON_CHECK_EXPR = `
  (async () => {
    const entries = performance.getEntriesByType('resource').map(e => e.name);
    const fiberUrl = entries.find(u => u.includes('.vite/deps/@react-three_fiber.js'));
    if (!fiberUrl) return { error: 'react-three-fiber module URL not found in resource timing' };
    const mod = await import(fiberUrl);
    const canvas = document.querySelector('canvas');
    if (!canvas) return { error: 'no <canvas> in DOM' };
    const root = mod._roots.get(canvas);
    if (!root) return { error: 'no r3f root registered for canvas' };
    const scene = root.store.getState().scene;
    let beaconFound = false;
    scene.traverse((o) => {
      if (o.geometry && o.geometry.type === 'OctahedronGeometry') beaconFound = true;
    });
    return { beaconFound };
  })()
`;

async function checkSlotHasNoBeacon(targetUrl, cdpPort) {
  const tempProfile = `/tmp/chrome_no_beacon_${cdpPort}_${Date.now()}`;
  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--use-gl=angle',
    '--enable-webgl',
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${tempProfile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1400,900',
    'about:blank'
  ]);

  try {
    let cdpReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        await httpGet(`http://127.0.0.1:${cdpPort}/json/version`);
        cdpReady = true;
        break;
      } catch (_) {}
    }
    if (!cdpReady) throw new Error(`Chrome debugging port ${cdpPort} failed to respond`);

    const newPage = await httpPut(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(targetUrl)}`);
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

    async function evaluate(expression) {
      const res = await sendCmd('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.text || JSON.stringify(res.exceptionDetails));
      }
      return res.result ? res.result.value : undefined;
    }

    await sendCmd('Page.enable');
    await sendCmd('Runtime.enable');

    // Fresh load, no interaction — just long enough for the terrain + beacon
    // effects to mount if they were going to.
    await sleep(4000);

    const result = await evaluate(BEACON_CHECK_EXPR);
    if (result.error) throw new Error(result.error);
    return result.beaconFound;
  } finally {
    try { chromeProc.kill('SIGKILL'); } catch (_) {}
  }
}

async function run() {
  console.log('=====================================================');
  console.log('[TEST] NO STRAY BEACON RING ON LOAD (FORGE v3, Q1)');
  console.log('=====================================================\n');

  let viteProc = null;

  const cleanup = () => {
    if (viteProc) {
      try { viteProc.kill('SIGKILL'); } catch (_) {}
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  try {
    console.log(`[STEP 1] Starting isolated simulation/frontend dev server on :${TEST_VITE_PORT}...`);
    let viteLogs = [];
    viteProc = spawn(process.execPath, [
      path.join(simFrontendDir, 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(TEST_VITE_PORT),
      '--strictPort'
    ], { cwd: simFrontendDir });
    viteProc.stdout.on('data', chunk => viteLogs.push(chunk.toString()));
    viteProc.stderr.on('data', chunk => viteLogs.push(chunk.toString()));

    let viteReady = false;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        await httpGet(`http://127.0.0.1:${TEST_VITE_PORT}/`);
        viteReady = true;
        break;
      } catch (_) {}
    }
    if (!viteReady) {
      console.error('Vite output:\n' + viteLogs.join(''));
      throw new Error(`simulation/frontend dev server failed to start on :${TEST_VITE_PORT}`);
    }
    console.log(`  PASS  Dev server running on http://127.0.0.1:${TEST_VITE_PORT}`);

    console.log('[STEP 2] Checking SIM slot for a beacon mesh on load...');
    const simHasBeacon = await checkSlotHasNoBeacon(
      `http://127.0.0.1:${TEST_VITE_PORT}/?embed=1&slot=sim`,
      TEST_CDP_PORT_BASE + 1
    );
    if (simHasBeacon) throw new Error('SIM slot rendered a beacon mesh on fresh load (expected none until a `trigger` command)');
    console.log('  PASS  SIM slot: no beacon mesh on load');

    console.log('[STEP 3] Checking FORGE slot for a beacon mesh on load...');
    const forgeHasBeacon = await checkSlotHasNoBeacon(
      `http://127.0.0.1:${TEST_VITE_PORT}/?embed=1&slot=forge`,
      TEST_CDP_PORT_BASE + 2
    );
    if (forgeHasBeacon) throw new Error('FORGE slot rendered a beacon mesh on fresh load (expected none until a terrain click or forge-preview)');
    console.log('  PASS  FORGE slot: no beacon mesh on load');

    console.log('\n=====================================================');
    console.log('ALL NO-STRAY-BEACON CHECKS PASSED');
    console.log('=====================================================\n');
  } finally {
    cleanup();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nFAIL:', err);
    process.exit(1);
  });
