import React, { useRef, useEffect, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface SeismicWaveOverlayProps {
  active: boolean;
  originX?: number;
  originY?: number;
}

export const SeismicWaveOverlay: React.FC<SeismicWaveOverlayProps> = ({
  active,
  originX = 0,
  originY = 0,
}) => {
  const [radius, setRadius] = useState<number>(0);
  const [opacity, setOpacity] = useState<number>(0);
  const isAnimatingRef = useRef<boolean>(false);
  const radiusRef = useRef<number>(0);

  useEffect(() => {
    if (active) {
      isAnimatingRef.current = true;
      radiusRef.current = 5;
      setRadius(5);
      setOpacity(0.9);
    }
  }, [active]);

  useFrame((_, delta) => {
    if (isAnimatingRef.current) {
      radiusRef.current += delta * 240.0; // Expanding wave velocity (240 m/s)
      setRadius(radiusRef.current);

      const remainingOpacity = Math.max(0, 1.0 - radiusRef.current / 380.0);
      setOpacity(remainingOpacity);

      if (radiusRef.current > 380.0) {
        isAnimatingRef.current = false;
        setOpacity(0);
      }
    }
  });

  if (opacity <= 0.01) return null;

  return (
    <group position={[originX, 1.5, originY]}>
      {/* 1. Primary P-Wave Front Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(0.1, radius - 3.5), radius, 64]} />
        <meshBasicMaterial
          color="#8fa3ad"
          transparent
          opacity={opacity * 0.85}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 2. Secondary S-Wave Ripple Ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.2, 0]}>
        <ringGeometry args={[Math.max(0.1, radius * 0.7 - 2.5), radius * 0.7, 64]} />
        <meshBasicMaterial
          color="#d9a25f"
          transparent
          opacity={opacity * 0.55}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 3. Epicenter Flash Disk */}
      {radius < 60 && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
          <circleGeometry args={[Math.max(1, 25 - radius * 0.4), 32]} />
          <meshBasicMaterial
            color="#c2603f"
            transparent
            opacity={opacity * 0.7}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
};
