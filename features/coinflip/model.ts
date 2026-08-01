export type CoinSide = "Heads" | "Tails";

export function createCoinflipId(random = crypto.getRandomValues(new Uint32Array(2))) {
  return (BigInt(random[0]) << 32n) | BigInt(random[1]);
}
