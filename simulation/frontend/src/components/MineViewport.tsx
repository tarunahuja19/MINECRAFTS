import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { NodeDef, NodeTelemetry, Perturbation, SimulationPacket, TargetLocation } from "../types";
import type { EmbedClipBounds } from "../embed";
import { sampleBaseGroundY } from "../utils/terrainSampler";
import { TerrainMesh } from "./TerrainMesh";
import { NodeMarkers } from "./NodeMarkers";
import { TargetBeacon } from "./TargetBeacon";
import { TerrainLegend } from "./TerrainLegend";

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
  perturbations: Perturbation[];
  latestPacket?: SimulationPacket | null;
  nodes: NodeDef[];
  nodeTelemetry: NodeTelemetry[];
  exaggeration: number;
  selectedNodeId: number | null;
  targetLocation: TargetLocation | null;
  collapseRadiusM?: number;
  showMeshTopology?: boolean;
  vibrationActive?: boolean;
  onSelectNode: (id: number) => void;
  onTerrainClick: (x: number, y: number, elev: number) => void;
  wireframe?: boolean;
  /** Embed-mode terrain sub-window (panel-frame metres); null = full panel. */
  clipBounds?: EmbedClipBounds | null;
  /** Embed-mode node allowlist; null = spatial/default filtering. */
  nodeFilter?: number[] | null;
}

export const MineViewport = forwardRef<MineViewportHandle, MineViewportProps>(({
  z0Mesh,
  baseBowlMesh,
  elevMinM,
  windowSizeM = 600,
  elevMaxM,
  timeScalar,
  perturbations,
  latestPacket,
  nodes,
  nodeTelemetry,
  exaggeration,
  selectedNodeId,
  targetLocation,
  collapseRadiusM = 75,
  showMeshTopology = true,
  vibrationActive = false,
  onSelectNode,
  onTerrainClick,
  wireframe = false,
  clipBounds = null,
  nodeFilter = null,
}, ref) => {
  const controlsRef = useRef<OrbitControlsImpl>(null);

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
  useEffect(() => {
    if (!clipBounds) return;
    focusOnBounds(clipBounds);
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
        {/* Natural Sun & Atmospheric Lighting */}
        <ambientLight intensity={0.7} color="#ffffff" />
        <directionalLight
          position={[300, 520, 240]}
          intensity={1.3}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
        />
        <pointLight position={[-200, 300, -200]} intensity={0.4} color="#a3a4a6" />
        <pointLight position={[200, 200, 200]} intensity={0.3} color="#f7f7f7" />

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

        {/* Dynamic 600m Natural Rolling Terrain Mesh */}
        <TerrainMesh
          z0Mesh={z0Mesh}
          baseBowlMesh={baseBowlMesh}
          elevMinM={elevMinM}
          elevMaxM={elevMaxM}
          timeScalar={timeScalar}
          perturbations={perturbations}
          latestPacket={latestPacket}
          exaggeration={exaggeration}
          windowSizeM={windowSizeM}
          wireframe={wireframe}
          vibrationActive={vibrationActive}
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
        />
      </Canvas>

      {/* Key to the viewport's colour scales: the fused height/depth ramp,
          plus the soil body's own. */}
      <TerrainLegend elevMinM={elevMinM} elevMaxM={elevMaxM} />
    </div>
  );
});

MineViewport.displayName = "MineViewport";


