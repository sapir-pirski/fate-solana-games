"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Group, Mesh, Points } from "three";
import { AdaptiveCanvas } from "./SceneCanvas";

function Case({opening,opened}:{opening:boolean;opened:boolean}){
  const group=useRef<Group>(null),lid=useRef<Group>(null),token=useRef<Mesh>(null),particles=useRef<Points>(null);
  const particleGeometry=useMemo(()=>{const values=new Float32Array(42*3);for(let i=0;i<42;i++){const angle=i*2.399;const radius=.2+(i%9)*.18;values[i*3]=Math.cos(angle)*radius;values[i*3+1]=(i%7)*.18;values[i*3+2]=Math.sin(angle)*radius}const geometry=new BufferGeometry();geometry.setAttribute("position",new BufferAttribute(values,3));return geometry},[]);
  useFrame((state,delta)=>{if(!group.current||!lid.current)return;const t=state.clock.elapsedTime;const shake=opening?Math.sin(t*58)*.052:0;group.current.position.x+=(shake-group.current.position.x)*Math.min(1,delta*20);group.current.position.y=Math.sin(t)*.05;group.current.rotation.y=Math.sin(t*.45)*.1;const target=opened?-1.72:opening?-.3:0;lid.current.rotation.x+=(target-lid.current.rotation.x)*Math.min(1,delta*6);if(token.current){token.current.rotation.y+=delta*1.8;const targetY=opened?1.65:.15;token.current.position.y+=(targetY-token.current.position.y)*Math.min(1,delta*3)}if(particles.current)particles.current.rotation.y+=delta*.45});
  return <group ref={group} rotation={[.08,-.14,0]}>
    <mesh castShadow><boxGeometry args={[3.2,1.7,1.9,5,3,4]}/><meshPhysicalMaterial color="#10131a" metalness={.9} roughness={.2} clearcoat={1}/></mesh>
    <group ref={lid} position={[0,1.02,-.88]}>
      <mesh position={[0,0,.88]} castShadow><boxGeometry args={[3.4,.38,2.06,5,2,4]}/><meshPhysicalMaterial color="#232733" metalness={.92} roughness={.16} clearcoat={1}/></mesh>
      <mesh position={[0,.21,.88]}><boxGeometry args={[2.4,.025,1.15]}/><meshBasicMaterial color="#9945ff" transparent opacity={.65}/></mesh>
    </group>
    <mesh position={[0,.03,.97]}><boxGeometry args={[1.35,.72,.06]}/><meshStandardMaterial color="#151b22" metalness={.85} roughness={.22} emissive="#33106c" emissiveIntensity={.8}/></mesh>
    <mesh position={[0,.03,1.02]}><torusGeometry args={[.25,.07,20,48]}/><meshStandardMaterial color="#cfff69" emissive="#8bff63" emissiveIntensity={1.5}/></mesh>
    <mesh ref={token} position={[0,.15,0]} visible={opening||opened} rotation={[Math.PI/2,0,0]}><cylinderGeometry args={[.52,.52,.11,48]}/><meshStandardMaterial color="#ffcb57" metalness={1} roughness={.13} emissive="#7c4a08" emissiveIntensity={.7}/></mesh>
    <points ref={particles} geometry={particleGeometry} position={[0,.65,0]} visible={opening||opened}><pointsMaterial size={.085} color={opened?"#ffcb57":"#8bff63"} transparent opacity={.86} blending={AdditiveBlending} depthWrite={false}/></points>
    {(opening||opened)&&<pointLight position={[0,1.25,0]} intensity={opened?65:32} distance={7} color={opened?"#ffcb57":"#8bff63"}/>}<pointLight position={[-3,2,3]} intensity={24} color="#9945ff"/>
  </group>;
}

export default function DailyCase3D({opening,opened}:{opening:boolean;opened:boolean}){
  return <div className={`webgl-stage case-webgl ${opening?"is-opening":""} ${opened?"is-opened":""}`} role="img" aria-label="Animated mechanical daily reward case">
    <AdaptiveCanvas camera={{position:[0,1.3,6.2],fov:40}} shadows>
      <ambientLight intensity={.7}/><spotLight position={[4,6,5]} intensity={52} angle={.52} penumbra={.8} color="#ffffff" castShadow/><Case opening={opening} opened={opened}/>
    </AdaptiveCanvas><div className="case-beam"/><div className="case-flare"/>
  </div>;
}
