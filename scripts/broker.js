#!/usr/bin/env node
'use strict';

// ==============================================================================
// MQTT broker for the R4 stack (port 1883).
//
// aedes is a pure-Node broker, so the stack needs no Homebrew mosquitto and no
// system service: `npm start` brings the broker up with everything else.
//
// Who talks to it:
//   publisher   simulation/sandbox/mqtt_bridge.py  (per-tick telemetry + alarms)
//   subscriber  frontend_dashboard/main/mqtt-client.js  (the Electron dashboard)
//
// Topics (the real ones mqtt-client.js already subscribes to):
//   mine/<panel>/node/<node>/telemetry
//   mine/<panel>/node/<node>/status
//   mine/<panel>/alarm
//   mine/<panel>/gateway/health
//
// Run standalone for debugging:  node scripts/broker.js
// ==============================================================================

const net = require('net');
const { Aedes } = require('aedes');

const PORT = parseInt(process.env.R4_BROKER_PORT || '1883', 10);
const HOST = process.env.R4_BROKER_HOST || '127.0.0.1';

// Publish counters, reported periodically so the launcher log shows whether
// real traffic is flowing rather than just whether the port is bound.
let published = 0;
let lastReported = 0;

// aedes 1.x initializes asynchronously: `new Aedes()` returns an instance whose
// internals are never set up, so clients complete the TCP handshake but never
// receive a CONNACK. `createBroker()` is the supported constructor.
async function start () {
  const aedes = await Aedes.createBroker();

  aedes.on('client', (client) => {
    console.log('[broker] client connected:', client.id);
  });

  aedes.on('clientDisconnect', (client) => {
    console.log('[broker] client disconnected:', client.id);
  });

  aedes.on('subscribe', (subscriptions, client) => {
    const topics = subscriptions.map((s) => s.topic).join(', ');
    console.log('[broker] %s subscribed: %s', client && client.id, topics);
  });

  aedes.on('publish', (packet, client) => {
    // Ignore the broker's own $SYS keepalives; only count real client traffic.
    if (!client) return;
    published += 1;
  });

  aedes.on('clientError', (client, err) => {
    console.warn('[broker] client error (%s): %s', client && client.id, err.message);
  });

  const server = net.createServer(aedes.handle);

  server.listen(PORT, HOST, () => {
    console.log('[broker] MQTT broker listening on mqtt://%s:%d', HOST, PORT);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('[broker] port %d already in use - is another broker running?', PORT);
    } else {
      console.error('[broker] server error:', err.message);
    }
    process.exit(1);
  });

  setInterval(() => {
    if (published !== lastReported) {
      console.log('[broker] %d messages published (%d since last report)',
        published, published - lastReported);
      lastReported = published;
    }
  }, 30000).unref();

  function shutdown() {
    console.log('[broker] shutting down');
    server.close(() => aedes.close(() => process.exit(0)));
    // Don't hang forever if a client refuses to close.
    setTimeout(() => process.exit(0), 2000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[broker] failed to start:', err);
  process.exit(1);
});
