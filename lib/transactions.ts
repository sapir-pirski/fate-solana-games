export const GAME_ACTIONS = {
  jackpot: new Set(["enter_jackpot"]),
  coinflip: new Set(["create_coinflip", "join_coinflip"]),
  daily: new Set(["open_daily", "settle_daily", "cancel_daily_timeout"]),
} as const;

export type GameType = keyof typeof GAME_ACTIONS;
export type GameAction = "enter_jackpot" | "create_coinflip" | "join_coinflip" | "open_daily" | "settle_daily" | "cancel_daily_timeout";

export function serializeLamports(value: bigint) {
  if (value < 0n) throw new Error("Lamports cannot be negative.");
  return value.toString(10);
}

export function parseLamports(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(parsed);
  } catch {
    return null;
  }
}

export function isValidGameAction(gameType: string, action: string): gameType is GameType {
  return gameType in GAME_ACTIONS && (GAME_ACTIONS[gameType as GameType] as ReadonlySet<string>).has(action);
}
