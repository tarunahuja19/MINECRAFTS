'use strict';

/**
 * dashboard_electron/test/verify_forge_b3.js
 *
 * B3: FORGE right column (health strip, node card, mini map, FORGE alarms)
 * coloured by the FORGE frame's node_states, plus the live radius preview.
 * Same harness as verify_forge_cavein.js: headless Chrome over CDP against
 * :8085 on 127.0.0.1, own FORGE server on :8022 (FORGE_PORT overrides).
 *
 *  1. radius slider 30 → 200 moves the preview ring (mini map + 3D command) before FIRE
 *  2. FIRE 10 m / 100 m at (100, 50) on day 20 clears the preview; PLAY at 20 d/s to END
 *     does not skip the collapse, and a FORGE alarm line appears
 *  3. day 20.43: health counts = frame counts; mini map and dots have as many nodes as MAP;
 *     every node within 1.2R is CRITICAL on the dots and the mini map
 *  4. clicking a mini-map node fills the node card (CRITICAL, subsidence, nearest event, first day)
 *  5. RESET FORGE clears the FORGE alarms
 *  6. MAP / ALARMS unchanged; zero :8010, /control and forbidden /api/simulation/* requests
 */

const { spawn, spawnSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpReq(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(out) }); } catch (_) { resolve({ status: res.statusCode, body: out }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) failures++;
  return cond;
}

async function run() {
  console.log('=====================================================');
  console.log('[TEST] FORGE RIGHT COLUMN + RADIUS PREVIEW (B3)');
  console.log('=====================================================\n');

  const repoRoot = path.join(__dirname, '..', '..');
  const simDir = path.join(repoRoot, 'simulation');
  const pythonBin = path.join(simDir, '.venv', 'bin', 'python');
  const imgDir = path.join(repoRoot, 'walkthroughs', 'forge-v2', 'img');
  fs.mkdirSync(imgDir, { recursive: true });

  // Node positions from the engine's own sensor layout (ground truth for check 5).
  const posOut = spawnSync(pythonBin, ['-c',
    'import json\n' +
    'from sandbox.sensors import SensorArray, SensorNoiseConfig\n' +
    'from sandbox.mqtt_bridge import _node_topic_id\n' +
    'a = SensorArray(SensorNoiseConfig(enable_noise=False))\n' +
    'print(json.dumps({_node_topic_id(n.node_id): [n.x_m, n.y_m] for n in a.nodes}))'
  ], { cwd: simDir, encoding: 'utf8' });
  const nodePos = JSON.parse(posOut.stdout);

  // ---- FORGE server --------------------------------------------------------
  const forgePort = Number(process.env.FORGE_PORT || 8022);
  const forgeBase = `http://127.0.0.1:${forgePort}`;
  let forgeProc = null;
  const health = async () => {
    try { return (await httpReq('GET', forgeBase + '/health')).status === 200; } catch (_) { return false; }
  };
  if (await health()) {
    console.log(`[SETUP] Using running FORGE server on ${forgeBase}`);
  } else {
    forgeProc = spawn(pythonBin, ['-m', 'uvicorn', 'forge.server:app', '--host', '127.0.0.1', '--port', String(forgePort)],
      { cwd: simDir, stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await health(); }
    if (!up) throw new Error('FORGE server did not start on ' + forgeBase);
    console.log(`[SETUP] Started own FORGE server on ${forgeBase}`);
  }

  // ---- Browser -------------------------------------------------------------
  const tempProfile = `/tmp/chrome_forge_b3_${Date.now()}`;
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--use-gl=angle', '--enable-webgl', '--remote-debugging-port=9228',
    `--user-data-dir=${tempProfile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1400,900', 'about:blank'
  ]);
  const cleanup = () => {
    if (forgeProc) try { forgeProc.kill('SIGTERM'); } catch (_) {}
    try { chromeProc.kill('SIGKILL'); } catch (_) {}
    try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (_) {}
  };
  process.on('exit', cleanup);

  let cdpUp = false;
  for (let i = 0; i < 40 && !cdpUp; i++) {
    await sleep(250);
    try { cdpUp = (await httpReq('GET', 'http://127.0.0.1:9228/json/version')).status === 200; } catch (_) {}
  }
  if (!cdpUp) throw new Error('Chrome CDP did not come up');

  const pageUrl = `http://127.0.0.1:8085/renderer/index.html?forge_port=${forgePort}`;
  const newPage = (await httpReq('PUT', `http://127.0.0.1:9228/json/new?${encodeURIComponent(pageUrl)}`)).body;
  const ws = new WebSocket(newPage.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();
  const contexts = new Map(); // contextId -> {origin, frameId}
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Runtime.executionContextCreated') {
      const c = msg.params.context;
      contexts.set(c.id, { origin: c.origin, frameId: c.auxData && c.auxData.frameId, isDefault: c.auxData && c.auxData.isDefault });
    } else if (msg.method === 'Runtime.executionContextDestroyed') {
      contexts.delete(msg.params.executionContextId);
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  });
  await new Promise((r) => ws.on('open', r));
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  async function evaluate(expression, contextId) {
    const params = { expression, returnByValue: true, awaitPromise: true };
    if (contextId) params.contextId = contextId;
    const res = await send('Runtime.evaluate', params);
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text + ' ' + JSON.stringify(res.exceptionDetails.exception || {}));
    return res.result ? res.result.value : undefined;
  }
  async function shot(name) {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(imgDir, name), Buffer.from(res.data, 'base64'));
    console.log(`  [SCREENSHOT] ${name}`);
  }

  await send('Page.enable');
  await send('Runtime.enable');
  // A /json/new tab does not inherit --window-size; pin the layout viewport.
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(3500);

  // Page-side spies: network, forge frames sent/applied.
  await evaluate(`(function () {
    window.__net = { control: 0, api8080Forbidden: [], status: 0, forgeFrameBodies: [] };
    var orig = window.fetch;
    window.fetch = function (url, opts) {
      var u = String(url || ''); var m = (opts && opts.method ? opts.method : 'GET').toUpperCase();
      if (u.indexOf('/control') !== -1) window.__net.control++;
      if (u.indexOf(':8010') !== -1) window.__net.lab = (window.__net.lab || 0) + 1;
      if (u.indexOf('/api/simulation/') !== -1) {
        if (u.indexOf('/api/simulation/status') !== -1 && m === 'GET') window.__net.status++;
        else window.__net.api8080Forbidden.push(m + ' ' + u);
      }
      if (u.indexOf('/forge/frame') !== -1 && opts && opts.body) {
        try { window.__net.forgeFrameBodies.push(JSON.parse(opts.body)); } catch (_) {}
      }
      return orig.apply(this, arguments);
    };
    window.__applied = [];
    window.addEventListener('message', function (e) {
      if (e.data && e.data.event === 'forge-frame-applied') window.__applied.push(e.data);
    });
    window.__lastFrame = null;
    var origSend = simEmbed.sendForgeFrame;
    simEmbed.sendForgeFrame = function (frame) { window.__lastFrame = frame; return origSend.apply(this, arguments); };
  })()`);

  // MAP / ALARMS baseline before anything happens in FORGE.
  const liveSnapshot = `(function () {
    var states = {};
    (nodeMarkers.getAllNodes() || []).forEach(function (n) { states[n.node_id || n.id] = n.state; });
    var b = document.getElementById('alarm-badge');
    return { states: states, alarms: b ? b.textContent.trim() : null };
  })()`;
  const liveBefore = await evaluate(liveSnapshot);

  // Open FORGE and wait for the seed + first frame.
  await evaluate(`document.querySelector('button.tab-btn[data-tab="forge"]').click()`);
  let seeded = false;
  for (let i = 0; i < 40 && !seeded; i++) {
    await sleep(250);
    seeded = await evaluate(`window.__applied.length > 0`);
  }
  if (!seeded) throw new Error('FORGE never applied a frame after opening');

  // FORGE iframe context (same-site, so it is in this page's process).
  const tree = await send('Page.getFrameTree');
  const frames = [];
  (function walk(n) { frames.push(n.frame); (n.childFrames || []).forEach(walk); })(tree.frameTree);
  const forgeFrame = frames.find((f) => /slot=forge/.test(f.url));
  if (!forgeFrame) throw new Error('FORGE iframe not found: ' + frames.map((f) => f.url).join(', '));
  let forgeCtx = null;
  for (const [id, c] of contexts) if (c.frameId === forgeFrame.id && c.isDefault) forgeCtx = id;
  if (!forgeCtx) throw new Error('FORGE iframe JS context not found');

  // Spy on the iframe's globalGeomechanics.triggerCollapse (same Vite module
  // instance App.tsx imported) and on its fetches.
  await evaluate(`import('/src/utils/geomechanicsEngine.ts').then(function (m) {
    var g = m.globalGeomechanics;
    window.__tc = 0;
    var orig = g.triggerCollapse;
    g.triggerCollapse = function () { window.__tc++; return orig.apply(this, arguments); };
    window.__previews = [];
    window.addEventListener('message', function (e) {
      if (e.data && e.data.cmd === 'forge-preview') window.__previews.push({ x: e.data.x, y: e.data.y, r: e.data.radius_m });
    });
    window.__iframeNet = [];
    var of = window.fetch;
    window.fetch = function (u, o) { window.__iframeNet.push(((o && o.method) || 'GET') + ' ' + String(u)); return of.apply(this, arguments); };
    return true;
  })`, forgeCtx);

  // ---- helpers --------------------------------------------------------------
  async function postTarget(x, y) {
    await evaluate(`window.parent.postMessage({ source: 'r4-sim-viewport', event: 'terrain-target',
      x: ${x}, y: ${y}, elev: 12, slopeDeg: 3.0, zoneName: 'test' }, '*')`, forgeCtx);
    await sleep(200);
  }
  const setSlider = (id, v) => evaluate(`(function () { var s = document.getElementById('${id}'); s.value = '${v}';
    s.dispatchEvent(new Event('input')); })()`);
  async function frameAt(day) {
    await evaluate(`window.__applied = []`);
    await setSlider('forge-day-slider', day);
    for (let i = 0; i < 40; i++) {
      await sleep(100);
      const a = await evaluate(`(function () { var a = window.__applied; for (var i = a.length - 1; i >= 0; i--)
        if (Math.abs(a[i].t_days - ${day}) < 0.051) return a[i]; return null; })()`);
      if (a) return a;
    }
    throw new Error('no forge-frame-applied for day ' + day);
  }
  async function waitStoppedAtEnd() {
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      const st = await evaluate(`simTab.getForgeState()`);
      if (!st.playing && Math.abs(st.day - st.endDay) < 0.01) return st;
    }
    throw new Error('PLAY did not stop at END');
  }
  const column = () => evaluate(`(function () {
    function num(k) { var b = document.querySelector('#forge-health-counts b[data-k="' + k + '"]'); return b ? b.textContent : null; }
    var dots = {}; Array.prototype.forEach.call(document.querySelectorAll('#forge-health-body .forge-health-dot'), function (d) { dots[d.dataset.nodeId] = d.dataset.state; });
    var mm = {}; Array.prototype.forEach.call(document.querySelectorAll('#forge-minimap circle.node'), function (c) { mm[c.dataset.nodeId] = c.dataset.state; });
    var pv = document.getElementById('forge-minimap-preview');
    var f = simTab.getForgeFrame();
    return { counts: { ACTIVE: num('ACTIVE'), WARNING: num('WARNING'), CRITICAL: num('CRITICAL') }, dots: dots, mini: mm,
      preview: pv ? Number(pv.dataset.radiusM) : null, frameDay: f ? f.t_days : null, frameStates: f ? f.node_states : null,
      alarms: simTab.getForgeAlarms().map(function (a) { return a.text; }),
      alarmRows: document.querySelectorAll('#forge-alarm-list .forge-alarm-row').length };
  })()`);

  // ---- 1. radius preview follows the slider before FIRE ----------------------
  console.log('\n[1] Radius preview (before FIRE)');
  await evaluate(`document.querySelector('.sim-scenario-btn[data-type="sudden_sinking"]').click()`);
  await setSlider('sim-cavein-depth', 10);
  await postTarget(100, 50);
  const seen = [];
  for (const r of [30, 80, 140, 200]) {
    await setSlider('sim-cavein-radius', r);
    await sleep(150);
    const c = await column();
    const last = await evaluate(`window.__previews[window.__previews.length - 1] || null`, forgeCtx);
    seen.push({ r, mini: c.preview, iframe: last && last.r });
  }
  console.log('  slider → mini map / 3D command:', JSON.stringify(seen));
  check(seen.every((s) => s.mini === s.r), 'mini-map preview circle radius follows the slider 30 → 200 m');
  check(seen.every((s) => s.iframe === s.r), 'the 3D view receives forge-preview with the slider radius on every input');
  const lastPv = await evaluate(`window.__previews[window.__previews.length - 1]`, forgeCtx);
  check(lastPv.x === 100 && lastPv.y === 50, 'preview is centred on the FORGE target (100, 50)');
  await setSlider('sim-cavein-radius', 100);
  await frameAt(19.5);
  await sleep(500);
  await shot('forge-b3-preview.png');

  // ---- 2. FIRE and play to END ------------------------------------------------
  console.log('\n[2] FIRE CAVE-IN 10 m / 100 m at (100, 50) on day 20, play to END at 20 d/s');
  await frameAt(20);
  await evaluate(`document.querySelector('.forge-speed-btn[data-speed="20"]').click()`);
  await evaluate(`document.getElementById('btn-sim-run-scenario').click()`);
  await sleep(300);
  const afterFire = await column();
  const pvCleared = await evaluate(`window.__previews[window.__previews.length - 1]`, forgeCtx);
  check(afterFire.preview === null && pvCleared.x === null, 'FIRE clears the preview (mini map and 3D)');
  const endSt = await waitStoppedAtEnd();
  await sleep(400);
  const atEnd = await column();
  console.log(`  END day ${endSt.day}; FORGE alarms (${atEnd.alarms.length}):`);
  atEnd.alarms.slice(0, 8).forEach((a) => console.log('    ' + a));
  check(atEnd.alarms.some((a) => /→ CRITICAL \(CAVE-IN #\d+, \d+ m\)/.test(a)), 'PLAY at 20 d/s did not skip the collapse: a "→ CRITICAL (CAVE-IN #n, d m)" alarm line appeared');
  check(atEnd.alarmRows === atEnd.alarms.length, `alarm list shows every alarm (${atEnd.alarmRows} rows)`);
  await shot('forge-b3-after-end.png');

  // ---- 3. inside the collapse window: every view agrees with the frame -------
  console.log('\n[3] Day 20.43 (collapse in progress)');
  await frameAt(20.43);
  await sleep(300);
  const mid = await column();
  const fc = { ACTIVE: 0, WARNING: 0, CRITICAL: 0 };
  Object.values(mid.frameStates).forEach((s) => { fc[s]++; });
  console.log('  frame counts:', JSON.stringify(fc), '| strip:', JSON.stringify(mid.counts));
  check(Number(mid.counts.ACTIVE) === fc.ACTIVE && Number(mid.counts.WARNING) === fc.WARNING && Number(mid.counts.CRITICAL) === fc.CRITICAL,
    'health counts equal the frame node_states counts');
  check(fc.CRITICAL > 0, `the collapse makes nodes CRITICAL (${fc.CRITICAL})`);
  const mapCount = await evaluate(`(nodeMarkers.getAllNodes() || []).length`);
  check(Object.keys(mid.mini).length === mapCount && Object.keys(mid.dots).length === mapCount,
    `mini map (${Object.keys(mid.mini).length}) and dots (${Object.keys(mid.dots).length}) have as many nodes as the MAP tab (${mapCount})`);
  const inside = Object.keys(nodePos).filter((id) => Math.hypot(nodePos[id][0] - 100, nodePos[id][1] - 50) <= 120);
  console.log('  within 1.2R:', inside.join(','));
  check(inside.length > 0 && inside.every((id) => mid.dots[id] === 'CRITICAL' && mid.mini[id] === 'CRITICAL'),
    'every node within 1.2R is CRITICAL on the dots and on the mini map');
  check(Object.keys(mid.frameStates).every((id) => mid.dots[id] === mid.frameStates[id]), 'every dot matches its frame state');
  await shot('forge-b3-during.png');

  // ---- 4. node detail ---------------------------------------------------------
  console.log('\n[4] Node detail for ' + inside[0]);
  await evaluate(`document.querySelector('#forge-minimap circle.node[data-node-id="${inside[0]}"]').dispatchEvent(new MouseEvent('click'))`);
  await sleep(200);
  const card = await evaluate(`(function () { var c = document.querySelector('#forge-node-detail .forge-node-card');
    return c ? { id: c.dataset.nodeId, state: c.dataset.state, text: c.innerText } : null; })()`);
  console.log('  card:', card && card.text.replace(/\n/g, ' | '));
  check(card && card.id === inside[0] && card.state === 'CRITICAL', 'clicking a mini-map node selects it; the card shows CRITICAL');
  check(card && /Subsidence\s*\|?\s*-?\d/.test(card.text.replace(/\n/g, ' | ')) && /CAVE-IN #\d/.test(card.text) && /CRIT d20/.test(card.text),
    'card shows subsidence, the nearest event and the first CRITICAL day');
  await shot('forge-b3-node-selected.png');

  // ---- 5. RESET clears FORGE alarms ------------------------------------------
  await evaluate(`document.getElementById('btn-forge-reset').click()`);
  await sleep(600);
  const afterReset = await column();
  check(afterReset.alarms.length === 0 && afterReset.preview === null, 'RESET FORGE clears FORGE alarms and the preview');

  // ---- 6. MAP / ALARMS unchanged, isolation, no :8010 --------------------------
  console.log('\n[6] Live tabs and requests');
  const liveAfter = await evaluate(liveSnapshot);
  check(JSON.stringify(liveBefore.states) === JSON.stringify(liveAfter.states), `MAP node states unchanged (${Object.keys(liveAfter.states).length} nodes)`);
  check(liveBefore.alarms === liveAfter.alarms, `ALARMS count unchanged (${liveAfter.alarms})`);
  const net = await evaluate(`({ control: window.__net.control, forbidden: window.__net.api8080Forbidden, lab: window.__net.lab || 0 })`);
  const iframeNet = await evaluate(`window.__iframeNet`, forgeCtx);
  console.log('  page:', JSON.stringify(net));
  check(net.lab === 0 && !iframeNet.some((u) => /:8010/.test(u)), 'zero requests to :8010 from FORGE');
  check(net.control === 0 && net.forbidden.length === 0, 'zero /control and zero /api/simulation/* other than GET status');

  console.log('\n=====================================================');
  console.log(failures === 0 ? 'ALL FORGE B3 CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  console.log('=====================================================');
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
