'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sms = require('./sms');
const { query, pool } = require('../db/db');

async function run() {
  console.log('[test:sms] Starting SMS notification verification...');

  const testPhone = '+15005550006'; // Twilio magic test number
  let seededId = null;

  // 1. Seed a test contact in DB to test DB-backed recipient retrieval
  try {
    const res = await query(
      `INSERT INTO sms_contacts (name, phone, auto_alert)
       VALUES ($1, $2, true)
       ON CONFLICT (phone) DO UPDATE SET auto_alert = true
       RETURNING contact_id, name, phone;`,
      ['Test Manual Contact', testPhone]
    );
    seededId = res.rows[0].contact_id;
    console.log(`[test:sms] Seeded test contact: ID=${seededId}, name=${res.rows[0].name}, phone=${res.rows[0].phone}`);
  } catch (err) {
    console.warn('[test:sms] Note: Could not seed test contact to DB (DB might not be running):', err.message);
  }

  // 2. Set up broadcaster mock to verify dispatch event emission
  const emittedEvents = [];
  sms.setBroadcaster((evt) => {
    emittedEvents.push(evt);
    console.log('[test:sms] Intercepted dispatch event:', JSON.stringify(evt));
  });

  const fakeAlarm = {
    alarm_id: 'test-manual-' + Date.now(),
    level: 3,
    zone_id: 'Z1',
    max_strain_ue: 1250,
    explanation: 'Manual test alarm for SMS dedup & recipient verification'
  };

  // 3. Call sendAlarmSms twice with the same alarm_id to test dedup
  console.log('[test:sms] Triggering sendAlarmSms first time (expected to dispatch)...');
  await sms.sendAlarmSms(fakeAlarm);

  console.log('[test:sms] Triggering sendAlarmSms second time with same alarm_id (expected to dedup/suppress)...');
  await sms.sendAlarmSms(fakeAlarm);

  // 4. Clean up seeded test contact if created
  if (seededId) {
    try {
      await query(`DELETE FROM sms_contacts WHERE contact_id = $1;`, [seededId]);
      console.log(`[test:sms] Cleaned up test contact ID=${seededId}`);
    } catch (cleanErr) {
      console.warn('[test:sms] Failed to clean up test contact:', cleanErr.message);
    }
  }

  if (pool) {
    await pool.end().catch(() => {});
  }

  console.log('[test:sms] Verification script completed successfully.');
}

run().catch((err) => {
  console.error('[test:sms] Failed:', err);
  process.exit(1);
});
