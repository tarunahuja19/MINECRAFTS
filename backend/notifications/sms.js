'use strict';

const notifiedAlarms = new Map();
let notConfiguredLogged = false;

function buildMessage(alarm) {
  const parts = [];
  const zone = alarm.zone_id != null ? alarm.zone_id : 'Unknown';
  parts.push(`[MINE ALERT - LEVEL ${alarm.level}] Zone: ${zone}`);
  if (alarm.max_strain_ue != null) {
    parts.push(`Strain: ${alarm.max_strain_ue} µε`);
  }
  if (alarm.explanation) {
    parts.push(`Details: ${alarm.explanation}`);
  }
  return parts.join(' | ');
}

async function sendAlarmSms(alarm) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const toNumbersRaw = process.env.ALERT_SMS_TO;

    if (
      !accountSid || !accountSid.trim() ||
      !authToken || !authToken.trim() ||
      !fromNumber || !fromNumber.trim() ||
      !toNumbersRaw || !toNumbersRaw.trim()
    ) {
      if (!notConfiguredLogged) {
        console.log('[notifications:sms] Twilio not configured, skipping');
        notConfiguredLogged = true;
      }
      return;
    }

    if (!alarm) {
      return;
    }

    const level = parseInt(alarm.level, 10);
    if (isNaN(level) || level < 2) {
      return;
    }

    const alarmId = alarm.alarm_id != null ? String(alarm.alarm_id) : null;
    if (!alarmId) {
      return;
    }

    const lastNotifiedLevel = notifiedAlarms.get(alarmId);
    if (lastNotifiedLevel !== undefined && level <= lastNotifiedLevel) {
      return;
    }

    notifiedAlarms.set(alarmId, level);

    const toNumbers = toNumbersRaw
      .split(',')
      .map((num) => num.trim())
      .filter(Boolean);

    if (toNumbers.length === 0) {
      return;
    }

    let twilioClient;
    try {
      const twilio = require('twilio');
      twilioClient = twilio(accountSid, authToken);
    } catch (err) {
      console.error('[notifications:sms] Failed to initialize Twilio client:', err.message);
      return;
    }

    const body = buildMessage(alarm);

    for (const to of toNumbers) {
      try {
        const msg = await twilioClient.messages.create({
          body,
          from: fromNumber,
          to
        });
        console.log(`[notifications:sms] Sent alert SMS to ${to} (SID: ${msg.sid})`);
      } catch (err) {
        console.error(`[notifications:sms] Failed to send SMS to ${to}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[notifications:sms] Error processing alarm SMS:', err.message);
  }
}

module.exports = {
  sendAlarmSms
};
