import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

const CONFIG_SEED = Buffer.from("config"); const JACKPOT_SEED = Buffer.from("jackpot"); const JACKPOT_VAULT_SEED = Buffer.from("jackpot-vault");
const COINFLIP_SEED = Buffer.from("coinflip"); const COINFLIP_VAULT_SEED = Buffer.from("coinflip-vault");
const DISCRIMINATORS = {
  enterJackpot: [74,241,109,6,202,151,119,121], createCoinflip: [23,66,225,208,103,207,25,225],
} as const;
function u64(value: bigint) { const data = Buffer.alloc(8); data.writeBigUInt64LE(value); return data; }
function i64(value: bigint) { const data = Buffer.alloc(8); data.writeBigInt64LE(value); return data; }
function ix(programId: PublicKey, data: Uint8Array[], keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[]) { return new TransactionInstruction({ programId, keys, data: Buffer.concat(data.map(Buffer.from)) }); }
export function fateAddresses(program: PublicKey) {
  return { config: PublicKey.findProgramAddressSync([CONFIG_SEED], program)[0], jackpot(id: bigint) { const round = PublicKey.findProgramAddressSync([JACKPOT_SEED, u64(id)], program)[0]; return { round, vault: PublicKey.findProgramAddressSync([JACKPOT_VAULT_SEED, round.toBuffer()], program)[0] }; }, coinflip(id: bigint) { const game = PublicKey.findProgramAddressSync([COINFLIP_SEED, u64(id)], program)[0]; return { game, vault: PublicKey.findProgramAddressSync([COINFLIP_VAULT_SEED, game.toBuffer()], program)[0] }; } };
}
export function enterJackpotTransaction(input: { programId: string; player: string; roundId: bigint; amountLamports: bigint }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), addresses = fateAddresses(program), game = addresses.jackpot(input.roundId);
  return new Transaction().add(ix(program, [Uint8Array.from(DISCRIMINATORS.enterJackpot), u64(input.amountLamports)], [{pubkey:player,isSigner:true,isWritable:true},{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:game.round,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
}
export function createCoinflipTransaction(input: { programId: string; creator: string; gameId: bigint; side: "Heads"|"Tails"; amountLamports: bigint; expiresAt: bigint }) {
  const program = new PublicKey(input.programId), creator = new PublicKey(input.creator), addresses = fateAddresses(program), game = addresses.coinflip(input.gameId);
  return new Transaction().add(ix(program, [Uint8Array.from(DISCRIMINATORS.createCoinflip),u64(input.gameId),Uint8Array.of(input.side === "Heads" ? 0 : 1),u64(input.amountLamports),i64(input.expiresAt)], [{pubkey:creator,isSigner:true,isWritable:true},{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:game.game,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
}
export function solToLamports(value: string) { const normalized = value.trim(); if (!/^\d+(\.\d{0,9})?$/.test(normalized)) throw new Error("Enter a valid SOL amount with at most nine decimals."); const [whole,fraction=""] = normalized.split("."); const lamports = BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,"0")); if (lamports<=0n) throw new Error("Amount must be greater than zero."); return lamports; }
