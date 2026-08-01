"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { useEffect, type ReactNode } from "react";

export function Mark({ small = false }: { small?: boolean }) {
  return <div className={`mark ${small ? "mark-small" : ""}`}><span>F</span></div>;
}

export function SolIcon() {
  return <span className="sol-icon">◎</span>;
}

export function AnimatedNumber({ value, decimals = 2 }: { value: number; decimals?: number }) {
  const reduceMotion = useReducedMotion();
  const source = useSpring(0, { stiffness: 65, damping: 18, mass: 0.8 });
  const display = useTransform(source, current => current.toFixed(decimals));
  useEffect(() => { source.set(value); }, [source, value]);
  return reduceMotion ? <span>{value.toFixed(decimals)}</span> : <motion.span>{display}</motion.span>;
}

export function Stat({ icon, label, value, accent }: { icon: ReactNode; label: string; value: string; accent?: boolean }) {
  return <div className="stat"><div className={accent ? "stat-icon accent" : "stat-icon"}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div></div>;
}
