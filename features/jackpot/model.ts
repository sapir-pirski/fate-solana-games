export function jackpotChance(entrySol: number, potSol: number) {
  if (!Number.isFinite(entrySol) || entrySol <= 0) return 0;
  return Math.min(100, (entrySol / (Math.max(0, potSol) + entrySol)) * 100);
}
