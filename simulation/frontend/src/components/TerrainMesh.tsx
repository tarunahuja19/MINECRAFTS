import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import type { Perturbation, SimulationPacket } from "../types";
import type { EmbedClipBounds } from "../embed";
import { SeismicWaveOverlay } from "./SeismicWaveOverlay";
import { evaluateNaturalElevation } from "../utils/proceduralTerrain";
import { ADRIYALA, globalGeomechanics, CUMULATIVE_DEPTH_MAX_M } from "../utils/geomechanicsEngine";

// --- Subsidence overlay tuning ---------------------------------------------

/**
 * Settlement-bowl ramp ceiling, m: one seam's worth of subsidence,
 * S_max = a * m (0.75 * 3.0 = 2.25 m). The blue DEPTH_STOPS run 0 -> this.
 *
 * Not S_MAX_FULL_M (5 m, the per-event carve-in ceiling) and not
 * CUMULATIVE_DEPTH_MAX_M (50 m): a 2 m bowl on a 50 m ramp used 4% of it and
 * drew no contours. Drop beyond a seam is an event's doing and is coloured by
 * the hot ramp instead (see HOT_STOPS in hypsometry.ts).
 */
export const BOWL_RAMP_MAX_M = ADRIYALA.A_SUBS * ADRIYALA.M_SEAM_M;

/**
 * Depth between contour rings, m. The bowl gets the same 9 rings the old
 * 5 m / 50 m pairing gave a full-depth bowl; the event drop gets 1 m rings.
 * The count matters more than the absolute interval: each ring must still
 * cover several render cells (3.77 m per cell) or it aliases into moire.
 */
export const BOWL_CONTOUR_INTERVAL_M = 0.25;
export const EVENT_CONTOUR_INTERVAL_M = 1.0;

/**
 * Slope at which event contours reach full strength, m/m. Same idea as
 * CONTOUR_MIN_SLOPE_MM_PER_M below, in the units the perturbation gradient
 * comes out in: a 10 m cave-in over 40 m peaks near 0.2, so 0.03 gives the
 * flanks lines and leaves the floor and skirt plain.
 */
const EVENT_CONTOUR_MIN_SLOPE = 0.03;

/** Half-width of a contour line, as a fraction of one interval. */
const CONTOUR_WIDTH = 0.16;

/**
 * Slope at which contour lines reach full strength, mm/m.
 *
 * Contours are suppressed on ground flatter than this and fade in above it.
 * Without the gate a flat region that happens to lie inside one depth band is
 * filled solid rather than outlined — measured on an R = 85 m bowl, whose
 * inner 25 m varies by only 0.02 m and so flooded dark. Real subsidence tilt
 * peaks near 5 mm/m on this panel, so 1.5 mm/m puts the fade in the lower
 * third of the achievable range: flanks get lines, floors do not.
 */
const CONTOUR_MIN_SLOPE_MM_PER_M = 1.5;

/** Below this drop the ground is treated as undisturbed and left untinted. */
export const SUBSIDENCE_EPS_M = 0.002;

/**
 * Depth over which the overlay fades in from fully transparent.
 *
 * Prevents a hard colour boundary on ground that has barely moved. 0.12 m is
 * about 5% of the bowl ramp — small enough that a real bowl is fully tinted
 * almost everywhere, wide enough that the outer edge dissolves rather than
 * ending on a line.
 */
export const SUBSIDENCE_FADE_M = 0.12;

/**
 * Strength of the darkening applied at ramp entry ("excavation shadow").
 *
 * DEPTH_STOPS now enters at L* 58 — lighter than HEIGHT_STOPS' darkest stop
 * (L* 46) — because the ramp's extra perceptual range comes from chroma, not
 * from staying under a lightness ceiling (see hypsometry.ts). Entering the
 * ramp at full brightness would therefore brighten the darkest terrain it
 * blends over, reopening the bug verify_bowl_physics.mjs exists to catch.
 * This constant darkens the blended colour, strongest exactly at entry and
 * releasing as the ramp darkens on its own — see the `multiplyScalar` call
 * below.
 *
 * 0.22 is solved, not a taste knob: it is the smallest value (to 0.01) that
 * satisfies BOTH guards simultaneously. 0.21 already gives zero composite
 * violations, but leaves the shadowed ramp entry at L* 46.4 — just above the
 * darkest terrain colour (L* 45.96), so the shadow would not quite cover the
 * band overlap it exists to cover. 0.22 brings entry to L* 45.84, under the
 * floor, with the composite sweep still at zero violations. The cost is
 * 0.6 L* of brightness at the very shallow end, which is below the ~2.3 JND
 * and so invisible. Raising it further only darkens the scale for nothing.
 */
export const SUBSIDENCE_SHADOW = 0.22;

/**
 * Ceiling on the EXAGGERATED sag applied to a vertex's Y, as a multiple of
 * CUMULATIVE_DEPTH_MAX_M.
 *
 * CUMULATIVE_DEPTH_MAX_M is the physical limit; `exaggeration` is a deliberate
 * view control on top of it, applied unbounded. Without a second ceiling here
 * a high exaggeration setting can sink a vertex arbitrarily far and fold the
 * sheet through itself. 8x is generous headroom for the view control while
 * still bounding the visual result.
 */
const MAX_SAG_EXAGGERATION = 8;
import { sampleGrid, setTerrainSource } from "../utils/terrainSampler";
import {
  buildElevationCdf,
  depthColor,
  equalAreaT,
  eventDropT,
  EVENT_DROP_MIN_M,
  heightColor,
  hillshade,
  hotColor,
} from "../utils/hypsometry";

/**
 * Darkening strength (0..1) of a depth contour ring at `drop`, m.
 *
 * 1 at each multiple of `interval`, falling to 0 within CONTOUR_WIDTH of an
 * interval on both sides and squared, so the core stays dark while the edges
 * taper like a drawn line. `slopeGate` (0..1+) suppresses it on flat ground,
 * where an entire region can sit inside one band and the "line" would flood
 * it.
 */
function contourStrength(drop: number, interval: number, slopeGate: number): number {
  const gate = Math.min(1.0, slopeGate);
  if (gate <= 0.0) return 0.0;
  const phase = (drop / interval) % 1.0;
  const edgeDist = Math.min(phase, 1.0 - phase);
  if (edgeDist >= CONTOUR_WIDTH) return 0.0;
  const strength = (1.0 - edgeDist / CONTOUR_WIDTH) * gate;
  return strength * strength;
}

interface TerrainMeshProps {
  z0Mesh?: number[][];
  baseBowlMesh?: number[][];
  elevMinM?: number;
  elevMaxM?: number;
  timeScalar: number;
  /** y factor of the moving bowl. The profile is held by globalGeomechanics; this only re-runs the vertex pass when it changes. */
  bowlPy?: number[] | null;
  bowlTermsPy?: number[][] | null;
  perturbations: Perturbation[];
  latestPacket?: SimulationPacket | null;
  exaggeration: number;
  windowSizeM?: number;
  wireframe?: boolean;
  /**
   * Wall-clock driver (ms) that ticks at 10 Hz while an event is in flight.
   * The Knothe time law evolves between engine ticks, so without a local
   * driver the mesh holds its last tick's shape for up to 60 s and the bowl
   * appears all at once. With the profile cache in geomechanicsEngine the
   * per-frame cost is Map lookups, not Bessel quadratures.
   */
  animMs?: number;
  /** True while an event is settling; its falling edge forces one last pass. */
  flightActive?: boolean;
  /** Blast pulse counter forwarded to the shockwave overlay. */
  vibrationPulse?: number;
  /** Panel-frame origin the shockwave ring expands from. */
  waveOrigin?: { x: number; y: number } | null;
  onTerrainClick?: (x: number, y: number, elev: number) => void;
  /**
   * Embed-mode sub-window (panel-frame metres). When set, only this region
   * is meshed — the full 160x160 grid is spent on the selection instead of
   * the whole panel, so a small sector renders sharper, not coarser.
   */
  clipBounds?: EmbedClipBounds | null;
}

export const TerrainMesh: React.FC<TerrainMeshProps> = ({
  z0Mesh,
  baseBowlMesh: _baseBowlMesh,
  elevMinM,
  elevMaxM: _elevMaxM,
  timeScalar,
  bowlPy,
  bowlTermsPy,
  perturbations,
  latestPacket,
  exaggeration = 1.0,
  windowSizeM = 600,
  wireframe = false,
  animMs = 0,
  flightActive = false,
  vibrationPulse = 0,
  waveOrigin = null,
  onTerrainClick,
  clipBounds = null,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  // Log packet render update (§Phase 14)
  useEffect(() => {
    if (latestPacket) {
      console.log(`[RENDER] terrain updated with packet #${latestPacket.packet_id}`);
    }
  }, [latestPacket]);
  const gridSize = 160; // 160x160 = 25,600 vertices for smooth rolling hills & sharp craters

  // Reused across updates so `useEffect` mutates in place instead of
  // allocating a fresh Float32Array + BufferAttribute every physics tick.
  const colorsRef = useRef<Float32Array | null>(null);

  const hasRealMesh = !!z0Mesh && z0Mesh.length > 0;
  const realMeshN = hasRealMesh ? z0Mesh!.length : 0;

  // The meshed rectangle in panel-frame metres: the whole window by default,
  // or the embed selection when the dashboard crops the view. Point selections
  // expand to a minimum span so there is always ground to look at.
  const viewWindow = useMemo(() => {
    const full = {
      x0: -windowSizeM / 2.0,
      y0: -windowSizeM / 2.0,
      w: windowSizeM,
      h: windowSizeM,
    };
    if (
      !clipBounds ||
      !Number.isFinite(clipBounds.xMin) ||
      !Number.isFinite(clipBounds.xMax) ||
      !Number.isFinite(clipBounds.yMin) ||
      !Number.isFinite(clipBounds.yMax) ||
      clipBounds.xMax <= clipBounds.xMin ||
      clipBounds.yMax <= clipBounds.yMin
    ) {
      return full;
    }
    const MIN_SPAN_M = 60;
    const cx = (clipBounds.xMin + clipBounds.xMax) / 2.0;
    const cy = (clipBounds.yMin + clipBounds.yMax) / 2.0;
    const w = Math.max(clipBounds.xMax - clipBounds.xMin, MIN_SPAN_M);
    const h = Math.max(clipBounds.yMax - clipBounds.yMin, MIN_SPAN_M);
    return { x0: cx - w / 2.0, y0: cy - h / 2.0, w, h };
  }, [clipBounds, windowSizeM]);

  // 1. Create base PlaneGeometry once per meshed rectangle
  const geometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(viewWindow.w, viewWindow.h, gridSize - 1, gridSize - 1);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [viewWindow, gridSize]);

  // A new clip rectangle replaces the geometry; release the old GPU buffers
  // instead of leaking one 160x160 mesh per selection change.
  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  // Datum used to recentre real DEM elevations (~196-370m AMSL) around the
  // scene origin. Vertex Y is written as (trueElevation - datum) so the
  // terrain stays near y=0 and does not break the existing camera framing;
  // the true AMSL value is kept separately for colouring/display.
  const elevDatum = useMemo(() => {
    if (elevMinM !== undefined) return elevMinM;
    if (!hasRealMesh) return 0;
    let min = Infinity;
    for (const row of z0Mesh!) {
      for (const v of row) {
        if (v < min) min = v;
      }
    }
    return min === Infinity ? 0 : min;
  }, [elevMinM, hasRealMesh, z0Mesh]);

  // 2. Pre-computed baseline elevation, real AMSL where available: bilinear
  // upsample of the server's real z0_mesh (121x121) onto the 160x160 render
  // grid; falls back to invented procedural hills only when the backend has
  // not supplied real terrain (e.g. offline / backend down).
  const baseElevations = useMemo(() => {
    const arr = new Float32Array(gridSize * gridSize);
    const half = windowSizeM / 2.0;
    let idx = 0;
    for (let iy = 0; iy < gridSize; iy++) {
      const y = viewWindow.y0 + (iy * viewWindow.h) / (gridSize - 1);
      for (let ix = 0; ix < gridSize; ix++) {
        const x = viewWindow.x0 + (ix * viewWindow.w) / (gridSize - 1);
        if (hasRealMesh) {
          // Normalised against the FULL window, not the meshed rectangle:
          // the clip is a sub-range of the server DEM, so (u, v) must address
          // the same grid the full view samples from.
          const u = (x + half) / windowSizeM;
          const v = (y + half) / windowSizeM;
          arr[idx++] = sampleGrid(z0Mesh!, realMeshN, u, v);
        } else {
          arr[idx++] = evaluateNaturalElevation(x, y);
        }
      }
    }
    return arr;
  }, [gridSize, windowSizeM, viewWindow, hasRealMesh, z0Mesh, realMeshN]);

  // Publish the live DEM + datum so NodeMarkers and TargetBeacon place
  // themselves on THIS surface. Previously they each called
  // `evaluateNaturalElevation()` (8-65 m procedural hills) while the mesh drew
  // the real DEM (0-174 m datum-relative), so monuments sank into the ridge
  // and the targeting ring drew below ground.
  useEffect(() => {
    setTerrainSource(hasRealMesh ? z0Mesh! : null, elevDatum, windowSizeM);
  }, [hasRealMesh, z0Mesh, elevDatum, windowSizeM]);

  // Equal-area colour ranking + hillshade for the real DEM, recomputed only
  // when the source elevations change (not every physics frame). On this
  // panel the median elevation sits at only ~9% of the [min,max] range, so a
  // linear colour stretch crushes over half the terrain into one dark blue
  // mass — ranking by cumulative area (mirroring sandbox/hypsometry.py) gives
  // equal ground area equal colour instead.
  const elevationShading = useMemo(() => {
    if (!hasRealMesh) return null;
    const sortedAsc = buildElevationCdf(baseElevations);
    const spacingM = (viewWindow.w + viewWindow.h) / 2.0 / (gridSize - 1);
    const { shade, slopeDeg } = hillshade(baseElevations, gridSize, spacingM);
    return { sortedAsc, shade, slopeDeg };
  }, [hasRealMesh, baseElevations, viewWindow, gridSize]);

  // 3. Compute live vertex elevations, physical drop, and color shading
  useEffect(() => {
    if (!geometry) return;

    const posAttr = geometry.attributes.position;
    const positions = posAttr.array as Float32Array;
    if (!colorsRef.current || colorsRef.current.length !== gridSize * gridSize * 3) {
      colorsRef.current = new Float32Array(gridSize * gridSize * 3);
    }
    const colors = colorsRef.current;

    // Ground tones for the procedural fallback surface (used only when the
    // backend is down and there is no real DEM to rank), and for terrain
    // features drawn over the height ramp.
    const colGrassHigh = new THREE.Color("#8f9472");  // Sunlit upland scrub
    const colGrassMid = new THREE.Color("#6e7554");   // Mid-slope dry grass
    const colGrassLow = new THREE.Color("#525a44");   // Shaded valley floor
    const colCliffRock = new THREE.Color("#8a8378");  // Steep rock / cliff face
    const colCragDark = new THREE.Color("#6b655c");   // Exposed basalt / shale
    const colScorch = new THREE.Color("#2b2118");     // Fresh ejecta / dust stain

    // COLOUR SPACE, and why every previous palette edit appeared to do
    // nothing. The ramps in hypsometry.ts are sRGB hex, but three.js r152+
    // enables colour management by default, so `setRGB(r, g, b)` with no
    // fourth argument declares those numbers to be in the WORKING space
    // (Linear-sRGB) and converts them out to sRGB for display. Feeding sRGB
    // values down that path applies the ~1/2.2 encoding transfer a second
    // time, which lightens and desaturates every vertex. Measured on stops
    // that used to be in use (the old hypsometric ramp):
    //
    //   #3f7a3a lowland green   rendered as  #88b883  (pale sage)
    //   #bcbf55 mid yellow      rendered as  #dfe09c  (washed cream)
    //   #7d3527 summit red-brown rendered as #ba7e6d  (topsoil)
    //
    // That is the "terrain still looks like topsoil" report: the palette was
    // already the intended ramp and rewriting the stops could never fix it,
    // because the distortion was downstream of the stops. Passing
    // THREE.SRGBColorSpace at each setRGB call site states the space the
    // values are actually in, so three.js converts INTO the working space
    // instead of out of it a second time.
    //
    // The `new THREE.Color("#rrggbb")` constructors below need no such
    // argument: the hex-string constructor already assumes sRGB.

    // Scratch colour for the depth ramp, reused per vertex rather than
    // allocating a THREE.Color for each of the 25,600 vertices on every
    // physics tick.
    const rampColor = new THREE.Color();

    const tempColor = new THREE.Color();
    const nowSec = performance.now() / 1000.0;

    let vIdx = 0;
    for (let iy = 0; iy < gridSize; iy++) {
      const yCoord = viewWindow.y0 + (iy * viewWindow.h) / (gridSize - 1);
      for (let ix = 0; ix < gridSize; ix++) {
        const xCoord = viewWindow.x0 + (ix * viewWindow.w) / (gridSize - 1);
        const z0 = baseElevations[vIdx];

        // Evaluate live continuum geomechanics deformation & strain
        const state = globalGeomechanics.evaluatePoint(xCoord, yCoord, z0, nowSec);

        // Include any server perturbations if present
        // The event drop is kept apart from the bowl because the two are
        // coloured on different ramps. Local cave-ins (SIM tab, standalone
        // app) are events too: `state.interventionDropM` joins the server
        // perturbations here, so a 10 m hole gets the hot ramp everywhere
        // instead of saturating the 2.25 m blue one. Its gradient is
        // accumulated alongside, for the event contours' slope gate.
        let serverPerturbDrop = 0.0;
        let eventGradX = 0.0;
        let eventGradY = 0.0;
        if (perturbations && perturbations.length > 0) {
          for (const p of perturbations) {
            const ddx = xCoord - p.cx;
            const ddy = yCoord - p.cy;
            const dist = Math.hypot(ddx, ddy);
            if (dist < p.radius_m) {
              const scale = p.radius_m * 0.7;
              const q = dist / scale;
              const profile = Math.exp(-Math.pow(q, 2.2));
              serverPerturbDrop += p.amp * profile;
              if (dist > 1e-6) {
                const dDrop = (-p.amp * profile * 2.2 * Math.pow(q, 1.2)) / scale;
                eventGradX += (dDrop * ddx) / dist;
                eventGradY += (dDrop * ddy) / dist;
              }
            }
          }
        }

        // What the event ramp colours: server events plus local cave-ins.
        // `totalDrop` below must not use it (`dropDistanceM` already holds the
        // local part).
        const eventDrop = serverPerturbDrop + Math.max(0.0, state.interventionDropM);
        eventGradX += state.interventionSlopeX;
        eventGradY += state.interventionSlopeY;

        // `state.dropDistanceM` is already clamped inside evaluatePoint, but
        // `serverPerturbDrop` is summed on top of it here and was previously
        // unbounded — a large server perturbation could sink a vertex past the
        // ceiling. Clamp the combined drop before it is used for anything.
        const totalDrop = Math.min(
          state.dropDistanceM + serverPerturbDrop,
          CUMULATIVE_DEPTH_MAX_M,
        );
        // `exaggeration` is a deliberate view control applied to the clamped
        // physical drop, but it too was unbounded — a high exaggeration
        // slider could fold the sheet through itself. Bound the visual sag
        // separately from the physical ceiling above.
        const exaggeratedSag = Math.min(
          totalDrop * exaggeration,
          CUMULATIVE_DEPTH_MAX_M * MAX_SAG_EXAGGERATION,
        );
        // Current elevation in meters (true AMSL when driven by the real DEM)
        const liveElevation = z0 - exaggeratedSag + state.vibrationDisplacementM;

        // In Three.js with plane rotated around X:
        // index 0 = X, index 1 = Y (vertical height), index 2 = Z (horizontal -y)
        // Real DEM elevations run ~196-370m AMSL but the scene (camera framing,
        // strata box, grid) is built around y=0, so the datum is subtracted only
        // here at write-time; z0/liveElevation above stay true AMSL for colouring.
        positions[vIdx * 3] = xCoord;
        positions[vIdx * 3 + 1] = liveElevation - elevDatum;
        positions[vIdx * 3 + 2] = yCoord;

        // One fused colour path: a height base, overlaid by a depth ramp
        // once the ground has moved. No mode switch any more.
        if (hasRealMesh && elevationShading) {
          // Real DEM: height tint by equal-area rank (matches
          // sandbox/hypsometry.py's ramp POSITION, not its colours — see
          // hypsometry.ts) modulated by Horn hillshade, so relief reads even
          // though the median sits at only ~9% of the range.
          // Ranked on the LIVE elevation, not the pristine z0. Colouring by
          // z0 meant the tint was looked up at the height the ground USED
          // to be, so a bowl sank geometrically while keeping the exact
          // colour of the untouched ridge it was cut into — the subsidence
          // was visible only as silhouette, which is why a cave-in read as
          // "nothing happened" from a top-down camera.
          //
          // `liveElevation` already carries the exaggeration factor, which
          // would make the colour scale with a view setting rather than
          // with the ground, so the true (un-exaggerated) elevation is
          // reconstructed here: the physical drop is what recolours.
          //
          // Ranking below the CDF floor is well defined — equalAreaT binary
          // searches to rank 0 and blends with the linear term, so ground
          // that subsides past the panel minimum keeps ramping downward
          // instead of clamping to a flat colour.
          const trueLiveElevation = z0 - totalDrop;
          const t = equalAreaT(trueLiveElevation, elevationShading.sortedAsc);
          const [r, g, b] = heightColor(t);
          const shade = 0.75 + 0.25 * elevationShading.shade[vIdx];
          tempColor.setRGB(r * shade, g * shade, b * shade, THREE.SRGBColorSpace);
        } else {
          // Procedural fallback terrain: photorealistic game nature shading.
          // Only renders when there is no real DEM (backend down / offline),
          // so it keeps its own invented palette and normalisation rather
          // than being forced onto the DEM-ranked height ramp above.
          const normAlt = Math.min(1.0, Math.max(0.0, (z0 - 15.0) / 45.0));
          if (normAlt > 0.6) {
            tempColor.copy(colGrassMid).lerp(colGrassHigh, (normAlt - 0.6) / 0.4);
          } else {
            tempColor.copy(colGrassLow).lerp(colGrassMid, normAlt / 0.6);
          }
        }

        // Rock outcrop on steep NATURAL ground. This previously tested
        // `state.tiltDeg`, the subsidence tilt — which under correct physics
        // peaks at 0.28 deg against a 22 deg threshold, so it could never
        // fire. Terrain steepness is a property of the DEM, so it is read
        // from the hillshade's own slope instead (the real panel reaches
        // 54 deg).
        const slopeDeg = elevationShading
          ? elevationShading.slopeDeg[vIdx]
          : 0;
        if (slopeDeg > 22.0) {
          tempColor.lerp(colCliffRock, Math.min(1.0, (slopeDeg - 22.0) / 18.0) * 0.85);
        }
        if (slopeDeg > 35.0) {
          tempColor.lerp(colCragDark, 0.7);
        }

        // ------------------------------------------------------------
        // Depth overlays: the settlement bowl (blue) and the event drop (hot)
        // ------------------------------------------------------------
        //
        // These make a bowl and a cave-in visible at all. The height tint
        // above is stretched across this panel's full natural relief of
        // 174.1 m and answers "how high is this ground above sea level",
        // which is not the question a subsidence display is asked. These
        // ramps measure displacement from the original surface instead.
        //
        // Two drops, two ramps, because they differ by an order of magnitude
        // and one ramp cannot show both. On the old single 50 m ramp a 2 m
        // bowl used 4% of the colour range and drew no contours, and a 10 m
        // cave-in only 20%.
        //   * bowl  (`state.dropDistanceM`): the blue DEPTH_STOPS over one
        //     seam's worth of settlement, BOWL_RAMP_MAX_M, contoured every
        //     0.25 m.
        //   * event (`eventDrop`, server events + local cave-ins): HOT_STOPS on a log scale from 5 cm
        //     to 25 m, contoured every 1 m, blended over the bowl colour.
        const bowlDrop = Math.max(0.0, state.dropDistanceM - state.interventionDropM);
        if (bowlDrop > SUBSIDENCE_EPS_M) {
          // Linear in depth, deliberately: equal depth = equal colour step,
          // which is also what makes the contour bands evenly spaced in
          // depth. (An earlier sqrt spent ramp on the outer skirt.)
          const t = Math.min(1.0, bowlDrop / BOWL_RAMP_MAX_M);
          const [cr, cg, cb] = depthColor(t);
          rampColor.setRGB(cr, cg, cb, THREE.SRGBColorSpace);

          // Contours: a smooth ramp cannot show a bowl's floor (an R = 85 m
          // bowl varies by 0.02 m over its inner 25 m), so depth is quantised
          // into rings that the eye reads by spacing, as on a topographic
          // map. Gated on the analytic slope `tiltMmPerM` so they outline
          // flanks and fade out on flat ground instead of flooding it.
          rampColor.multiplyScalar(
            1.0 - 0.34 * contourStrength(
              bowlDrop,
              BOWL_CONTOUR_INTERVAL_M,
              state.tiltMmPerM / CONTOUR_MIN_SLOPE_MM_PER_M,
            ),
          );

          // Blend, faded in over the first few centimetres so the bowl
          // dissolves into undisturbed terrain instead of ending on a ring.
          // `blend` alone is the weight; a second depth factor on top would
          // let the lighter height base show through at full depth (see
          // verify_bowl_physics.mjs's composite sweep).
          const blend = Math.min(1.0, bowlDrop / SUBSIDENCE_FADE_M);
          tempColor.lerp(rampColor, blend);

          // Excavation shadow: darkens the blended result, strongest at ramp
          // entry and releasing as the ramp darkens on its own. It must
          // multiply AFTER the lerp, and the (1 - t) decay is essential: a
          // flat `1 - SUBSIDENCE_SHADOW * blend` crushes the deep end (1260
          // composite violations at shadow >= 0.55). See hypsometry.ts.
          tempColor.multiplyScalar(1.0 - SUBSIDENCE_SHADOW * blend * (1.0 - t));
        }

        if (eventDrop > EVENT_DROP_MIN_M) {
          rampColor.setRGB(...hotColor(eventDropT(eventDrop)), THREE.SRGBColorSpace);
          rampColor.multiplyScalar(
            1.0 - 0.34 * contourStrength(
              eventDrop,
              EVENT_CONTOUR_INTERVAL_M,
              Math.hypot(eventGradX, eventGradY) / EVENT_CONTOUR_MIN_SLOPE,
            ),
          );
          // Fades in over 2 -> 5 cm so the event's edge is not a hard line.
          const eventBlend = Math.min(
            1.0,
            (eventDrop - EVENT_DROP_MIN_M) / 0.03,
          );
          tempColor.lerp(rampColor, eventBlend);
        }

        // Keep the hillshade relief visible through the overlays, so the
        // bowl still reads as a 3-D depression rather than a flat decal.
        if (elevationShading && (bowlDrop > SUBSIDENCE_EPS_M || eventDrop > EVENT_DROP_MIN_M)) {
          const relief = 0.88 + 0.12 * elevationShading.shade[vIdx];
          tempColor.multiplyScalar(relief);
        }

        // Ejecta scorch: thrown rock and settled dust stain the ground in and
        // around each crater, strongest at the centre and dying over ~0.9R.
        // Applied AFTER the depth overlay so it darkens the ramp too — fresh
        // ejecta covers whatever colour was there. Persistent: it keys off the
        // live intervention list, which only clears on reset, so the stain
        // marks where the ground broke even after the bowl has settled.
        const liveInters = globalGeomechanics.interventions;
        if (liveInters.length > 0) {
          let scorch = 0.0;
          for (let ki = 0; ki < liveInters.length; ki++) {
            const inter = liveInters[ki];
            const idx = xCoord - inter.cx;
            const idy = yCoord - inter.cy;
            const q = Math.sqrt(idx * idx + idy * idy) / (0.9 * inter.radiusM);
            if (q < 3.0) scorch += Math.exp(-q * q);
          }
          if (scorch > 0.01) {
            tempColor.lerp(colScorch, Math.min(1.0, scorch) * 0.5);
          }
        }

        colors[vIdx * 3] = tempColor.r;
        colors[vIdx * 3 + 1] = tempColor.g;
        colors[vIdx * 3 + 2] = tempColor.b;

        vIdx++;
      }
    }

    posAttr.needsUpdate = true;
    const colorAttr = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!colorAttr || colorAttr.array !== colors) {
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    } else {
      colorAttr.needsUpdate = true;
    }
    geometry.computeVertexNormals(); // Recalculate 3D lighting normals every frame!
    // Recompute after vertex displacement — without this, frustum culling can
    // wrongly clip the deformed mesh out of view and raycast picking (terrain
    // clicks) silently stops registering once vertices move off the original
    // bounding sphere.
    geometry.computeBoundingSphere();
  }, [
    geometry,
    baseElevations,
    elevDatum,
    hasRealMesh,
    elevationShading,
    timeScalar,
    bowlPy,
    bowlTermsPy,
    perturbations,
    exaggeration,
    gridSize,
    viewWindow,
    animMs,
    flightActive,
  ]);

  // Handle terrain click to pick exact (x, y) target coordinates
  const handlePointerDown = (e: any) => {
    if (onTerrainClick && e.point) {
      onTerrainClick(e.point.x, e.point.z, e.point.y);
    }
  };

  return (
    <group>
      {/* 1. Photorealistic Deforming Natural Terrain Mesh */}
      <mesh
        ref={meshRef}
        geometry={geometry}
        receiveShadow
        castShadow
        onPointerDown={(e) => {
          e.stopPropagation();
          handlePointerDown(e);
        }}
      >
        {/* DoubleSide, not FrontSide: there is no solid body beneath the
            surface any more, so a low camera looking up through the
            underside of the sheet needs the back faces rendered or the bowl
            is see-through from below. Same vertex colours apply to both
            faces. */}
        <meshStandardMaterial
          vertexColors
          roughness={0.75}
          metalness={0.08}
          wireframe={wireframe}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 2. Seismic Shockwave Ring Overlay */}
      <SeismicWaveOverlay
        pulse={vibrationPulse}
        originX={waveOrigin ? waveOrigin.x : 0}
        originY={waveOrigin ? waveOrigin.y : 0}
      />
    </group>
  );
};
