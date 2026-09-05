'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const http = require('http');
const WebSocket = require('ws');
const { testConnection, query } = require('./db/db');
const nodesRouter = require('./routes/nodes');
const readingsRouter = require('./routes/readings');
const alarmsRouter = require('./routes/alarms');
const { router: simulationRouter, setBroadcaster } = require('./routes/simulation');

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);
const server = http.createServer(app);

// WebSocket Server for real-time notifications
const wss = new WebSocket.Server({ server });
const clients = new Set();

function broadcast(data) {
  const message = typeof data === 'string' ? data : JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch (err) {
        console.error('[ws:broadcast] send error:', err.message);
      }
    }
  }
}

setBroadcaster(broadcast);

wss.on('connection', (ws, req) => {
  clients.add(ws);
  const clientIp = req.socket.remoteAddress;
  console.log(`[ws] Client connected from ${clientIp}. Total connected clients: ${clients.size}`);

  // Send initial welcome frame
  ws.send(JSON.stringify({
    type: 'connection',
    status: 'connected',
    service: 'mine_subsidence_backend',
    time: new Date().toISOString()
  }));

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
      }
    } catch (e) {
      // Ignore non-json frames
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected. Total connected clients: ${clients.size}`);
  });

  ws.on('error', (err) => {
    console.error('[ws] Socket error:', err.message);
    clients.delete(ws);
  });
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging in dev
if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`[HTTP] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    next();
  });
}

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const conn = await testConnection();
    const nodeCount = await query('SELECT count(*) FROM nodes;');
    const readingCount = await query('SELECT count(*) FROM readings;');
    const packetCount = await query('SELECT count(*) FROM simulation_packets;');

    res.json({
      status: 'healthy',
      database: conn.db,
      connected_at: conn.now,
      counts: {
        nodes: parseInt(nodeCount.rows[0].count, 10),
        readings: parseInt(readingCount.rows[0].count, 10),
        simulation_packets: parseInt(packetCount.rows[0].count, 10)
      },
      ws_clients: clients.size,
      uptime_seconds: Math.floor(process.uptime())
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: err.message
    });
  }
});

// API Routes
app.use('/api/nodes', nodesRouter);
app.use('/api/readings', readingsRouter);
app.use('/api/telemetry', readingsRouter); // Backward compatibility alias
app.use('/api/alarms', alarmsRouter);

// Simulation Packet Routes (both /simulation and /api/simulation supported)
app.use('/simulation', simulationRouter);
app.use('/api/simulation', simulationRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Cannot ${req.method} ${req.url}` });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[server:error]', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========================================================`);
  console.log(`  Mine Subsidence Backend Server running on port ${PORT}`);
  console.log(`  Health Check: http://localhost:${PORT}/api/health`);
  console.log(`  Nodes API:    http://localhost:${PORT}/api/nodes`);
  console.log(`  Readings API: http://localhost:${PORT}/api/readings/latest`);
  console.log(`  Packets API:  http://localhost:${PORT}/simulation/packets/latest`);
  console.log(`  WebSocket:    ws://localhost:${PORT}/ws`);
  console.log(`========================================================\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[server] SIGTERM signal received. Closing HTTP and WS server...');
  wss.close(() => {
    server.close(() => {
      console.log('[server] Server closed.');
      process.exit(0);
    });
  });
});

module.exports = { app, server, wss, broadcast };
