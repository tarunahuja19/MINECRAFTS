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
 *
 * Exit 0 = ALL PASS, exit 1 = any FAIL. WARN never fails the gate.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

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
    'showLoadingOverlay', 'hideLoadingOverlay', 'setViewportLit', 'sim-live-lit', 'runScenario',
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

  console.log(`\n=== QA RESULT: ${pass} pass, ${fail} fail, ${warn} warn ===`);
  if (fail > 0) {
    console.log('GATE: FAIL — fix the ✗ lines above, then re-run `npm run qa`.');
    process.exit(1);
  }
  console.log('GATE: PASS');
}

main().catch((e) => { console.error('QA crashed:', e); process.exit(1); });
