"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";

function Coin({ side }: { side: "Heads" | "Tails" }) {
  const coin = useRef<Group>(null);
  const velocity = useRef(0);
  useEffect(() => { velocity.current = 13; }, [side]);
  useFrame((state, delta) => {
    if (!coin.current) return;
    if (velocity.current > 0.06) {
      coin.current.rotation.x += velocity.current * delta;
      velocity.current *= Math.pow(0.045, delta);
    } else {
      const target = side === "Heads" ? 0 : Math.PI;
      const current = coin.current.rotation.x;
      const normalized = current - Math.round((current - target) / (Math.PI * 2)) * Math.PI * 2;
      coin.current.rotation.x += (target - normalized) * Math.min(1, delta * 7);
    }
    coin.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.8) * 0.08;
    coin.current.position.y = Math.sin(state.clock.elapsedTime * 1.15) * 0.12;
  });
  return <group ref={coin} rotation={[0, 0.2, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[1.35, 1.35, 0.28, 64]} />
        <meshStandardMaterial color="#29252f" metalness={0.95} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0, 0.16]}>
        <circleGeometry args={[1.18, 64]} />
        <meshStandardMaterial color="#7545dc" metalness={0.72} roughness={0.2} emissive="#2e1267" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.18]}>
        <torusGeometry args={[0.73, 0.08, 20, 64]} />
        <meshStandardMaterial color="#d8c7ff" metalness={1} roughness={0.16} />
      </mesh>
      <mesh position={[0, 0, -0.16]} rotation={[0, Math.PI, 0]}>
        <circleGeometry args={[1.18, 64]} />
        <meshStandardMaterial color="#9fc82f" metalness={0.7} roughness={0.22} emissive="#344707" emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0, 0, -0.18]} rotation={[0, Math.PI, 0]}>
        <torusGeometry args={[0.58, 0.23, 28, 64]} />
        <meshStandardMaterial color="#e5ff9e" metalness={0.75} roughness={0.19} />
      </mesh>
  </group>;
}

export default function GameCoin3D({ side }: { side: "Heads" | "Tails" }) {
  return <div className="webgl-stage" role="img" aria-label={`Animated 3D coin showing ${side}`}>
    <Canvas camera={{ position: [0, 0, 5.8], fov: 40 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
      <ambientLight intensity={0.7} />
      <spotLight position={[4, 5, 6]} intensity={45} angle={0.5} penumbra={0.7} color="#c8ff4d" />
      <pointLight position={[-4, -2, 4]} intensity={26} color="#8b5cf6" />
      <Coin side={side} />
    </Canvas>
  </div>;
}
