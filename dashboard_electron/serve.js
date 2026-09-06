const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname);
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

// ---------------------------------------------------------------------------
// Map tile proxy + on-disk cache
// ---------------------------------------------------------------------------
// The dashboard is loaded by Electron with loadFile(), so the renderer's origin
// is file://. MapLibre GL fetches raster tiles with fetch/XHR, and from a
// file:// origin every cross-origin request is blocked by CORS no matter what
// the CSP allows - which is why the 3D terrain window rendered as a black
// canvas while the 2D map (plain <img> tiles, not subject to CORS) worked.
//
// Routing tiles through this same-origin proxy fixes that, and caching them to
// disk means the imagery is downloaded once rather than on every launch. After
// one warm run the 3D view works with no network at all.
const TILE_CACHE_DIR = path.join(root, 'tiles');

const TILE_UPSTREAMS = {
  // ESRI World Imagery. Note the y/x order is deliberately swapped relative to
  // the request path: ESRI serves .../tile/{z}/{y}/{x}.
  satellite: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  // Terrarium-encoded DEM. Coverage stops at z15; higher zooms legitimately
  // 404 and MapLibre overzooms the z15 tile itself.
  dem: (z, x, y) =>
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  // Place/boundary labels drawn over the satellite basemap, and the topographic
  // alternative basemap - both used by the 2D map view.
  labels: (z, x, y) =>
    `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}`,
  topo: (z, x, y) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${y}/${x}`
};

function fetchUpstream(url, redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, { headers: { 'User-Agent': 'r4-dashboard-tile-proxy' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
          return resolve(fetchUpstream(res.headers.location, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(Object.assign(new Error(`upstream ${res.statusCode}`), {
            statusCode: res.statusCode
          }));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      })
      .on('error', reject);

    req.setTimeout(8000, () => {
      req.destroy(new Error('upstream timeout'));
    });
  });
}

// ESRI serves JPEG and the terrarium DEM serves PNG, both under a .png request
// path. The DEM in particular MUST NOT be mislabelled: MapLibre decodes
// terrarium tiles by reading exact RGB bytes, so sniffing the real type from
// the magic number rather than assuming PNG keeps elevation decoding correct.
function tileContentType(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  return 'image/png';
}

function sendTile(res, buf) {
  res.setHeader('Content-Type', tileContentType(buf));
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Tiles are immutable for our purposes; let the renderer keep them in memory.
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(buf);
}

// Serves /tiles/<layer>/<z>/<x>/<y>.png, reading from disk when cached and
// falling back to the upstream provider (then caching the result) when not.
async function handleTile(req, res, layer, z, x, y) {
  const upstream = TILE_UPSTREAMS[layer];
  if (!upstream) {
    res.statusCode = 404;
    return res.end('Unknown tile layer');
  }

  // Reject anything non-numeric so the path cannot escape the cache directory.
  if (![z, x, y].every((v) => /^\d+$/.test(v))) {
    res.statusCode = 400;
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end('Bad tile coordinates');
  }

  // Terrarium DEM stops at z15; higher zooms 404 immediately so MapLibre can overzoom without network delays
  if (layer === 'dem' && Number(z) > 15) {
    res.statusCode = 404;
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.end('DEM max zoom is 15');
  }

  const cachePath = path.join(TILE_CACHE_DIR, layer, z, x, `${y}.png`);

  try {
    return sendTile(res, await fs.promises.readFile(cachePath));
  } catch (_) {
    // Not cached yet - fall through to the network.
  }

  try {
    const buf = await fetchUpstream(upstream(z, x, y));
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    // Write via a temp file so a killed process cannot leave a truncated tile
    // in the cache that would then be served forever as if it were valid.
    const tmp = `${cachePath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, cachePath);
    return sendTile(res, buf);
  } catch (err) {
    // A DEM 404 above z15 is expected and not worth logging as a failure.
    const code = err.statusCode || 502;
    if (code !== 404) {
      console.warn(`[tiles] ${layer}/${z}/${x}/${y} failed: ${err.message}`);
    }
    res.statusCode = code;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end('Tile unavailable');
  }
}

const server = http.createServer((req, res) => {
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/' || reqPath === '') reqPath = '/renderer/index.html';

  const tileMatch = reqPath.match(/^\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (tileMatch) {
    return handleTile(req, res, tileMatch[1], tileMatch[2], tileMatch[3], tileMatch[4]);
  }

  const filePath = path.normalize(path.join(root, reqPath));

  if (!filePath.startsWith(root)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.end('Not Found: ' + reqPath);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.end(data);
  });
});

// Starts on require as well as on `node serve.js`, because Electron's main
// process requires this module to get a tile server in-process when one is not
// already running - see ensureTileServer() in main.js.
server.listen(8085, '127.0.0.1', () => {
  console.log('R4 Server running on http://127.0.0.1:8085/');
});

module.exports = server;
