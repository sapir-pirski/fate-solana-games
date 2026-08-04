const publicConfig = {
  solanaCluster: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
  solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  fateProgramId: process.env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim() || null,
  coinflipRandomnessEndpoint: process.env.NEXT_PUBLIC_COINFLIP_RANDOMNESS_ENDPOINT?.trim() || null,
  coinflipRandomnessAccount: process.env.NEXT_PUBLIC_COINFLIP_RANDOMNESS_ACCOUNT?.trim() || null,
  dailyRandomnessEndpoint: process.env.NEXT_PUBLIC_DAILY_RANDOMNESS_ENDPOINT?.trim() || null,
  dailyRandomnessAccount: process.env.NEXT_PUBLIC_DAILY_RANDOMNESS_ACCOUNT?.trim() || null,
} as const;

export function getPublicConfig() {
  return publicConfig;
}

export function requireFateProgramId() {
  if (!publicConfig.fateProgramId) throw new Error("The FATE program address is not configured.");
  return publicConfig.fateProgramId;
}
