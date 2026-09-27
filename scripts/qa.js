#!/usr/bin/env node
'use strict';
/**
 * scripts/qa.js — One-command QA gate for the R4 Mine Subsidence system.
 *
 * Runnable by humans, Claude Code (`/qa`), or Antigravity (`npm run qa`).
 * No npm dependencies: uses only Node built-ins (http, fs, path).
 * Node 18+ required (global fetch).
 *
 * Checks:
 *  1. Backend REST endpoints alive (:8080, :8000, :8010, :8085)
 *  2. WebSocket handshake on ws://127.0.0.1:8080/ws
 *  3. Static wiring: SIM close button, loading overlay, WS logic, lit-up CSS
 *  4. FORGE isolation while `npm run demo:scripted` runs (opt-in: --scripted,
 *     or start the demo yourself first — it resets the demo database)
 *
 * Exit 0 = ALL PASS, exit 1 = any FAIL. WARN never fails the gate.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0, warn = 0;
const results = [];

function row(status, name, detail) {
  results.push({ status, name, detail: detail || '' });
  if (status === 'PASS') pass++;
  else if (status === 'FAIL') fail++;
  else warn++;
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '!';
  console.log(`[${icon} ${status}] ${name}${detail ? ' — ' + detail : ''}`);
}

function fetchJson(url, timeoutMs = 2500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { cache: 'no-store', signal: ctrl.signal })
    .then(async (r) => ({ ok: r.ok, status: r.status, body: await r.text().catch(() => '') }))
    .finally(() => clearTimeout(t));
}

async function checkHttp(name, url, validate) {
  try {
    const res = await fetchJson(url);
    if (validate) {
      const msg = validate(res);
      if (msg === true) row('PASS', name, `HTTP ${res.status}`);
      else row('FAIL', name, typeof msg === 'string' ? msg : `HTTP ${res.status}`);
    } else if (res.ok || res.status === 404) {
      // 404 on a static prefix still proves the server is up
      row('PASS', name, `alive (HTTP ${res.status})`);
    } else {
      row('FAIL', name, `HTTP ${res.status}`);
    }
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'timeout' : (e.cause ? e.cause.code || e.message : e.message);
    row('FAIL', name, `unreachable (${reason}) — is the server running?`);
  }
}

function checkWs(name, wsUrl) {
  return new Promise((resolve) => {
    const u = new URL(wsUrl);
    const key = Buffer.from('qa-probe-1234567').toString('base64');
    const req = http.request({
      host: u.hostname, port: Number(u.port) || 80, path: u.pathname || '/ws',
      method: 'GET',
      headers: {
        Upgrade: 'websocket', Connection: 'Upgrade',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13',
      },
      timeout: 2500,
    }, (res) => {
      // A plain HTTP response means the server is up but WS upgrade failed
      row('FAIL', name, `no WS upgrade (HTTP ${res.statusCode})`);
      res.resume();
      resolve();
    });
    req.on('upgrade', (res) => {
      row('PASS', name, `upgrade OK (HTTP ${res.statusCode || 101})`);
      req.destroy();
      resolve();
    });
    req.on('timeout', () => { row('FAIL', name, 'timeout'); req.destroy(); resolve(); });
    req.on('error', (e) => { row('FAIL', name, `unreachable (${e.code || e.message})`); resolve(); });
    req.end();
  });
}

function checkFile(name, relPath, mustContain) {
  const full = path.join(ROOT, relPath);
  let src = null;
  try { src = fs.readFileSync(full, 'utf8'); }
  catch (e) { row('FAIL', name, `${relPath} missing`); return; }
  const missing = (mustContain || []).filter((s) => !src.includes(s));
  if (missing.length === 0) row('PASS', name, relPath);
  else row('FAIL', name, `${relPath} missing: ${missing.join(', ')}`);
}

const SIM = 'http://127.0.0.1:8000';
const BACKEND = 'http://127.0.0.1:8080';
const FORGE = 'http://127.0.0.1:8020';

async function getJson(url) {
  const r = await fetchJson(url, 5000);
  try { return JSON.parse(r.body); } catch (e) { throw new Error(`${url}: non-JSON (HTTP ${r.status})`); }
}

/** Everything a stray write from FORGE would move, read without touching it. */
async function liveSnapshot() {
  const health = await getJson(`${SIM}/health`);
  const inter = await getJson(`${SIM}/interventions`);
  const alarms = await getJson(`${BACKEND}/api/alarms?limit=1000`);
  return {
    day: health.t_sim_seconds / 86400,
    running: health.is_running,
    paused: health.is_paused,
    speed: health.speed_multiplier,
    script: health.script && health.script.name,
    failures: inter.pillar_failures.length,
    alarms: alarms.length,
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/** The FORGE math server may read :8000/interventions but must not name a write route. */
function checkNoForbiddenCalls() {
  const files = ['simulation/forge/server.py', 'simulation/forge/states.py'];
  const bad = [];
  for (const rel of files) {
    let src = '';
    try { src = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { bad.push(`${rel} missing`); continue; }
    for (const needle of ['/control', '/api/simulation', ':8010', '/script/run']) {
      if (src.includes(needle)) bad.push(`${rel} mentions ${needle}`);
    }
  }
  if (bad.length) row('FAIL', 'FORGE math server names no write routes', bad.join('; '));
  else row('PASS', 'FORGE math server names no write routes', files.join(', '));
}

async function checkForgeIsolationDuringScript(spawnDemo) {
  const name = 'FORGE isolation during scripted run';
  let demo = null;
  try {
    let before = await liveSnapshot();
    if (!before.script || !before.running) {
      if (!spawnDemo) {
        row('WARN', name, 'skipped: no scripted run is playing. Run `npm run demo:scripted` first, or `node scripts/qa.js --scripted`');
        return;
      }
      // Slow enough that the quiet stretch before the day-60 crack lasts minutes.
      demo = spawn('node', [path.join(ROOT, 'scripts', 'run_scripted_demo.js'), '--speed', '0.4'], { stdio: 'ignore' });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try { before = await liveSnapshot(); } catch (e) { continue; }
        if (before.script && before.running && before.day > 1) break;
      }
      if (!before.script || !before.running) { row('FAIL', name, 'demo:scripted did not start'); return; }
    }
    if (before.day > 55 && before.day < 400 && spawnDemo === false) {
      row('WARN', name, `skipped: the run is at day ${before.day.toFixed(1)}, past the quiet stretch before the first event (day 60)`);
      return;
    }

    // FORGE frame calls: every event kind, with and without the full grids,
    // plus the seed and range reads FORGE makes when its tab opens.
    const events = [
      { type: 'cave_in', x: 0, y: 0, radius_m: 100, depth_m: 10, day: 20, duration_h: 4.8 },
      { type: 'crack', x0: -60, y0: 0, x1: 60, y1: 0, throw_m: 0.5, width_m: 10, open_days: 2, day: 25 },
      { type: 'tilt', x: 100, y: 50, radius_m: 100, rate_mm_per_m: 5, direction_deg: 90, over_days: 3, day: 30 },
      { type: 'vibration', day: 35, ppv_mm_s: 40, duration_s: 60 },
    ];
    let frames = 0;
    for (const day of [0, 10, 21, 26, 31, 36, 60, 200, 365]) {
      const r = await postJson(`${FORGE}/forge/frame`, { day, events, include_grids: day === 26 });
      if (r.status !== 200) { row('FAIL', name, `/forge/frame day ${day} answered HTTP ${r.status}`); return; }
      frames++;
    }
    await postJson(`${FORGE}/forge/range`, { events });
    await getJson(`${FORGE}/forge/seed`);

    const after = await liveSnapshot();
    const moved = [];
    if (after.script !== before.script) moved.push(`script ${before.script} -> ${after.script}`);
    if (after.running !== before.running) moved.push(`running ${before.running} -> ${after.running}`);
    if (after.paused !== before.paused) moved.push(`paused ${before.paused} -> ${after.paused}`);
    if (after.speed !== before.speed) moved.push(`speed ${before.speed} -> ${after.speed}`);
    if (after.failures !== before.failures) moved.push(`interventions ${before.failures} -> ${after.failures}`);
    if (after.alarms !== before.alarms) moved.push(`alarms ${before.alarms} -> ${after.alarms}`);
    if (!(after.day > before.day)) moved.push('the run stopped advancing');
    if (moved.length) { row('FAIL', name, moved.join('; ')); return; }
    row('PASS', name,
      `${frames} frames + range + seed: control state, speed, interventions (${after.failures}) and alarms (${after.alarms}) unchanged; run advanced day ${before.day.toFixed(1)} -> ${after.day.toFixed(1)}`);
  } catch (e) {
    row('FAIL', name, e.message);
  } finally {
    if (demo) {
      demo.kill('SIGINT'); // the demo stops the engine on Ctrl-C
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

async function main() {
  console.log('=== R4 QA GATE ===\n--- 1. Live services ---');
  await checkHttp('backend :8080 health', 'http://127.0.0.1:8080/api/health', (r) => {
    if (!r.ok) return `HTTP ${r.status} (expected 200)`;
    try {
      const j = JSON.parse(r.body);
      if (j.status && j.status !== 'healthy') return `status=${j.status}`;
      return true;
    } catch (e) { return 'non-JSON body'; }
  });
  await checkHttp('sim engine :8000 health', 'http://127.0.0.1:8000/health', (r) => {
    if (!r.ok) return `HTTP ${r.status} — sim engine down? (npm run sim)`;
    return true;
  });
  await checkHttp('scenario lab :8010 segments', 'http://127.0.0.1:8010/api/segments', (r) => {
    if (!r.ok) return `HTTP ${r.status} — scenario lab down?`;
    return true;
  });
  await checkHttp('tiles :8085 alive', 'http://127.0.0.1:8085/tiles/', null);

  console.log('\n--- 2. WebSocket ---');
  await checkWs('backend WS /ws upgrade', 'ws://127.0.0.1:8080/ws');

  console.log('\n--- 3. Static wiring (SIM terrain lab, close, WS, lit-up UI) ---');
  checkFile('sim-tab close button', 'dashboard_electron/renderer/js/sim/sim-tab.js', [
    'closeSandboxSession', 'updateCloseButtonState', 'bindCloseButton', 'btn-sim-close-session',
  ]);
  checkFile('sim-tab loading + lit-up', 'dashboard_electron/renderer/js/sim/sim-tab.js', [
    'showLoadingOverlay', 'hideLoadingOverlay', 'setViewportLit', 'forge-live-lit', 'runScenario',
  ]);
  checkFile('sim-tab sandbox isolation', 'dashboard_electron/renderer/js/sim/sim-tab.js', [
    'sim-sandbox-create', 'sim-sandbox-closed', 'sim-maplibre-map',
  ]);
  checkFile('sim-live websocket', 'dashboard_electron/renderer/js/sim/sim-live.js', [
    '/ws', 'simulation_status', 'packet_available', 'reconnect',
  ]);
  checkFile('sim HTML hooks', 'dashboard_electron/renderer/index.html', [
    'btn-sim-close-session', 'sim-loading-overlay', 'sim-status-hud', 'sim-maplibre-map',
  ]);
  checkFile('sim lit-up CSS', 'dashboard_electron/renderer/css/sim-tab.css', [
    'sim-live-lit', 'btn-sim-close-session',
  ]);

  console.log('\n--- 4. FORGE isolation during a scripted run ---');
  checkNoForbiddenCalls();
  await checkForgeIsolationDuringScript(process.argv.includes('--scripted') ? true : false);

  console.log(`\n=== QA RESULT: ${pass} pass, ${fail} fail, ${warn} warn ===`);
  if (fail > 0) {
    console.log('GATE: FAIL — fix the ✗ lines above, then re-run `npm run qa`.');
    process.exit(1);
  }
  console.log('GATE: PASS');
}

main().catch((e) => { console.error('QA crashed:', e); process.exit(1); });
