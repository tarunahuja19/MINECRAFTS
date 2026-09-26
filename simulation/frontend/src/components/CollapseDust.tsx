import React, { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { sampleBaseGroundY } from "../utils/terrainSampler";

/**
 * One impact dust burst, spawned where a collapse or tilt bowl is triggered.
 *
 * The bowl itself eases open over seconds (Knothe law), which reads as slow
 * slumping; the violence of a roof fall is in the first two seconds — dust
 * thrown out radially, then hanging and settling. This cloud covers that
 * window: ~260 points with outward + upward velocities, gravity, drag, and a
 * linear opacity fade over DUST_LIFE_S. The parent removes the burst after
 * that; `visible=false` past end-of-life is only belt-and-braces.
 *
 * Speeds scale with the trigger's own radius and magnitude, not with constants
 * tuned for one event size: a 150 m bowl throws further than a 40 m one.
 */
export interface ImpactBurst {
  id: number;
  /** Panel-frame metres of the bowl centre the dust belongs to. */
  x: number;
  y: number;
  radiusM: number;
  magM: number;
}

const DUST_LIFE_S = 2.4;
const DUST_COUNT = 260;

const DustCloud: React.FC<{ burst: ImpactBurst }> = ({ burst }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.PointsMaterial>(null);

  const groundY = useMemo(
    () => sampleBaseGroundY(burst.x, burst.y) + 1.5,
    [burst.x, burst.y, burst.id]
  );

  // Per-particle state, allocated once: position buffer (mutated per frame)
  // plus velocity scratch. Directions are radial-out with an upward bias;
  // speeds scale with bowl size so big events throw further.
  const sim = useMemo(() => {
    const pos = new Float32Array(DUST_COUNT * 3);
    const vel = new Float32Array(DUST_COUNT * 3);
    const throwR = Math.max(8, burst.radiusM * 0.75);
    const upBase = 4.0 + Math.min(14.0, burst.magM * 3.0);
    for (let i = 0; i < DUST_COUNT; i++) {
      const a = Math.random() * Math.PI * 2.0;
      const rr = Math.sqrt(Math.random()) * throwR;
      pos[i * 3] = burst.x + Math.cos(a) * rr;
      pos[i * 3 + 1] = groundY + Math.random() * 2.0;
      pos[i * 3 + 2] = burst.y + Math.sin(a) * rr;
      const radial = (0.35 + Math.random() * 0.65) * throwR * 0.55;
      vel[i * 3] = Math.cos(a) * radial;
      vel[i * 3 + 1] = upBase * (0.4 + Math.random() * 0.9);
      vel[i * 3 + 2] = Math.sin(a) * radial;
    }
    return { pos, vel };
  }, [burst, groundY]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(sim.pos, 3));
    return g;
  }, [sim]);

  // A burst's particle state is single-use; release its GPU buffers on removal
  // rather than leaking one cloud per trigger.
  React.useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  // The cloud times itself from its first rendered frame (mount ≈ trigger),
  // keeping everything on the fibre clock's own epoch instead of mixing
  // performance.now() against THREE.Clock's start time.
  const startRef = useRef<number | null>(null);

  useFrame((state, rawDt) => {
    const pts = pointsRef.current;
    const mat = matRef.current;
    if (!pts || !mat) return;
    if (startRef.current === null) startRef.current = state.clock.elapsedTime;
    const age = state.clock.elapsedTime - startRef.current;
    if (age > DUST_LIFE_S) {
      pts.visible = false;
      return;
    }
    pts.visible = true;
    // Clamp the frame step: a backgrounded tab returning with a 5 s delta
    // must not teleport the cloud into orbit.
    const dt = Math.min(rawDt, 0.05);
    const { pos, vel } = sim;
    const drag = Math.max(0.0, 1.0 - 1.4 * dt);
    for (let i = 0; i < DUST_COUNT; i++) {
      vel[i * 3] *= drag;
      vel[i * 3 + 2] *= drag;
      vel[i * 3 + 1] = vel[i * 3 + 1] * drag - 6.5 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // Floor on the ground the burst started from: dust settles, it does
      // not fall through the panel.
      if (pos[i * 3 + 1] < groundY - 1.0) {
        pos[i * 3 + 1] = groundY - 1.0;
        vel[i * 3 + 1] = 0.0;
      }
    }
    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    geometry.computeBoundingSphere();
    mat.opacity = 0.8 * (1.0 - age / DUST_LIFE_S);
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        ref={matRef}
        color="#a5937a"
        size={Math.max(2.0, burst.radiusM * 0.09)}
        sizeAttenuation
        transparent
        opacity={0.8}
        depthWrite={false}
      />
    </points>
  );
};

export const CollapseDust: React.FC<{ bursts: ImpactBurst[] }> = ({ bursts }) => {
  if (bursts.length === 0) return null;
  return (
    <group>
      {bursts.map((b) => (
        <DustCloud key={b.id} burst={b} />
      ))}
    </group>
  );
};
