#!/usr/bin/env node
'use strict';

/**
 * scripts/run_scripted_demo.js — play the fixed scenario through the live pipeline.
 *
 *   npm run demo:scripted [-- --speed N] [--name default_demo]
 *
 * With the stack up (`npm start`) this:
 *   1. clears the database (scripts/reset_demo_state.sh). The script's clock is
 *      fixed, so a previous run's rows would collide with this run's
 *      timestamps and be silently dropped by ON CONFLICT DO NOTHING;
 *   2. resets the engine on :8000, loads the script (POST /script/run), sets
 *      the speed and starts the run;
 *   3. follows the backend WebSocket (:8080/ws) and prints a timeline of what
 *      the pipeline raised:
 *
 *        day  60.0  crack      → N22 CRITICAL, N23 CRITICAL
 *
 * It exits when the script reaches its duration, or on Ctrl-C (which stops the
 * run). Node 18+, no npm dependencies beyond the repo's own `ws`.
 *
 * --speed N is scripted DAYS per wall second (the FORGE d/s unit). Each tick
 * costs the engine a few milliseconds to ~30 ms, so about 1.5 d/s is the
 * ceiling: asking for more just runs flat out.
 */

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SIM = process.env.SIM_URL || 'http://127.0.0.1:8000';
const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8080';
const BACKEND_WS = BACKEND.replace(/^http/, 'ws') + '/ws';

const WebSocketImpl = globalThis.WebSocket || require('ws');

function parseArgs(argv) {
  const out = { name: 'default_demo', speed: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--speed') out.speed = Number(argv[++i]);
    else if (a.startsWith('--speed=')) out.speed = Number(a.slice(8));
    else if (a === '--name') out.name = argv[++i];
    else if (a.startsWith('--name=')) out.name = a.slice(7);
    else if (a === '--help' || a === '-h') out.help = true;
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  if (out.speed !== null && !(out.speed > 0)) { console.error('--speed needs a positive number of days per second'); process.exit(2); }
  return out;
}

function say(msg) { console.log(`[demo] ${msg}`); }
function die(msg) { console.error(`[demo] FAIL ${msg}`); process.exit(1); }

async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { ok: res.ok, status: res.status, json, text };
}

const control = (payload) => call('POST', `${SIM}/control`, payload);

function resetDatabase() {
  try {
    execFileSync('bash', [path.join(ROOT, 'scripts', 'reset_demo_state.sh')], { stdio: ['ignore', 'pipe', 'pipe'] });
    say('database cleared (scripts/reset_demo_state.sh)');
    return true;
  } catch (e) {
    say(`reset_demo_state.sh failed (${String(e.stderr || e.message).trim().split('\n').pop()}); trying the backend reset`);
    return false;
  }
}

const pad = (s, n) => String(s).padEnd(n);
const fmtDay = (d) => d.toFixed(1).padStart(6);

function describeEvent(ev) {
  switch (ev.type) {
    case 'crack': return `crack ${Math.round(Math.hypot(ev.x1 - ev.x0, ev.y1 - ev.y0))} m, throw ${ev.throw_m} m`;
    case 'tilt': return `tilt ${ev.rate_mm_per_m} mm/m → ${ev.direction_deg}° over ${ev.over_days} d`;
    case 'cave_in': return `cave-in ${ev.depth_m} m deep, R ${ev.radius_m} m`;
    case 'vibration': return `vibration ${ev.ppv_mm_s} mm/s, ${ev.duration_s} s`;
    default: return ev.type;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('usage: npm run demo:scripted [-- --speed DAYS_PER_SECOND] [--name SCRIPT]');
    return;
  }

  // 1. The stack must be up.
  for (const [label, url] of [['sim engine :8000', `${SIM}/health`], ['backend :8080', `${BACKEND}/api/health`]]) {
    try {
      const r = await call('GET', url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      die(`${label} is not answering (${e.message}). Start the stack first: npm start`);
    }
  }

  // 2. Fresh database, fresh engine, script loaded.
  if (!resetDatabase()) {
    const r = await call('POST', `${BACKEND}/api/system/reset`, {});
    if (!r.ok) die(`could not reset the database (backend HTTP ${r.status}): ${r.text.slice(0, 200)}`);
    say('database cleared (backend /api/system/reset)');
  }
  let r = await control({ action: 'reset' });
  if (!r.ok || r.json.status !== 'success') die(`engine reset failed: ${r.text.slice(0, 200)}`);
  say('engine reset');

  r = await call('POST', `${SIM}/script/run`, { name: args.name });
  if (r.status === 404 && r.json && r.json.detail === 'Not Found') {
    die('the engine on :8000 has no /script/run — it predates the scripted demo. Restart the stack: npm start');
  }
  if (!r.ok) die(`script load refused (HTTP ${r.status}): ${(r.json && r.json.detail) || r.text.slice(0, 200)}`);
  const script = r.json;
  const events = script.events;
  const baseMs = Date.parse(script.base_iso_time);
  say(`loaded ${script.name}: ${script.duration_days} days, ${events.length} events, ${script.n_ticks} ticks of ${script.tick_seconds} s`);

  const speedDaysPerS = args.speed !== null ? args.speed : script.speed / 86400;
  r = await control({ action: 'set_speed', multiplier: speedDaysPerS * 86400 });
  if (!r.ok) die(`set_speed failed: ${r.text.slice(0, 200)}`);
  say(`speed ${speedDaysPerS.toFixed(2)} days/s`);

  // 3. Follow the backend before starting, so no alarm is missed.
  const fired = new Set();
  const pending = new Map(); // `${eventIndex}|${t_utc}` -> { day, eventIndex, nodes: [], zones: [] }
  let flushTimer = null;
  let alarmCount = { WARNING: 0, CRITICAL: 0 };

  const eventFor = (day) => {
    let idx = -1;
    events.forEach((ev, i) => { if (ev.type !== 'vibration' && ev.day <= day + 1e-6) idx = i; });
    return idx;
  };
  const announce = (i) => {
    if (fired.has(i)) return;
    fired.add(i);
    const ev = events[i];
    if (ev.type === 'vibration') console.log(`day ${fmtDay(ev.day)}  ${pad(ev.type, 10)} ${describeEvent(ev)} (moves no node state)`);
    else console.log(`day ${fmtDay(ev.day)}  ${pad(ev.type, 10)} fires: ${describeEvent(ev)}`);
  };
  const announceUpTo = (day) => events.forEach((ev, i) => { if (ev.day <= day + 1e-6) announce(i); });

  const flush = () => {
    flushTimer = null;
    const rows = [...pending.values()].sort((a, b) => a.day - b.day);
    pending.clear();
    for (const row of rows) {
      announceUpTo(row.day);
      const parts = row.nodes.map((n) => `${n.id} ${n.state}`).concat(row.zones.map((z) => `zone ${z.id} ${z.state}`));
      if (!parts.length) continue;
      const label = row.eventIndex >= 0 ? events[row.eventIndex].type : 'alarm';
      console.log(`day ${fmtDay(row.day)}  ${pad(label, 10)} → ${parts.join(', ')}`);
    }
  };

  const onAlarm = (alarm) => {
    const day = (Date.parse(alarm.t_utc) - baseMs) / 86400000;
    const state = alarm.level >= 3 ? 'CRITICAL' : 'WARNING';
    const eventIndex = eventFor(day);
    const key = `${eventIndex}|${alarm.t_utc}`;
    if (!pending.has(key)) pending.set(key, { day, eventIndex, nodes: [], zones: [] });
    const row = pending.get(key);
    // A zone alarm (zone_id set) lists every node inside the alert radius; a
    // node alarm names the one node. Print each kind for what it is.
    if (alarm.zone_id) {
      if (!row.zones.some((z) => z.id === alarm.zone_id)) row.zones.push({ id: alarm.zone_id, state });
    } else {
      (alarm.affected_nodes || []).filter((n) => /^N\d+$/.test(n)).forEach((id) => {
        if (!row.nodes.some((n) => n.id === id)) { row.nodes.push({ id, state }); alarmCount[state] += 1; }
      });
    }
    if (!flushTimer) flushTimer = setTimeout(flush, 300);
  };

  const ws = new WebSocketImpl(BACKEND_WS);
  await new Promise((resolve, reject) => {
    ws.addEventListener ? ws.addEventListener('open', resolve) : ws.on('open', resolve);
    ws.addEventListener ? ws.addEventListener('error', () => reject(new Error('backend WebSocket failed'))) : ws.on('error', reject);
  }).catch((e) => die(e.message));
  const onMessage = (ev) => {
    let msg;
    try { msg = JSON.parse(typeof ev === 'string' ? ev : (ev.data !== undefined ? ev.data : ev.toString())); } catch (_) { return; }
    if (msg && msg.type === 'alarm' && msg.alarm) onAlarm(msg.alarm);
  };
  ws.addEventListener ? ws.addEventListener('message', onMessage) : ws.on('message', onMessage);

  // 4. Start, then watch the clock.
  let stopping = false;
  const finish = async (why, code) => {
    if (stopping) return;
    stopping = true;
    if (flushTimer) { clearTimeout(flushTimer); flush(); }
    let day = null;
    try {
      const h = (await call('GET', `${SIM}/health`)).json;
      day = h.t_sim_seconds / 86400;
      if (why === 'interrupted' && h.is_running) await control({ action: 'stop' });
    } catch (_) { /* engine gone */ }
    try { ws.close(); } catch (_) { /* already closed */ }
    say(`${why}${day !== null ? ` at day ${day.toFixed(1)}` : ''}: ${alarmCount.CRITICAL} CRITICAL and ${alarmCount.WARNING} WARNING node alarms raised (zone alarms not counted)`);
    process.exit(code);
  };
  process.on('SIGINT', () => finish('interrupted', 130));
  process.on('SIGTERM', () => finish('interrupted', 143));

  r = await control({ action: 'start' });
  if (!r.ok || r.json.status !== 'success') die(`start failed: ${r.text.slice(0, 200)}`);
  say('running — Ctrl-C to stop');
  console.log('');

  for (;;) {
    await new Promise((res) => setTimeout(res, 250));
    let h;
    try { h = (await call('GET', `${SIM}/health`)).json; } catch (e) { await finish('engine stopped answering', 1); }
    const day = h.t_sim_seconds / 86400;
    announceUpTo(day - 0.0001);
    if ((h.script && h.script.done) || day >= script.duration_days) {
      await new Promise((res) => setTimeout(res, 800)); // let the last alarms arrive
      const alarms = await call('GET', `${BACKEND}/api/alarms?limit=1000`).catch(() => null);
      if (alarms && alarms.ok) say(`backend holds ${alarms.json.length} alarm records`);
      await finish(`script complete (${script.duration_days} days)`, 0);
    }
    if (!h.is_running && day < script.duration_days) await finish('engine stopped', 1);
  }
}

main().catch((e) => die(e.stack || e.message));
