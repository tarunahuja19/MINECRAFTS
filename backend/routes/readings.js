'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { ingestReadings } = require('../scripts/ingest-simulation');

// Format a row to include both SCHEMA.md standard columns and frontend compatibility fields
function formatReading(row) {
  const epoch = Math.floor(new Date(row.ts).getTime() / 1000);
  return {
    ...row,
    // Frontend chart / fixture compatibility aliases
    t_epoch_s: epoch,
    strain_ustrain: row.strain_ue ?? (row.fissure_mm != null ? Math.round(row.fissure_mm * 500) : 120),
    tilt_x_mdeg: row.tilt_x_urad != null ? Math.round(row.tilt_x_urad / 17.4533) : 0,
    tilt_y_mdeg: row.tilt_y_urad != null ? Math.round(row.tilt_y_urad / 17.4533) : 0,
    temp_c_x10: row.die_temp_c != null ? Math.round(row.die_temp_c * 10) : 215,
    vib_rms: row.vib_rms_mm_s != null ? Math.round(row.vib_rms_mm_s * 10) : 8,
    vbat_mv: 4120,
    flags: 0
  };
}

// GET /api/readings/latest - Most recent reading for every node
router.get('/latest', async (req, res) => {
  try {
    const sql = `
      SELECT DISTINCT ON (node_id) *
      FROM readings
      ORDER BY node_id, ts DESC;
    `;
    const result = await query(sql);
    const rows = result.rows.map(formatReading);
    res.json(rows);
  } catch (err) {
    console.error('[routes:readings] Error getting latest readings:', err.message);
    res.status(500).json({ error: 'Failed to fetch latest readings', details: err.message });
  }
});

// GET /api/readings (or /api/telemetry) - Historical query
router.get('/', async (req, res) => {
  try {
    const { node_id, from, to, limit = 1000, order = 'asc' } = req.query;
    let sql = `SELECT * FROM readings WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (node_id) {
      sql += ` AND node_id = $${idx++}`;
      params.push(node_id);
    }

    if (from) {
      const fromDate = !isNaN(Number(from)) ? new Date(Number(from) * 1000) : new Date(from);
      sql += ` AND ts >= $${idx++}`;
      params.push(fromDate.toISOString());
    }

    if (to) {
      const toDate = !isNaN(Number(to)) ? new Date(Number(to) * 1000) : new Date(to);
      sql += ` AND ts <= $${idx++}`;
      params.push(toDate.toISOString());
    }

    const sortOrder = String(order).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    sql += ` ORDER BY ts ${sortOrder}, node_id ASC`;

    const maxLimit = Math.min(Math.max(1, parseInt(limit, 10) || 10000), 50000);
    sql += ` LIMIT $${idx++};`;
    params.push(maxLimit);

    const result = await query(sql, params);
    const rows = result.rows.map(formatReading);
    res.json(rows);
  } catch (err) {
    console.error('[routes:readings] Error querying readings:', err.message);
    res.status(500).json({ error: 'Failed to query readings', details: err.message });
  }
});

// POST /api/readings - Ingest single or batch readings
router.post('/', async (req, res) => {
  try {
    const body = req.body;
    const records = Array.isArray(body) ? body : [body];

    if (records.length === 0) {
      return res.status(400).json({ error: 'No reading records provided in request body' });
    }

    const result = await ingestReadings(records);
    res.status(201).json({
      ok: true,
      inserted: result.inserted,
      total: result.total
    });
  } catch (err) {
    console.error('[routes:readings] Ingestion error:', err.message);
    res.status(500).json({ error: 'Failed to ingest readings', details: err.message });
  }
});

module.exports = router;
