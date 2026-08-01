import { Connection, PublicKey } from "@solana/web3.js";

export type GameKind = "jackpot" | "coinflip" | "daily";
export type FairnessResult = {
  verified: boolean;
  checks: { label: string; ok: boolean; detail: string }[];
  game: string;
  gameKind: GameKind;
  randomnessAccount?: string;
  seedSlot?: string;
  revealSlot?: string;
  randomnessHex?: string;
  expectedOutcome?: string;
  recordedOutcome?: string;
  gameSignature?: string;
  randomnessSignature?: string;
};

const OFFSETS = {
  jackpot: { state: 48, randomness: 73, account: 105, seed: 137, reveal: 145, winner: 153 },
  coinflip: { creator: 16, joiner: 48, side: 80, state: 89, randomness: 106, account: 138, seed: 170, reveal: 178, winner: 186 },
  daily: { player: 8, state: 40, randomness: 57, account: 89, seed: 121, reveal: 129, reward: 137 },
} as const;
const GAME_DISCRIMINATORS: Record<GameKind, number[]> = {
  jackpot: [19, 135, 98, 129, 147, 40, 135, 21],
  coinflip: [103, 119, 176, 171, 170, 204, 73, 25],
  daily: [2, 123, 72, 37, 246, 127, 78, 33],
};
const RANDOMNESS_DISCRIMINATOR = [10, 66, 229, 135, 220, 239, 217, 114];

function u64(data: Uint8Array, offset: number) {
  return new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true);
}

function key(data: Uint8Array, offset: number) {
  return new PublicKey(data.slice(offset, offset + 32)).toBase58();
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function dailyReward(byte: number) {
  if (byte <= 1) return 1_000_000_000n;
  if (byte <= 11) return 250_000_000n;
  if (byte <= 51) return 100_000_000n;
  if (byte <= 151) return 50_000_000n;
  return 10_000_000n;
}

export function weightedWinner(entries: { player: string; amount: bigint }[], randomness: Uint8Array) {
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0n);
  if (total === 0n) throw new Error("Jackpot contains no wagered lamports.");
  const random = u64(randomness, 0) % total;
  let cumulative = 0n;
  for (const entry of entries) {
    cumulative += entry.amount;
    if (random < cumulative) return entry.player;
  }
  throw new Error("The stored jackpot entries are inconsistent with the total.");
}

function decodeGame(kind: GameKind, data: Uint8Array) {
  const layout = OFFSETS[kind];
  if (!sameBytes(data.slice(0, 8), Uint8Array.from(GAME_DISCRIMINATORS[kind]))) throw new Error(`Account is not a FATE ${kind} account.`);
  const randomness = data.slice(layout.randomness, layout.randomness + 32);
  const randomnessAccount = key(data, layout.account);
  const seedSlot = u64(data, layout.seed);
  const revealSlot = u64(data, layout.reveal);
  if (kind === "coinflip") {
    const creator = key(data, OFFSETS.coinflip.creator);
    const joiner = key(data, OFFSETS.coinflip.joiner);
    const recorded = key(data, OFFSETS.coinflip.winner);
    const expected = randomness[0] % 2 === data[OFFSETS.coinflip.side] ? creator : joiner;
    return { state: data[layout.state], randomness, randomnessAccount, seedSlot, revealSlot, expected, recorded };
  }
  if (kind === "daily") {
    const recorded = u64(data, OFFSETS.daily.reward);
    const expected = dailyReward(randomness[0]);
    return { state: data[layout.state], randomness, randomnessAccount, seedSlot, revealSlot, expected: `${expected} lamports`, recorded: `${recorded} lamports` };
  }
  const entryCount = new DataView(data.buffer, data.byteOffset + 185, 4).getUint32(0, true);
  const entries = Array.from({ length: entryCount }, (_, index) => {
    const offset = 189 + index * 40;
    return { player: key(data, offset), amount: u64(data, offset + 32) };
  });
  return {
    state: data[layout.state], randomness,
    randomnessAccount,
    seedSlot,
    revealSlot,
    expected: weightedWinner(entries, randomness),
    recorded: key(data, OFFSETS.jackpot.winner),
  };
}

function decodeProvider(data: Uint8Array) {
  if (data.length < 184) throw new Error("Randomness provider account is too small.");
  if (!sameBytes(data.slice(0, 8), Uint8Array.from(RANDOMNESS_DISCRIMINATOR))) throw new Error("Provider account has an invalid randomness discriminator.");
  return {
    queue: key(data, 40),
    seedSlot: u64(data, 104),
    revealSlot: u64(data, 144),
    value: data.slice(152, 184),
  };
}

export async function verifyGameFairness(input: {
  rpcUrl: string;
  programId: string;
  providerProgramId: string;
  providerQueue: string;
  gameAddress: string;
  gameKind: GameKind;
}): Promise<FairnessResult> {
  const connection = new Connection(input.rpcUrl, "confirmed");
  const gameKey = new PublicKey(input.gameAddress);
  const [gameInfo, gameSignatures] = await Promise.all([
    connection.getAccountInfo(gameKey, "confirmed"),
    connection.getSignaturesForAddress(gameKey, { limit: 1 }, "confirmed"),
  ]);
  if (!gameInfo) throw new Error("Game account was not found on this Solana cluster.");
  const game = decodeGame(input.gameKind, gameInfo.data);
  const randomnessKey = new PublicKey(game.randomnessAccount);
  const [providerInfo, providerSignatures] = await Promise.all([
    connection.getAccountInfo(randomnessKey, "confirmed"),
    connection.getSignaturesForAddress(randomnessKey, { limit: 1 }, "confirmed"),
  ]);
  if (!providerInfo) throw new Error("Committed randomness account was not found.");
  const provider = decodeProvider(providerInfo.data);
  const checks = [
    { label: "Game program owner", ok: gameInfo.owner.equals(new PublicKey(input.programId)), detail: gameInfo.owner.toBase58() },
    { label: "Randomness provider owner", ok: providerInfo.owner.equals(new PublicKey(input.providerProgramId)), detail: providerInfo.owner.toBase58() },
    { label: "Configured oracle queue", ok: provider.queue === input.providerQueue, detail: provider.queue },
    { label: "Game is settled", ok: game.state === 2, detail: game.state === 2 ? "Settled" : `State ${game.state}` },
    { label: "Committed seed slot", ok: provider.seedSlot === game.seedSlot, detail: game.seedSlot.toString() },
    { label: "Fresh reveal slot", ok: provider.revealSlot === game.revealSlot && game.revealSlot > game.seedSlot, detail: game.revealSlot.toString() },
    { label: "Random bytes match", ok: sameBytes(provider.value, game.randomness), detail: hex(game.randomness) },
    { label: "Outcome reproduced", ok: game.expected === game.recorded, detail: String(game.expected) },
  ];
  return {
    verified: checks.every(check => check.ok), checks,
    game: gameKey.toBase58(), gameKind: input.gameKind,
    randomnessAccount: randomnessKey.toBase58(), seedSlot: game.seedSlot.toString(), revealSlot: game.revealSlot.toString(),
    randomnessHex: hex(game.randomness), expectedOutcome: String(game.expected), recordedOutcome: String(game.recorded),
    gameSignature: gameSignatures[0]?.signature, randomnessSignature: providerSignatures[0]?.signature,
  };
}
