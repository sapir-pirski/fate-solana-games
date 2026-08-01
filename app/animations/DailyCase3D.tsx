"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group, Mesh } from "three";

function Case({ opening, opened }: { opening: boolean; opened: boolean }) {
  const group = useRef<Group>(null);
  const lid = useRef<Mesh>(null);
  useFrame((state, delta) => {
    if (!group.current || !lid.current) return;
    const t = state.clock.elapsedTime;
    const shake = opening ? Math.sin(t * 62) * 0.055 : 0;
    group.current.position.x += (shake - group.current.position.x) * Math.min(1, delta * 18);
    group.current.position.y = Math.sin(t * 1.05) * 0.06;
    group.current.rotation.y = Math.sin(t * 0.55) * 0.12;
    const lidTarget = opened ? -1.75 : opening ? -0.18 : 0;
    lid.current.rotation.x += (lidTarget - lid.current.rotation.x) * Math.min(1, delta * 7);
    lid.current.position.y += ((opened ? 1.25 : 0.92) - lid.current.position.y) * Math.min(1, delta * 7);
  });
  return <group ref={group} rotation={[0.08, -0.15, 0]}>
      <mesh castShadow>
        <boxGeometry args={[3.15, 1.65, 1.85, 4, 4, 4]} />
        <meshStandardMaterial color="#18161d" metalness={0.82} roughness={0.26} />
      </mesh>
      <mesh ref={lid} position={[0, 0.92, 0]} castShadow>
        <boxGeometry args={[3.35, 0.38, 2.03, 4, 2, 4]} />
        <meshStandardMaterial color="#2b2732" metalness={0.9} roughness={0.19} />
      </mesh>
      <mesh position={[0, 0.02, 0.94]}>
        <boxGeometry args={[1.3, 0.72, 0.07]} />
        <meshStandardMaterial color="#8b5cf6" emissive="#6f35e7" emissiveIntensity={1.2} metalness={0.55} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.02, 1]}>
        <torusGeometry args={[0.24, 0.075, 16, 40]} />
        <meshStandardMaterial color="#d9ff78" emissive="#a3d52f" emissiveIntensity={1.6} />
      </mesh>
      {(opening || opened) && <pointLight position={[0, 1.25, 0]} intensity={opened ? 55 : 22} distance={6} color="#c8ff4d" />}
  </group>;
}

export default function DailyCase3D({ opening, opened }: { opening: boolean; opened: boolean }) {
  return <div className="webgl-stage case-webgl" role="img" aria-label="Animated 3D daily reward case">
    <Canvas camera={{ position: [0, 1.2, 6], fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
      <ambientLight intensity={0.8} />
      <spotLight position={[4, 6, 5]} intensity={48} angle={0.55} penumbra={0.8} color="#9c71ff" />
      <pointLight position={[-4, -1, 3]} intensity={24} color="#c8ff4d" />
      <Case opening={opening} opened={opened} />
    </Canvas>
  </div>;
}
