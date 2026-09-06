/**
 * Elevation and subsidence colouring for the real Adriyala DEM panel.
 * Presentation logic only — no physics here.
 *
 * `HYPSOMETRIC_STRENGTH` and `RAMP_FLOOR` still mirror
 * `hypsometric_normalise` in `sandbox/hypsometry.py`, so client and server
 * agree on what ramp POSITION a given elevation maps to. The colour stops
 * themselves no longer do (see the note below `HEIGHT_STOPS`).
 */

// ---------------------------------------------------------------------------
// The colour scheme, and why it is built the way it is
// ---------------------------------------------------------------------------
//
// Two ramps, one rule: HEIGHT_STOPS colours absolute elevation (green ->
// yellow, ascending in lightness, L* 46 -> 88 — higher ground is lighter).
// DEPTH_STOPS colours how far the ground has SUNK from where it started
// (blue -> violet -> red, descending in lightness, L* 58 -> 20 — deeper is
// darker).
//
// TerrainMesh blends the depth ramp over the height-coloured base as a bowl
// forms, and a previous version of this scheme proved that per-ramp
// monotonicity is not enough: with the old ramps, the composite's lightness
// at the panel median actually ROSE from L* 74.7 to L* 83.4 over the first
// 0.125 m of subsidence, because the old ground-change ramp's lightest stop
// (L* 93.1) was lighter than the terrain it was blended over. The ramp itself
// was monotonic; the composite was not, and nothing tested the composite, so
// five separate fixes retuned the ramp, saw the ramp-only test pass, and
// shipped a bug that was still there.
//
// THE FIX USED TO BE A BAND GAP: keeping the depth ramp's lightest stop
// darker than the height ramp's darkest stop, so entering the depth scale was
// a darkening step from any terrain height by construction. That worked, and
// for a while it was the whole story here. It stopped being viable when the
// ramp needed more perceptual range than a band gap leaves room for (a
// "shades go dark too soon" complaint — see the plan this ramp was rebuilt
// under). The band gap pins the ramp's usable lightness span to roughly
// 26 L* units no matter how bright the raw stops are made, because widening
// the top just demands more shadow at the bottom to keep the composite
// monotone; every unit of brightness added gets cancelled. The only way to
// buy more range without reopening the original bug is to spend it on
// CHROMA instead of lightness — hue and saturation the eye can still tell
// apart even while L* is doing the darkening work.
//
// So DEPTH_STOPS now enters at L* 58.1, which is LIGHTER than HEIGHT_STOPS'
// darkest stop (L* 46.0) — the band gap is gone on purpose. What keeps the
// composite from brightening instead is an "excavation shadow": TerrainMesh
// multiplies the blended colour by a darkening factor that is strongest
// exactly at ramp entry (where the brightness risk is) and releases as the
// ramp darkens on its own with depth (see SUBSIDENCE_SHADOW in
// TerrainMesh.tsx). `npm run verify:physics` asserts three things instead of
// two: per-ramp monotonicity, that the shadow is strong enough to darken
// ramp entry to at least HEIGHT_STOPS' darkest stop ("shadow sufficiency"),
// and the composite sweep across 21 heights x 226 depths that checks the
// actual rendered result never brightens. Do not "restore" the band gap by
// darkening these stops again — it cannot coexist with the wider chroma-
// driven ramp below (see the derivation note above DEPTH_STOPS), and the
// shadow is what carries the invariant now.
//
// The hex values below are SOLVED against a fixed CIE L* schedule (hue swept
// while chroma was maximised subject to hitting a target lightness curve),
// not hand-picked. Retuning a stop by eye can silently drop below the L*
// schedule the excavation shadow was sized against, which is exactly how
// this bug came back five times before.
//
// DIVERGED FROM THE SERVER. `sandbox/hypsometry.py`'s `TERRAIN_STOPS` still
// feeds the server-rendered PNG figures in `out/` and `scripts/pyvista_*.py`
// — a separate deliverable, not touched by this change — using the old
// green/yellow/red-brown hypsometric convention. The two ramps are no longer
// required to match; editing one does not require editing the other.
export const HEIGHT_STOPS: [number, string][] = [
  [0.00, "#417a2e"], // lowland    L* 46.0
  [0.25, "#68943f"], //            L* 56.5
  [0.50, "#92ad51"], //            L* 67.0
  [0.75, "#c0c666"], //            L* 77.5
  [1.00, "#efde86"], // high       L* 88.0
];

// ---------------------------------------------------------------------------
// Depth ramp: blue -> violet -> red, keyed to DISPLACEMENT, not AMSL
// ---------------------------------------------------------------------------

/**
 * Colour ramp for how far the ground has moved from where it started.
 *
 * WHY THIS IS NOT A SECOND ELEVATION RAMP, measured rather than asserted.
 * The panel spans 174.1 m of natural relief (196.2-370.3 m AMSL), which an
 * absolute-height ramp is stretched across. Carve-in is a small fraction of
 * that range, so a full cave-in moves an absolute ramp by a sliver of one
 * colour stop — it answers "how high is this ground", not "how far has it
 * sunk", which is the question being asked. Worse, the
 * relief is wildly non-uniform: 78% of the panel lies below 230 m while a
 * corner ridge above 250 m occupies 15% of the area but eats the top half
 * of the ramp. Measured percentiles of the real DEM:
 *
 *     25th pct = 202.8 m   ( 3.8% up the range)
 *     50th pct = 211.0 m   ( 8.5% up the range)
 *     75th pct = 225.0 m   (16.5% up the range)
 *
 * So the working area — where the mine, the nodes and every bowl actually
 * are — is compressed into the bottom sixth of any absolute ramp, and the
 * bowl moves it by 1.3%. No choice of colours fixes that, because the
 * problem is the SCALE, not the palette: absolute height and subsidence
 * differ by two orders of magnitude and cannot share one ramp.
 *
 * This ramp therefore measures the quantity actually being asked about:
 * displacement relative to the original ground surface, normalised to
 * CUMULATIVE_DEPTH_MAX_M (the deepest total carve-in the panel supports)
 * rather than to regional relief. Just-moved ground is blue; deepening
 * subsidence swings through violet; red means it has reached that ceiling.
 * Normalising to the cumulative ceiling rather than one event's S_MAX_FULL_M
 * is what keeps the colour meaningful after repeated collapses in one place.
 *
 * The signal fills the ramp by construction, because the ramp's full extent
 * IS the full range of the thing it shows.
 *
 * WHY BLUE -> RED, DESCENDING, AND NEVER THROUGH GREEN.
 * The ramp used to run green -> yellow -> red, which is a hue sequence, and
 * hue alone fails for the ~8% of men with red-green colour deficiency, in
 * greyscale, and on a washed-out projector — a naive dark-green ->
 * bright-yellow -> dark-red version peaks in lightness at yellow and falls
 * again, so a barely-settled bowl and a bowl at the ceiling map to the SAME
 * grey. Worse, ANY ramp that passes through green risks overlapping
 * HEIGHT_STOPS' own green->yellow lightness band, which is what let the
 * ground brighten as it sank (see the note above HEIGHT_STOPS). So this ramp
 * avoids green entirely — running blue -> violet -> red instead — and is
 * held to a lightness schedule, L* 58 -> 20, descending monotonically end to
 * end. That schedule no longer sits strictly below HEIGHT_STOPS' L* 46 -> 88
 * the way it once did: entry (L* 58.1) is lighter than HEIGHT_STOPS' darkest
 * stop (L* 46.0). Deeper ground is still always darker than shallower ground
 * ON THIS RAMP, but the ramp is no longer darker than any terrain colour it
 * could be blended over by construction alone — that guarantee now comes
 * from the excavation shadow TerrainMesh applies at blend time (see
 * SUBSIDENCE_SHADOW in TerrainMesh.tsx), not from the stops themselves.
 * `verify_bowl_physics.mjs` asserts the ramp's own monotonicity, that the
 * shadow is sufficient to compensate at entry, and the rendered composite
 * sweep, so a future palette edit cannot silently break any of the three.
 */
// Constructed rather than hand-picked: hue sweeps through blue/violet/red
// while chroma is MAXIMISED subject to hitting a fixed descending CIE L*
// schedule (58.0 -> 20.0) at each stop — the earlier derivation fixed
// saturation and solved only for value, which is what kept the ramp dark and
// dull even after retuning; maximising chroma instead is what buys the wider
// perceptual range this ramp needed. It no longer keeps every stop below
// HEIGHT_STOPS' lightest stop — that job belongs to the excavation shadow
// applied in TerrainMesh.tsx plus the composite sweep below, not to the stops
// themselves. Internal monotonicity is still solved for directly, because
// hand-tuning kept failing to hold a lightness schedule AND maximise chroma
// at the same time.
//
// If you retune these, re-run `npm run verify:physics`, which asserts the
// ramp's own monotonicity, shadow sufficiency, and the rendered composite.
export const DEPTH_STOPS: [number, string][] = [
  [0.00, "#0093dc"], // just moved   L* 58.1  C* 47
  [0.14, "#1778ff"], //              L* 52.8  C* 78
  [0.29, "#4b5aff"], //              L* 47.0  C* 96
  [0.43, "#6c2dff"], //              L* 41.7  C* 117
  [0.57, "#8800c3"], //              L* 36.3  C* 98
  [0.71, "#8b006f"], //              L* 31.0  C* 63
  [0.86, "#7d002a"], //              L* 25.3  C* 51
  [1.00, "#690003"], // at S_max     L* 20.1  C* 51
];

// Where the ramp starts. Was 0.1 to keep land off gist_earth's ocean-black
// bottom; HEIGHT_STOPS has no such dead zone, so the whole ramp is usable.
// Must equal RAMP_FLOOR in sandbox/hypsometry.py.
export const RAMP_FLOOR = 0.0;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Map normalised elevation `t` in [0, 1] to an RGB triple (each channel
 * 0..1) by linearly interpolating between `HEIGHT_STOPS`.
 */
export function heightColor(t: number): [number, number, number] {
  return sampleRamp(t, HEIGHT_STOPS);
}

/**
 * Colour for `t` in [0, 1] on the depth ramp: 0 = just moved,
 * 1 = subsided to the physical ceiling S_max. See DEPTH_STOPS for
 * why displacement gets its own ramp instead of sharing the elevation one.
 */
export function depthColor(t: number): [number, number, number] {
  return sampleRamp(t, DEPTH_STOPS);
}

/**
 * Piecewise-linear sample of a stop list at `t`, clamped to [0, 1].
 *
 * Factored out so the height ramp and the depth ramp cannot drift
 * apart in how they interpolate — only in the stops they interpolate between.
 */
function sampleRamp(
  t: number,
  stops: [number, string][],
): [number, number, number] {
  const tc = Math.min(1.0, Math.max(0.0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (tc >= t0 && tc <= t1) {
      const frac = t1 === t0 ? 0.0 : (tc - t0) / (t1 - t0);
      const [r0, g0, b0] = hexToRgb(c0);
      const [r1, g1, b1] = hexToRgb(c1);
      return [
        (r0 + frac * (r1 - r0)) / 255,
        (g0 + frac * (g1 - g0)) / 255,
        (b0 + frac * (b1 - b0)) / 255,
      ];
    }
  }
  const [r, g, b] = hexToRgb(stops[stops.length - 1][1]);
  return [r / 255, g / 255, b / 255];
}

/**
 * Build a sorted-ascending copy of `values`, for use with `equalAreaT`.
 */
export function buildElevationCdf(values: Float32Array): Float32Array {
  const sorted = Float32Array.from(values);
  sorted.sort();
  return sorted;
}

/** Blend between a linear stretch and full histogram equalisation. Must equal
 * the `strength` default of `hypsometric_normalise` in sandbox/hypsometry.py:
 * client and server colour the same DEM, so a mismatch here means the browser
 * and any server-rendered figure disagree about what elevation a tint means. */
export const HYPSOMETRIC_STRENGTH = 0.7;

/**
 * Ramp position in [0, 1] for elevation `z`, mirroring `hypsometric_normalise`
 * in sandbox/hypsometry.py.
 *
 * Real relief is rarely uniformly distributed: on this panel the median
 * elevation sits only ~9% of the way up the 196-370 m range, so a pure linear
 * stretch squeezes over half the ground into the bottom tenth of the ramp and
 * throws away detail the DEM actually contains. Colouring by *rank* (equal
 * ground area gets equal colour) recovers it, which is what hypsometric sheets
 * do. `HYPSOMETRIC_STRENGTH` blends the two so the ramp stays broadly
 * monotonic in height while still showing lowland detail.
 *
 * This previously returned the pure rank and ignored both the linear term and
 * RAMP_FLOOR, which put it up to 0.176 of ramp position away from the server
 * for the same elevation and dropped 10% of the panel onto the old ramp's
 * black end — the "valley reads as a hole" artefact.
 */
export function equalAreaT(
  z: number,
  sortedAsc: Float32Array,
  zMin?: number,
  zMax?: number,
): number {
  const n = sortedAsc.length;
  if (n === 0) return 0;
  if (n === 1) return RAMP_FLOOR;

  // Binary search for the insertion point of z in sortedAsc -> rank fraction.
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedAsc[mid] < z) lo = mid + 1;
    else hi = mid;
  }
  const equalised = lo / (n - 1);

  // The sorted array carries the range, so callers need not pass it.
  const lo0 = zMin ?? sortedAsc[0];
  const hi0 = zMax ?? sortedAsc[n - 1];
  const linear = hi0 > lo0 ? (z - lo0) / (hi0 - lo0) : 0.0;

  const s = HYPSOMETRIC_STRENGTH;
  const t = Math.min(1.0, Math.max(0.0, (1.0 - s) * linear + s * equalised));

  // Remap into [RAMP_FLOOR, 1] exactly as `elevation_to_color` does server-side.
  return RAMP_FLOOR + t * (1.0 - RAMP_FLOOR);
}

/**
 * Horn (1981) analytical hillshade of a square `n`x`n` elevation grid
 * (row-major, `spacingM` metres between samples), values clipped to [0, 1].
 *
 * Horn, B.K.P. (1981), "Hill shading and the reflectance map", Proceedings
 * of the IEEE 69(1), pp. 14-47 — the standard finite-difference hillshade
 * algorithm used by GIS tools (ESRI, GDAL, QGIS):
 *   slope  = atan(hypot(dz/dx, dz/dy))
 *   aspect = atan2(dz/dy, -dz/dx)
 *   shade  = sin(alt)*cos(slope) + cos(alt)*sin(slope)*cos(az - aspect)
 *
 * Azimuth 315 deg (NW) / altitude 45 deg is the cartographic default
 * (matching ESRI/GDAL) because human relief perception is biased to
 * reading illumination as coming from the upper-left.
 */
export function hillshade(
  grid: Float32Array,
  n: number,
  spacingM: number,
  azimuthDeg: number = 315.0,
  altitudeDeg: number = 45.0,
): { shade: Float32Array; slopeDeg: Float32Array } {
  const out = new Float32Array(n * n);
  // Terrain steepness falls out of the same central differences the shading
  // already needs, so it is returned alongside rather than recomputed by
  // callers that want to tint rock outcrop on steep natural ground.
  const slopeOut = new Float32Array(n * n);
  const az = (azimuthDeg * Math.PI) / 180.0;
  const alt = (altitudeDeg * Math.PI) / 180.0;
  const sinAlt = Math.sin(alt);
  const cosAlt = Math.cos(alt);

  for (let iy = 0; iy < n; iy++) {
    const iyM1 = Math.max(0, iy - 1);
    const iyP1 = Math.min(n - 1, iy + 1);
    const dyDenom = (iyP1 - iyM1) * spacingM || spacingM;
    for (let ix = 0; ix < n; ix++) {
      const ixM1 = Math.max(0, ix - 1);
      const ixP1 = Math.min(n - 1, ix + 1);
      const dxDenom = (ixP1 - ixM1) * spacingM || spacingM;

      const dzdx = (grid[iy * n + ixP1] - grid[iy * n + ixM1]) / dxDenom;
      const dzdy = (grid[iyP1 * n + ix] - grid[iyM1 * n + ix]) / dyDenom;

      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);

      const shade =
        sinAlt * Math.cos(slope) + cosAlt * Math.sin(slope) * Math.cos(az - aspect);
      out[iy * n + ix] = Math.min(1.0, Math.max(0.0, shade));
      slopeOut[iy * n + ix] = (slope * 180.0) / Math.PI;
    }
  }
  return { shade: out, slopeDeg: slopeOut };
}
