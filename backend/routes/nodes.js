'use strict';

const express = require('express');
const router = express.Router();
const { query } = require('../db/db');

function enrichNode(row) {
  // lat/lon are written by the simulation (sandbox.geo) alongside x/y and are the
  // single source of truth for where a node sits on the map. There is no fixture
  // fallback: the old one read the Jharia nodes.json, ~1000 km from the modelled
  // site, so a NULL here must surface as null rather than as a plausible-looking
  // wrong location.
  const lat = (row.lat != null) ? row.lat : null;
  const lon = (row.lon != null) ? row.lon : null;
  const ring = row.node_type === 'gateway' ? 'outer' : (row.node_type === 'anchor' ? 'middle' : 'inner');

  return {
    ...row,
    // Frontend map & table display fields
    label: row.node_id,
    lat: lat,
    lon: lon,
    // `lng` is the name the existing map code reads; keep it as an alias of lon.
    lng: lon,
    ring: ring,
    state: row.status
  };
}

// GET /api/nodes - List all node profiles
router.get('/', async (req, res) => {
  try {
    const { site_id, status, tier } = req.query;
    let sql = `SELECT * FROM nodes WHERE 1=1`;
    const params = [];
    let idx = 1;

    if (site_id) {
      sql += ` AND site_id = $${idx++}`;
      params.push(site_id);
    }
    if (status) {
      sql += ` AND status = $${idx++}`;
      params.push(status);
    }
    if (tier) {
      sql += ` AND tier = $${idx++}`;
      params.push(tier);
    }

    sql += ` ORDER BY node_id ASC;`;
    const result = await query(sql, params);
    const enriched = result.rows.map(enrichNode);
    res.json(enriched);
  } catch (err) {
    console.error('[routes:nodes] Error fetching nodes:', err.message);
    res.status(500).json({ error: 'Failed to fetch nodes', details: err.message });
  }
});

// GET /api/nodes/:nodeId - Get single node profile + latest reading
router.get('/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    const nodeRes = await query(`SELECT * FROM nodes WHERE node_id = $1;`, [nodeId]);
    if (nodeRes.rowCount === 0) {
      return res.status(404).json({ error: `Node ${nodeId} not found` });
    }

    const readingRes = await query(
      `SELECT * FROM readings WHERE node_id = $1 ORDER BY ts DESC LIMIT 1;`,
      [nodeId]
    );

    const profile = enrichNode(nodeRes.rows[0]);
    profile.latest_reading = readingRes.rows[0] || null;

    res.json(profile);
  } catch (err) {
    console.error(`[routes:nodes] Error fetching node ${req.params.nodeId}:`, err.message);
    res.status(500).json({ error: 'Failed to fetch node details', details: err.message });
  }
});

// POST /api/nodes - Create or update node profile
router.post('/', async (req, res) => {
  try {
    const { node_id, site_id, tier, node_type, x, y, z, installed_at, status } = req.body;
    if (!node_id || !site_id || !tier || !node_type) {
      return res.status(400).json({ error: 'Missing required fields: node_id, site_id, tier, node_type' });
    }

    const sql = `
      INSERT INTO nodes (node_id, site_id, tier, node_type, x, y, z, installed_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (node_id) DO UPDATE
      SET site_id = EXCLUDED.site_id, tier = EXCLUDED.tier, node_type = EXCLUDED.node_type,
          x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z, status = EXCLUDED.status
      RETURNING *;
    `;
    const params = [
      node_id, site_id, tier, node_type,
      x || 0, y || 0, z || 0,
      installed_at || new Date(),
      status || 'active'
    ];

    const result = await query(sql, params);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[routes:nodes] Error saving node:', err.message);
    res.status(500).json({ error: 'Failed to save node profile', details: err.message });
  }
});

module.exports = router;
