'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/db');

let broadcastFn = null;

function setBroadcaster(fn) {
  broadcastFn = fn;
}

function notifyPacketAvailable(packet) {
  if (typeof broadcastFn === 'function') {
    const notification = {
      type: 'packet_available',
      packet_id: Number(packet.packet_id),
      session_id: String(packet.session_id || 'SIM001'),
      grid_id: String(packet.grid_id || 'G8'),
      start_sim_time: Number(packet.start_sim_time || 0),
      end_sim_time: Number(packet.end_sim_time || 60),
      timestamp: new Date().toISOString()
    };
    broadcastFn(notification);
  }
}

// GET /simulation/packets/latest - Get most recent finalized 60-second packet
router.get('/packets/latest', async (req, res) => {
  try {
    const sql = `
      SELECT payload FROM simulation_packets
      ORDER BY packet_id DESC LIMIT 1;
    `;
    const result = await query(sql);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'No simulation packets recorded yet' });
    }
    const payload = result.rows[0].payload;
    res.json(typeof payload === 'string' ? JSON.parse(payload) : payload);
  } catch (err) {
    console.error('[routes:simulation] Error fetching latest packet:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest simulation packet', details: err.message });
  }
});

// GET /simulation/packets/:packetId - Get single 60-second packet by packet_id
router.get('/packets/:packetId', async (req, res) => {
  try {
    const packetId = parseInt(req.params.packetId, 10);
    if (isNaN(packetId)) {
      return res.status(400).json({ error: 'Invalid packet ID' });
    }

    const sql = `
      SELECT payload FROM simulation_packets
      WHERE packet_id = $1
      LIMIT 1;
    `;
    const result = await query(sql, [packetId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Packet ${packetId} not found` });
    }

    const payload = result.rows[0].payload;
    res.json(typeof payload === 'string' ? JSON.parse(payload) : payload);
  } catch (err) {
    console.error(`[routes:simulation] Error fetching packet ${req.params.packetId}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch simulation packet', details: err.message });
  }
});

// GET /simulation/packets - List recent packet metadata
router.get('/packets', async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 200);
    const sql = `
      SELECT packet_id, session_id, grid_id, start_sim_time, end_sim_time, created_at
      FROM simulation_packets
      ORDER BY packet_id DESC
      LIMIT $1;
    `;
    const result = await query(sql, [limit]);
    res.json({
      count: result.rowCount,
      packets: result.rows.map(r => ({
        ...r,
        packet_id: parseInt(r.packet_id, 10)
      }))
    });
  } catch (err) {
    console.error('[routes:simulation] Error listing packets:', err.message);
    res.status(500).json({ error: 'Failed to list simulation packets', details: err.message });
  }
});

// POST /simulation/packets - Ingest a finalized 60-second simulation packet
router.post('/packets', async (req, res) => {
  try {
    const packet = req.body;
    if (!packet || packet.packet_id == null) {
      return res.status(400).json({ error: 'Missing packet_id in simulation packet payload' });
    }

    const packetId = parseInt(packet.packet_id, 10);
    const sessionId = String(packet.session_id || 'SIM001');
    const gridId = String(packet.grid_id || 'G8');
    const startSimTime = parseFloat(packet.start_sim_time || 0);
    const endSimTime = parseFloat(packet.end_sim_time || 60);
    const payloadJson = typeof packet === 'object' ? JSON.stringify(packet) : packet;

    const sql = `
      INSERT INTO simulation_packets (packet_id, session_id, grid_id, start_sim_time, end_sim_time, payload)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (packet_id) DO UPDATE
      SET session_id = EXCLUDED.session_id,
          grid_id = EXCLUDED.grid_id,
          start_sim_time = EXCLUDED.start_sim_time,
          end_sim_time = EXCLUDED.end_sim_time,
          payload = EXCLUDED.payload
      RETURNING packet_id;
    `;
    await query(sql, [packetId, sessionId, gridId, startSimTime, endSimTime, payloadJson]);

    // Broadcast lightweight WebSocket notification to all connected clients
    notifyPacketAvailable(packet);

    res.status(201).json({
      ok: true,
      packet_id: packetId,
      message: `Packet ${packetId} saved to PostgreSQL and notification broadcast`
    });
  } catch (err) {
    console.error('[routes:simulation] Error saving packet:', err.message);
    res.status(500).json({ error: 'Failed to save simulation packet', details: err.message });
  }
});

// GET /simulation/status - Query simulation server health and return running/stopped state
router.get('/status', async (req, res) => {
  try {
    const http = require('http');
    const simReq = http.get('http://127.0.0.1:8000/health', (simRes) => {
      let data = '';
      simRes.on('data', chunk => { data += chunk; });
      simRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const isRunning = Boolean(json.is_running);
          const isPaused = Boolean(json.is_paused);
          const state = isRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED';
          res.json({
            is_running: isRunning,
            is_paused: isPaused,
            state: state,
            t_sim_seconds: json.t_sim_seconds || 0,
            tick_index: json.tick_index || 0
          });
        } catch (e) {
          res.json({ is_running: false, is_paused: false, state: 'STOPPED' });
        }
      });
    });
    simReq.on('error', () => {
      res.json({ is_running: false, is_paused: false, state: 'STOPPED' });
    });
    simReq.setTimeout(800, () => {
      simReq.destroy();
      res.json({ is_running: false, is_paused: false, state: 'STOPPED' });
    });
  } catch (err) {
    res.json({ is_running: false, is_paused: false, state: 'STOPPED' });
  }
});

// POST /simulation/status - Update and broadcast simulation state over WebSocket
router.post('/status', (req, res) => {
  const { is_running, is_paused, state } = req.body || {};
  const isRunning = Boolean(is_running);
  const isPaused = Boolean(is_paused);
  const statusState = state || (isRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'STOPPED');
  if (typeof broadcastFn === 'function') {
    broadcastFn({
      type: 'simulation_status',
      is_running: isRunning,
      is_paused: isPaused,
      state: statusState,
      timestamp: new Date().toISOString()
    });
  }
  res.json({ ok: true, state: statusState });
});

module.exports = {
  router,
  setBroadcaster,
  notifyPacketAvailable
};
