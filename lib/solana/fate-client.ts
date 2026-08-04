import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

const CONFIG_SEED = Buffer.from("config"); const JACKPOT_SEED = Buffer.from("jackpot"); const JACKPOT_VAULT_SEED = Buffer.from("jackpot-vault");
const COINFLIP_SEED = Buffer.from("coinflip"); const COINFLIP_VAULT_SEED = Buffer.from("coinflip-vault");
const DAILY_SEED = Buffer.from("daily"); const DAILY_VAULT_SEED = Buffer.from("daily-vault"); const RANDOMNESS_RECEIPT_SEED = Buffer.from("randomness-receipt");
const DISCRIMINATORS = {
  enterJackpot: [74,241,109,6,202,151,119,121], createCoinflip: [23,66,225,208,103,207,25,225],
  initializeDailyPlayer: [242,50,30,88,112,28,220,44], openDailyCase: [198,234,60,101,248,143,240,87],
  settleDailyCase: [182,216,21,52,151,70,100,126], cancelDailyTimeout: [192,124,232,93,228,118,128,202],
} as const;
const DAILY_PLAYER_DISCRIMINATOR = Buffer.from([2,123,72,37,246,127,78,33]);
export const DAILY_COOLDOWN_SECONDS = 86_400;
export const DAILY_RANDOMNESS_TIMEOUT_SECONDS = 600;
export type DailyPlayerState = "open" | "randomness_requested" | "settled" | "refunded";
export type DailyPlayerAccount = { player: string; state: DailyPlayerState; lastOpenedAt: number; randomnessRequestedAt: number; randomnessHex: string | null; randomnessAccount: string | null; randomnessSeedSlot: bigint; randomnessRevealSlot: bigint; rewardLamports: bigint };
function u64(value: bigint) { const data = Buffer.alloc(8); data.writeBigUInt64LE(value); return data; }
function i64(value: bigint) { const data = Buffer.alloc(8); data.writeBigInt64LE(value); return data; }
function ix(programId: PublicKey, data: Uint8Array[], keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) { return new TransactionInstruction({ programId, keys, data: Buffer.concat(data.map(Buffer.from)) }); }
export function fateAddresses(program: PublicKey) {
  return { config: PublicKey.findProgramAddressSync([CONFIG_SEED], program)[0], dailyVault: PublicKey.findProgramAddressSync([DAILY_VAULT_SEED], program)[0], jackpot(id: bigint) { const round = PublicKey.findProgramAddressSync([JACKPOT_SEED, u64(id)], program)[0]; return { round, vault: PublicKey.findProgramAddressSync([JACKPOT_VAULT_SEED, round.toBuffer()], program)[0] }; }, coinflip(id: bigint) { const game = PublicKey.findProgramAddressSync([COINFLIP_SEED, u64(id)], program)[0]; return { game, vault: PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, game.toBuffer()], program)[0] }; }, daily(player: PublicKey) { return PublicKey.findProgramAddressSync([DAILY_SEED, player.toBuffer()], program)[0]; }, randomnessReceipt(randomnessAccount: PublicKey) { return PublicKey.findProgramAddressSync([RANDOMNESS_RECEIPT_SEED, randomnessAccount.toBuffer()], program)[0]; } };
}
export function enterJackpotTransaction(input: { programId: string; player: string; roundId: bigint; amountLamports: bigint }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), addresses = fateAddresses(program), game = addresses.jackpot(input.roundId);
  return new Transaction().add(ix(program, [Uint8Array.from(DISCRIMINATORS.enterJackpot), u64(input.amountLamports)], [{pubkey:player,isSigner:true,isWritable:true},{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:game.round,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
}
export function createCoinflipTransaction(input: { programId: string; creator: string; gameId: bigint; side: "Heads"|"Tails"; amountLamports: bigint; expiresAt: bigint }) {
  const program = new PublicKey(input.programId), creator = new PublicKey(input.creator), addresses = fateAddresses(program), game = addresses.coinflip(input.gameId);
  return new Transaction().add(ix(program, [Uint8Array.from(DISCRIMINATORS.createCoinflip),u64(input.gameId),Uint8Array.of(input.side === "Heads" ? 0 : 1),u64(input.amountLamports),i64(input.expiresAt)], [{pubkey:creator,isSigner:true,isWritable:true},{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:game.game,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
}

export function openDailyCaseTransaction(input: { programId: string; player: string; randomnessAccount: string; initializePlayer?: boolean }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), randomness = new PublicKey(input.randomnessAccount), addresses = fateAddresses(program), daily = addresses.daily(player), receipt = addresses.randomnessReceipt(randomness);
  const transaction = new Transaction();
  if (input.initializePlayer) transaction.add(ix(program, [Uint8Array.from(DISCRIMINATORS.initializeDailyPlayer)], [{pubkey:player,isSigner:true,isWritable:true},{pubkey:daily,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
  return transaction.add(ix(program, [Uint8Array.from(DISCRIMINATORS.openDailyCase)], [{pubkey:player,isSigner:true,isWritable:true},{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:daily,isSigner:false,isWritable:true},{pubkey:randomness,isSigner:false,isWritable:false},{pubkey:receipt,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
}

export function settleDailyCaseTransaction(input: { programId: string; player: string; randomnessAccount: string }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), randomness = new PublicKey(input.randomnessAccount), addresses = fateAddresses(program), daily = addresses.daily(player), receipt = addresses.randomnessReceipt(randomness);
  return new Transaction().add(ix(program, [Uint8Array.from(DISCRIMINATORS.settleDailyCase)], [{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:daily,isSigner:false,isWritable:true},{pubkey:randomness,isSigner:false,isWritable:false},{pubkey:receipt,isSigner:false,isWritable:false},{pubkey:player,isSigner:false,isWritable:true},{pubkey:addresses.dailyVault,isSigner:false,isWritable:true}]));
}

export function cancelDailyTimeoutTransaction(input: { programId: string; player: string }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), daily = fateAddresses(program).daily(player);
  return new Transaction().add(ix(program, [Uint8Array.from(DISCRIMINATORS.cancelDailyTimeout)], [{pubkey:player,isSigner:true,isWritable:false},{pubkey:daily,isSigner:false,isWritable:true}]));
}

export function decodeDailyPlayerAccount(bytes: Uint8Array): DailyPlayerAccount {
  const data = Buffer.from(bytes);
  if (data.length < 146 || !data.subarray(0,8).equals(DAILY_PLAYER_DISCRIMINATOR)) throw new Error("Invalid Daily Player account data.");
  let offset = 8;
  const player = new PublicKey(data.subarray(offset,offset+=32)).toBase58();
  const stateValue = data[offset++];
  const states: DailyPlayerState[] = ["open","randomness_requested","settled","refunded"];
  if (!states[stateValue]) throw new Error("Unknown Daily Player state.");
  const lastOpenedAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const randomnessRequestedAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const randomness = data.subarray(offset,offset+=32);
  const randomnessKey = new PublicKey(data.subarray(offset,offset+=32));
  const randomnessSeedSlot = data.readBigUInt64LE(offset); offset += 8;
  const randomnessRevealSlot = data.readBigUInt64LE(offset); offset += 8;
  const rewardLamports = data.readBigUInt64LE(offset);
  return { player, state: states[stateValue], lastOpenedAt, randomnessRequestedAt, randomnessHex: randomness.some(Boolean)?randomness.toString("hex"):null, randomnessAccount: randomnessKey.equals(PublicKey.default)?null:randomnessKey.toBase58(), randomnessSeedSlot, randomnessRevealSlot, rewardLamports };
}

export async function fetchDailyPlayerAccount(input: { rpcUrl: string; programId: string; player: string }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), address = fateAddresses(program).daily(player);
  const account = await new Connection(input.rpcUrl,"confirmed").getAccountInfo(address,"confirmed");
  return account ? decodeDailyPlayerAccount(account.data) : null;
}
export function solToLamports(value: string) { const normalized = value.trim(); if (!/^\d+(\.\d{0,9})?$/.test(normalized)) throw new Error("Enter a valid SOL amount with at most nine decimals."); const [whole,fraction=""] = normalized.split("."); const lamports = BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,"0")); if (lamports<=0n) throw new Error("Amount must be greater than zero."); return lamports; }
