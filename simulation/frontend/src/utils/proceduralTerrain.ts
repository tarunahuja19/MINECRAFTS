import { terrainReliefM } from "./terrainSampler";
/**
 * Procedural Natural Topography Generator for Mine Simulation.
 * Generates realistic 3D hills, valleys, and ridges (Elevation +10m to +65m)
 * with analytical gradients for surface normals and slope calculations.
 */

// Simplex/Perlin-inspired multi-octave harmonic noise
function harmonicNoise2D(x: number, y: number, seed: number = 42): number {
  const s1 = Math.sin(x * 0.007 + seed * 0.1) * Math.cos(y * 0.007 + seed * 0.2);
  const s2 = Math.sin(x * 0.015 - y * 0.012 + 1.7) * 0.5;
  const s3 = Math.cos(x * 0.031 + y * 0.028 + 3.1) * 0.25;
  const s4 = Math.sin(x * 0.065 - y * 0.058 + 5.2) * 0.12;
  return s1 + s2 + s3 + s4;
}

/**
 * Evaluates the baseline natural topography elevation Z0(x, y) in meters.
 * Generates rolling hills (+45m to +65m), natural plateau saddles, and drainage valleys (+10m to +20m).
 */
export function evaluateNaturalElevation(x: number, y: number): number {
  // Base rolling landscape
  const primaryHill1 = 28.0 * Math.exp(-((x - 120) ** 2 + (y - 80) ** 2) / (2 * 140 ** 2)); // North-East Hill (+60m peak)
  const primaryHill2 = 22.0 * Math.exp(-((x + 140) ** 2 + (y + 110) ** 2) / (2 * 130 ** 2)); // South-West Ridge (+50m)
  const plateau = 14.0 * Math.exp(-((x + 80) ** 2 + (y - 140) ** 2) / (2 * 100 ** 2));
  
  // Valley drainage groove along y-axis
  const valleyDepth = -8.0 * Math.exp(-(x ** 2) / (2 * 90 ** 2));

  // Multi-frequency terrain ripples (rocks and soil undulations)
  const detail = harmonicNoise2D(x, y) * 7.5;

  // Base elevation datum (15m above mine seam datum)
  const baseDatum = 22.0;

  const totalElev = baseDatum + primaryHill1 + primaryHill2 + plateau + valleyDepth + detail;
  return Math.max(8.0, totalElev); // Keep above minimum datum
}

/**
 * Classifies a point into geological terrain categories for operator HUD inspection.
 */
export function classifyTerrainZone(
  elevation: number,
  slopeDeg: number
): "HIGHLAND_RIDGE" | "ESCARPMENT_CLIFF" | "TRANSITION_SLOPE" | "PIT_BASIN" {
  // Thresholds are fractions of the panel's own relief, not absolute metres.
  // The absolute 45 m / 18 m cutoffs were calibrated for the retired
  // procedural hills (8-65 m); against the real Adriyala DEM's 174 m of relief
  // they classified almost the entire panel as HIGHLAND_RIDGE.
  const relief = Math.max(1, terrainReliefM());
  const t = elevation / relief;
  if (t > 0.62) return "HIGHLAND_RIDGE";
  if (slopeDeg > 18.0) return "ESCARPMENT_CLIFF";
  if (t < 0.22) return "PIT_BASIN";
  return "TRANSITION_SLOPE";
}
