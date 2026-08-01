"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useCallback, useRef, useState, type ComponentProps, type ReactNode } from "react";

function FrameBudget({ degrade }: { degrade: () => void }) {
  const sample = useRef({ elapsed: 0, frames: 0, strikes: 0 });
  useFrame((_, delta) => {
    sample.current.elapsed += delta;
    sample.current.frames += 1;
    if (sample.current.elapsed < 2) return;
    const fps = sample.current.frames / sample.current.elapsed;
    sample.current.strikes = fps < 42 ? sample.current.strikes + 1 : 0;
    if (sample.current.strikes >= 2) degrade();
    sample.current.elapsed = 0;
    sample.current.frames = 0;
  });
  return null;
}

type CanvasProps = ComponentProps<typeof Canvas> & { children: ReactNode };

export function AdaptiveCanvas({ children, ...props }: CanvasProps) {
  const [quality, setQuality] = useState(() => {
    if (typeof window === "undefined") return 1.25;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    return memory <= 2 || matchMedia("(max-width: 600px)").matches ? 1 : 1.5;
  });
  const degrade = useCallback(() => setQuality(current => Math.max(0.8, current - 0.25)), []);
  return <Canvas {...props} dpr={[0.8, quality]} gl={{ antialias: quality > 1, alpha: true, powerPreference: "high-performance" }}>
    <FrameBudget degrade={degrade}/>
    {children}
  </Canvas>;
}
