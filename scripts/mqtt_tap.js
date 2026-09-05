#!/usr/bin/env node
'use strict';

// ==============================================================================
// mosquitto_sub equivalent, in Node — no Homebrew required.
//
// Subscribes to the same topics the Electron dashboard does and prints what
// actually arrives, so "the broker is up" and "real telemetry is flowing" can
// be checked separately.
//
//   node scripts/mqtt_tap.js                     # follow all traffic
//   node scripts/mqtt_tap.js 'mine/+/alarm'      # one topic filter
//   node scripts/mqtt_tap.js --count 20          # exit after 20 messages
//   node scripts/mqtt_tap.js --full              # print entire payloads
//   node scripts/mqtt_tap.js --probe             # exit 0 once CONNACK arrives
// ==============================================================================

const mqtt = require('mqtt');

const DEFAULT_TOPICS = [
  'mine/+/node/+/telemetry',
  'mine/+/node/+/status',
  'mine/+/alarm',
  'mine/+/gateway/health'
];

const argv = process.argv.slice(2);
let limit = Infinity;
let full = false;
let probe = false;
const topics = [];

for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--count') {
    limit = parseInt(argv[++i], 10);
  } else if (argv[i] === '--full') {
    full = true;
  } else if (argv[i] === '--probe') {
    probe = true;
  } else {
    topics.push(argv[i]);
  }
}

const subs = topics.length ? topics : DEFAULT_TOPICS;
const url = process.env.R4_BROKER_URL || 'mqtt://127.0.0.1:1883';

const client = mqtt.connect(url, {
  clientId: 'r4-tap-' + Date.now(),
  clean: true,
  // A probe must fail fast rather than retry forever inside the launcher loop.
  reconnectPeriod: probe ? 0 : 1000,
  connectTimeout: probe ? 2000 : 10000
});

if (probe) {
  setTimeout(() => process.exit(1), 3000).unref();
}

let seen = 0;
const perTopic = new Map();

client.on('connect', () => {
  if (probe) {
    // A CONNACK is the only proof the broker speaks MQTT, not just TCP.
    client.end(true, () => process.exit(0));
    return;
  }
  console.log('[tap] connected to %s', url);
  client.subscribe(subs, { qos: 0 }, (err) => {
    if (err) {
      console.error('[tap] subscribe failed:', err.message);
      process.exit(1);
    }
    console.log('[tap] subscribed: %s', subs.join(', '));
    console.log('[tap] waiting for messages (Ctrl+C to stop)...\n');
  });
});

client.on('error', (err) => {
  console.error('[tap] error:', err.message);
  process.exit(1);
});

client.on('message', (topic, payload) => {
  seen += 1;
  const kind = topic.split('/').slice(2).join('/');
  perTopic.set(kind, (perTopic.get(kind) || 0) + 1);

  const text = payload.toString();
  let line = text;
  if (!full) {
    // Condense telemetry to the fields an operator would actually scan.
    try {
      const d = JSON.parse(text);
      if (topic.endsWith('/telemetry')) {
        line = `node=${d.node_id} tier=${d.tier} alive=${d.alive} ` +
               `tilt=(${d.tilt_x_urad}, ${d.tilt_y_urad}) strain=${d.strain_ue} rssi=${d.rssi_dbm}`;
      } else if (topic.endsWith('/alarm')) {
        line = `ALARM L${d.level} zone=${d.zone_id} state=${d.state} strain=${d.max_strain_ue}`;
      } else {
        line = text.length > 160 ? text.slice(0, 160) + '…' : text;
      }
    } catch (e) {
      /* not JSON - print raw */
    }
  }

  console.log('%s  %s  %s', new Date().toISOString(), topic, line);

  if (seen >= limit) {
    console.log('\n[tap] %d messages received. Breakdown:', seen);
    for (const [k, n] of perTopic) console.log('   %s: %d', k, n);
    client.end(true, () => process.exit(0));
  }
});

process.on('SIGINT', () => {
  console.log('\n[tap] %d messages received. Breakdown:', seen);
  for (const [k, n] of perTopic) console.log('   %s: %d', k, n);
  client.end(true, () => process.exit(0));
});
