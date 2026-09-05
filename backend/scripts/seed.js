'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// ---------------------------------------------------------------------------
// LEGACY SEEDER - DISABLED BY DEFAULT.
//
// This script predates the geo-alignment work. It is destructive and wrong:
//   * It TRUNCATEs readings AND nodes, wiping the live simulation run and the
//     geo-aligned nodes (their lat/lon and real z elevations) along with it.
//   * It repopulates from the old 60-node Jharia fixture (23.74N, 86.42E),
//     which is ~1000 km from the modelled site (Adriyala, Telangana 18.6435N,
//     79.5750E - see simulation/sandbox/geo.py).
//   * Its FIXTURES_DIR points at ../../r4-dashboard/fixtures, which no longer
//     exists, so it cannot run to completion anyway.
//
// The real data path is: run the simulation (npm run sim), which writes
// geo-aligned nodes and readings straight to PostgreSQL via sandbox/db.py.
//
// If you genuinely need the legacy Jharia demo data, set:
//     ALLOW_LEGACY_JHARIA_SEED=1 npm --prefix backend run seed
// ---------------------------------------------------------------------------
if (process.env.ALLOW_LEGACY_JHARIA_SEED !== '1') {
  console.error('[seed] REFUSING TO RUN: this legacy seeder TRUNCATEs nodes and readings');
  console.error('[seed] and repopulates them from the obsolete Jharia fixture, destroying');
  console.error('[seed] the geo-aligned nodes and the current simulation run.');
  console.error('[seed] Use "npm run sim" to populate the database instead.');
  console.error('[seed] To override anyway: ALLOW_LEGACY_JHARIA_SEED=1 node backend/scripts/seed.js');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'labpass123',
  database: process.env.PGDATABASE || 'mine_subsidence',
});

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'r4-dashboard', 'fixtures');

// Tier assignment per SCHEMA.md:
function getNodeTier(nodeId) {
  const num = parseInt(nodeId.replace(/\D/g, ''), 10) || 1;
  if (num <= 20) return { tier: '1B', node_type: 'scout' };
  if (num <= 30) return { tier: '1C', node_type: 'scout' };
  if (num <= 40) return { tier: '2A', node_type: 'anchor' };
  if (num <= 50) return { tier: '2B', node_type: 'anchor' };
  return { tier: '3', node_type: 'gateway' };
}

// Subsidence epicenter coordinates (Panel A East extraction front)
const SUBSIDENCE_LAT = 23.7455;
const SUBSIDENCE_LNG = 86.4190;
const RADIUS_OF_INFLUENCE = 210; // meters (standard Knothe influence radius for 180m depth)

async function seed() {
  console.log('[seed] Starting coordinated Knothe subsidence database seeding (60s TDMA superframes)...');
  const client = await pool.connect();

  try {
    // 1. Load nodes fixture
    const nodesFile = path.join(FIXTURES_DIR, 'nodes.json');
    if (!fs.existsSync(nodesFile)) {
      throw new Error(`Nodes fixture not found at ${nodesFile}`);
    }
    const rawNodes = JSON.parse(fs.readFileSync(nodesFile, 'utf8'));
    console.log(`[seed] Found ${rawNodes.length} nodes in fixtures.`);

    const REF_LAT = 23.7445;
    const REF_LNG = 86.4205;

    await client.query('BEGIN');

    // Clean existing data
    await client.query('TRUNCATE TABLE readings CASCADE;');
    await client.query('TRUNCATE TABLE nodes CASCADE;');

    // Classify all nodes by physical distance and Knothe influence to subsidence center
    const nodeSpatialInfo = {};
    const criticalNodeIds = [];
    const warningNodeIds = [];

    for (const node of rawNodes) {
      const dx = (node.lng - SUBSIDENCE_LNG) * 102000;
      const dy = (node.lat - SUBSIDENCE_LAT) * 111000;
      const dist = Math.hypot(dx, dy);
      const influence = Math.exp(-Math.PI * Math.pow(dist / RADIUS_OF_INFLUENCE, 2));

      let initialStatus = 'active';
      if (node.node_id === 'N48') {
        initialStatus = 'lastgasp';
      } else if (influence >= 0.5) {
        initialStatus = 'critical';
        criticalNodeIds.push(node.node_id);
      } else if (influence >= 0.08) {
        initialStatus = 'warning';
        warningNodeIds.push(node.node_id);
      }

      nodeSpatialInfo[node.node_id] = {
        dist: Math.round(dist),
        influence: Math.round(influence * 1000) / 1000,
        initialStatus
      };

      const { tier, node_type } = getNodeTier(node.node_id);
      const x = Math.round((node.lng - REF_LNG) * 102000 * 100) / 100;
      const y = Math.round((node.lat - REF_LAT) * 111000 * 100) / 100;
      const z = 0.0;

      await client.query(
        `INSERT INTO nodes (node_id, site_id, tier, node_type, x, y, z, installed_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (node_id) DO UPDATE 
         SET site_id = EXCLUDED.site_id, tier = EXCLUDED.tier, node_type = EXCLUDED.node_type,
             x = EXCLUDED.x, y = EXCLUDED.y, z = EXCLUDED.z, status = EXCLUDED.status;`,
        [node.node_id, 'mine-r4', tier, node_type, x, y, z, new Date('2026-01-15T08:00:00Z'), initialStatus]
      );
    }

    console.log(`[seed] Node Classification according to Knothe Subsidence Geometry:`);
    console.log(`  - Core Critical Nodes (${criticalNodeIds.length}): ${criticalNodeIds.join(', ')}`);
    console.log(`  - Warning Inflection Nodes (${warningNodeIds.length}): ${warningNodeIds.join(', ')}`);
    console.log(`  - Perimeter Last-Gasp Node: N48`);
    console.log(`  - Reference Active Nodes: ${rawNodes.length - criticalNodeIds.length - warningNodeIds.length - 1} nodes`);

    // 2. Generate 120 consecutive 60-second TDMA superframes (2 hours)
    // Detection timeline based on physical propagation velocity across the mesh:
    const TOTAL_STEPS = 120;
    const nowSec = Math.floor(Date.now() / 1000);
    const baseEpoch = (Math.floor(nowSec / 60) - TOTAL_STEPS) * 60;

    console.log(`[seed] Generating ${TOTAL_STEPS} timesteps at 60s intervals (${TOTAL_STEPS * 60} readings total)...`);
    console.log(`[seed] Time range: ${new Date(baseEpoch * 1000).toISOString()} -> ${new Date((baseEpoch + TOTAL_STEPS * 60) * 1000).toISOString()}`);

    const generatedReadings = [];

    for (let s = 0; s < TOTAL_STEPS; s++) {
      const stepEpoch = baseEpoch + s * 60;
      const ts = new Date(stepEpoch * 1000);

      for (const node of rawNodes) {
        const nodeId = node.node_id;
        const num = parseInt(nodeId.replace(/\D/g, ''), 10) || 1;
        const { tier } = getNodeTier(nodeId);
        const spatial = nodeSpatialInfo[nodeId];

        // Normal ambient baseline
        const noiseStrain = (Math.sin(s * 0.2 + num) * 3) + (Math.cos(s * 0.35 + num) * 2);
        let strainVal = 95 + Math.round(noiseStrain);
        let tiltX_mdeg = Math.round((Math.sin(s * 0.15 + num) * 2) * 10) / 10;
        let tiltY_mdeg = Math.round((Math.cos(s * 0.15 + num) * 2) * 10) / 10;
        let tempC = Math.round((21.5 + (Math.sin(s * 0.05 + num) * 0.6)) * 10) / 10;
        let vibRms = Math.round((0.65 + (Math.abs(Math.sin(s * 0.1 + num)) * 0.25)) * 100) / 100;
        let flags = 0;

        // Ground movement propagation based on physical proximity to subsidence center:
        if (nodeId === 'N48') {
          // Perimeter anchor fault rupture
          if (s >= 98 && s < 102) {
            vibRms = 3.8 + (Math.random() * 0.8);
            strainVal = 320;
          } else if (s >= 102) {
            flags = 1; // Last-gasp rupture packet
            strainVal = 780;
            vibRms = 4.2;
            tiltX_mdeg = 310;
          }
        } else if (spatial.initialStatus === 'critical') {
          // Core subsidence nodes: N07 (44m), N26 (67m), N06 (75m), N27 (75m), N08 (76m)
          // Onset time is strictly proportional to distance from center:
          const onsetStep = Math.round(30 + (spatial.dist - 44) * 0.55); // N07: 30, N26: 43, N06/N27/N08: ~47-49
          const warningStep = onsetStep + 10; // Crosses 400
          const criticalStep = onsetStep + 34; // Crosses 600

          if (s < onsetStep) {
            strainVal = 95 + Math.round(noiseStrain);
          } else if (s < criticalStep) {
            // Progressive creep into warning stage
            const progress = (s - onsetStep) / (criticalStep - onsetStep);
            strainVal = Math.round(100 + progress * 510 + noiseStrain);
            tiltX_mdeg = Math.round((-10 - progress * 200));
          } else if (s < 95) {
            // Rapid acute acceleration into full rupture
            const acuteProgress = (s - criticalStep) / (95 - criticalStep);
            const peakStrain = 620 + Math.round(spatial.influence * 300); // N07 reaches ~910, N26 ~830, N06/N08 ~740
            strainVal = Math.round(620 + acuteProgress * (peakStrain - 620) + noiseStrain);
            tiltX_mdeg = Math.round((-210 - acuteProgress * 250));
            vibRms = Math.round((1.8 + acuteProgress * 1.2) * 100) / 100;
          } else {
            // Plateau at full subsidence basin
            const finalStrain = 620 + Math.round(spatial.influence * 300);
            strainVal = finalStrain + Math.round(Math.sin(s) * 6);
            tiltX_mdeg = -460 + Math.round(Math.cos(s) * 4);
          }
        } else if (spatial.initialStatus === 'warning') {
          // Warning inflection nodes: N25, N05, N09, N28, N04, N47, N10 (distances 102m - 173m)
          const onsetStep = Math.round(40 + (spatial.dist - 100) * 0.45); // ~41 to ~73
          const targetWarningStrain = Math.round(410 + spatial.influence * 260); // 440 to 540 ustrain

          if (s < onsetStep) {
            strainVal = 90 + Math.round(noiseStrain);
          } else {
            const warningProgress = Math.min(1.0, (s - onsetStep) / 25);
            strainVal = Math.round(90 + warningProgress * (targetWarningStrain - 90) + noiseStrain);
            tiltY_mdeg = Math.round(-10 - warningProgress * 70);
          }
        }

        // Convert to SCHEMA.md units
        const tiltX_urad = Math.round(tiltX_mdeg * 17.4533);
        const tiltY_urad = Math.round(tiltY_mdeg * 17.4533);
        const vibPeak = Math.round((vibRms * 1.414) * 100) / 100;
        const vibFdom = Math.round((12.5 + ((num * 3) % 7)) * 10) / 10;

        // Strict tier nullability per SCHEMA.md
        const is1Series = ['1A', '1B', '1C'].includes(tier);
        const tilt_x_urad = ['1A', '1B', '1C', '2A'].includes(tier) ? tiltX_urad : null;
        const tilt_y_urad = ['1A', '1B', '1C', '2A'].includes(tier) ? tiltY_urad : null;
        const accel_x_g = is1Series ? 0.01 : null;
        const accel_y_g = is1Series ? -0.01 : null;
        const accel_z_g = is1Series ? 0.98 : null;
        const gyro_x_dps = is1Series ? 0.02 : null;
        const gyro_y_dps = is1Series ? -0.01 : null;
        const gyro_z_dps = is1Series ? 0.01 : null;
        const vib_rms_mm_s = is1Series ? vibRms : null;
        const vib_peak_mm_s = is1Series ? vibPeak : null;
        const vib_fdom_hz = is1Series ? vibFdom : null;
        const die_temp_c = tempC;
        const fissure_mm = tier === '1B' ? Math.round((0.35 + (strainVal / 500)) * 100) / 100 : null;
        const strain_ue = tier === '1B' ? strainVal : null;
        const moisture_pct = tier === '1C' ? Math.round((18.5 + (strainVal % 15)) * 10) / 10 : null;
        const ext_delta_mm = tier === '1C' ? Math.round((0.20 + (strainVal / 1200)) * 100) / 100 : null;
        const pore_pressure_kpa = tier === '2B' ? Math.round((142.0 + (vibRms * 3.5)) * 10) / 10 : null;
        const borehole_tilt_d1_urad = tier === '2B' ? Math.round(tiltX_urad * 1.2) : null;
        const borehole_tilt_d2_urad = tier === '2B' ? Math.round(tiltX_urad * 0.9) : null;
        const borehole_tilt_d3_urad = tier === '2B' ? Math.round(tiltX_urad * 0.6) : null;
        const borehole_tilt_d4_urad = tier === '2B' ? Math.round(tiltX_urad * 0.3) : null;
        const gps_dx_mm = tier === '3' ? Math.round((Math.sin(s / 20) * 2.2) * 100) / 100 : null;
        const gps_dy_mm = tier === '3' ? Math.round((Math.cos(s / 20) * 1.8) * 100) / 100 : null;
        const gps_dz_mm = tier === '3' ? Math.round((Math.sin(s / 40) * 0.9) * 100) / 100 : null;

        generatedReadings.push({
          node_id: nodeId,
          ts: ts,
          t_epoch_s: stepEpoch,
          tilt_x_urad, tilt_y_urad,
          accel_x_g, accel_y_g, accel_z_g,
          gyro_x_dps, gyro_y_dps, gyro_z_dps,
          vib_rms_mm_s, vib_peak_mm_s, vib_fdom_hz,
          die_temp_c, fissure_mm, strain_ue,
          moisture_pct, ext_delta_mm, pore_pressure_kpa,
          borehole_tilt_d1_urad, borehole_tilt_d2_urad,
          borehole_tilt_d3_urad, borehole_tilt_d4_urad,
          gps_dx_mm, gps_dy_mm, gps_dz_mm,
          strain_ustrain: strainVal,
          tilt_x_mdeg: tiltX_mdeg,
          tilt_y_mdeg: tiltY_mdeg,
          temp_c_x10: Math.round(tempC * 10),
          vbat_mv: 4120 - Math.round(s * 0.2),
          vib_rms: Math.round(vibRms * 10),
          flags: flags
        });
      }
    }

    console.log(`[seed] Batch inserting ${generatedReadings.length} readings into PostgreSQL...`);
    const BATCH_SIZE = 500;
    for (let i = 0; i < generatedReadings.length; i += BATCH_SIZE) {
      const batch = generatedReadings.slice(i, i + BATCH_SIZE);
      const valueClauses = [];
      const params = [];
      let paramIdx = 1;

      for (const r of batch) {
        const cols = [
          r.node_id, r.ts, r.tilt_x_urad, r.tilt_y_urad,
          r.accel_x_g, r.accel_y_g, r.accel_z_g, r.gyro_x_dps, r.gyro_y_dps, r.gyro_z_dps,
          r.vib_rms_mm_s, r.vib_peak_mm_s, r.vib_fdom_hz, r.die_temp_c,
          r.fissure_mm, r.strain_ue, r.moisture_pct, r.ext_delta_mm,
          r.pore_pressure_kpa, r.borehole_tilt_d1_urad, r.borehole_tilt_d2_urad,
          r.borehole_tilt_d3_urad, r.borehole_tilt_d4_urad,
          r.gps_dx_mm, r.gps_dy_mm, r.gps_dz_mm
        ];

        const ph = [];
        for (let c = 0; c < cols.length; c++) {
          ph.push(`$${paramIdx++}`);
          params.push(cols[c]);
        }
        valueClauses.push(`(${ph.join(', ')})`);
      }

      const insertSql = `
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
      await client.query(insertSql, params);
    }

    await client.query('COMMIT');
    console.log('[seed] PostgreSQL readings insert committed.');

    // 3. Synchronize alarms with the multi-node Knothe subsidence cluster
    const allAffectedSubsidenceNodes = [
      ...criticalNodeIds,
      ...warningNodeIds,
      'N48'
    ];

    const synchronizedAlarms = [
      {
        alarm_id: 'ALM-N05',
        t_utc: new Date((baseEpoch + 70 * 60) * 1000).toISOString(),
        panel_id: 'PNL-A-NORTH',
        level: 2,
        centroid: { lat: SUBSIDENCE_LAT, lng: SUBSIDENCE_LNG },
        affected_nodes: ['N07', 'N26', 'N27', 'N06', 'N08', 'N05', 'N25'],
        trough_fit_r2: 0.89,
        projection: { days_to_level_3: 4.8, confidence: 0.84 },
        blast_correlated: false,
        explanation: 'LEVEL 2 WARNING: Coordinated multi-sensor tensile deflection detected across Inner and Middle rings. 7 adjacent nodes show correlated ground extension over extraction front.',
        confidence_zone: 'medium_warning'
      },
      {
        alarm_id: 'ALM-N07',
        t_utc: new Date((baseEpoch + 92 * 60) * 1000).toISOString(),
        panel_id: 'PNL-A-EAST',
        level: 3,
        centroid: { lat: SUBSIDENCE_LAT, lng: SUBSIDENCE_LNG },
        affected_nodes: allAffectedSubsidenceNodes,
        trough_fit_r2: 0.97,
        projection: { days_to_level_3: 0, confidence: 0.96 },
        blast_correlated: false,
        explanation: `CRITICAL LEVEL 3 SUBSIDENCE: Multi-ring subsidence trough fully formed. Core settlement cluster (${criticalNodeIds.join(', ')}) exceeds critical rupture strain (>600-920 ustrain). Radial inflection confirmed across ${allAffectedSubsidenceNodes.length} coordinated nodes. Evacuate extraction front immediately.`,
        confidence_zone: 'high_confidence'
      },
      {
        alarm_id: 'ALM-N48',
        t_utc: new Date((baseEpoch + 102 * 60) * 1000).toISOString(),
        panel_id: 'PNL-A-DEFENSE',
        level: 3,
        centroid: { lat: 23.7466, lng: 86.4171 },
        affected_nodes: ['N48', 'N47'],
        trough_fit_r2: 0.98,
        projection: { days_to_level_3: 0, confidence: 0.98 },
        blast_correlated: false,
        explanation: 'CRITICAL LAST-GASP EVENT: Outer perimeter shear rupture. Node N48 transmitted final rupture RF burst upon edge fault displacement before sensor decapitation.',
        confidence_zone: 'high_confidence'
      }
    ];

    fs.writeFileSync(path.join(FIXTURES_DIR, 'alarms.json'), JSON.stringify(synchronizedAlarms, null, 2), 'utf8');
    console.log('[seed] Synchronized fixtures/alarms.json with detection timeline.');

    // 4. Also update fixtures/nodes.json with the initial mine state
    const nodesJsonContent = rawNodes.map(n => ({
      ...n,
      state: nodeSpatialInfo[n.node_id] ? nodeSpatialInfo[n.node_id].initialStatus : 'active'
    }));
    fs.writeFileSync(nodesFile, JSON.stringify(nodesJsonContent, null, 2), 'utf8');
    console.log('[seed] Synchronized fixtures/nodes.json with initial mine condition.');

    // 5. Update fixtures/telemetry-90d.json with the exact 60-second time series
    const fixtureCompatible = generatedReadings.map(r => ({
      node_id: r.node_id,
      t_epoch_s: r.t_epoch_s,
      strain_ustrain: r.strain_ustrain,
      tilt_x_mdeg: r.tilt_x_mdeg,
      tilt_y_mdeg: r.tilt_y_mdeg,
      temp_c_x10: r.temp_c_x10,
      vbat_mv: r.vbat_mv,
      vib_rms: r.vib_rms,
      flags: r.flags
    }));
    fs.writeFileSync(path.join(FIXTURES_DIR, 'telemetry-90d.json'), JSON.stringify(fixtureCompatible), 'utf8');
    console.log('[seed] Updated fixtures/telemetry-90d.json with 60-second replay data.');

    // Summary
    const nodeCount = await client.query('SELECT count(*) FROM nodes;');
    const readingCount = await client.query('SELECT count(*) FROM readings;');
    console.log(`[seed] SUCCESS! Database Summary:`);
    console.log(`  - Total nodes: ${nodeCount.rows[0].count}`);
    console.log(`  - Total readings: ${readingCount.rows[0].count} (every 60s)`);
    console.log(`  - Total affected nodes in subsidence basin: ${allAffectedSubsidenceNodes.length}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Seeding error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { seed };
