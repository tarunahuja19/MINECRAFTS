'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { getTwilioClient, buildMessage } = require('../notifications/sms');

// E.164 phone format: + followed by 7-15 digits
const E164_RE = /^\+[1-9]\d{6,14}$/;

// In-memory sliding-window rate limiter for the manual-send endpoint.
// Keeps it simple (no dependency) for this single-process backend.
const SEND_WINDOW_MS = 60_000;
const SEND_MAX_PER_WINDOW = 10;
const MAX_RECIPIENTS_PER_SEND = 10;
const sendTimestamps = [];

let broadcastFn = null;

function setBroadcaster(fn) {
  broadcastFn = fn;
}

function rateLimitOk() {
  const now = Date.now();
  // Purge entries older than the window
  while (sendTimestamps.length > 0 && sendTimestamps[0] < now - SEND_WINDOW_MS) {
    sendTimestamps.shift();
  }
  if (sendTimestamps.length >= SEND_MAX_PER_WINDOW) return false;
  sendTimestamps.push(now);
  return true;
}

// GET /api/sms-contacts — list all contacts
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT contact_id, name, phone, auto_alert, created_at FROM sms_contacts ORDER BY created_at ASC;`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[routes:sms-contacts] GET failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
  }
});

// POST /api/sms-contacts — add a contact
router.post('/', async (req, res) => {
  try {
    const { name, phone, auto_alert } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Missing or empty "name"' });
    }
    if (typeof phone !== 'string' || !E164_RE.test(phone.trim())) {
      return res.status(400).json({
        error: 'Invalid phone number. Must be E.164 format, e.g. +919812345678'
      });
    }

    const autoAlert = auto_alert !== undefined ? Boolean(auto_alert) : true;
    const result = await query(
      `INSERT INTO sms_contacts (name, phone, auto_alert) VALUES ($1, $2, $3) RETURNING *;`,
      [name.trim(), phone.trim(), autoAlert]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'A contact with this phone number already exists' });
    }
    console.error('[routes:sms-contacts] POST failed:', err.message);
    res.status(500).json({ error: 'Failed to add contact', details: err.message });
  }
});

// PATCH /api/sms-contacts/:id — partial update (name, phone, auto_alert)
router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid contact ID. Must be a positive integer' });
    }

    const { name, phone, auto_alert } = req.body || {};

    // Build SET clause dynamically from provided fields
    const sets = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Name must be a non-empty string' });
      }
      sets.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (phone !== undefined) {
      if (typeof phone !== 'string' || !E164_RE.test(phone.trim())) {
        return res.status(400).json({
          error: 'Invalid phone number. Must be E.164 format, e.g. +919812345678'
        });
      }
      sets.push(`phone = $${idx++}`);
      values.push(phone.trim());
    }
    if (auto_alert !== undefined) {
      sets.push(`auto_alert = $${idx++}`);
      values.push(Boolean(auto_alert));
    }

    if (sets.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);
    const result = await query(
      `UPDATE sms_contacts SET ${sets.join(', ')} WHERE contact_id = $${idx} RETURNING *;`,
      values
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A contact with this phone number already exists' });
    }
    console.error('[routes:sms-contacts] PATCH failed:', err.message);
    res.status(500).json({ error: 'Failed to update contact', details: err.message });
  }
});

// DELETE /api/sms-contacts/:id — remove a contact (history retained)
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid contact ID. Must be a positive integer' });
    }

    const result = await query(
      `DELETE FROM sms_contacts WHERE contact_id = $1 RETURNING *;`,
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ ok: true, deleted: result.rows[0] });
  } catch (err) {
    console.error('[routes:sms-contacts] DELETE failed:', err.message);
    res.status(500).json({ error: 'Failed to delete contact', details: err.message });
  }
});

// POST /api/sms-contacts/send — manual SMS send
// Body: { contact_ids?: number[], phones?: string[], message: string }
router.post('/send', async (req, res) => {
  if (!rateLimitOk()) {
    return res.status(429).json({
      error: `Rate limit exceeded. Max ${SEND_MAX_PER_WINDOW} manual sends per minute.`
    });
  }

  try {
    const { contact_ids, phones, message } = req.body || {};
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Missing or empty "message"' });
    }

    if (contact_ids !== undefined) {
      if (!Array.isArray(contact_ids)) {
        return res.status(400).json({ error: '"contact_ids" must be an array' });
      }
      if (contact_ids.length > MAX_RECIPIENTS_PER_SEND) {
        return res.status(400).json({
          error: `Too many contact IDs. Maximum allowed per request is ${MAX_RECIPIENTS_PER_SEND}.`
        });
      }
      for (const id of contact_ids) {
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: 'All contact_ids must be positive integers' });
        }
      }
    }

    if (phones !== undefined) {
      if (!Array.isArray(phones)) {
        return res.status(400).json({ error: '"phones" must be an array' });
      }
      if (phones.length > MAX_RECIPIENTS_PER_SEND) {
        return res.status(400).json({
          error: `Too many phone numbers. Maximum allowed per request is ${MAX_RECIPIENTS_PER_SEND}.`
        });
      }
      for (const p of phones) {
        if (typeof p !== 'string') {
          return res.status(400).json({ error: 'All phone entries must be strings' });
        }
      }
    }

    // Collect phone numbers from contact_ids and/or raw phones
    const targetPhones = new Set();
    const contactNames = {};

    if (Array.isArray(contact_ids) && contact_ids.length > 0) {
      const result = await query(
        `SELECT contact_id, name, phone FROM sms_contacts WHERE contact_id = ANY($1);`,
        [contact_ids]
      );
      for (const row of result.rows) {
        targetPhones.add(row.phone);
        contactNames[row.phone] = row.name;
      }
    }

    if (Array.isArray(phones)) {
      for (const p of phones) {
        const cleaned = p.trim();
        if (E164_RE.test(cleaned)) {
          targetPhones.add(cleaned);
          if (!contactNames[cleaned]) contactNames[cleaned] = 'UNSAVED';
        }
      }
    }

    if (targetPhones.size === 0) {
      return res.status(400).json({ error: 'No valid recipients specified' });
    }

    if (targetPhones.size > MAX_RECIPIENTS_PER_SEND) {
      return res.status(400).json({
        error: `Too many recipients (${targetPhones.size}). Maximum allowed per request is ${MAX_RECIPIENTS_PER_SEND}.`
      });
    }

    const client = getTwilioClient();
    if (!client) {
      return res.status(503).json({ error: 'Twilio not configured on this server' });
    }

    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const results = [];

    for (const to of targetPhones) {
      const dispatchEvent = {
        type: 'sms_dispatch',
        contact: contactNames[to] || to,
        phone: to,
        source: 'manual',
        t: Date.now()
      };

      try {
        const msg = await client.messages.create({
          body: message.trim(),
          from: fromNumber,
          to
        });
        console.log(`[routes:sms-contacts] Manual SMS sent to ${to} (SID: ${msg.sid})`);
        dispatchEvent.outcome = 'SENT';
        dispatchEvent.sid = msg.sid;
        results.push({ phone: to, name: contactNames[to], outcome: 'SENT', sid: msg.sid });
      } catch (err) {
        console.error(`[routes:sms-contacts] Manual SMS to ${to} failed:`, err.message);
        dispatchEvent.outcome = 'FAILED';
        dispatchEvent.error = err.message;
        results.push({ phone: to, name: contactNames[to], outcome: 'FAILED', error: err.message });
      }

      // Broadcast dispatch event for the real-time log
      if (typeof broadcastFn === 'function') {
        broadcastFn(dispatchEvent);
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error('[routes:sms-contacts] send failed:', err.message);
    res.status(500).json({ error: 'Failed to send SMS', details: err.message });
  }
});

// GET /api/sms-contacts/count — auto-alert contact count (for tier-config display)
router.get('/count', async (req, res) => {
  try {
    const result = await query(`SELECT count(*) FROM sms_contacts WHERE auto_alert = true;`);
    res.json({ count: parseInt(result.rows[0].count, 10) });
  } catch (err) {
    console.warn('[routes:sms-contacts] DB count query failed:', err.message);
    const envTo = process.env.ALERT_SMS_TO;
    if (envTo && envTo.trim()) {
      const fallbackCount = envTo.split(',').map(s => s.trim()).filter(Boolean).length;
      return res.json({ count: fallbackCount, fallback: true });
    }
    res.status(500).json({ error: 'Failed to count auto-alert contacts', details: err.message });
  }
});

module.exports = { router, setBroadcaster };
