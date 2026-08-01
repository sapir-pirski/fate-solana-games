"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, Points } from "three";
import { AdaptiveCanvas } from "./SceneCanvas";

function Space({ accent }: { accent: string }) {
  const group = useRef<Group>(null);
  const points = useRef<Points>(null);
  const geometry = useMemo(() => {
    const values = new Float32Array(135 * 3);
    for (let i = 0; i < 135; i++) {
      const angle = i * 2.399963;
      const radius = 4 + (i % 17) * .42;
      values[i * 3] = Math.cos(angle) * radius;
      values[i * 3 + 1] = ((i * 37) % 100) / 7 - 7;
      values[i * 3 + 2] = -2 - (i % 11) * 1.4;
    }
    const output = new BufferGeometry();
    output.setAttribute("position", new BufferAttribute(values, 3));
    return output;
  }, []);
  useFrame((state, delta) => {
    if (group.current) {
      group.current.rotation.y += (state.pointer.x * .08 - group.current.rotation.y) * Math.min(1, delta * 1.5);
      group.current.rotation.x += (-state.pointer.y * .045 - group.current.rotation.x) * Math.min(1, delta * 1.5);
    }
    if (points.current) points.current.rotation.z += delta * .008;
  });
  return <group ref={group}>
    <points ref={points} geometry={geometry}>
      <pointsMaterial size={.055} color={accent} transparent opacity={.72} depthWrite={false} blending={AdditiveBlending}/>
    </points>
    {[0,1,2,3].map(index => <mesh key={index} position={[0,-4.8,-4-index*2]} rotation={[Math.PI/2,0,index*.16]}>
      <torusGeometry args={[4.5+index*1.8,.007,4,120]}/>
      <meshBasicMaterial color={index%2 ? "#55e7ff" : accent} transparent opacity={.11-index*.015}/>
    </mesh>)}
    <mesh position={[0,2,-9]} scale={[8,3,1]}>
      <planeGeometry args={[1,1,16,8]}/>
      <meshBasicMaterial color={new Color(accent)} transparent opacity={.035} depthWrite={false}/>
    </mesh>
  </group>;
}

export default function SpatialBackground3D({ accent }: { accent: string }) {
  return <div className="spatial-background" aria-hidden="true">
    <AdaptiveCanvas camera={{position:[0,0,7],fov:52}} frameloop="always">
      <Space accent={accent}/>
    </AdaptiveCanvas>
    <div className="spatial-aurora"/>
    <div className="spatial-grid"/>
  </div>;
}
