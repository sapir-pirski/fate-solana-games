"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { AdditiveBlending, Group, InstancedMesh, Object3D } from "three";
import { AdaptiveCanvas } from "./SceneCanvas";

function Vault({ pot, chance, seconds, active }: { pot:number; chance:number; seconds:number; active:boolean }) {
  const root=useRef<Group>(null); const coins=useRef<InstancedMesh>(null); const ring=useRef<Group>(null);
  const count=Math.min(48,Math.max(12,Math.ceil(pot*2)+12));
  const dummy=useMemo(()=>new Object3D(),[]);
  useEffect(()=>{if(!coins.current)return;for(let i=0;i<count;i++){const angle=i*2.399963;const radius=.25+(i%7)*.18;dummy.position.set(Math.cos(angle)*radius,-1.05+Math.floor(i/12)*.16,Math.sin(angle)*radius);dummy.rotation.set(Math.PI/2,angle,i*.31);dummy.scale.setScalar(.7+(i%3)*.1);dummy.updateMatrix();coins.current.setMatrixAt(i,dummy.matrix)}coins.current.instanceMatrix.needsUpdate=true},[count,dummy]);
  useFrame((state,delta)=>{const t=state.clock.elapsedTime;if(root.current){root.current.rotation.y+=delta*(active?1.05:.18);root.current.rotation.x+=(state.pointer.y*.08-root.current.rotation.x)*Math.min(1,delta*2);const pulse=1+Math.sin(t*(active?8:2))*(active?.025:.008);root.current.scale.setScalar(pulse)}if(ring.current)ring.current.rotation.z-=delta*(.22+chance*.006)});
  return <group ref={root}>
    <mesh>
      <sphereGeometry args={[1.75,48,48]}/>
      <meshPhysicalMaterial color="#101820" metalness={.15} roughness={.08} transmission={.62} thickness={.65} transparent opacity={.52} emissive="#162a20" emissiveIntensity={.35}/>
    </mesh>
    <mesh scale={1.015}>
      <sphereGeometry args={[1.75,24,16]}/><meshBasicMaterial color="#8bff63" wireframe transparent opacity={.14} blending={AdditiveBlending}/>
    </mesh>
    <instancedMesh ref={coins} args={[undefined,undefined,48]} count={count} castShadow>
      <cylinderGeometry args={[.22,.22,.055,20]}/><meshStandardMaterial color="#ffcb57" metalness={.95} roughness={.16} emissive="#7c4a08" emissiveIntensity={.42}/>
    </instancedMesh>
    <group ref={ring}>
      <mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[2.18,.025,12,128,Math.PI*2*Math.max(.04,seconds/30)]}/><meshBasicMaterial color="#8bff63" transparent opacity={.9}/></mesh>
      <mesh rotation={[Math.PI/2,0,0]}><torusGeometry args={[2.32,.008,6,128]}/><meshBasicMaterial color="#55e7ff" transparent opacity={.35}/></mesh>
    </group>
    <pointLight color="#8bff63" intensity={active?42:22} distance={8}/><pointLight position={[-3,2,2]} color="#9945ff" intensity={25}/>
  </group>;
}

export default function JackpotVault3D(props:{pot:number;chance:number;seconds:number;active:boolean}){
  return <div className={`jackpot-vault ${props.active?"is-active":""}`} role="img" aria-label={`Animated jackpot vault holding ${props.pot.toFixed(2)} SOL`}>
    <AdaptiveCanvas camera={{position:[0,.3,6.8],fov:38}}>
      <ambientLight intensity={.55}/><spotLight position={[4,6,5]} intensity={48} angle={.55} penumbra={.8} color="#ffffff"/>
      <Vault {...props}/>
    </AdaptiveCanvas>
    <div className="vault-readout"><span>LIVE POT</span><strong>{props.pot.toFixed(2)} SOL</strong><small>{String(props.seconds).padStart(2,"0")}s TO DRAW</small></div>
  </div>;
}
