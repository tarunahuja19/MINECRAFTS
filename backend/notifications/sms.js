'use strict';

const notifiedAlarms = new Map();
let notConfiguredLogged = false;
let broadcastFn = null;

/**
 * Shared Twilio client constructor. Used by both automatic alarm sends
 * and the manual-send route so credential checks aren't duplicated.
 * Returns null (with a console warning) if Twilio isn't configured.
 */
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (
    !accountSid || !accountSid.trim() ||
    !authToken || !authToken.trim() ||
    !fromNumber || !fromNumber.trim()
  ) {
    if (!notConfiguredLogged) {
      console.log('[notifications:sms] Twilio not configured, skipping');
      notConfiguredLogged = true;
    }
    return null;
  }

  try {
    const twilio = require('twilio');
    return twilio(accountSid, authToken);
  } catch (err) {
    console.error('[notifications:sms] Failed to initialize Twilio client:', err.message);
    return null;
  }
}

function setBroadcaster(fn) {
  broadcastFn = fn;
}

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

/**
 * Collect recipient contacts for an automatic alarm SMS.
 * Primary source: sms_contacts table (auto_alert = true).
 * Fallback source: ALERT_SMS_TO env var (defense-in-depth for DB-down scenarios).
 * Returns a Map of phone -> name.
 */
async function getAutoAlertRecipients() {
  const contactMap = new Map();

  // Primary: database
  try {
    const { query } = require('../db/db');
    const result = await query(`SELECT name, phone FROM sms_contacts WHERE auto_alert = true;`);
    for (const row of result.rows) {
      if (row.phone) {
        contactMap.set(row.phone, row.name || row.phone);
      }
    }
  } catch (err) {
    console.error('[notifications:sms] DB query for auto-alert contacts failed:', err.message);
  }

  // Fallback: env var (always merged so a DB outage doesn't silence alerts)
  const envTo = process.env.ALERT_SMS_TO;
  if (envTo && envTo.trim()) {
    for (const p of envTo.split(',').map(s => s.trim()).filter(Boolean)) {
      if (!contactMap.has(p)) {
        contactMap.set(p, p);
      }
    }
  }

  return contactMap;
}

async function getAutoAlertPhones() {
  const map = await getAutoAlertRecipients();
  return Array.from(map.keys());
}

async function sendAlarmSms(alarm) {
  try {
    if (!alarm) return;

    const level = parseInt(alarm.level, 10);
    if (isNaN(level) || level < 2) return;

    const alarmId = alarm.alarm_id != null ? String(alarm.alarm_id) : null;
    if (!alarmId) return;

    const lastNotifiedLevel = notifiedAlarms.get(alarmId);
    if (lastNotifiedLevel !== undefined && level <= lastNotifiedLevel) return;

    notifiedAlarms.set(alarmId, level);

    const twilioClient = getTwilioClient();
    if (!twilioClient) return;

    const recipientMap = await getAutoAlertRecipients();
    if (recipientMap.size === 0) return;

    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const body = buildMessage(alarm);

    for (const [to, name] of recipientMap.entries()) {
      const dispatchEvent = {
        type: 'sms_dispatch',
        contact: name || to,
        phone: to,
        source: 'auto',
        alarm_id: alarmId,
        level,
        t: Date.now()
      };

      try {
        const msg = await twilioClient.messages.create({ body, from: fromNumber, to });
        console.log(`[notifications:sms] Sent alert SMS to ${to} (SID: ${msg.sid})`);
        dispatchEvent.outcome = 'SENT';
        dispatchEvent.sid = msg.sid;
      } catch (err) {
        console.error(`[notifications:sms] Failed to send SMS to ${to}:`, err.message);
        dispatchEvent.outcome = 'FAILED';
        dispatchEvent.error = err.message;
      }

      // Broadcast dispatch event so the dashboard's dispatch log shows real sends
      if (typeof broadcastFn === 'function') {
        broadcastFn(dispatchEvent);
      }
    }
  } catch (err) {
    console.error('[notifications:sms] Error processing alarm SMS:', err.message);
  }
}

module.exports = {
  sendAlarmSms,
  getTwilioClient,
  buildMessage,
  setBroadcaster
};
