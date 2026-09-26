'use strict';

/**
 * dashboard_electron/test/verify_forge_cavein.js
 *
 * B2c: click-to-target and CAVE-IN as a FORGE timeline event.
 *
 * Headless Chrome over CDP against the dashboard on :8085 (same harness as
 * verify_sandbox / verify_forge_timeline). The page is opened on 127.0.0.1 so
 * the FORGE iframe (127.0.0.1:5173) is same-site and its JS context is
 * reachable with Runtime.evaluate({contextId}).
 *
 * Starts its own FORGE math server on :8022 from the working tree
 * (FORGE_PORT overrides; 8021 is held by macOS launchd).
 *
 *  1. a real click on the FORGE terrain posts terrain-target (readout leaves "(default)");
 *     before any click the readout is x 0 · y 0 (default)
 *  2. terrain-target at (100, 50) → readout shows it
 *  3. depth 10 m, radius 100 m, day 20, FIRE → event line, PLAY starts, stops at END
 *  4. at END max_amp ≈ 10 m (±10%); day 19 → perturbations = 0
 *  5. day 20.5: nodes within 1.2 × 100 m of (100, 50) are CRITICAL in the FORGE frame
 *  6. MAP node states and the ALARMS count are unchanged
 *  7. globalGeomechanics.triggerCollapse was not called in the FORGE slot
 *     (control: an old-style `trigger` does move the spy, so the spy is live)
 *  8. zero requests to :8000/control and :8080/api/simulation/* (except GET status)
 *  9. screenshots before / during / after at two spots
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
  console.log('[TEST] FORGE CAVE-IN AS A TIMELINE EVENT (B2c)');
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
  const tempProfile = `/tmp/chrome_forge_cavein_${Date.now()}`;
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--use-gl=angle', '--enable-webgl', '--remote-debugging-port=9227',
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
    try { cdpUp = (await httpReq('GET', 'http://127.0.0.1:9227/json/version')).status === 200; } catch (_) {}
  }
  if (!cdpUp) throw new Error('Chrome CDP did not come up');

  const pageUrl = `http://127.0.0.1:8085/renderer/index.html?forge_port=${forgePort}`;
  const newPage = (await httpReq('PUT', `http://127.0.0.1:9227/json/new?${encodeURIComponent(pageUrl)}`)).body;
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
    window.__iframeNet = [];
    var of = window.fetch;
    window.fetch = function (u, o) { window.__iframeNet.push(((o && o.method) || 'GET') + ' ' + String(u)); return of.apply(this, arguments); };
    return true;
  })`, forgeCtx);

  // ---- 1. default readout, then a real click ------------------------------
  console.log('\n[1] Target readout');
  const readout = () => evaluate(`document.getElementById('forge-target-readout').textContent`);
  const r0 = await readout();
  console.log('  before click:', JSON.stringify(r0));
  check(/x 0 m · y 0 m \(default\)/.test(r0), 'before any click the target is (0, 0) (default)');

  // The FORGE iframe is created on first tab show and grows to its column
  // width a moment later; click only once it has its real size.
  let rect = null;
  for (let i = 0; i < 40; i++) {
    rect = await evaluate(`(function () {
      var f = document.querySelector('iframe[src*="slot=forge"]');
      var r = f.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    if (rect.w > 400 && rect.h > 400) break;
    await sleep(250);
  }
  await sleep(1000);
  const cx = Math.round(rect.x + rect.w * 0.45);
  const cy = Math.round(rect.y + rect.h * 0.55);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 });
    await sleep(60);
  }
  await sleep(500);
  const r1 = await readout();
  console.log('  after real click:', JSON.stringify(r1));
  check(!/\(default\)/.test(r1) && /elev \+/.test(r1), 'a real terrain click posts terrain-target and fills the readout');

  // Exact spot for the numeric checks: the iframe posts terrain-target itself.
  async function postTarget(x, y) {
    await evaluate(`window.parent.postMessage({ source: 'r4-sim-viewport', event: 'terrain-target',
      x: ${x}, y: ${y}, elev: 12, slopeDeg: 3.0, zoneName: 'test' }, '*')`, forgeCtx);
    await sleep(200);
  }
  await postTarget(100, 50);
  const r2 = await readout();
  console.log('  after terrain-target (100, 50):', JSON.stringify(r2));
  check(/^x 100 m · y 50 m/.test(r2), 'readout shows the posted target (100, 50)');

  // ---- helpers --------------------------------------------------------------
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
  async function fireCaveIn(day, depth, radius) {
    await frameAt(day);
    await evaluate(`document.querySelector('.sim-scenario-btn[data-type="sudden_sinking"]').click()`);
    await setSlider('sim-cavein-depth', depth);
    await setSlider('sim-cavein-radius', radius);
    await evaluate(`document.querySelector('.forge-speed-btn[data-speed="20"]').click()`);
    await evaluate(`document.getElementById('btn-sim-run-scenario').click()`);
  }
  async function waitStoppedAtEnd() {
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      const st = await evaluate(`simTab.getForgeState()`);
      if (!st.playing && Math.abs(st.day - st.endDay) < 0.01) return st;
    }
    throw new Error('PLAY did not stop at END');
  }

  // ---- 3. FIRE at (100, 50) --------------------------------------------------
  console.log('\n[3] FIRE CAVE-IN 10 m / 100 m at (100, 50) on day 20');
  await frameAt(19.5);
  await shot('forge-cavein-a-before.png');
  await fireCaveIn(20, 10, 100);
  await sleep(300);
  const afterFire = await evaluate(`({ st: simTab.getForgeState(),
    list: Array.from(document.querySelectorAll('#forge-event-list .forge-event-row')).map(function (r) { return r.textContent; }) })`);
  console.log('  event list:', JSON.stringify(afterFire.list));
  const ev = afterFire.st.events.find((e) => e.source !== 'live');
  console.log('  event:', JSON.stringify(ev));
  check(afterFire.list.indexOf('Day 20.0 · CAVE-IN 10 m / 100 m at (100, 50)') !== -1, 'event list has "Day 20.0 · CAVE-IN 10 m / 100 m at (100, 50)"');
  check(ev && ev.x === 100 && ev.y === 50 && ev.depth_m === 10 && ev.radius_m === 100 && ev.day === 20 && ev.duration_h === 4.8,
    'event carries the slider values, the target and the FORGE day (duration_h = engine default 4.8)');
  check(afterFire.st.playing === true, 'PLAY started after FIRE');
  const sentWithEvent = await evaluate(`window.__net.forgeFrameBodies.some(function (b) {
    return (b.events || []).some(function (e) { return e.x === 100 && e.y === 50 && e.depth_m === 10; }); })`);
  check(sentWithEvent, 'a /forge/frame request carrying the new event followed FIRE');
  const endSt = await waitStoppedAtEnd();
  console.log(`  stopped at day ${endSt.day} / END ${endSt.endDay}`);
  check(true, 'PLAY stopped at END by itself');
  await sleep(300);
  await shot('forge-cavein-a-after.png');
  // "During": inside the collapse (starts day 20 + 8 h, lasts 4.8 h).
  await frameAt(20.43);
  await sleep(400);
  await shot('forge-cavein-a-during.png');

  // ---- 4. depth at END, nothing before day 20 --------------------------------
  console.log('\n[4] Depth at END and before the event');
  const atEnd = await frameAt(endSt.endDay);
  console.log('  END applied:', JSON.stringify(atEnd));
  check(Math.abs(atEnd.max_amp - 10) <= 1.0, `max_amp at END ≈ 10 m (±10%): ${atEnd.max_amp}`);
  const at19 = await frameAt(19);
  console.log('  day 19 applied:', JSON.stringify(at19));
  check(at19.perturbations === 0, 'day 19: perturbations = 0');

  // ---- 5. node states inside the active window -------------------------------
  console.log('\n[5] Node states at day 20.5');
  const at205 = await frameAt(20.5);
  console.log('  day 20.5 applied:', JSON.stringify(at205));
  const ns = await evaluate(`window.__lastFrame && window.__lastFrame.t_days === 20.5 ? window.__lastFrame.node_states : null`);
  const inside = Object.keys(nodePos).filter((id) => Math.hypot(nodePos[id][0] - 100, nodePos[id][1] - 50) <= 120);
  const critical = ns ? Object.keys(ns).filter((id) => ns[id] === 'CRITICAL') : [];
  console.log('  within 1.2R:', inside.join(','), '| CRITICAL in frame:', critical.join(','));
  check(inside.length > 0 && inside.every((id) => ns && ns[id] === 'CRITICAL'), 'every node within 1.2 × 100 m of (100, 50) is CRITICAL in the FORGE frame');

  // ---- 9. second spot --------------------------------------------------------
  console.log('\n[9] Second spot: RESET FORGE, then 6 m / 60 m at (-150, -80) on day 30');
  await evaluate(`document.getElementById('btn-forge-reset').click()`);
  await sleep(600);
  const afterReset = await evaluate(`({ st: simTab.getForgeState(),
    list: Array.from(document.querySelectorAll('#forge-event-list .forge-event-row')).map(function (r) { return r.textContent; }) })`);
  check(afterReset.st.events.every((e) => e.source === 'live') && afterReset.list.length === afterReset.st.events.length,
    `RESET FORGE cleared FORGE's own events (left: ${afterReset.st.events.length} live)`);
  await postTarget(-150, -80);
  await frameAt(29.5);
  await shot('forge-cavein-b-before.png');
  await fireCaveIn(30, 6, 60);
  await waitStoppedAtEnd();
  await sleep(300);
  await shot('forge-cavein-b-after.png');
  const bEnd = await evaluate(`window.__applied[window.__applied.length - 1]`);
  await frameAt(30.43);
  await sleep(400);
  await shot('forge-cavein-b-during.png');
  console.log('  spot B END applied:', JSON.stringify(bEnd));
  check(Math.abs(bEnd.max_amp - 6) <= 0.6, `spot B max_amp at END ≈ 6 m: ${bEnd.max_amp}`);

  // ---- 7. no triggerCollapse in FORGE for CAVE-IN ----------------------------
  console.log('\n[7] globalGeomechanics.triggerCollapse in the FORGE slot');
  const tcCount = await evaluate(`window.__tc`, forgeCtx);
  check(tcCount === 0, `triggerCollapse calls during both CAVE-INs: ${tcCount}`);

  // ---- 6. MAP / ALARMS unchanged ---------------------------------------------
  console.log('\n[6] MAP node states and ALARMS count');
  const liveAfter = await evaluate(liveSnapshot);
  console.log('  ALARMS before/after:', liveBefore.alarms, '/', liveAfter.alarms);
  check(JSON.stringify(liveBefore.states) === JSON.stringify(liveAfter.states), `MAP node states unchanged (${Object.keys(liveAfter.states).length} nodes)`);
  check(liveBefore.alarms === liveAfter.alarms, 'ALARMS count unchanged');

  // ---- 8. request isolation --------------------------------------------------
  console.log('\n[8] Requests');
  const net = await evaluate(`({ control: window.__net.control, forbidden: window.__net.api8080Forbidden, status: window.__net.status })`);
  const iframeNet = await evaluate(`window.__iframeNet`, forgeCtx);
  console.log('  page:', JSON.stringify(net), '| FORGE iframe fetches:', JSON.stringify(iframeNet));
  check(net.control === 0 && net.forbidden.length === 0, 'page: zero :8000/control and zero :8080/api/simulation/* other than GET status');
  check(!iframeNet.some((u) => /\/control|\/api\/simulation\//.test(u)), 'FORGE iframe: zero /control and /api/simulation/* requests');

  // ---- 7b. control: the spy is live ------------------------------------------
  const tcBefore = await evaluate(`window.__tc`, forgeCtx);
  await evaluate(`simEmbed.triggerScenario('forge', 'collapse', 0, 0, 1, 50)`);
  await sleep(500);
  const tcAfter = await evaluate(`window.__tc`, forgeCtx);
  check(tcAfter === tcBefore + 1, `spy control: an old-style 'trigger' collapse moves the spy (${tcBefore} → ${tcAfter})`);

  console.log('\n=====================================================');
  console.log(failures === 0 ? 'ALL FORGE CAVE-IN CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  console.log('=====================================================');
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
