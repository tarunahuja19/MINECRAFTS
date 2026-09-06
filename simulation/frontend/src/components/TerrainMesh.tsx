import React, { useMemo, useRef, useEffect } from "react";
import * as THREE from "three";
import type { Perturbation, SimulationPacket } from "../types";
import { SeismicWaveOverlay } from "./SeismicWaveOverlay";
import { evaluateNaturalElevation } from "../utils/proceduralTerrain";
import { globalGeomechanics, CUMULATIVE_DEPTH_MAX_M } from "../utils/geomechanicsEngine";

// --- Subsidence overlay tuning ---------------------------------------------

/**
 * Depth between subsidence contour rings, m.
 *
 * 5 m divides the 50 m carve-in ceiling into 10 bands, keeping the ring count
 * that made the old 0.25 m / 2.25 m pairing readable. The count is what
 * matters, not the absolute interval: a full-depth bowl needs enough rings to
 * read as a shape while each ring still covers several render cells (the grid
 * is 3.77 m per cell). Scaling the ceiling without scaling this would put 200
 * rings on the bowl and alias into moire against the mesh.
 */
export const CONTOUR_INTERVAL_M = 5.0;

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
 * about 5% of the ceiling — small enough that a real bowl is fully tinted
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
  heightColor,
  hillshade,
} from "../utils/hypsometry";

interface TerrainMeshProps {
  z0Mesh?: number[][];
  baseBowlMesh?: number[][];
  elevMinM?: number;
  elevMaxM?: number;
  timeScalar: number;
  perturbations: Perturbation[];
  latestPacket?: SimulationPacket | null;
  exaggeration: number;
  windowSizeM?: number;
  wireframe?: boolean;
  vibrationActive?: boolean;
  onTerrainClick?: (x: number, y: number, elev: number) => void;
}

export const TerrainMesh: React.FC<TerrainMeshProps> = ({
  z0Mesh,
  baseBowlMesh: _baseBowlMesh,
  elevMinM,
  elevMaxM: _elevMaxM,
  timeScalar,
  perturbations,
  latestPacket,
  exaggeration = 1.0,
  windowSizeM = 600,
  wireframe = false,
  vibrationActive = false,
  onTerrainClick,
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

  // 1. Create base PlaneGeometry once
  const geometry = useMemo(() => {
    const geom = new THREE.PlaneGeometry(windowSizeM, windowSizeM, gridSize - 1, gridSize - 1);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [windowSizeM, gridSize]);

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
      const y = -half + (iy * windowSizeM) / (gridSize - 1);
      const v = iy / (gridSize - 1);
      for (let ix = 0; ix < gridSize; ix++) {
        const x = -half + (ix * windowSizeM) / (gridSize - 1);
        if (hasRealMesh) {
          const u = ix / (gridSize - 1);
          arr[idx++] = sampleGrid(z0Mesh!, realMeshN, u, v);
        } else {
          arr[idx++] = evaluateNaturalElevation(x, y);
        }
      }
    }
    return arr;
  }, [gridSize, windowSizeM, hasRealMesh, z0Mesh, realMeshN]);

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
    const spacingM = windowSizeM / (gridSize - 1);
    const { shade, slopeDeg } = hillshade(baseElevations, gridSize, spacingM);
    return { sortedAsc, shade, slopeDeg };
  }, [hasRealMesh, baseElevations, windowSizeM, gridSize]);

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
    const half = windowSizeM / 2.0;
    const nowSec = performance.now() / 1000.0;

    let vIdx = 0;
    for (let iy = 0; iy < gridSize; iy++) {
      const yCoord = -half + (iy * windowSizeM) / (gridSize - 1);
      for (let ix = 0; ix < gridSize; ix++) {
        const xCoord = -half + (ix * windowSizeM) / (gridSize - 1);
        const z0 = baseElevations[vIdx];

        // Evaluate live continuum geomechanics deformation & strain
        const state = globalGeomechanics.evaluatePoint(xCoord, yCoord, z0, nowSec);

        // Include any server perturbations if present
        let serverPerturbDrop = 0.0;
        if (perturbations && perturbations.length > 0) {
          for (const p of perturbations) {
            const dist = Math.hypot(xCoord - p.cx, yCoord - p.cy);
            if (dist < p.radius_m) {
              const profile = Math.exp(-Math.pow(dist / (p.radius_m * 0.7), 2.2));
              serverPerturbDrop += p.amp * profile;
            }
          }
        }

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
          const shade = 0.45 + 0.55 * elevationShading.shade[vIdx];
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
        // Depth overlay: blue -> violet -> red by how far the surface has
        // moved from where it started.
        // ------------------------------------------------------------
        //
        // This is the layer that makes a cave-in visible, and it exists as
        // its own ramp because the alternative is measurably impossible.
        // The height tint above is stretched across this panel's full
        // natural relief of 174.1 m (196.2-370.3 m AMSL), and it is an
        // ABSOLUTE scale: it answers "how high is this ground above sea
        // level", which is not the question a subsidence display is asked.
        //
        // The question here is how far the ground has carved in from where
        // it started, so this ramp measures exactly that — displacement
        // from the original surface — normalised to CUMULATIVE_DEPTH_MAX_M,
        // the deepest total carve-in the panel supports. Normalising to the
        // total rather than to one event's S_MAX_FULL_M is what keeps the
        // colour meaningful after repeated collapses: keyed to a single
        // event's 5 m ceiling, the second collapse in the same place would
        // paint a hole already saturated at the ramp's red end and every
        // further metre would look identical.
        //
        // Blue = just moved. Violet = deepening. Red = at the deepest
        // carve-in the panel supports. So the colour reads directly as
        // depth below the original ground: roughly 10 m at the blue-indigo
        // transition, 25 m mid-ramp, 50 m at full red.
        if (totalDrop > SUBSIDENCE_EPS_M) {
          const dropFactor = Math.min(1.0, totalDrop / CUMULATIVE_DEPTH_MAX_M);

          // Linear in depth, deliberately. An earlier version used sqrt to
          // "front-load" the shallow end, but that is backwards for this
          // shape: it spends ramp on the outer skirt where almost nothing
          // is happening and compresses the deep end where the bowl is.
          // Linear keeps equal depth = equal colour step, which is also
          // what makes the contour bands below evenly spaced in depth.
          const t = dropFactor;
          const [cr, cg, cb] = depthColor(t);
          rampColor.setRGB(cr, cg, cb, THREE.SRGBColorSpace);

          // ---- Depth contours -------------------------------------
          // The single most important part of this overlay, because a
          // smooth ramp CANNOT show the bowl's floor. Measured across an
          // R = 85 m, full-depth bowl: from the centre out to 40 m the
          // ground only rises from 2.25 m to 2.15 m of drop, which is
          // 0.02-0.04 of the colour ramp depending on tone curve — a flat
          // wash over the entire floor, i.e. more than half the bowl's
          // radius carries no shape information at all.
          //
          // Contour banding solves what a gradient cannot: quantising
          // depth into fixed intervals turns that invisible 0.1 m of
          // relief into a countable set of rings. The same bowl gains 9
          // distinct bands, and the eye reads the shape from the ring
          // spacing (tight rings = steep flank, wide rings = flat floor)
          // exactly as it reads a topographic map. This is standard
          // cartographic practice for the same reason: gradients lose
          // low-relief structure, isolines preserve it.
          const bandPhase = (totalDrop / CONTOUR_INTERVAL_M) % 1.0;
          // Darken a narrow strip at each interval crossing. `strength`
          // is 1 at the crossing and falls to 0 within CONTOUR_WIDTH,
          // measured on both sides so the line is symmetric. Squaring it
          // keeps the line's core dark while its edges taper, which reads
          // as a drawn contour rather than a wide dirty band.
          const edgeDist = Math.min(bandPhase, 1.0 - bandPhase);
          if (edgeDist < CONTOUR_WIDTH) {
            // Gate on the ground's SLOPE, not just on the phase. A contour
            // is a line only where the surface is actually crossing depths;
            // where the surface is flat, an entire region can sit inside one
            // band and the "line" floods it. That is not hypothetical here:
            // the floor of an R = 85 m bowl varies by 0.02 m over its inner
            // 25 m, so an ungated test fired on every sample from 0-25 m and
            // painted the whole floor dark instead of drawing a ring.
            //
            // `tiltMmPerM` is the analytic |dS/dx| already computed for this
            // vertex, in mm per m. Requiring a minimum slope means contours
            // appear on the flanks (where they carry shape information) and
            // fade out on the floor and the far skirt (where they would only
            // add noise), which is also how a cartographer treats a plateau.
            const slopeGate = Math.min(
              1.0,
              state.tiltMmPerM / CONTOUR_MIN_SLOPE_MM_PER_M,
            );
            if (slopeGate > 0.0) {
              const strength = (1.0 - edgeDist / CONTOUR_WIDTH) * slopeGate;
              rampColor.multiplyScalar(1.0 - 0.34 * strength * strength);
            }
          }

          // ---- Blend, faded smoothly at the outer edge -------------
          // The overlay used to switch on at a fixed threshold with a
          // floor of 0.35 opacity, which drew a hard colour ring on
          // ground that had not actually moved. Fading the blend in from
          // zero over the first few centimetres removes that edge, so the
          // bowl dissolves into undisturbed terrain instead of ending at
          // a line.
          //
          // `fadeIn` alone is the blend weight — it used to also carry a
          // (0.55 + 0.45 * t) factor scaling by depth, a SECOND depth
          // encoding stacked on top of the ramp's own colour, which is not
          // needed and is not safe: it lets the overlay stay partially
          // transparent even at full depth, letting the (lighter) height
          // base show through and brightening the composite as the bowl
          // deepens. That used to defeat a band gap between HEIGHT_STOPS and
          // DEPTH_STOPS; that gap is gone (see hypsometry.ts), and the
          // guarantee now rests on the excavation shadow below, which is
          // sized assuming blend reaches 1. Dropping the factor is still
          // load-bearing — see verify_bowl_physics.mjs's composite sweep.
          const blend = Math.min(1.0, totalDrop / SUBSIDENCE_FADE_M);
          tempColor.lerp(rampColor, blend);

          // Excavation shadow: darkens the blend result, strongest at ramp entry
          // (blend ~= 1, t ~= 0, i.e. ground that has just crossed into the overlay)
          // and releasing as the ramp darkens on its own with depth. Must multiply
          // AFTER the lerp above, not before — it darkens the blended result, not
          // just the ramp colour being blended in. The (1 - t) decay is essential: a
          // flat `1 - SUBSIDENCE_SHADOW * blend` crushes the deep end and reintroduces
          // composite violations (measured: 1260 at shadow >= 0.55). See hypsometry.ts
          // and verify_bowl_physics.mjs for the invariant this maintains.
          tempColor.multiplyScalar(1.0 - SUBSIDENCE_SHADOW * blend * (1.0 - t));

          // Keep the hillshade relief visible through the overlay, so the
          // bowl still reads as a 3-D depression rather than a flat decal
          // painted onto the terrain.
          if (elevationShading) {
            const relief = 0.78 + 0.22 * elevationShading.shade[vIdx];
            tempColor.multiplyScalar(relief);
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
    perturbations,
    exaggeration,
    gridSize,
    windowSizeM,
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
      <SeismicWaveOverlay active={vibrationActive} />
    </group>
  );
};
