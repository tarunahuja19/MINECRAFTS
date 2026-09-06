/**
 * Metres <-> lat/lon for the 3D simulation view.
 *
 * This is the TypeScript mirror of `simulation/sandbox/geo.py`, and it is a
 * MIRROR, not a second opinion: the same flat-earth projection about the same
 * Adriyala origin, so a node at (x, y) metres lands on the same ground here,
 * on the dashboard map (frontend_dashboard/renderer/js/map/map-view.js) and in
 * PostgreSQL (nodes.lat/nodes.lon, written by sandbox/db.py). If these ever
 * disagree the two screens quietly drift apart, which is the exact bug the
 * geo-alignment work removed.
 *
 * The constants below are defaults only. The server sends `dem_lat`,
 * `dem_lon` and `panel_bearing_deg` in its init payload, and `setGeoOrigin()`
 * adopts those on connect — so the server stays the authority at runtime and
 * these values only cover the pre-connect / offline view.
 */

/** Panel centre (x=0, y=0): the real Adriyala longwall site, Telangana. */
export const DEFAULT_ORIGIN_LAT = 18.6435;
export const DEFAULT_ORIGIN_LON = 79.5725;

/**
 * Compass bearing of the panel's long axis. 0 means +y is due north and +x
 * due east — a STATED ASSUMPTION carried over from geo.py, pending real SCCL
 * data. Changing it server-side rotates map, grid and nodes together.
 */
export const DEFAULT_PANEL_BEARING_DEG = 0.0;

const M_PER_DEG_LAT = 111320.0;

/** The live origin, overwritten by the server's init payload. */
let originLat = DEFAULT_ORIGIN_LAT;
let originLon = DEFAULT_ORIGIN_LON;
let bearingDeg = DEFAULT_PANEL_BEARING_DEG;
let mPerDegLon = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);

/**
 * Adopt the origin the server actually simulated on. Called once from the
 * init handler; arguments the server omits leave the current value alone, so
 * an older server that sends no bearing does not silently reset it.
 */
export function setGeoOrigin(lat?: number, lon?: number, bearing?: number): void {
  if (Number.isFinite(lat)) originLat = lat as number;
  if (Number.isFinite(lon)) originLon = lon as number;
  if (Number.isFinite(bearing)) bearingDeg = bearing as number;
  mPerDegLon = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180);
}

export function getGeoOrigin(): { lat: number; lon: number; bearingDeg: number } {
  return { lat: originLat, lon: originLon, bearingDeg };
}

/** Rotate a panel-frame vector into east/north. Exactly the identity at
 *  bearing 0, matching geo.py's `_rotate`. */
function rotate(x: number, y: number, deg: number): [number, number] {
  if (deg === 0.0) return [x, y];
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [x * cos + y * sin, -x * sin + y * cos];
}

/** Panel-frame metres -> [lat, lon] degrees. Mirrors geo.xy_to_latlon. */
export function xyToLatLon(x: number, y: number): [number, number] {
  const [east, north] = rotate(x, y, bearingDeg);
  return [originLat + north / M_PER_DEG_LAT, originLon + east / mPerDegLon];
}

/** [lat, lon] degrees -> panel-frame metres. Exact inverse of xyToLatLon. */
export function latLonToXy(lat: number, lon: number): [number, number] {
  const north = (lat - originLat) * M_PER_DEG_LAT;
  const east = (lon - originLon) * mPerDegLon;
  return rotate(east, north, -bearingDeg);
}

/** Format a lat/lon pair the way both screens label a position, so the same
 *  node reads identically in the 3D tag and in the dashboard popup. */
export function formatLatLon(lat: number, lon: number): string {
  return `${lat.toFixed(5)}°${lat >= 0 ? "N" : "S"}, ${lon.toFixed(5)}°${lon >= 0 ? "E" : "W"}`;
}
