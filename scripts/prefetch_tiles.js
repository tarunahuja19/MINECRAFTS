#!/usr/bin/env node
'use strict';

/**
 * Warms the on-disk map tile cache for the Adriyala site.
 *
 * The dashboard's tile proxy (dashboard_electron/serve.js) caches whatever it
 * fetches, so the cache fills in naturally as you pan the map. This script just
 * front-loads that work: run it once with a network connection and the 2D map
 * and the 3D terrain window both render fully offline afterwards, which is what
 * makes the app safe to demo on an untrusted network.
 *
 * Usage:  node scripts/prefetch_tiles.js          (server must be running)
 */

const http = require('http');

// Adriyala longwall site - the same anchor used by simulation/sandbox/geo.py.
// Keep these in step with ORIGIN_LAT/ORIGIN_LON there.
const ORIGIN_LAT = 18.6435;
const ORIGIN_LON = 79.5725;

// Half-width of the area to warm. The simulation window is 600 m across; 1.5 km
// gives comfortable margin to pan and zoom around it without hitting cold tiles.
const HALF_SPAN_M = 1500;
const M_PER_DEG_LAT = 111320;

const BASE = 'http://127.0.0.1:8085/tiles';

// The satellite basemap is used from z12 up to its native z19. The terrarium DEM
// has no coverage above z15 and MapLibre overzooms the z15 tile, so fetching
// beyond that would only collect 404s.
const LAYERS = {
  satellite: [12, 17],
  labels: [12, 17],
  topo: [12, 16],
  dem: [12, 15]
};

function lonToX(lon, z) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function latToY(lat, z) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * Math.pow(2, z)
  );
}

function get(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      })
      .on('error', () => resolve(0));
  });
}

async function main() {
  const dLat = HALF_SPAN_M / M_PER_DEG_LAT;
  const dLon = HALF_SPAN_M / (M_PER_DEG_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180));

  const north = ORIGIN_LAT + dLat;
  const south = ORIGIN_LAT - dLat;
  const west = ORIGIN_LON - dLon;
  const east = ORIGIN_LON + dLon;

  const targets = [];
  for (const [layer, [minZ, maxZ]] of Object.entries(LAYERS)) {
    for (let z = minZ; z <= maxZ; z++) {
      // y grows southward in Web Mercator, so the north edge gives the low y.
      for (let x = lonToX(west, z); x <= lonToX(east, z); x++) {
        for (let y = latToY(north, z); y <= latToY(south, z); y++) {
          targets.push(`${BASE}/${layer}/${z}/${x}/${y}.png`);
        }
      }
    }
  }

  console.log(`[prefetch] warming ${targets.length} tiles around ${ORIGIN_LAT}, ${ORIGIN_LON}`);

  let ok = 0;
  let failed = 0;
  // Modest concurrency - enough to be quick, not enough to get rate-limited by
  // the upstream imagery providers.
  const CONCURRENCY = 6;
  let next = 0;

  async function worker() {
    while (next < targets.length) {
      const i = next++;
      const code = await get(targets[i]);
      if (code === 200) ok++;
      else failed++;
      if ((ok + failed) % 50 === 0) {
        console.log(`[prefetch] ${ok + failed}/${targets.length}  ok=${ok} miss=${failed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`[prefetch] done: ${ok} cached, ${failed} unavailable`);
  if (ok === 0) {
    console.error('[prefetch] nothing cached - is the dashboard server running on 8085?');
    process.exit(1);
  }
}

main();
