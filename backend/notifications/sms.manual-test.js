'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const sms = require('./sms');

async function run() {
  const fakeAlarm = {
    alarm_id: 'test-manual-' + Date.now(),
    level: 3,
    zone_id: 'Z1',
    max_strain_ue: 1250,
    explanation: 'Manual test alarm for SMS dedup verification'
  };

  // Call sendAlarmSms twice with the same alarm_id to test dedup
  await sms.sendAlarmSms(fakeAlarm);
  await sms.sendAlarmSms(fakeAlarm);
}

run().catch((err) => {
  console.error('[test:sms] Failed:', err);
  process.exit(1);
});
