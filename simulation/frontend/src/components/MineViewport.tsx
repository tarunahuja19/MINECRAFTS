import { useEffect, useMemo, useRef, useImperativeHandle, forwardRef, type ReactNode } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { CrackLine, EventZone, PreviewLine, NodeDef, NodeTelemetry, Perturbation, SimulationPacket, TargetLocation } from "../types";
import type { EmbedClipBounds } from "../embed";
import { sampleBaseGroundY, sampleGroundY } from "../utils/terrainSampler";
import { TerrainMesh } from "./TerrainMesh";
import { NodeMarkers } from "./NodeMarkers";
import { TargetBeacon } from "./TargetBeacon";
import { TerrainLegend } from "./TerrainLegend";
import { CollapseDust, type ImpactBurst } from "./CollapseDust";
import {
  CrackDustLines,
  EventZones,
  TiltArrows,
  type CrackDustSpec,
  type PreviewZone,
  type TiltArrowSpec,
} from "./EventZones";

export type CameraPreset = "overview" | "highland" | "pit" | "cutaway" | "topdown";

export interface MineViewportHandle {
  resetCamera: () => void;
  setCameraPreset: (preset: CameraPreset) => void;
  focusOnPoint: (x: number, y: number, z: number) => void;
  /** Frame an embed selection rectangle. */
  focusOnBounds: (bounds: EmbedClipBounds) => void;
  /**
   * Re-aim the camera at pitch/bearing degrees around the current target,
   * keeping its distance — the embed bridge for the dashboard toolbar.
   * Pitch 0 = top-down, 90 = horizontal.
   */
  setView: (pitchDeg: number, bearingDeg: number) => void;
}

interface MineViewportProps {
  z0Mesh: number[][];
  baseBowlMesh: number[][];
  elevMinM?: number;
  elevMaxM?: number;
  /** Side of the square simulation window in metres (constants.WINDOW_SIZE_M),
   *  as reported by the server's init payload. The terrain plane, the node
   *  coordinates and the geo projection must all be built on this same number
   *  — it was hardcoded to 600 here, which was correct only by coincidence. */
  windowSizeM?: number;
  timeScalar: number;
  /** y factor of the moving bowl; a change redraws the terrain (the profile is in globalGeomechanics). */
  bowlPy?: number[] | null;
  perturbations: Perturbation[];
  latestPacket?: SimulationPacket | null;
  nodes: NodeDef[];
  nodeTelemetry: NodeTelemetry[];
  exaggeration: number;
  selectedNodeId: number | null;
  targetLocation: TargetLocation | null;
  collapseRadiusM?: number;
  showMeshTopology?: boolean;
  /** Blast pulse counter; each increment replays the shockwave ring. */
  vibrationPulse?: number;
  /** Wall-clock driver (ms) for in-flight mesh animation; see TerrainMesh. */
  animMs?: number;
  /** True while an event is settling; its falling edge forces a final pass. */
  flightActive?: boolean;
  /** World-shake amplitude in metres; 0 = still. Decays in the parent. */
  shakeAmp?: number;
  /** Live impact dust bursts; empty = none. */
  bursts?: ImpactBurst[];
  onSelectNode: (id: number) => void;
  onTerrainClick: (x: number, y: number, elev: number) => void;
  wireframe?: boolean;
  /** Embed-mode terrain sub-window (panel-frame metres); null = full panel. */
  clipBounds?: EmbedClipBounds | null;
  /** Embed-mode node allowlist; null = spatial/default filtering. */
  nodeFilter?: number[] | null;
  /** Lab crack segments overlay (dashboard `set-cracks`); empty = none. */
  crackLines?: CrackLine[];
  /** FORGE CRACK preview: dashed line A-B while drawing; null = none. */
  previewLine?: PreviewLine | null;
  /** FORGE hazard zones (white / red rings and fills) from the :8020 frame. */
  eventZones?: EventZone[];
  /** FORGE zone preview drawn dashed before an event is fired; null = none. */
  previewZone?: PreviewZone | null;
  /** FORGE: the target beacon shows only its beam and reticle; rings come from `eventZones` / `previewZone`. */
  zoneRings?: boolean;
  /** Live tilt direction arrows (FORGE); each removed by the parent after it fades. */
  tiltArrows?: TiltArrowSpec[];
  /** Live crack dust lines (FORGE). */
  crackDusts?: CrackDustSpec[];
}

/** Dashed amber line A-B riding the deformed ground (FORGE DRAW CRACK preview). */
function PreviewLineOverlay({ line, exaggeration, perturbations }: { line: PreviewLine | null; exaggeration: number; perturbations: Perturbation[] }) {
  const obj = useMemo(() => {
    if (!line) return null;
    const len = Math.hypot(line.x1 - line.x0, line.y1 - line.y0);
    const n = Math.max(2, Math.ceil(len / 5));
    const pos: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = line.x0 + (line.x1 - line.x0) * t;
      const y = line.y0 + (line.y1 - line.y0) * t;
      const h = sampleGroundY(x, y, exaggeration, perturbations);
      pos.push(x, (Number.isFinite(h) ? h : 0) + CRACK_LIFT_M, y);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: "#ffaa00", dashSize: 6, gapSize: 3, depthWrite: false }));
    l.computeLineDistances();
    l.frustumCulled = false;
    return l;
  }, [line, exaggeration, perturbations]);

  useEffect(() => () => {
    obj?.geometry.dispose();
    (obj?.material as THREE.Material | undefined)?.dispose();
  }, [obj]);

  return obj ? <primitive object={obj} /> : null;
}

/** Cracks and preview lines lie this far above the deformed surface, m. */
const CRACK_LIFT_M = 0.5;

/**
 * Crack ground-break overlay: new segments draw red with a dark split core,
 * pre-existing segments draw dim orange. Each end sits CRACK_LIFT_M above the
 * DEFORMED surface — the height TerrainMesh writes, exaggeration included — so
 * a line lies on a pit's floor instead of floating over the pit's rim. WebGL
 * draws 1 px lines, so the "break" read comes from the dark-core-over-red
 * pairing, not width.
 */
function CrackLinesOverlay({ lines, exaggeration, perturbations, tick }: { lines: CrackLine[]; exaggeration: number; perturbations: Perturbation[]; tick?: unknown }) {
  const geoms = useMemo(() => {
    const fresh: number[] = [];
    const old: number[] = [];
    const core: number[] = [];
    const heightAt = (x: number, y: number) => {
      const h = sampleGroundY(x, y, exaggeration, perturbations);
      return Number.isFinite(h) ? h : 0;
    };
    for (const s of lines) {
      const h0 = heightAt(s.x0, s.y0);
      const h1 = heightAt(s.x1, s.y1);
      const target = s.isNew ? fresh : old;
      target.push(s.x0, h0 + CRACK_LIFT_M, s.y0, s.x1, h1 + CRACK_LIFT_M, s.y1);
      if (s.isNew) {
        core.push(s.x0, h0 + CRACK_LIFT_M + 0.1, s.y0, s.x1, h1 + CRACK_LIFT_M + 0.1, s.y1);
      }
    }
    const mk = (arr: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(arr), 3));
      return g;
    };
    return { fresh: mk(fresh), old: mk(old), core: mk(core) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, exaggeration, perturbations, tick]);

  useEffect(() => {
    return () => {
      geoms.fresh.dispose();
      geoms.old.dispose();
      geoms.core.dispose();
    };
  }, [geoms]);

  if (lines.length === 0) return null;
  return (
    <group>
      <lineSegments geometry={geoms.old} frustumCulled={false}>
        <lineBasicMaterial color="#FF8800" transparent opacity={0.75} />
      </lineSegments>
      <lineSegments geometry={geoms.fresh} frustumCulled={false}>
        <lineBasicMaterial color="#FF2222" transparent opacity={0.95} />
      </lineSegments>
      <lineSegments geometry={geoms.core} frustumCulled={false}>
        <lineBasicMaterial color="#050505" transparent opacity={1.0} />
      </lineSegments>
    </group>
  );
}

/**
 * Blast/impact shake, applied to the WORLD rather than the camera.
 *
 * Offsetting the camera fights OrbitControls (with damping it re-reads the
 * camera every frame and would absorb the jitter as drift). Shaking the scene
 * contents instead is visually identical and stateless: a fresh random offset
 * per frame, snapped back to exactly zero when the amplitude dies.
 */
function ShakeGroup({ amp, children }: { amp: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const ampRef = useRef(amp);
  ampRef.current = amp;
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const a = ampRef.current;
    if (a <= 0.001) {
      if (g.position.lengthSq() !== 0) g.position.set(0, 0, 0);
      return;
    }
    g.position.set(
      (Math.random() - 0.5) * 2.0 * a,
      (Math.random() - 0.5) * 1.2 * a,
      (Math.random() - 0.5) * 2.0 * a
    );
  });
  return <group ref={ref}>{children}</group>;
}

export const MineViewport = forwardRef<MineViewportHandle, MineViewportProps>(({
  z0Mesh,
  baseBowlMesh,
  elevMinM,
  windowSizeM = 600,
  elevMaxM,
  timeScalar,
  bowlPy,
  perturbations,
  latestPacket,
  nodes,
  nodeTelemetry,
  exaggeration,
  selectedNodeId,
  targetLocation,
  collapseRadiusM = 75,
  showMeshTopology = true,
  vibrationPulse = 0,
  animMs = 0,
  flightActive = false,
  shakeAmp = 0,
  bursts = [],
  onSelectNode,
  onTerrainClick,
  wireframe = false,
  clipBounds = null,
  nodeFilter = null,
  crackLines = [],
  previewLine = null,
  eventZones = [],
  previewZone = null,
  zoneRings = true,
  tiltArrows = [],
  crackDusts = [],
}, ref) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);

  // Whatever else moves the ground besides `perturbations` (the bowl profile,
  // the clock, an in-flight event); overlays that ride the surface re-sample
  // when it changes.
  const groundTick = `${timeScalar}|${animMs}|${bowlPy ? bowlPy.length : 0}|${bowlPy ? bowlPy[Math.floor(bowlPy.length / 2)] : 0}`;

  const focusOnBounds = (b: EmbedClipBounds) => {
    if (!controlsRef.current) return;
    const cx = (b.xMin + b.xMax) / 2.0;
    const cy = (b.yMin + b.yMax) / 2.0;
    const span = Math.max(b.xMax - b.xMin, b.yMax - b.yMin, 60);
    // Datum-relative scene units — the same Y the mesh writes, so the target
    // sits on the selected ground rather than at a guessed height.
    const groundY = sampleBaseGroundY(cx, cy);
    const targetY = Number.isFinite(groundY) ? groundY + 8 : 70;
    const dist = Math.min(950, Math.max(150, span * 1.7));
    controlsRef.current.target.set(cx, targetY, cy);
    controlsRef.current.object.position.set(
      cx + dist * 0.55,
      targetY + dist * 0.72,
      cy + dist * 0.55,
    );
    controlsRef.current.update();
  };

  // A new embed selection re-frames the camera onto the rendered sub-window.
  // Keyed on a scalar: the parent posts a fresh object per update, and
  // depending on the object itself would refire on every parent render.
  const clipKey = clipBounds
    ? `${clipBounds.xMin},${clipBounds.yMin},${clipBounds.xMax},${clipBounds.yMax}`
    : "";
  const prevClipRef = useRef<boolean>(!!clipBounds);
  useEffect(() => {
    if (clipBounds) {
      focusOnBounds(clipBounds);
      prevClipRef.current = true;
    } else if (prevClipRef.current) {
      applyCameraPreset("overview");
      prevClipRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipKey]);

  // Presets are framed for the real Adriyala panel, which spans ~174 m of
  // relief above the datum (the terrain is rendered datum-relative, so the
  // valley floor sits at y=0 and the north-east ridge tops out near y=174).
  // The previous targets (y=20..60) were framed for the old synthetic 8-65 m
  // hills and now look at the valley floor with the ridge out of frame.
  const applyCameraPreset = (preset: CameraPreset) => {
    if (!controlsRef.current) return;
    if (preset === "overview") {
      controlsRef.current.target.set(0, 70, 0);
      controlsRef.current.object.position.set(430, 400, 500);
    } else if (preset === "highland") {
      // North-east ridge, the high ground on this panel.
      controlsRef.current.target.set(230, 150, 210);
      controlsRef.current.object.position.set(430, 300, 420);
    } else if (preset === "pit") {
      // South-west low ground, the valley floor.
      controlsRef.current.target.set(-180, 15, -170);
      controlsRef.current.object.position.set(60, 190, 130);
    } else if (preset === "cutaway") {
      // Low, near-horizontal eye line so the relief reads as relief.
      controlsRef.current.target.set(0, 60, 0);
      controlsRef.current.object.position.set(560, 110, 0);
    } else if (preset === "topdown") {
      controlsRef.current.target.set(0, 60, 0);
      controlsRef.current.object.position.set(0, 760, 0.1);
    }
    controlsRef.current.update();
  };

  useImperativeHandle(ref, () => ({
    resetCamera: () => {
      applyCameraPreset("overview");
    },
    setCameraPreset: (preset: CameraPreset) => {
      applyCameraPreset(preset);
    },
    focusOnPoint: (x: number, y: number, z: number) => {
      if (!controlsRef.current) return;
      controlsRef.current.target.set(x, y + 5, z);
      controlsRef.current.object.position.set(x + 110, y + 85, z + 110);
      controlsRef.current.update();
    },
    focusOnBounds: (b: EmbedClipBounds) => {
      focusOnBounds(b);
    },
    setView: (pitchDeg: number, bearingDeg: number) => {
      const c = controlsRef.current;
      if (!c) return;
      const pitch = (Math.max(0, Math.min(90, pitchDeg)) * Math.PI) / 180;
      const bearing = ((Number.isFinite(bearingDeg) ? bearingDeg : 0) * Math.PI) / 180;
      const dist = c.object.position.distanceTo(c.target);
      const horiz = dist * Math.sin(pitch);
      c.object.position.set(
        c.target.x + horiz * Math.sin(bearing),
        c.target.y + dist * Math.cos(pitch),
        c.target.z + horiz * Math.cos(bearing),
      );
      c.update();
    },
  }));

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", background: "var(--bg-viewport)" }}>
      {/* 3D WebGL Canvas */}
      <Canvas
        shadows
        camera={{
          position: [430, 400, 500],
          fov: 45,
          // The default near plane (0.1) against a ~3 km far plane leaves the
          // depth buffer with far too little precision at this scene's scale,
          // which is what made the terrain tear and flicker on zoom. A near
          // plane of 5 m is still far closer than OrbitControls' minDistance
          // ever allows the camera to approach.
          near: 5,
          far: 4000,
        }}
        style={{ background: "radial-gradient(circle at center, #111728 0%, #04060c 100%)" }}
      >
        {/* Natural Sun & Atmospheric Multi-Directional Lighting (Prevents Black Slopes) */}
        <ambientLight intensity={0.9} color="#ffffff" />
        <hemisphereLight args={["#ffffff", "#556677", 1.4]} />
        <directionalLight
          position={[300, 520, 240]}
          intensity={1.4}
          color="#fffbf0"
        />
        <directionalLight
          position={[-300, 300, -200]}
          intensity={0.8}
          color="#cbd5e1"
        />
        <directionalLight
          position={[-300, 380, -240]}
          intensity={0.9}
          color="#94a3b8"
        />
        <directionalLight
          position={[-200, 420, 280]}
          intensity={0.7}
          color="#cbd5e1"
        />

        {/* Orbit Controls with Unrestricted View Angles for 600m domain */}
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={60}
          maxDistance={1600}
          // No polar clamp: the mesh renders side={THREE.DoubleSide}, so the
          // underside is already drawn and correct from beneath the panel.
          target={[0, 70, 0]}
        />

        {/* World-shake group: blast/impact jitter moves the scene, never the
            camera (see ShakeGroup). Lights and controls stay outside. */}
        <ShakeGroup amp={shakeAmp}>
          {/* Dynamic 600m Natural Rolling Terrain Mesh */}
          <TerrainMesh
            z0Mesh={z0Mesh}
            baseBowlMesh={baseBowlMesh}
            elevMinM={elevMinM}
            elevMaxM={elevMaxM}
            timeScalar={timeScalar}
            bowlPy={bowlPy}
            perturbations={perturbations}
            latestPacket={latestPacket}
            exaggeration={exaggeration}
            windowSizeM={windowSizeM}
            wireframe={wireframe}
            animMs={animMs}
            flightActive={flightActive}
            vibrationPulse={vibrationPulse}
            waveOrigin={targetLocation ? { x: targetLocation.x, y: targetLocation.y } : null}
            onTerrainClick={onTerrainClick}
            clipBounds={clipBounds}
          />

          {/* 33 Sensor Node Geodetic Monuments & Extensometer Baseline Links */}
          <NodeMarkers
            nodes={nodes}
            nodeTelemetry={nodeTelemetry}
            z0Mesh={z0Mesh}
            baseBowlMesh={baseBowlMesh}
            timeScalar={timeScalar}
            perturbations={perturbations}
            latestPacket={latestPacket}
            exaggeration={exaggeration}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            showMeshTopology={showMeshTopology}
            nodeFilter={nodeFilter}
            clipBounds={clipBounds}
          />

          {/* 3D Holographic Target Beacon (Terrain-conforming red radius ring) */}
          <TargetBeacon
            target={targetLocation}
            radiusM={collapseRadiusM}
            exaggeration={exaggeration}
            perturbations={perturbations}
            showRings={zoneRings}
          />

          {/* FORGE hazard zones: white/red rings + fills, and their dashed preview */}
          <EventZones
            zones={eventZones}
            preview={previewZone}
            exaggeration={exaggeration}
            perturbations={perturbations}
            tick={groundTick}
          />

          {/* Lab / FORGE crack ground-break overlay (`set-cracks`, `forge-frame`) */}
          <CrackLinesOverlay lines={crackLines} exaggeration={exaggeration} perturbations={perturbations} tick={groundTick} />

          {/* FORGE CRACK preview (embed `forge-preview` with a line) */}
          <PreviewLineOverlay line={previewLine} exaggeration={exaggeration} perturbations={perturbations} />

          {/* Impact dust thrown by collapse / tilt triggers */}
          <CollapseDust bursts={bursts} />

          {/* FORGE event looks: tilt direction arrow, crack dust line */}
          <TiltArrows arrows={tiltArrows} exaggeration={exaggeration} perturbations={perturbations} tick={groundTick} />
          <CrackDustLines dusts={crackDusts} />
        </ShakeGroup>
      </Canvas>

      {/* Key to the viewport's colour scales: the fused height/depth ramp,
          plus the soil body's own. */}
      <TerrainLegend elevMinM={elevMinM} elevMaxM={elevMaxM} />
    </div>
  );
});

MineViewport.displayName = "MineViewport";


