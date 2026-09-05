'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { query } = require('../db/db');

// The dashboard's offline fixture. Previously this pointed at an `r4-dashboard`
// directory that does not exist in this repo, so the route silently returned []
// on every request. The dashboard lives in `dashboard_electron`.
const ALARMS_FIXTURE = path.join(
  __dirname, '..', '..', 'dashboard_electron', 'fixtures', 'alarms.json'
);

let broadcastFn = null;

function setBroadcaster(fn) {
  broadcastFn = fn;
}

// Shape a DB row the way the fixture — and therefore the renderer — expects.
// `centroid` is nested and `affected_nodes` is a plain array; the columns are
// flat, so the mapping happens here rather than in every consumer.
function rowToAlarm(row) {
  return {
    alarm_id: row.alarm_id,
    t_utc: new Date(row.t_utc).toISOString(),
    panel_id: row.panel_id,
    level: row.level,
    zone_id: row.zone_id,
    state: row.state,
    centroid: { lat: row.lat, lng: row.lon },
    affected_nodes: row.affected_nodes || [],
    max_strain_ue: row.max_strain_ue,
    trough_fit_r2: row.trough_fit_r2,
    blast_correlated: row.blast_correlated,
    explanation: row.explanation,
    confidence_zone: row.confidence_zone
  };
}

function readFixture() {
  try {
    if (!fs.existsSync(ALARMS_FIXTURE)) return [];
    return JSON.parse(fs.readFileSync(ALARMS_FIXTURE, 'utf8'));
  } catch (err) {
    console.error('[routes:alarms] Fixture unreadable:', err.message);
    return [];
  }
}

// GET /api/alarms - alarm history, newest first.
// Live rows win; the fixture stands in only when no simulation has ever raised
// an alarm against this database, so a fresh checkout still shows a populated
// history panel instead of an empty table.
router.get('/', async (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 200), 1000);
  try {
    const result = await query(
      `SELECT * FROM alarms ORDER BY t_utc DESC LIMIT $1;`,
      [limit]
    );
    if (result.rowCount > 0) {
      return res.json(result.rows.map(rowToAlarm));
    }
  } catch (err) {
    // An unmigrated or unreachable database is a fallback case, not a 500:
    // the operator still needs to see history.
    console.error('[routes:alarms] DB read failed, serving fixture:', err.message);
  }
  res.json(readFixture());
});

// POST /api/alarms - persist an alarm raised by the simulation.
// Idempotent on alarm_id: the simulation derives it from the zone and the state
// it entered, so a re-published transition updates its row rather than adding a
// duplicate.
router.post('/', async (req, res) => {
  try {
    const a = req.body;
    if (!a || !a.alarm_id) {
      return res.status(400).json({ error: 'Missing alarm_id in alarm payload' });
    }

    const centroid = a.centroid || {};
    const sql = `
      INSERT INTO alarms (
        alarm_id, t_utc, panel_id, level, zone_id, state, lat, lon,
        affected_nodes, max_strain_ue, trough_fit_r2, blast_correlated,
        explanation, confidence_zone
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (alarm_id) DO UPDATE
      SET t_utc = EXCLUDED.t_utc,
          level = EXCLUDED.level,
          state = EXCLUDED.state,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          affected_nodes = EXCLUDED.affected_nodes,
          max_strain_ue = EXCLUDED.max_strain_ue,
          trough_fit_r2 = EXCLUDED.trough_fit_r2,
          blast_correlated = EXCLUDED.blast_correlated,
          explanation = EXCLUDED.explanation,
          confidence_zone = EXCLUDED.confidence_zone
      RETURNING *;
    `;
    const result = await query(sql, [
      String(a.alarm_id),
      a.t_utc ? new Date(a.t_utc) : new Date(),
      String(a.panel_id || 'unknown'),
      parseInt(a.level, 10) || 1,
      a.zone_id != null ? String(a.zone_id) : null,
      a.state != null ? String(a.state) : null,
      centroid.lat != null ? Number(centroid.lat) : null,
      centroid.lng != null ? Number(centroid.lng) : null,
      Array.isArray(a.affected_nodes) ? a.affected_nodes.map(String) : [],
      a.max_strain_ue != null ? Number(a.max_strain_ue) : null,
      a.trough_fit_r2 != null ? Number(a.trough_fit_r2) : null,
      Boolean(a.blast_correlated),
      a.explanation != null ? String(a.explanation) : null,
      a.confidence_zone != null ? String(a.confidence_zone) : null
    ]);

    const alarm = rowToAlarm(result.rows[0]);

    // Push it to every connected dashboard so the banner fires without waiting
    // for the next history poll.
    if (typeof broadcastFn === 'function') {
      broadcastFn({ type: 'alarm', alarm: alarm });
    }

    res.status(201).json({ ok: true, alarm_id: alarm.alarm_id });
  } catch (err) {
    console.error('[routes:alarms] Error saving alarm:', err.message);
    res.status(500).json({ error: 'Failed to save alarm', details: err.message });
  }
});

module.exports = { router, setBroadcaster };
