import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EventZone, Perturbation } from "../types";
import { sampleBaseGroundY, sampleGroundY } from "../utils/terrainSampler";

/**
 * FORGE event overlays that sit ON the deformed ground: hazard-zone rings and
 * fills, the dashed preview of a zone before it is fired, the tilt direction
 * arrow and the crack dust line.
 *
 * Everything conforming is built as a flat footprint in panel-frame metres
 * (built once per shape) plus a per-frame pass that writes each vertex's Y
 * from `sampleGroundY` — the expression TerrainMesh writes into its own
 * position buffer, exaggeration and vibration included — so a ring follows a
 * pit down instead of hovering over it.
 */

/** White = CRITICAL edge, red = WARNING edge. Mirrors sandbox/session.py. */
export const ZONE_WHITE_FACTOR = 1.2;
export const ZONE_RED_FACTOR = 1.5;

const WHITE = "#FFFFFF";
const RED = "#FF2A2A";
const FILL_RED = "#FF2222";
const FILL_YELLOW = "#FFD400";
const FILL_OPACITY = 0.2;
const PREVIEW_FILL_OPACITY = 0.1;

/** Fill / ring heights above the sampled surface, m; the mesh is piecewise linear, so the margin covers convex cells. */
const FILL_LIFT_M = 0.5;
const RING_LIFT_M = 0.9;
/** Ring ribbon width, m — wide enough to read as a line from the overview camera (WebGL lines are 1 px). */
const RING_WIDTH_M = 2.4;
const DASH_M = 14;
const GAP_M = 9;

type Pt = readonly [number, number];

/** Flat vertices (x, y pairs, panel frame) and triangle indices of one shape. */
interface Footprint {
  xy: Float32Array;
  index: number[];
}

/**
 * Points around the capsule of half-width `rho` about the segment a-b, as a
 * closed loop; a == b gives a circle. `capN` points per half-circle, `sideN`
 * per straight side, so loops built with the same counts and different `rho`
 * line up index for index.
 */
function capsuleLoop(a: Pt, b: Pt, rho: number, capN: number, sideN: number): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dir = len > 0 ? Math.atan2(b[1] - a[1], b[0] - a[0]) : 0;
  const out: Pt[] = [];
  // Cap round b, sweeping through the segment's direction.
  for (let i = 0; i <= capN; i++) {
    const ang = dir - Math.PI / 2 + (Math.PI * i) / capN;
    out.push([b[0] + rho * Math.cos(ang), b[1] + rho * Math.sin(ang)]);
  }
  // Left side, b -> a.
  const nl = dir + Math.PI / 2;
  for (let i = 1; i < sideN; i++) {
    const t = 1 - i / sideN;
    out.push([a[0] + (b[0] - a[0]) * t + rho * Math.cos(nl), a[1] + (b[1] - a[1]) * t + rho * Math.sin(nl)]);
  }
  // Cap round a.
  for (let i = 0; i <= capN; i++) {
    const ang = dir + Math.PI / 2 + (Math.PI * i) / capN;
    out.push([a[0] + rho * Math.cos(ang), a[1] + rho * Math.sin(ang)]);
  }
  // Right side, a -> b.
  const nr = dir - Math.PI / 2;
  for (let i = 1; i < sideN; i++) {
    const t = i / sideN;
    out.push([a[0] + (b[0] - a[0]) * t + rho * Math.cos(nr), a[1] + (b[1] - a[1]) * t + rho * Math.sin(nr)]);
  }
  return out;
}

/** Loop resolution that keeps point spacing near `step` m on the largest loop. */
function loopCounts(a: Pt, b: Pt, rhoMax: number, step: number, capCap: number) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return {
    capN: Math.min(capCap, Math.max(16, Math.ceil((Math.PI * rhoMax) / step))),
    sideN: Math.max(1, Math.min(40, Math.ceil(len / step))),
  };
}

/** Solid area of the capsule band rho0..rho1 (rho0 = 0 is the whole capsule), subdivided so it conforms to the terrain. */
function bandFootprint(a: Pt, b: Pt, rho0: number, rho1: number): Footprint {
  const { capN, sideN } = loopCounts(a, b, rho1, 6, 40);
  const rings = Math.max(1, Math.min(8, Math.ceil((rho1 - rho0) / 8)));
  const loops: Pt[][] = [];
  for (let k = 0; k <= rings; k++) {
    loops.push(capsuleLoop(a, b, rho0 + ((rho1 - rho0) * k) / rings, capN, sideN));
  }
  const n = loops[0].length;
  const xy = new Float32Array(loops.length * n * 2);
  loops.forEach((loop, k) => loop.forEach((p, i) => { xy[(k * n + i) * 2] = p[0]; xy[(k * n + i) * 2 + 1] = p[1]; }));
  const index: number[] = [];
  for (let k = 0; k < rings; k++) {
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const p00 = k * n + i, p01 = k * n + i2, p10 = (k + 1) * n + i, p11 = (k + 1) * n + i2;
      index.push(p00, p10, p01, p01, p10, p11);
    }
  }
  return { xy, index };
}

/**
 * A ribbon RING_WIDTH_M wide centred on the capsule outline at `rho`. With
 * `dashed`, quads are kept only where the outline's running length falls in a
 * dash, so the ring reads as a dashed line whatever its vertex spacing.
 */
function ringFootprint(a: Pt, b: Pt, rho: number, dashed: boolean): Footprint {
  const { capN, sideN } = loopCounts(a, b, rho, 4, 96);
  const inner = capsuleLoop(a, b, Math.max(0, rho - RING_WIDTH_M / 2), capN, sideN);
  const outer = capsuleLoop(a, b, rho + RING_WIDTH_M / 2, capN, sideN);
  const centre = capsuleLoop(a, b, rho, capN, sideN);
  const n = centre.length;
  const xy = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    xy[i * 4] = inner[i][0]; xy[i * 4 + 1] = inner[i][1];
    xy[i * 4 + 2] = outer[i][0]; xy[i * 4 + 3] = outer[i][1];
  }
  const index: number[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const seg = Math.hypot(centre[j][0] - centre[i][0], centre[j][1] - centre[i][1]);
    const on = !dashed || (run + seg / 2) % (DASH_M + GAP_M) < DASH_M;
    run += seg;
    if (!on) continue;
    index.push(i * 2, i * 2 + 1, j * 2, j * 2, i * 2 + 1, j * 2 + 1);
  }
  return { xy, index };
}

/**
 * Geometry whose vertices ride the deformed ground. The footprint fixes X/Z;
 * Y is rewritten whenever the ground can have moved (`tick` covers
 * bowl / time changes that arrive without a new perturbations array).
 */
function useConformed(
  fp: Footprint,
  lift: number,
  exaggeration: number,
  perturbations: Perturbation[],
  tick: unknown,
): THREE.BufferGeometry {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((fp.xy.length / 2) * 3), 3));
    g.setIndex(fp.index);
    return g;
  }, [fp]);

  useLayoutEffect(() => {
    const attr = geo.getAttribute("position") as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    const count = fp.xy.length / 2;
    for (let i = 0; i < count; i++) {
      const x = fp.xy[i * 2];
      const y = fp.xy[i * 2 + 1];
      const h = sampleGroundY(x, y, exaggeration, perturbations);
      pos[i * 3] = x;
      pos[i * 3 + 1] = (Number.isFinite(h) ? h : 0) + lift;
      pos[i * 3 + 2] = y;
    }
    attr.needsUpdate = true;
  }, [geo, fp, lift, exaggeration, perturbations, tick]);

  useEffect(() => () => geo.dispose(), [geo]);
  return geo;
}

interface ConformedProps {
  fp: Footprint;
  color: string;
  opacity: number;
  lift: number;
  exaggeration: number;
  perturbations: Perturbation[];
  tick: unknown;
  /** Draw order: rings over fills. */
  order: number;
}

const Conformed: React.FC<ConformedProps> = ({ fp, color, opacity, lift, exaggeration, perturbations, tick, order }) => {
  const geo = useConformed(fp, lift, exaggeration, perturbations, tick);
  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={order}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-4 - order}
        polygonOffsetUnits={-4 - order}
      />
    </mesh>
  );
};

interface ShapeProps {
  /** Capsule spine: one point (a circle) or a polyline. */
  spine: Pt[];
  rWhite: number;
  rRed: number;
  dashed: boolean;
  exaggeration: number;
  perturbations: Perturbation[];
  tick: unknown;
}

/**
 * One hazard zone: 20% red inside the white ring, 20% yellow in the band out
 * to the red ring, then the two rings. A polyline spine is drawn as one
 * capsule per segment.
 */
const ZoneShape: React.FC<ShapeProps> = ({ spine, rWhite, rRed, dashed, exaggeration, perturbations, tick }) => {
  const key = spine.map((p) => p.join(",")).join(";");
  const parts = useMemo(() => {
    const segs: [Pt, Pt][] = spine.length === 1 ? [[spine[0], spine[0]]] : spine.slice(1).map((p, i) => [spine[i], p]);
    const w = Math.min(rWhite, rRed);
    const r = Math.max(rWhite, rRed);
    return segs.map(([a, b]) => ({
      inside: bandFootprint(a, b, 0, w),
      band: bandFootprint(a, b, w, r),
      white: ringFootprint(a, b, w, dashed),
      red: ringFootprint(a, b, r, dashed),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rWhite, rRed, dashed]);
  const fillOpacity = dashed ? PREVIEW_FILL_OPACITY : FILL_OPACITY;
  const common = { exaggeration, perturbations, tick };
  return (
    <group>
      {parts.map((p, i) => (
        <group key={i}>
          <Conformed fp={p.inside} color={FILL_RED} opacity={fillOpacity} lift={FILL_LIFT_M} order={1} {...common} />
          <Conformed fp={p.band} color={FILL_YELLOW} opacity={fillOpacity} lift={FILL_LIFT_M} order={1} {...common} />
          <Conformed fp={p.white} color={WHITE} opacity={1} lift={RING_LIFT_M} order={2} {...common} />
          <Conformed fp={p.red} color={RED} opacity={1} lift={RING_LIFT_M} order={3} {...common} />
        </group>
      ))}
    </group>
  );
};

export interface PreviewZone {
  /** Circle centre, or the A-B segment when `line` is set. */
  x: number;
  y: number;
  /** Event radius R (cave-in / tilt) or crack width; the rings sit at 1.2 R and 1.5 R. */
  radius_m: number;
  line?: { x0: number; y0: number; x1: number; y1: number } | null;
}

interface EventZonesProps {
  zones: EventZone[];
  preview?: PreviewZone | null;
  exaggeration: number;
  perturbations: Perturbation[];
  /** Anything else that moves the ground (bowl, clock); forces a height refresh. */
  tick?: unknown;
}

export const EventZones: React.FC<EventZonesProps> = ({ zones, preview = null, exaggeration, perturbations, tick }) => {
  const spineOf = (z: EventZone): Pt[] | null => {
    if (Array.isArray(z.polyline) && z.polyline.length >= 2) return z.polyline.map((p) => [p[0], p[1]] as Pt);
    if (Number.isFinite(z.cx) && Number.isFinite(z.cy)) return [[z.cx as number, z.cy as number]];
    return null;
  };
  const previewSpine: Pt[] | null = preview
    ? preview.line
      ? [[preview.line.x0, preview.line.y0], [preview.line.x1, preview.line.y1]]
      : [[preview.x, preview.y]]
    : null;
  return (
    <group>
      {zones.map((z) => {
        const spine = spineOf(z);
        if (!spine || !(z.r_white > 0) || !(z.r_red > 0)) return null;
        return (
          <ZoneShape
            key={`z${z.event_index}`}
            spine={spine}
            rWhite={z.r_white}
            rRed={z.r_red}
            dashed={false}
            exaggeration={exaggeration}
            perturbations={perturbations}
            tick={tick}
          />
        );
      })}
      {preview && previewSpine && preview.radius_m > 0 && (
        <ZoneShape
          spine={previewSpine}
          rWhite={ZONE_WHITE_FACTOR * preview.radius_m}
          rRed={ZONE_RED_FACTOR * preview.radius_m}
          dashed
          exaggeration={exaggeration}
          perturbations={perturbations}
          tick={tick}
        />
      )}
    </group>
  );
};

// ---------------------------------------------------------------------------
// TILT direction arrow
// ---------------------------------------------------------------------------

/** How long the arrow stays fully visible, then how long it takes to fade, s. */
export const TILT_ARROW_HOLD_S = 4;
export const TILT_ARROW_FADE_S = 1;

export interface TiltArrowSpec {
  id: number;
  /** The event target (panel frame m); the arrow starts here. */
  x: number;
  y: number;
  /** Compass bearing the ground tilts toward, degrees. */
  dirDeg: number;
  /** Arrow length, m. */
  lengthM: number;
}

function arrowFootprint(a: TiltArrowSpec): Footprint {
  const b = (a.dirDeg * Math.PI) / 180;
  const ux = Math.sin(b), uy = Math.cos(b);      // along the bearing (x east, y north)
  const vx = -uy, vy = ux;                       // to its left
  const L = a.lengthM;
  const shaftEnd = 0.68 * L;
  const shaftHalf = Math.max(1.4, L * 0.035);
  const headHalf = shaftHalf * 3.2;
  // Rows across the arrow: (distance along, half-width). The head tapers to a point.
  const rows: [number, number][] = [];
  const shaftRows = Math.max(3, Math.ceil(shaftEnd / 8));
  for (let i = 0; i <= shaftRows; i++) rows.push([(shaftEnd * i) / shaftRows, shaftHalf]);
  rows.push([shaftEnd, headHalf]);
  const headRows = 4;
  for (let j = 1; j <= headRows; j++) rows.push([shaftEnd + ((L - shaftEnd) * j) / headRows, headHalf * (1 - j / headRows)]);
  // The shaft's last row and the head's base share a distance but not a width,
  // so they are separate rows and the strip between them is the shoulder.
  const xy = new Float32Array(rows.length * 3 * 2);
  rows.forEach(([u, hw], r) => {
    for (let c = 0; c < 3; c++) {
      const w = (c - 1) * hw;
      xy[(r * 3 + c) * 2] = a.x + ux * u + vx * w;
      xy[(r * 3 + c) * 2 + 1] = a.y + uy * u + vy * w;
    }
  });
  const index: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < 2; c++) {
      const p00 = r * 3 + c, p01 = r * 3 + c + 1, p10 = (r + 1) * 3 + c, p11 = (r + 1) * 3 + c + 1;
      index.push(p00, p10, p01, p01, p10, p11);
    }
  }
  return { xy, index };
}

export const TiltArrow: React.FC<{ arrow: TiltArrowSpec; exaggeration: number; perturbations: Perturbation[]; tick?: unknown }> = ({
  arrow, exaggeration, perturbations, tick,
}) => {
  const fp = useMemo(() => arrowFootprint(arrow), [arrow]);
  const geo = useConformed(fp, 1.4, exaggeration, perturbations, tick);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const startRef = useRef<number | null>(null);
  useFrame((state) => {
    const m = matRef.current;
    if (!m) return;
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - startRef.current;
    m.opacity = age <= TILT_ARROW_HOLD_S ? 1 : Math.max(0, 1 - (age - TILT_ARROW_HOLD_S) / TILT_ARROW_FADE_S);
  });
  return (
    <mesh geometry={geo} frustumCulled={false} renderOrder={4}>
      <meshBasicMaterial
        ref={matRef}
        color="#FFB800"
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>
  );
};

// ---------------------------------------------------------------------------
// CRACK dust line
// ---------------------------------------------------------------------------

const CRACK_DUST_LIFE_S = 2.0;

export interface CrackDustSpec {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A thin puff of dust strung along a crack: little rise, no radial blast. */
const CrackDust: React.FC<{ dust: CrackDustSpec }> = ({ dust }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);
  const startRef = useRef<number | null>(null);

  const sim = useMemo(() => {
    const len = Math.hypot(dust.x1 - dust.x0, dust.y1 - dust.y0);
    const count = Math.min(220, Math.max(60, Math.round(len * 0.8)));
    const nx = len > 0 ? -(dust.y1 - dust.y0) / len : 0;
    const ny = len > 0 ? (dust.x1 - dust.x0) / len : 0;
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const floor = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      const off = (Math.random() - 0.5) * 2.4;
      const x = dust.x0 + (dust.x1 - dust.x0) * t + nx * off;
      const y = dust.y0 + (dust.y1 - dust.y0) * t + ny * off;
      const g = sampleBaseGroundY(x, y);
      floor[i] = (Number.isFinite(g) ? g : 0) + 0.5;
      pos[i * 3] = x;
      pos[i * 3 + 1] = floor[i] + Math.random() * 0.8;
      pos[i * 3 + 2] = y;
      const side = (Math.random() - 0.5) * 3.0;
      vel[i * 3] = nx * side;
      vel[i * 3 + 1] = 1.5 + Math.random() * 3.0;
      vel[i * 3 + 2] = ny * side;
    }
    return { pos, vel, floor, count };
  }, [dust]);

  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sim.pos, 3));
    return g;
  }, [sim]);
  useEffect(() => () => geo.dispose(), [geo]);

  useFrame((state, rawDt) => {
    const pts = pointsRef.current;
    const mat = matRef.current;
    if (!pts || !mat) return;
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - startRef.current;
    if (age > CRACK_DUST_LIFE_S) {
      pts.visible = false;
      return;
    }
    const dt = Math.min(rawDt, 0.05);
    const drag = Math.max(0, 1 - 1.6 * dt);
    const { pos, vel, floor, count } = sim;
    for (let i = 0; i < count; i++) {
      vel[i * 3] *= drag;
      vel[i * 3 + 2] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 4.0 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (pos[i * 3 + 1] < floor[i]) {
        pos[i * 3 + 1] = floor[i];
        vel[i * 3 + 1] = 0;
      }
    }
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    mat.opacity = 0.8 * (1 - age / CRACK_DUST_LIFE_S);
  });

  return (
    <points ref={pointsRef} geometry={geo} frustumCulled={false}>
      <pointsMaterial ref={matRef} color="#d2c4a4" size={3.2} sizeAttenuation transparent opacity={0.7} depthWrite={false} />
    </points>
  );
};

export const CrackDustLines: React.FC<{ dusts: CrackDustSpec[] }> = ({ dusts }) => (
  <group>{dusts.map((d) => <CrackDust key={d.id} dust={d} />)}</group>
);

export const TiltArrows: React.FC<{ arrows: TiltArrowSpec[]; exaggeration: number; perturbations: Perturbation[]; tick?: unknown }> = ({
  arrows, exaggeration, perturbations, tick,
}) => (
  <group>{arrows.map((a) => <TiltArrow key={a.id} arrow={a} exaggeration={exaggeration} perturbations={perturbations} tick={tick} />)}</group>
);
