'use strict';

const fs = require('fs');
const path = require('path');
const { pool, query } = require('../db/db');

// Cache node tiers from DB
let tierCache = null;

async function getCachedTiers() {
  if (!tierCache) {
    const res = await query('SELECT node_id, tier FROM nodes;');
    tierCache = {};
    for (const row of res.rows) {
      tierCache[row.node_id] = row.tier;
    }
  }
  return tierCache;
}

/**
 * Ingests an array of reading records into PostgreSQL adhering to tier-nullability rules.
 * @param {Array<Object>} records - Array of sensor reading objects
 * @returns {Promise<{ inserted: number, skipped: number }>}
 */
async function ingestReadings(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  const tiers = await getCachedTiers();
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const valueClauses = [];
    const params = [];
    let paramIdx = 1;

    for (const r of batch) {
      const nodeId = r.node_id || r._node_id;
      if (!nodeId) continue;

      const tier = tiers[nodeId] || r.tier || '1A';
      const ts = r.ts ? new Date(r.ts) : (r.t_epoch_s ? new Date(r.t_epoch_s * 1000) : new Date());

      // Nullable channels according to tier
      const is1Series = ['1A', '1B', '1C'].includes(tier);

      const tilt_x = ['1A', '1B', '1C', '2A'].includes(tier) ? (r.tilt_x_urad ?? (r.tilt_x_mdeg != null ? Math.round(r.tilt_x_mdeg * 17.4533) : null)) : null;
      const tilt_y = ['1A', '1B', '1C', '2A'].includes(tier) ? (r.tilt_y_urad ?? (r.tilt_y_mdeg != null ? Math.round(r.tilt_y_mdeg * 17.4533) : null)) : null;

      const accel_x = is1Series ? (r.accel_x_g ?? (r.accel_x_mg != null ? r.accel_x_mg / 1000.0 : null)) : null;
      const accel_y = is1Series ? (r.accel_y_g ?? (r.accel_y_mg != null ? r.accel_y_mg / 1000.0 : null)) : null;
      const accel_z = is1Series ? (r.accel_z_g ?? (r.accel_z_mg != null ? r.accel_z_mg / 1000.0 : null)) : null;
      const gyro_x = is1Series ? (r.gyro_x_dps ?? (r.gyro_x_mdps != null ? r.gyro_x_mdps / 1000.0 : null)) : null;
      const gyro_y = is1Series ? (r.gyro_y_dps ?? (r.gyro_y_mdps != null ? r.gyro_y_mdps / 1000.0 : null)) : null;
      const gyro_z = is1Series ? (r.gyro_z_dps ?? (r.gyro_z_mdps != null ? r.gyro_z_mdps / 1000.0 : null)) : null;
      const vib_rms = is1Series ? (r.vib_rms_mm_s ?? (r.vib_rms_x100 != null ? r.vib_rms_x100 / 100.0 : (r.vib_rms != null ? r.vib_rms / 10.0 : null))) : null;
      const vib_peak = is1Series ? (r.vib_peak_mm_s ?? (r.vib_peak_x100 != null ? r.vib_peak_x100 / 100.0 : (vib_rms != null ? vib_rms * 1.414 : null))) : null;
      const vib_fdom = is1Series ? (r.vib_fdom_hz ?? null) : null;

      const die_temp = r.die_temp_c ?? (r.die_temp_dc != null ? r.die_temp_dc / 10.0 : (r.temp_c != null ? r.temp_c : (r.temp_c_x10 != null ? r.temp_c_x10 / 10.0 : null)));

      const fissure = tier === '1B' ? (r.fissure_mm ?? null) : null;
      const strain = tier === '1B' ? (r.strain_ue ?? r.strain_ustrain ?? null) : null;

      const moisture = tier === '1C' ? (r.moisture_pct ?? null) : null;
      const ext_delta = tier === '1C' ? (r.ext_delta_mm ?? (r.ext_delta_10um != null ? r.ext_delta_10um * 0.01 : null)) : null;

      const pore_press = tier === '2B' ? (r.pore_pressure_kpa ?? null) : null;
      const bh_t1 = tier === '2B' ? (r.borehole_tilt_d1_urad ?? r.borehole_tilt_d1 ?? null) : null;
      const bh_t2 = tier === '2B' ? (r.borehole_tilt_d2_urad ?? r.borehole_tilt_d2 ?? null) : null;
      const bh_t3 = tier === '2B' ? (r.borehole_tilt_d3_urad ?? r.borehole_tilt_d3 ?? null) : null;
      const bh_t4 = tier === '2B' ? (r.borehole_tilt_d4_urad ?? r.borehole_tilt_d4 ?? null) : null;

      const gps_x = tier === '3' ? (r.gps_dx_mm ?? null) : null;
      const gps_y = tier === '3' ? (r.gps_dy_mm ?? null) : null;
      const gps_z = tier === '3' ? (r.gps_dz_mm ?? null) : null;

      const row = [
        nodeId, ts, tilt_x, tilt_y,
        accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z,
        vib_rms, vib_peak, vib_fdom, die_temp,
        fissure, strain, moisture, ext_delta,
        pore_press, bh_t1, bh_t2, bh_t3, bh_t4,
        gps_x, gps_y, gps_z
      ];

      const ph = [];
      for (let c = 0; c < row.length; c++) {
        ph.push(`$${paramIdx++}`);
        params.push(row[c]);
      }
      valueClauses.push(`(${ph.join(', ')})`);
    }

    if (valueClauses.length > 0) {
      const sql = `
        INSERT INTO readings (
          node_id, ts, tilt_x_urad, tilt_y_urad,
          accel_x_g, accel_y_g, accel_z_g, gyro_x_dps, gyro_y_dps, gyro_z_dps,
          vib_rms_mm_s, vib_peak_mm_s, vib_fdom_hz, die_temp_c,
          fissure_mm, strain_ue, moisture_pct, ext_delta_mm,
          pore_pressure_kpa, borehole_tilt_d1_urad, borehole_tilt_d2_urad,
          borehole_tilt_d3_urad, borehole_tilt_d4_urad,
          gps_dx_mm, gps_dy_mm, gps_dz_mm
        ) VALUES ${valueClauses.join(', ')}
        ON CONFLICT (node_id, ts) DO NOTHING;
      `;
      const res = await query(sql, params);
      inserted += res.rowCount;
    }
  }

  return { inserted, total: records.length };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.log('Usage: node ingest-simulation.js <path-to-simulation-data.json>');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  console.log(`[ingest] Ingesting simulation data from ${absPath}...`);
  const raw = fs.readFileSync(absPath, 'utf8');
  const records = JSON.parse(raw);
  const result = await ingestReadings(records);
  console.log(`[ingest] Completed. Inserted ${result.inserted} of ${result.total} records.`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[ingest] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { ingestReadings };
