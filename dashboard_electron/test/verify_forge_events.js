'use strict';

/**
 * dashboard_electron/test/verify_forge_events.js
 *
 * B2e TILT and B2f VIBRATION as FORGE timeline events (CRACK stays unbuilt).
 * Same harness as verify_forge_b3.js (own FORGE server on :8022).
 *
 *  1. CRACK says it is not built and adds no event
 *  2. TILT = the engine's tilt: a cave-in centred one radius off the target along the
 *     bearing, depth = rate × r; preview on the offset bowl; :8020 computes it exactly
 *     as that cave-in; nodes within 1.2R of the bowl go CRITICAL mid-collapse
 *  3. VIBRATION = Session.apply_vibration: site-wide PPV on every node for 60 s, no ground,
 *     no node state change; PLAY lands inside the 60 s window; node card shows it
 *  4. no triggerCollapse in the FORGE slot; MAP/ALARMS unchanged; no :8010 / control calls
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
  console.log('[TEST] FORGE TILT + VIBRATION EVENTS (B2e, B2f)');
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
  const tempProfile = `/tmp/chrome_forge_events_${Date.now()}`;
  const chromeProc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new', '--use-gl=angle', '--enable-webgl', '--remote-debugging-port=9229',
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
    try { cdpUp = (await httpReq('GET', 'http://127.0.0.1:9229/json/version')).status === 200; } catch (_) {}
  }
  if (!cdpUp) throw new Error('Chrome CDP did not come up');

  const pageUrl = `http://127.0.0.1:8085/renderer/index.html?forge_port=${forgePort}`;
  const newPage = (await httpReq('PUT', `http://127.0.0.1:9229/json/new?${encodeURIComponent(pageUrl)}`)).body;
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
    window.__lastFrame = null; window.__vibSeen = [];
    var origSend = simEmbed.sendForgeFrame;
    simEmbed.sendForgeFrame = function (frame) { window.__lastFrame = frame; if (frame.vib_mm_s > 0) window.__vibSeen.push(frame.t_days); return origSend.apply(this, arguments); };
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
    window.__previews = []; window.__effects = [];
    window.addEventListener('message', function (e) {
      if (e.data && e.data.cmd === 'forge-preview') window.__previews.push({ x: e.data.x, y: e.data.y, r: e.data.radius_m });
      if (e.data && e.data.cmd === 'forge-effect') window.__effects.push({ type: e.data.type, cx: e.data.cx, cy: e.data.cy, ppv: e.data.ppv });
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

  const eventRows = () => evaluate(`Array.from(document.querySelectorAll('#forge-event-list .forge-event-row')).map(function (r) { return r.textContent; })`);
  const own = () => evaluate(`simTab.getForgeState().events.filter(function (e) { return e.source !== 'live'; })`);
  async function directFrame(day, events) {
    return (await httpReq('POST', forgeBase + '/forge/frame', { day, events })).body;
  }
  // The tests below expect the default target; make it explicit.
  await postTarget(0, 0);

  // ---- 1. CRACK is not built ---------------------------------------------------
  console.log('\n[1] CRACK');
  await evaluate(`document.querySelector('.sim-scenario-btn[data-type="crack"]').click()`);
  await evaluate(`document.getElementById('btn-sim-run-scenario').click()`);
  await sleep(200);
  const crackBtn = await evaluate(`document.getElementById('btn-sim-run-scenario').textContent`);
  check(/NOT BUILT YET/.test(crackBtn) && (await own()).length === 0, `CRACK says "${crackBtn}" and adds no event`);

  // ---- 2. TILT -----------------------------------------------------------------
  console.log('\n[2] TILT 5 mm/m toward 90° (east), r 100 m, at target (0, 0), day 20');
  await evaluate(`document.querySelector('.sim-scenario-btn[data-type="tilt"]').click()`);
  await setSlider('sim-tilt-rate', 5);
  await setSlider('sim-tilt-dir', 90);
  await setSlider('sim-tilt-radius', 100);
  await sleep(150);
  const pv = await evaluate(`window.__previews[window.__previews.length - 1]`, forgeCtx);
  console.log('  preview:', JSON.stringify(pv));
  check(Math.abs(pv.x - 100) < 1e-6 && Math.abs(pv.y) < 1e-6 && pv.r === 100, 'TILT preview ring sits on the offset bowl (100, 0), r 100');
  await frameAt(19.5);
  await shot('forge-tilt-preview.png');
  await frameAt(20);
  await evaluate(`document.querySelector('.forge-speed-btn[data-speed="20"]').click()`);
  await evaluate(`document.getElementById('btn-sim-run-scenario').click()`);
  await sleep(300);
  const tiltEv = (await own())[0];
  console.log('  event:', JSON.stringify(tiltEv));
  console.log('  rows:', JSON.stringify(await eventRows()));
  check(tiltEv && tiltEv.type === 'cave_in' && tiltEv.kind === 'tilt' && Math.abs(tiltEv.x - 100) < 1e-6 && Math.abs(tiltEv.y) < 1e-6 &&
    tiltEv.radius_m === 100 && Math.abs(tiltEv.depth_m - 0.5) < 1e-9 && tiltEv.day === 20,
    'TILT event = engine tilt: cave-in centred one radius off the target, depth = rate × r');
  check((await eventRows()).indexOf('Day 20.0 · TILT 5 mm/m toward 90° at (0, 0), r 100 m') !== -1, 'event list shows the TILT line');
  const eff = await evaluate(`window.__effects[window.__effects.length - 1]`, forgeCtx);
  check(eff && eff.type === 'tilt' && Math.abs(eff.cx - 100) < 1e-6, 'forge-effect "tilt" played at the bowl');
  await waitStoppedAtEnd();
  const tEnd = await evaluate(`simTab.getForgeState().endDay`);
  const tiltApplied = await frameAt(tEnd);
  const asCave = await directFrame(tEnd, [Object.assign({}, tiltEv, { kind: 'cave_in' })]);
  const withTilt = await directFrame(tEnd, [tiltEv]);
  console.log('  END applied:', JSON.stringify(tiltApplied), '| max subsidence tilt/cave:', withTilt.terrain.max_subsidence_m, asCave.terrain.max_subsidence_m);
  check(Math.abs(tiltApplied.max_amp - 0.5) <= 0.05, `max_amp at END ≈ 0.5 m: ${tiltApplied.max_amp}`);
  check(JSON.stringify(withTilt.terrain) === JSON.stringify(asCave.terrain), ':8020 computes TILT exactly as the offset cave-in');
  await frameAt(20.43);
  await sleep(300);
  const mid = await evaluate(`simTab.getForgeFrame().node_states`);
  const inside = Object.keys(nodePos).filter((id) => Math.hypot(nodePos[id][0] - 100, nodePos[id][1]) <= 120);
  console.log('  within 1.2R of the bowl:', inside.join(','));
  check(inside.length > 0 && inside.every((id) => mid[id] === 'CRITICAL'), 'nodes within 1.2R of the tilt bowl are CRITICAL mid-collapse');
  await shot('forge-tilt-during.png');

  // ---- 3. VIBRATION ------------------------------------------------------------
  console.log('\n[3] VIBRATION 20 mm/s on day 30');
  await evaluate(`document.getElementById('btn-forge-reset').click()`);
  await sleep(600);
  await evaluate(`document.querySelector('.sim-scenario-btn[data-type="vibration"]').click()`);
  const vibPreview = await evaluate(`document.getElementById('forge-minimap-preview')`);
  check(vibPreview === null, 'VIBRATION shows no radius preview (site-wide)');
  await setSlider('sim-vib-ppv', 20);
  await frameAt(30);
  await evaluate(`window.__vibSeen = []`);
  await evaluate(`document.getElementById('btn-sim-run-scenario').click()`);
  await sleep(300);
  const vibEv = (await own())[0];
  console.log('  event:', JSON.stringify(vibEv));
  check(vibEv && vibEv.type === 'vibration' && vibEv.ppv_mm_s === 20 && vibEv.duration_s === 60 && vibEv.day === 30,
    'VIBRATION event carries PPV 20 mm/s, 60 s (engine default), day 30');
  check((await eventRows()).indexOf('Day 30.0 · VIBRATION 20 mm/s for 60 s (site-wide)') !== -1, 'event list shows the VIBRATION line');
  const veff = await evaluate(`window.__effects[window.__effects.length - 1]`, forgeCtx);
  check(veff && veff.type === 'vibration' && veff.ppv === 20, 'forge-effect "vibration" (shake) reached the 3D view');
  await waitStoppedAtEnd();
  const vibSeen = await evaluate(`window.__vibSeen`);
  console.log('  frames with vibration during PLAY at days:', JSON.stringify(vibSeen));
  check(vibSeen.length > 0, 'PLAY landed inside the 60 s vibration window');
  const during = await directFrame(30 + 30 / 86400, [vibEv]);
  const quiet = await directFrame(30 + 30 / 86400, []);
  check(during.nodes.every((n) => n.vib_rms === 20), 'inside the window every node reads vib_rms 20 mm/s');
  check(JSON.stringify(during.terrain) === JSON.stringify(quiet.terrain) && JSON.stringify(during.node_states) === JSON.stringify(quiet.node_states),
    'vibration moves no ground and changes no node state');
  await setSlider('forge-day-slider', 30.0002);
  await sleep(600);
  await evaluate(`simTab.selectNode('N01', 'forge')`);
  await sleep(200);
  const card = await evaluate(`document.getElementById('forge-node-detail').innerText`);
  console.log('  N01 card:', card.replace(/\n/g, ' | '));
  check(/Vibration\s*\n?\s*20\.0 mm\/s RMS/.test(card), 'node card shows the vibration reading');
  await shot('forge-vibration.png');

  // ---- 4. isolation ------------------------------------------------------------
  console.log('\n[4] Isolation');
  const tcCount = await evaluate(`window.__tc`, forgeCtx);
  check(tcCount === 0, `globalGeomechanics.triggerCollapse calls in the FORGE slot: ${tcCount}`);
  const liveAfter = await evaluate(liveSnapshot);
  check(JSON.stringify(liveBefore.states) === JSON.stringify(liveAfter.states) && liveBefore.alarms === liveAfter.alarms, 'MAP node states and ALARMS count unchanged');
  const net = await evaluate(`({ control: window.__net.control, forbidden: window.__net.api8080Forbidden, lab: window.__net.lab || 0 })`);
  console.log('  page:', JSON.stringify(net));
  check(net.lab === 0 && net.control === 0 && net.forbidden.length === 0, 'zero :8010, /control and forbidden /api/simulation/* requests');

  console.log('\n=====================================================');
  console.log(failures === 0 ? 'ALL FORGE EVENT CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  console.log('=====================================================');
  cleanup();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
