/**
 * ramps.js — colour language of the 3D view. Presentation only.
 *
 * Ported from the old sandbox (simulation/frontend/src/utils/hypsometry.ts), whose ramps were
 * solved against a CIE L* schedule rather than picked by eye:
 *   HEIGHT_STOPS  deep green -> mid green, lighter = higher ground (absolute terrain, metres AMSL)
 *   DEPTH_STOPS   blue -> violet -> red, darker = sunk further (change from the day-0 surface)
 * Two ramps because terrain relief (~140 m here) and subsidence (~1.2 m) differ by two orders of
 * magnitude and cannot share one scale. The depth ramp never passes through green, so it cannot be
 * confused with the height ramp it is blended over.
 */
(function (global) {
  "use strict";

  // Green ramp, solved on a CIE L* schedule (never picked by eye). Three versions have been on screen:
  //   pre-16 Sep  L* 46.0 -> 88.0   Adarsh: "light green", rejected
  //   16 Sep      L* 14.8 -> 45.7   Adarsh, 17 Sep: too dark, "reduce the darkness to 6 if this is 10"
  //   17 Sep      L* 27.3 -> 62.6   this one — 40 % of the way back toward the rejected ramp
  // Read "10 -> 6" as 40 % less dark and interpolated between the two ramps that had actually been on
  // screen, rather than inventing an absolute darkness scale. Hue angle and chroma of each stop are
  // carried over unchanged from the 16 Sep ramp; only L* moves, so the ramp stays the same green.
  // NB the 16 Sep comment here claimed L* 24 -> 52; measured against D65 the stops were 14.8 -> 45.7.
  // Retune the whole schedule if you change it, not one stop: SUBSIDENCE_SHADOW is sized against the
  // span, and a flat ramp (all five stops close in L*) is what makes ground read as mud.
  const HEIGHT_STOPS = [
    [0.00, "#2a472e"],   // lowland   L* 27.3
    [0.25, "#385b39"],   //           L* 35.2
    [0.50, "#467244"],   //           L* 43.9
    [0.75, "#578a4f"],   //           L* 52.7
    [1.00, "#6ca65e"],   // high      L* 62.7
  ];

  const DEPTH_STOPS = [
    [0.00, "#0093dc"],
    [0.14, "#1778ff"],
    [0.29, "#4b5aff"],
    [0.43, "#6c2dff"],
    [0.57, "#8800c3"],
    [0.71, "#8b006f"],
    [0.86, "#7d002a"],
    [1.00, "#690003"],
  ];

  /** Blend between a linear stretch and equal-area ranking (same as the sandbox's 0.7). */
  const HYPSOMETRIC_STRENGTH = 0.7;
  /** Darkening at depth-ramp entry so sinking ground never reads lighter than the ground around it. */
  const SUBSIDENCE_SHADOW = 0.22;

  /** sRGB channel -> linear. three.js r147 treats a vertex-colour attribute as LINEAR and encodes it
   *  on output (renderer.outputEncoding = sRGBEncoding). Handing it the sRGB hex straight from the
   *  table therefore gamma-brightened the whole ramp: #193f1c came out of the pipe near #6f9a72,
   *  which is why the ground read pale green whatever the stops said. Convert once, here. Legend bars
   *  use cssGradient, which keeps the raw hex — CSS is sRGB and needs no conversion. */
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    return [0, 2, 4].map((q) => srgbToLinear(parseInt(h.slice(q, q + 2), 16) / 255));
  }
  const H = HEIGHT_STOPS.map(([t, c]) => [t, hexToRgb(c)]);
  const D = DEPTH_STOPS.map(([t, c]) => [t, hexToRgb(c)]);

  function sample(stops, t, out) {
    const tc = Math.min(1, Math.max(0, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (tc <= t1) {
        const f = t1 === t0 ? 0 : (tc - t0) / (t1 - t0);
        out[0] = c0[0] + f * (c1[0] - c0[0]);
        out[1] = c0[1] + f * (c1[1] - c0[1]);
        out[2] = c0[2] + f * (c1[2] - c0[2]);
        return out;
      }
    }
    const last = stops[stops.length - 1][1];
    out[0] = last[0]; out[1] = last[1]; out[2] = last[2];
    return out;
  }

  /** Ramp position in [0,1] for elevation z: 0.3 linear + 0.7 equal-area rank (sortedAsc = all elevations). */
  function equalAreaT(z, sortedAsc) {
    const n = sortedAsc.length;
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedAsc[mid] < z) lo = mid + 1; else hi = mid;
    }
    const rank = lo / (n - 1);
    const zMin = sortedAsc[0], zMax = sortedAsc[n - 1];
    const linear = zMax > zMin ? (z - zMin) / (zMax - zMin) : 0;
    const s = HYPSOMETRIC_STRENGTH;
    return Math.min(1, Math.max(0, (1 - s) * linear + s * rank));
  }

  /** Horn (1981) hillshade + slope in degrees for an nx*ny grid stored i-major (index = i*ny + j). */
  function hillshade(elev, nx, ny, cell, azimuthDeg = 315, altitudeDeg = 45) {
    const shade = new Float32Array(nx * ny);
    const slope = new Float32Array(nx * ny);
    const az = (azimuthDeg * Math.PI) / 180;
    const alt = (altitudeDeg * Math.PI) / 180;
    for (let i = 0; i < nx; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(nx - 1, i + 1);
      for (let j = 0; j < ny; j++) {
        const jm = Math.max(0, j - 1), jp = Math.min(ny - 1, j + 1);
        const dzdx = (elev[ip * ny + j] - elev[im * ny + j]) / ((ip - im) * cell);
        const dzdy = (elev[i * ny + jp] - elev[i * ny + jm]) / ((jp - jm) * cell);
        const s = Math.atan(Math.hypot(dzdx, dzdy));
        const aspect = Math.atan2(dzdy, -dzdx);
        const v = Math.sin(alt) * Math.cos(s) + Math.cos(alt) * Math.sin(s) * Math.cos(az - aspect);
        shade[i * ny + j] = Math.min(1, Math.max(0, v));
        slope[i * ny + j] = (s * 180) / Math.PI;
      }
    }
    return { shade, slope };
  }

  /** CSS gradient string for a legend bar. */
  function cssGradient(stops) {
    return "linear-gradient(90deg," + stops.map(([t, c]) => `${c} ${(t * 100).toFixed(0)}%`).join(",") + ")";
  }

  global.Ramps = {
    HEIGHT_STOPS, DEPTH_STOPS, SUBSIDENCE_SHADOW,
    heightColor: (t, out) => sample(H, t, out),
    depthColor: (t, out) => sample(D, t, out),
    equalAreaT, hillshade, cssGradient,
  };
})(window);
