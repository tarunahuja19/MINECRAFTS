#!/usr/bin/env node
'use strict';

/**
 * verify_data_loop.js - prove the whole idea end to end.
 *
 * Not "did the services start" but: a value produced by the simulation this
 * run appears in Postgres and then reaches the dashboard.
 *
 *   sim (:8000)  --readings-->      Postgres.readings
 *   sim (:8000)  --60s packet-->    Postgres.simulation_packets
 *   sim          --HTTP POST-->     backend (:8080)
 *   backend      --WS broadcast-->  dashboard   ("packet_available")
 *   dashboard    --HTTP GET-->      backend /simulation/packets/:id  (Postgres)
 *   backend      /api/readings/latest reflects the new row
 *
 * This script stands in for the Electron window: it connects to the sim's
 * WebSocket the way the 3D view does (which is what makes the tick loop run),
 * connects to the backend WebSocket the way live-provider.js does, drives one
 * real run, and asserts every hop.
 *
 * Exit 0 = the loop is proven. Exit 1 = a hop is broken (which hop is named).
 *
 * Env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE (falls back to backend/.env),
 *      SIM_URL (http://localhost:8000), BACKEND_URL (http://localhost:8080).
 */

const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'backend', 'node_modules', 'ws'));
const { Client } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'))
  .config({ path: path.join(__dirname, '..', 'backend', '.env') });

const SIM_URL = process.env.SIM_URL || 'http://localhost:8000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
const SIM_WS = SIM_URL.replace(/^http/, 'ws') + '/ws';
const BACKEND_WS = BACKEND_URL.replace(/^http/, 'ws') + '/ws';
const DEADLINE_MS = 150_000;

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};
const pass = (m) => console.log(`  ${c.green('PASS')}  ${m}`);
const fail = (m) => { console.error(`  ${c.red('FAIL')}  ${m}`); process.exitCode = 1; };
const step = (m) => console.log(c.cyan(`\n[verify] ${m}`));

function db() {
  return new Client({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'labpass123',
    database: process.env.PGDATABASE || 'mine_subsidence',
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, { timeout = DEADLINE_MS, interval = 1000 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(interval);
  }
}

async function main() {
  console.log(c.cyan('================================================================'));
  console.log(c.cyan('  DATA LOOP VERIFICATION  -  sim -> Postgres -> dashboard'));
  console.log(c.cyan('================================================================'));

  // ---- 0. preconditions ----------------------------------------------------
  step('0. services reachable');
  const health = await fetch(`${BACKEND_URL}/api/health`).then((r) => r.json());
  pass(`backend healthy (${health.counts?.readings ?? '?'} readings, ${health.counts?.simulation_packets ?? '?'} packets already stored)`);
  const simHealth = await fetch(`${SIM_URL}/health`).then((r) => r.json()).catch(() => null);
  if (!simHealth) return fail('simulation server not reachable at ' + SIM_URL) && process.exit(1);
  pass('simulation server healthy');

  const conn = db();
  await conn.connect();
  pass('connected to Postgres directly');

  // ---- 1. snapshot the "before" state ------------------------------------
  step('1. snapshot Postgres before the run');
  const before = (await conn.query(`
    SELECT
      (SELECT count(*) FROM readings)             AS readings,
      (SELECT max(ts)  FROM readings)             AS max_ts,
      (SELECT count(*) FROM simulation_packets)   AS packets,
      (SELECT max(packet_id) FROM simulation_packets) AS max_packet_id
  `)).rows[0];
  const beforeReadings = Number(before.readings);
  const beforePackets = Number(before.packets);
  const beforeMaxTs = before.max_ts ? new Date(before.max_ts) : new Date(0);
  console.log(c.dim(`         readings=${beforeReadings}  packets=${beforePackets}  max_ts=${beforeMaxTs.toISOString()}`));

  // ---- 2. connect to the backend WS like the dashboard does -------------
  step('2. attach to the backend WebSocket (as the dashboard)');
  const backendWs = new WebSocket(BACKEND_WS);
  let packetAvailableFrame = null;
  const backendFrames = [];
  backendWs.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    backendFrames.push(msg);
    if (msg.type === 'packet_available') packetAvailableFrame = msg;
  });
  await new Promise((res, rej) => {
    backendWs.once('open', res);
    backendWs.once('error', rej);
  });
  pass('backend WebSocket open');

  // ---- 3. connect to the sim WS like the 3D view does, and start it ----
  step('3. drive the simulation (connect its WebSocket, send {action:start})');
  const simWs = new WebSocket(SIM_WS);
  let gotInit = false;
  let simTicks = 0;
  let simPacketNotices = 0;
  simWs.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'init') gotInit = true;
    else if (msg.type === 'packet_available') simPacketNotices++;
    else simTicks++;
  });
  await new Promise((res, rej) => {
    simWs.once('open', res);
    simWs.once('error', rej);
  });
  await waitFor('sim init frame', async () => gotInit, { timeout: 10_000, interval: 200 });
  pass('sim WebSocket open, init geometry received');
  simWs.send(JSON.stringify({ action: 'start' }));
  // A connected client + running state is what makes simulation_loop() tick.
  // Bump the speed so a full 60-sim-second packet finalizes in seconds, not
  // minutes - this is a verification run, not a demo.
  simWs.send(JSON.stringify({ action: 'set_speed', multiplier: 120 }));
  pass('sent start + set_speed(120x) - tick loop should now be producing telemetry');

  // Confirm the sim is actually ticking before we assert on its side effects.
  await waitFor('sim tick frames', async () => simTicks >= 2, { timeout: 30_000, interval: 250 });
  pass(`sim is ticking (${simTicks} tick frame(s) received on its WebSocket)`);

  // ---- 4. a value the sim produced this run lands in readings ----------
  // We assert on the row COUNT rising and on a row whose ts is within the last
  // few minutes (i.e. produced by this run), not on "ts > previous max": the
  // table can hold stale rows with future-dated ts from an earlier machine
  // clock, and a real fresh row would still be "older" than those.
  step('4. new sensor rows appear in Postgres.readings');
  const runStart = new Date(Date.now() - 5 * 60_000); // 5-minute window
  const afterRows = await waitFor('new readings rows', async () => {
    const r = (await conn.query(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE ts >= $1) AS recent
       FROM readings`,
      [runStart]
    )).rows[0];
    return Number(r.total) > beforeReadings && Number(r.recent) > 0 ? r : null;
  });
  const sample = (await conn.query(
    `SELECT node_id, ts, die_temp_c, tilt_x_urad, strain_ue, vib_rms_mm_s
     FROM readings WHERE ts >= $1 ORDER BY ts DESC LIMIT 1`, [runStart]
  )).rows[0];
  pass(`readings ${beforeReadings} -> ${afterRows.total} (+${Number(afterRows.total) - beforeReadings}), ` +
    `${afterRows.recent} row(s) timestamped in the last 5 min, newest ts=${new Date(sample.ts).toISOString()}`);
  console.log(c.dim(`         e.g. ${sample.node_id}: temp=${sample.die_temp_c}C tilt_x=${sample.tilt_x_urad}urad ` +
    `strain=${sample.strain_ue}ue vib=${sample.vib_rms_mm_s}mm/s`));

  // ---- 5. a 60-sim-second packet is finalized and stored -------------
  step('5. a 60s packet is aggregated and written to Postgres.simulation_packets');
  const newPacket = await waitFor('new simulation_packets row', async () => {
    const r = (await conn.query(
      `SELECT packet_id, session_id, jsonb_array_length(payload->'nodes') AS node_ct, created_at
       FROM simulation_packets
       WHERE packet_id > $1 ORDER BY packet_id DESC LIMIT 1`,
      [Number(before.max_packet_id || 0)]
    )).rows[0];
    return r || null;
  }, { timeout: DEADLINE_MS });
  pass(`packet #${newPacket.packet_id} stored (session ${newPacket.session_id}, ${newPacket.node_ct} nodes aggregated)`);

  // ---- 6. backend fans the packet out to the dashboard over WS -------
  step('6. backend broadcasts "packet_available" to the dashboard WebSocket');
  await waitFor('packet_available frame', async () => packetAvailableFrame, { timeout: 20_000 });
  pass(`dashboard received: packet_available #${packetAvailableFrame.packet_id}`);

  // ---- 7. the dashboard fetches that packet back (Postgres round trip) --
  step('7. dashboard fetches the packet by id (backend -> Postgres -> dashboard)');
  const fetched = await fetch(`${BACKEND_URL}/simulation/packets/${packetAvailableFrame.packet_id}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))));
  if (!fetched || !Array.isArray(fetched.nodes) || fetched.nodes.length === 0) {
    fail('fetched packet has no node data');
  } else {
    const n0 = fetched.nodes[0];
    pass(`packet body served with ${fetched.nodes.length} nodes ` +
      `(e.g. ${n0.node_id ?? n0.id}: ${JSON.stringify(n0).slice(0, 90)}...)`);
  }

  // ---- 8. /api/readings/latest reflects the new data --------------------
  step('8. backend /api/readings/latest reflects the fresh rows');
  const latest = await fetch(`${BACKEND_URL}/api/readings/latest`).then((r) => r.json());
  const rows = Array.isArray(latest) ? latest : latest.readings || latest.data || [];
  const recent = rows
    .map((r) => new Date(r.ts || r.t_utc || 0))
    .filter((d) => d >= runStart);
  if (recent.length > 0) {
    pass(`/api/readings/latest carries ${recent.length} node(s) with a reading from this run ` +
      `(newest ${recent.sort((a, b) => b - a)[0].toISOString()})`);
  } else {
    fail('/api/readings/latest shows no reading newer than this run start');
  }

  // ---- 9. alarms path (best-effort - only fires if a zone transitions) --
  step('9. alarms path (informational - depends on the run reaching a transition)');
  const alarmFrames = backendFrames.filter((m) => m.type === 'alarm');
  const alarmRows = Number((await conn.query('SELECT count(*) AS n FROM alarms')).rows[0].n);
  console.log(c.dim(`         ${alarmFrames.length} alarm frame(s) over WS this run, ${alarmRows} alarm row(s) total in Postgres`));

  // ---- teardown ---------------------------------------------------------
  simWs.send(JSON.stringify({ action: 'pause' }));
  simWs.close();
  backendWs.close();
  await conn.end();

  console.log(c.cyan('\n================================================================'));
  if (process.exitCode) {
    console.log(c.red('  RESULT: data loop BROKEN - see FAIL lines above'));
  } else {
    console.log(c.green('  RESULT: data loop PROVEN end to end'));
    console.log('  A value produced by the sim this run is in Postgres and');
    console.log('  reached the dashboard over both the WS notify and HTTP fetch paths.');
  }
  console.log(c.cyan('================================================================'));
  process.exit(process.exitCode || 0);
}

main().catch((err) => {
  console.error(`\n  ${c.red('FAIL')}  ${err.message}`);
  console.error(c.dim(err.stack?.split('\n').slice(1, 3).join('\n') || ''));
  process.exit(1);
});
