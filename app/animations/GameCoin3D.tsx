"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group, Mesh } from "three";
import { AdditiveBlending } from "three";
import { AdaptiveCanvas } from "./SceneCanvas";

function Coin({ side, active }: { side:"Heads"|"Tails"; active:boolean }) {
  const coin=useRef<Group>(null); const shockwave=useRef<Mesh>(null); const velocity=useRef(0); const height=useRef(0);
  useEffect(()=>{velocity.current=active?22:13;height.current=active?1.15:.25},[side,active]);
  useFrame((state,delta)=>{if(!coin.current)return;const t=state.clock.elapsedTime;if(velocity.current>.05){coin.current.rotation.x+=velocity.current*delta;coin.current.rotation.y+=velocity.current*delta*.22;velocity.current*=Math.pow(active?.075:.045,delta)}else{const target=side==="Heads"?0:Math.PI;const normalized=coin.current.rotation.x-Math.round((coin.current.rotation.x-target)/(Math.PI*2))*Math.PI*2;coin.current.rotation.x+=(target-normalized)*Math.min(1,delta*8)}height.current+=(0-height.current)*Math.min(1,delta*2.8);coin.current.position.y=height.current+Math.sin(t*1.25)*.08;coin.current.rotation.z=Math.sin(t*.7)*.06;if(shockwave.current){const phase=(t*1.25)%1;shockwave.current.scale.setScalar(.7+phase*2.6);const material=shockwave.current.material as {opacity:number};material.opacity=(1-phase)*.22}});
  return <group>
    <group ref={coin} rotation={[0,.2,0]}>
      <mesh rotation={[Math.PI/2,0,0]} castShadow><cylinderGeometry args={[1.42,1.42,.3,96,2,true]}/><meshStandardMaterial color="#1a1d24" metalness={1} roughness={.16}/></mesh>
      {[.18,-.18].map((z,index)=><group key={z} position={[0,0,z]} rotation={index?[0,Math.PI,0]:undefined}>
        <mesh><circleGeometry args={[1.27,96]}/><meshPhysicalMaterial color={index?"#8bff63":"#9945ff"} metalness={.82} roughness={.13} clearcoat={1} clearcoatRoughness={.08} emissive={index?"#264a0b":"#311064"} emissiveIntensity={.65}/></mesh>
        <mesh position={[0,0,.015]}><torusGeometry args={[.82,.07,20,96]}/><meshStandardMaterial color={index?"#e5ffb5":"#eadfff"} metalness={1} roughness={.12}/></mesh>
        <mesh position={[0,0,.03]} rotation={[0,0,index?Math.PI/4:0]}><octahedronGeometry args={[.38,0]}/><meshStandardMaterial color="#ffffff" metalness={.9} roughness={.1} emissive={index?"#8bff63":"#9945ff"} emissiveIntensity={.35}/></mesh>
      </group>)}
      {[0,1,2].map(index=><mesh key={index} rotation={[Math.PI/2,0,index*.08]}><torusGeometry args={[1.42,.025,8,96]}/><meshBasicMaterial color={index===1?"#55e7ff":"#ffffff"} transparent opacity={.48}/></mesh>)}
    </group>
    <mesh ref={shockwave} position={[0,-1.3,0]} rotation={[Math.PI/2,0,0]}><ringGeometry args={[.75,.79,96]}/><meshBasicMaterial color={side==="Heads"?"#9945ff":"#8bff63"} transparent opacity={.2} blending={AdditiveBlending} depthWrite={false}/></mesh>
  </group>;
}

export default function GameCoin3D({side,active=false}:{side:"Heads"|"Tails";active?:boolean}){
  return <div className={`webgl-stage coin-webgl ${active?"is-flipping":""}`} role="img" aria-label={`Animated metallic coin showing ${side}`}>
    <AdaptiveCanvas camera={{position:[0,.25,6],fov:39}} shadows>
      <ambientLight intensity={.62}/><spotLight position={[4,6,6]} intensity={55} angle={.48} penumbra={.75} color="#ffffff" castShadow/><pointLight position={[-4,-1,3]} intensity={active?38:25} color={side==="Heads"?"#9945ff":"#8bff63"}/>
      <Coin side={side} active={active}/>
    </AdaptiveCanvas>
    <div className="coin-lens-flare"/>
  </div>;
}
