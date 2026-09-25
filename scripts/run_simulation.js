#!/usr/bin/env node
'use strict';
/**
 * scripts/run_simulation.js — One-command simulation run for the R4 demo.
 *
 * Does the thing `npm run sim` does NOT do: `npm run sim` only boots the
 * FastAPI engine idle (is_running=false until someone clicks Start). This
 * script boots the engine if needed, then actually RUNS a scenario:
 *
 *   reset -> start -> set_speed -> apply_collapse -> poll packets -> report
 *
 * Usage:
 *   npm run sim:run
 *   node scripts/run_simulation.js [--days 2] [--speed 20]
 *     [--collapse 50,50,0.75,60] [--duration-hours 4.8] [--no-autostart]
 *
 * Env overrides: SIM_URL (default http://127.0.0.1:8000)
 * Stdlib only (fetch, http, child_process). Exit 0 = packets flowing.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIM_URL = process.env.SIM_URL || 'http://127.0.0.1:8000';

const args = process.argv.slice(2);
function argVal(name, def) {
  const i = args.findIndex((a) => a === name || a.startsWith(name + '='));
  if (i === -1) return def;
  const a = args[i];
  if (a.includes('=')) return a.split('=').slice(1).join('=');
  return args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}
function hasFlag(name) {
  return args.includes(name);
}

if (hasFlag('--help') || hasFlag('-h')) {
  console.log([
    'Usage: node scripts/run_simulation.js [options]',
    '',
    '  --speed N             time multiplier (default 20, demo-fast)',
    '  --collapse X,Y,M,R    collapse cx,cy,magnitude_m,radius_m (default 50,50,0.75,60)',
    '  --duration-hours H    collapse duration in sim-hours (default 4.8)',
    '  --wait-secs S         how long to poll for packets (default 30)',
    '  --no-autostart        do NOT spawn the engine if :8000 is down (fail instead)',
    '  --help                this text',
    '',
    'Examples:',
    '  npm run sim:run',
    '  node scripts/run_simulation.js --speed 50 --collapse 60,40,1.0,80',
  ].join('\n'));
  process.exit(0);
}

const SPEED = parseFloat(argVal('--speed', '20')) || 20;
const DURATION_HOURS = parseFloat(argVal('--duration-hours', '4.8')) || 4.8;
const WAIT_SECS = parseInt(argVal('--wait-secs', '30'), 10) || 30;
const COLLAPSE = (argVal('--collapse', '50,50,0.75,60') || '50,50,0.75,60').split(',').map(Number);
const [CX, CY, MAG_M, RADIUS_M] = COLLAPSE.length === 4 && COLLAPSE.every(Number.isFinite)
  ? COLLAPSE
  : [50, 50, 0.75, 60];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJson(urlPath, body) {
  const res = await fetch(`${SIM_URL}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON */ }
  if (!res.ok) throw new Error(`${urlPath} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  return json || { raw: text };
}

async function getJson(urlPath) {
  const res = await fetch(`${SIM_URL}${urlPath}`, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`${urlPath} -> HTTP ${res.status}`);
  try { return JSON.parse(text); } catch (_) { return { raw: text }; }
}

async function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      await res.text().catch(() => '');
      if (res.ok) return true;
    } catch (_) { /* retry */ }
    if (Date.now() - start > timeoutMs) return false;
    await sleep(500);
  }
}

function getPythonExecutable() {
  const cands = [
    path.join(ROOT, 'simulation', '.venv', 'bin', 'python'),
    path.join(ROOT, 'simulation', '.venv', 'Scripts', 'python.exe'),
    path.join(ROOT, 'simulation', 'venv', 'bin', 'python'),
    path.join(ROOT, 'simulation', 'venv', 'Scripts', 'python.exe'),
  ];
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function ensureEngine() {
  if (await waitForHttp(`${SIM_URL}/health`, 3000)) {
    console.log('  OK   sim engine already up — ' + SIM_URL);
    return null;
  }
  if (hasFlag('--no-autostart')) {
    throw new Error(`sim engine down at ${SIM_URL} (and --no-autostart set). Start it with: npm run sim`);
  }
  console.log('  .... sim engine down — starting it (sandbox.server:8000)…');
  const py = getPythonExecutable();
  const child = spawn(py, ['-m', 'uvicorn', 'sandbox.server:app', '--host', '0.0.0.0', '--port', '8000'], {
    cwd: path.join(ROOT, 'simulation'),
    stdio: 'inherit',
    detached: process.platform !== 'win32',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', PYTHONUNBUFFERED: '1' },
  });
  if (child && typeof child.unref === 'function') child.unref();
  const up = await waitForHttp(`${SIM_URL}/health`, 25000);
  if (!up) throw new Error('sim engine failed to come up within 25s — see output above');
  console.log('  OK   sim engine started — ' + SIM_URL);
  return child;
}

async function main() {
  console.log('=== R4 RUN SIMULATION ===');
  console.log(`  engine: ${SIM_URL} | speed: ${SPEED}x | collapse: cx=${CX} cy=${CY} mag=${MAG_M}m r=${RADIUS_M}m dur=${DURATION_HOURS}h`);

  await ensureEngine();

  console.log('[1/4] reset + start…');
  await postJson('/control', { action: 'reset', source: 'run_simulation' }).catch((e) => {
    console.log('  WARN reset skipped: ' + e.message);
  });
  const started = await postJson('/control', { action: 'start' });
  console.log(`  OK   state=${started.state || started.status}`);

  console.log('[2/4] set_speed + apply_collapse…');
  await postJson('/control', { action: 'set_speed', multiplier: SPEED });
  const col = await postJson('/control', {
    action: 'collapse', cx: CX, cy: CY,
    magnitude_m: MAG_M, radius_m: RADIUS_M, duration_hours: DURATION_HOURS,
  });
  console.log(`  OK   collapse accepted (state=${col.state || col.status})`);

  console.log('[3/4] polling for simulation packets…');
  const deadline = Date.now() + WAIT_SECS * 1000;
  let pkt = null;
  while (Date.now() < deadline) {
    try {
      const latest = await getJson('/simulation/packets/latest');
      // Endpoint returns the newest finalized 60-sim-second packet when present.
      if (latest && (latest.packet_id !== undefined || latest.packet || latest.id !== undefined)) {
        pkt = latest;
        break;
      }
      if (latest && latest.detail && /no packets/i.test(latest.detail)) {
        // Engine running but no 60s packet finalized yet — keep waiting.
      } else if (latest && typeof latest === 'object' && Object.keys(latest).length > 0) {
        pkt = latest;
        break;
      }
    } catch (e) {
      console.log('  .... waiting (' + e.message.slice(0, 80) + ')');
    }
    await sleep(2000);
  }

  console.log('[4/4] verifying live endpoints…');
  const checks = [
    ['sim :8000', `${SIM_URL}/health`],
    ['backend :8080', 'http://127.0.0.1:8080/api/health'],
    ['scenario lab :8010', 'http://127.0.0.1:8010/api/segments'],
  ];
  for (const [name, url] of checks) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      console.log(`  ${r.ok ? 'OK  ' : 'WARN'} ${name} — HTTP ${r.status}`);
    } catch (e) {
      console.log(`  WARN ${name} — unreachable (${name.includes('8080') ? 'npm run backend' : name.includes('8010') ? 'scenario lab not in start_all — run it manually' : 'see above'})`);
    }
  }

  console.log('\n=== RESULT ===');
  if (pkt) {
    console.log('SIMULATION RUNNING — packets flowing.');
    const id = pkt.packet_id ?? pkt.id ?? (pkt.packet && pkt.packet.packet_id) ?? '?';
    console.log(`  latest packet id: ${id}`);
    console.log('  watch live: sim WS ws://127.0.0.1:8000/ws | 3D sandbox http://127.0.0.1:5173/ (npm run sim:ui)');
    console.log('  full stack: npm start  |  QA gate: npm run qa');
  } else {
    console.log('ENGINE RUNNING, no finalized packet yet within ' + WAIT_SECS + 's.');
    console.log('  The 60-sim-second packet finalizes faster at higher --speed. Retry:');
    console.log('  node scripts/run_simulation.js --speed 50 --wait-secs 60');
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('FAIL ' + (e.stack || e.message));
  process.exit(1);
});
