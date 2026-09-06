/**
 * Single source of truth for "how high is the ground at (x, y)?".
 *
 * Before this module existed, three consumers each answered that question a
 * different way: TerrainMesh bilinearly sampled the server's real Adriyala DEM
 * (196-370 m AMSL, rendered datum-relative as 0-174 m), while NodeMarkers and
 * TargetBeacon both called `evaluateNaturalElevation()` — the invented
 * procedural hills, which only ever return 8-65 m. The result was that sensor
 * monuments and the red targeting ring were drawn at elevations unrelated to
 * the terrain actually on screen: nodes sank inside the ridge and the ring
 * disappeared under the surface.
 *
 * Everything that needs a ground height now goes through `sampleGroundY()`,
 * which returns the value in the SAME datum-relative scene units the mesh
 * writes into its position buffer, so a marker placed at that Y is on the
 * surface by construction.
 */

import { globalGeomechanics } from "./geomechanicsEngine";
import { evaluateNaturalElevation } from "./proceduralTerrain";
import type { Perturbation } from "../types";

interface TerrainSource {
  mesh: number[][] | null;
  n: number;
  datum: number;
  windowSizeM: number;
}

// Module-level because the R3F component tree reads this from render paths
// (NodeMarkers' useMemo, TargetBeacon's ring builder) that are not children of
// the component owning the mesh data, and threading a context through every
// one of them buys nothing over a value that changes once per `init` payload.
const source: TerrainSource = {
  mesh: null,
  n: 0,
  datum: 0,
  windowSizeM: 600,
};

/** Publish the server's real DEM. Called from TerrainMesh when `z0Mesh` changes. */
export function setTerrainSource(
  mesh: number[][] | null,
  datum: number,
  windowSizeM: number
): void {
  source.mesh = mesh && mesh.length > 0 ? mesh : null;
  source.n = source.mesh ? source.mesh.length : 0;
  source.datum = datum;
  source.windowSizeM = windowSizeM;
}

/** Elevation range of the live source, in datum-relative scene units. */
export function terrainReliefM(): number {
  if (!source.mesh) return 65;
  let max = -Infinity;
  for (const row of source.mesh) {
    for (const v of row) if (v > max) max = v;
  }
  return max === -Infinity ? 65 : max - source.datum;
}

/**
 * Bilinear sample of a square `n`x`n` grid at normalised (u, v) in [0, 1],
 * clamped at the edges.
 */
export function sampleGrid(mesh: number[][], n: number, u: number, v: number): number {
  const uc = Math.min(1, Math.max(0, u));
  const vc = Math.min(1, Math.max(0, v));
  const fx = uc * (n - 1);
  const fy = vc * (n - 1);
  const ix0 = Math.floor(fx);
  const iy0 = Math.floor(fy);
  const ix1 = Math.min(n - 1, ix0 + 1);
  const iy1 = Math.min(n - 1, iy0 + 1);
  const tx = fx - ix0;
  const ty = fy - iy0;

  const z00 = mesh[iy0][ix0];
  const z10 = mesh[iy0][ix1];
  const z01 = mesh[iy1][ix0];
  const z11 = mesh[iy1][ix1];

  const top = z00 + (z10 - z00) * tx;
  const bottom = z01 + (z11 - z01) * tx;
  return top + (bottom - top) * ty;
}

/**
 * Undeformed baseline ground height at world (x, y), in datum-relative scene
 * units — i.e. directly comparable to the mesh's vertex Y.
 */
export function sampleBaseGroundY(x: number, y: number): number {
  if (!source.mesh) return evaluateNaturalElevation(x, y);
  const half = source.windowSizeM / 2.0;
  const u = (x + half) / source.windowSizeM;
  const v = (y + half) / source.windowSizeM;
  return sampleGrid(source.mesh, source.n, u, v) - source.datum;
}

/**
 * Live ground height at world (x, y) including subsidence, server
 * perturbations, vertical exaggeration and seismic vibration — the exact
 * expression TerrainMesh writes into its position buffer, so anything placed
 * here sits on the rendered surface rather than floating or sinking.
 */
export function sampleGroundY(
  x: number,
  y: number,
  exaggeration: number = 1.0,
  perturbations?: Perturbation[],
  nowSec: number = performance.now() / 1000.0
): number {
  const base = sampleBaseGroundY(x, y);
  const state = globalGeomechanics.evaluatePoint(x, y, base, nowSec);

  let serverDrop = 0.0;
  if (perturbations && perturbations.length > 0) {
    for (const p of perturbations) {
      const dist = Math.hypot(x - p.cx, y - p.cy);
      if (dist < p.radius_m) {
        serverDrop += p.amp * Math.exp(-Math.pow(dist / (p.radius_m * 0.7), 2.2));
      }
    }
  }

  return base - (state.dropDistanceM + serverDrop) * exaggeration + state.vibrationDisplacementM;
}

/**
 * Ground slope in degrees at world (x, y), by central difference on the
 * baseline surface. Uses the real DEM when one is loaded, so the "slope" the
 * targeting panel reports is the slope of the terrain actually on screen.
 *
 * A central difference is correct here (unlike for the strain channels, which
 * must use analytic derivatives) because the DEM is a sampled grid with no
 * closed form to differentiate — there is no analytic alternative to lose.
 */
export function sampleSlopeDegrees(x: number, y: number, h: number = 5.0): number {
  const zL = sampleBaseGroundY(x - h, y);
  const zR = sampleBaseGroundY(x + h, y);
  const zD = sampleBaseGroundY(x, y - h);
  const zU = sampleBaseGroundY(x, y + h);
  const dzdx = (zR - zL) / (2 * h);
  const dzdy = (zU - zD) / (2 * h);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180.0) / Math.PI;
}
