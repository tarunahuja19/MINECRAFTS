import React, { useMemo } from "react";
import * as THREE from "three";
import type { Perturbation, TargetLocation } from "../types";
import { sampleGroundY } from "../utils/terrainSampler";

interface TargetBeaconProps {
  target: TargetLocation | null;
  radiusM?: number;
  zElev?: number;
  exaggeration?: number;
  perturbations?: Perturbation[];
}

/**
 * Ground height at world (x, y) in scene units, delegating to the single
 * shared terrain sampler.
 *
 * This function previously evaluated `evaluateNaturalElevation()` — the
 * invented procedural hills — while the viewport rendered the server's real
 * Adriyala DEM. The two surfaces are unrelated (8-65 m vs 0-174 m
 * datum-relative), which is why the outline ring was drawn buried
 * beneath the terrain almost everywhere on the panel.
 */
export function sampleTerrainSurfaceY(
  x: number,
  y: number,
  exaggeration: number = 1.0,
  perturbations?: Perturbation[]
): number {
  return sampleGroundY(x, y, exaggeration, perturbations);
}

export const TargetBeacon: React.FC<TargetBeaconProps> = ({
  target,
  radiusM = 75,
  exaggeration = 1.0,
  perturbations,
}) => {
  // Safe scalars captured before the hooks so `useMemo` can run
  // unconditionally even when `target` is null — React requires hook order
  // to stay identical across renders, so the null check has to come after.
  const tx = target?.x ?? 0;
  const ty = target?.y ?? 0;

  // Center ground elevation under targeting laser
  const centerGroundY = useMemo(() => {
    return sampleTerrainSurfaceY(tx, ty, exaggeration, perturbations);
  }, [tx, ty, exaggeration, perturbations]);

  // Conformal 3D terrain-following geometry for the outline ring and reticle
  const { lineGeo, innerRingGeo, innerLineGeo } = useMemo(() => {
    const segments = 128;
    const linePos: number[] = [];

    const outerR = radiusM;

    // Vertical float offset to ensure vertices strictly stay above terrain triangles
    const SURFACE_OFFSET = 0.75;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      // Outer perimeter vertex in world coordinates
      const ox = tx + outerR * cosT;
      const oz = ty + outerR * sinT;
      const oy = sampleTerrainSurfaceY(ox, oz, exaggeration, perturbations) + SURFACE_OFFSET;

      // Line perimeter follows the outer edge, raised slightly
      linePos.push(ox - tx, oy + 0.12, oz - ty);
    }

    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));

    // Conformal inner targeting reticle (radius 7.5m - 10.0m)
    const inSegments = 64;
    const inRibbonPos: number[] = [];
    const inRibbonIndices: number[] = [];
    const inLinePos: number[] = [];
    const inOuterR = 10.0;
    const inInnerR = 7.5;

    for (let i = 0; i <= inSegments; i++) {
      const theta = (i / inSegments) * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      const ox = tx + inOuterR * cosT;
      const oz = ty + inOuterR * sinT;
      const oy = sampleTerrainSurfaceY(ox, oz, exaggeration, perturbations) + SURFACE_OFFSET + 0.05;

      const ix = tx + inInnerR * cosT;
      const iz = ty + inInnerR * sinT;
      const iy = sampleTerrainSurfaceY(ix, iz, exaggeration, perturbations) + SURFACE_OFFSET + 0.05;

      inRibbonPos.push(ix - tx, iy, iz - ty);
      inRibbonPos.push(ox - tx, oy, oz - ty);
      inLinePos.push(ox - tx, oy + 0.08, oz - ty);

      if (i < inSegments) {
        const idx0 = i * 2;
        const idx1 = i * 2 + 1;
        const idx2 = (i + 1) * 2;
        const idx3 = (i + 1) * 2 + 1;

        inRibbonIndices.push(idx0, idx1, idx2);
        inRibbonIndices.push(idx1, idx3, idx2);
      }
    }

    const inGeo = new THREE.BufferGeometry();
    inGeo.setAttribute("position", new THREE.Float32BufferAttribute(inRibbonPos, 3));
    inGeo.setIndex(inRibbonIndices);
    inGeo.computeVertexNormals();

    const inLine = new THREE.BufferGeometry();
    inLine.setAttribute("position", new THREE.Float32BufferAttribute(inLinePos, 3));

    return {
      lineGeo: lGeo,
      innerRingGeo: inGeo,
      innerLineGeo: inLine,
    };
  }, [tx, ty, radiusM, exaggeration, perturbations]);

  if (!target) return null;

  return (
    <group position={[target.x, 0, target.y]}>
      {/* 1. Vertical Holographic Laser Beam rooted at the exact ground elevation */}
      <mesh position={[0, centerGroundY + 25, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 50, 16]} />
        <meshBasicMaterial color="#7fa0b5" transparent opacity={0.65} />
      </mesh>

      {/* 2. Top Beacon Holographic Crystal */}
      <mesh position={[0, centerGroundY + 50, 0]}>
        <octahedronGeometry args={[3.2]} />
        <meshStandardMaterial
          color="#7fa0b5"
          emissive="#7fa0b5"
          emissiveIntensity={2.5}
        />
      </mesh>

      {/* 3. Outer Perimeter Outline (neutral, terrain-conforming, occluded by hills) */}
      <lineLoop geometry={lineGeo}>
        <lineBasicMaterial
          color="#8fa3ad"
          linewidth={2}
          depthTest={true}
          depthWrite={false}
          polygonOffset={true}
          polygonOffsetFactor={-8}
          polygonOffsetUnits={-8}
        />
      </lineLoop>

      {/* 4. Conformal Inner Reticle Ring (Cyan Ground Decal) */}
      <mesh geometry={innerRingGeo}>
        <meshBasicMaterial
          color="#7fa0b5"
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
          depthTest={true}
          depthWrite={false}
          polygonOffset={true}
          polygonOffsetFactor={-6}
          polygonOffsetUnits={-6}
        />
      </mesh>

      <lineLoop geometry={innerLineGeo}>
        <lineBasicMaterial
          color="#8fa3ad"
          linewidth={2}
          depthTest={true}
          depthWrite={false}
          polygonOffset={true}
          polygonOffsetFactor={-8}
          polygonOffsetUnits={-8}
        />
      </lineLoop>
    </group>
  );
};
