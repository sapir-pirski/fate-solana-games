import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";

const CONFIG_SEED = Buffer.from("config"); const JACKPOT_SEED = Buffer.from("jackpot"); const JACKPOT_VAULT_SEED = Buffer.from("jackpot-vault");
const COINFLIP_SEED = Buffer.from("coinflip"); const COINFLIP_VAULT_SEED = Buffer.from("coinflip-vault");
const DAILY_SEED = Buffer.from("daily"); const DAILY_VAULT_SEED = Buffer.from("daily-vault"); const RANDOMNESS_RECEIPT_SEED = Buffer.from("randomness-use");
const DISCRIMINATORS = {
  enterJackpot: [74,241,109,6,202,151,119,121], createCoinflip: [23,66,225,208,103,207,25,225],
  joinCoinflip: [79,207,215,111,215,83,146,56], settleCoinflip: [69,57,200,136,7,34,236,112],
  cancelCoinflip: [1,62,100,241,181,60,206,52], refundCoinflipTimeout: [89,126,38,216,97,114,134,164],
  initializeDailyPlayer: [242,50,30,88,112,28,220,44], openDailyCase: [198,234,60,101,248,143,240,87],
  settleDailyCase: [182,216,21,52,151,70,100,126], cancelDailyTimeout: [192,124,232,93,228,118,128,202],
} as const;
const DAILY_PLAYER_DISCRIMINATOR = Buffer.from([2,123,72,37,246,127,78,33]);
const COINFLIP_GAME_DISCRIMINATOR = Buffer.from([103,119,176,171,170,204,73,25]);
const CONFIG_DISCRIMINATOR = Buffer.from([155,12,170,224,30,250,204,130]);
export const DAILY_COOLDOWN_SECONDS = 86_400;
export const DAILY_RANDOMNESS_TIMEOUT_SECONDS = 600;
export const COINFLIP_RANDOMNESS_TIMEOUT_SECONDS = 600;
export type DailyPlayerState = "open" | "randomness_requested" | "settled" | "refunded";
export type DailyPlayerAccount = { player: string; state: DailyPlayerState; lastOpenedAt: number; randomnessRequestedAt: number; randomnessHex: string | null; randomnessAccount: string | null; randomnessSeedSlot: bigint; randomnessRevealSlot: bigint; rewardLamports: bigint };
export type CoinflipGameAccount = { address: string; id: bigint; creator: string; joiner: string | null; creatorSide: "Heads"|"Tails"; amountLamports: bigint; state: DailyPlayerState; expiresAt: number; randomnessRequestedAt: number; randomnessHex: string | null; randomnessAccount: string | null; randomnessSeedSlot: bigint; randomnessRevealSlot: bigint; winner: string | null };
export type FateWagerConfig = { feeBps: number; minWagerLamports: bigint; maxWagerLamports: bigint };
export function usableJackpotLamports(input:{walletLamports:bigint;estimatedFeeLamports:bigint;safetyReserveLamports:bigint;programMaxLamports:bigint;dailyRemainingLamports?:bigint|null;weeklyRemainingLamports?:bigint|null}){let maximum=input.walletLamports-input.estimatedFeeLamports-input.safetyReserveLamports;if(maximum<0n)maximum=0n;for(const limit of [input.programMaxLamports,input.dailyRemainingLamports,input.weeklyRemainingLamports])if(limit!==null&&limit!==undefined&&maximum>limit)maximum=limit;return maximum;}
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

export function joinCoinflipTransaction(input: { programId: string; joiner: string; gameId: bigint; randomnessAccount: string }) {
  const program = new PublicKey(input.programId), joiner = new PublicKey(input.joiner), randomness = new PublicKey(input.randomnessAccount), addresses = fateAddresses(program), game = addresses.coinflip(input.gameId), receipt = addresses.randomnessReceipt(randomness);
  return new Transaction().add(ix(program,[Uint8Array.from(DISCRIMINATORS.joinCoinflip)],[{pubkey:joiner,isSigner:true,isWritable:true},{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:game.game,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:randomness,isSigner:false,isWritable:false},{pubkey:receipt,isSigner:false,isWritable:true},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]));
}

export function settleCoinflipTransaction(input: { programId: string; gameId: bigint; randomnessAccount: string; winner: string; treasury: string }) {
  const program = new PublicKey(input.programId), randomness = new PublicKey(input.randomnessAccount), addresses = fateAddresses(program), game = addresses.coinflip(input.gameId), receipt = addresses.randomnessReceipt(randomness);
  return new Transaction().add(ix(program,[Uint8Array.from(DISCRIMINATORS.settleCoinflip)],[{pubkey:addresses.config,isSigner:false,isWritable:false},{pubkey:game.game,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:randomness,isSigner:false,isWritable:false},{pubkey:receipt,isSigner:false,isWritable:false},{pubkey:new PublicKey(input.winner),isSigner:false,isWritable:true},{pubkey:new PublicKey(input.treasury),isSigner:false,isWritable:true}]));
}

export function cancelCoinflipTransaction(input: { programId: string; creator: string; gameId: bigint }) {
  const program = new PublicKey(input.programId), addresses = fateAddresses(program), game = addresses.coinflip(input.gameId);
  return new Transaction().add(ix(program,[Uint8Array.from(DISCRIMINATORS.cancelCoinflip)],[{pubkey:new PublicKey(input.creator),isSigner:true,isWritable:true},{pubkey:game.game,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true}]));
}

export function refundCoinflipTimeoutTransaction(input: { programId: string; gameId: bigint; creator: string; joiner: string }) {
  const program = new PublicKey(input.programId), addresses = fateAddresses(program), game = addresses.coinflip(input.gameId);
  return new Transaction().add(ix(program,[Uint8Array.from(DISCRIMINATORS.refundCoinflipTimeout)],[{pubkey:game.game,isSigner:false,isWritable:true},{pubkey:game.vault,isSigner:false,isWritable:true},{pubkey:new PublicKey(input.creator),isSigner:false,isWritable:true},{pubkey:new PublicKey(input.joiner),isSigner:false,isWritable:true}]));
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

export function decodeCoinflipGameAccount(bytes: Uint8Array, address = PublicKey.default.toBase58()): CoinflipGameAccount {
  const data=Buffer.from(bytes);
  if(data.length<219||!data.subarray(0,8).equals(COINFLIP_GAME_DISCRIMINATOR))throw new Error("Invalid Coinflip Game account data.");
  let offset=8;const id=data.readBigUInt64LE(offset);offset+=8;const creator=new PublicKey(data.subarray(offset,offset+=32)).toBase58();const joinerKey=new PublicKey(data.subarray(offset,offset+=32));const creatorSide=data[offset++]===0?"Heads":"Tails";const amountLamports=data.readBigUInt64LE(offset);offset+=8;const stateValue=data[offset++];const states:DailyPlayerState[]=["open","randomness_requested","settled","refunded"];if(!states[stateValue])throw new Error("Unknown Coinflip state.");const expiresAt=Number(data.readBigInt64LE(offset));offset+=8;const randomnessRequestedAt=Number(data.readBigInt64LE(offset));offset+=8;const randomness=data.subarray(offset,offset+=32);const randomnessKey=new PublicKey(data.subarray(offset,offset+=32));const randomnessSeedSlot=data.readBigUInt64LE(offset);offset+=8;const randomnessRevealSlot=data.readBigUInt64LE(offset);offset+=8;const winnerKey=new PublicKey(data.subarray(offset,offset+=32));
  return{address,id,creator,joiner:joinerKey.equals(PublicKey.default)?null:joinerKey.toBase58(),creatorSide,amountLamports,state:states[stateValue],expiresAt,randomnessRequestedAt,randomnessHex:randomness.some(Boolean)?randomness.toString("hex"):null,randomnessAccount:randomnessKey.equals(PublicKey.default)?null:randomnessKey.toBase58(),randomnessSeedSlot,randomnessRevealSlot,winner:winnerKey.equals(PublicKey.default)?null:winnerKey.toBase58()};
}

export async function fetchCoinflipGameAccount(input:{rpcUrl:string;gameAddress:string}){
  const address=new PublicKey(input.gameAddress);const account=await new Connection(input.rpcUrl,"confirmed").getAccountInfo(address,"confirmed");return account?decodeCoinflipGameAccount(account.data,address.toBase58()):null;
}

export async function fetchCoinflipSettlementContext(input:{rpcUrl:string;programId:string;gameAddress:string}){
  const connection=new Connection(input.rpcUrl,"confirmed"),program=new PublicKey(input.programId),gameAddress=new PublicKey(input.gameAddress),configAddress=fateAddresses(program).config;
  const gameInfo=await connection.getAccountInfo(gameAddress,"confirmed");if(!gameInfo)throw new Error("The Coinflip account no longer exists.");const game=decodeCoinflipGameAccount(gameInfo.data,gameAddress.toBase58());if(game.state!=="randomness_requested"||!game.randomnessAccount||!game.joiner)throw new Error("This Coinflip is not awaiting settlement.");
  const [randomnessInfo,configInfo]=await Promise.all([connection.getAccountInfo(new PublicKey(game.randomnessAccount),"confirmed"),connection.getAccountInfo(configAddress,"confirmed")]);if(!randomnessInfo||randomnessInfo.data.length<184)throw new Error("The committed randomness account is unavailable.");if(!configInfo||configInfo.data.length<248||!Buffer.from(configInfo.data).subarray(0,8).equals(CONFIG_DISCRIMINATOR))throw new Error("The FATE configuration account is unavailable.");
  const revealSlot=Buffer.from(randomnessInfo.data).readBigUInt64LE(144);if(revealSlot<=game.randomnessSeedSlot)throw new Error("The oracle has not revealed this Coinflip yet.");const landed=randomnessInfo.data[152]&1;const winner=landed===(game.creatorSide==="Heads"?0:1)?game.creator:game.joiner;const treasury=new PublicKey(Buffer.from(configInfo.data).subarray(216,248)).toBase58();return{game,winner,treasury};
}

export async function fetchFateWagerConfig(input:{rpcUrl:string;programId:string}):Promise<FateWagerConfig>{
  const program=new PublicKey(input.programId),account=await new Connection(input.rpcUrl,"confirmed").getAccountInfo(fateAddresses(program).config,"confirmed");if(!account)throw new Error("The FATE wager configuration is unavailable.");return decodeFateWagerConfig(account.data);
}
export function decodeFateWagerConfig(bytes:Uint8Array):FateWagerConfig{const data=Buffer.from(bytes);if(data.length<390||!data.subarray(0,8).equals(CONFIG_DISCRIMINATOR))throw new Error("The FATE configuration account is invalid.");return{feeBps:data.readUInt16LE(344),minWagerLamports:data.readBigUInt64LE(348),maxWagerLamports:data.readBigUInt64LE(356)};}

export async function fetchDailyPlayerAccount(input: { rpcUrl: string; programId: string; player: string }) {
  const program = new PublicKey(input.programId), player = new PublicKey(input.player), address = fateAddresses(program).daily(player);
  const account = await new Connection(input.rpcUrl,"confirmed").getAccountInfo(address,"confirmed");
  return account ? decodeDailyPlayerAccount(account.data) : null;
}
export function solToLamports(value: string) { const normalized = value.trim(); if (!/^\d+(\.\d{0,9})?$/.test(normalized)) throw new Error("Enter a valid SOL amount with at most nine decimals."); const [whole,fraction=""] = normalized.split("."); const lamports = BigInt(whole)*1_000_000_000n+BigInt(fraction.padEnd(9,"0")); if (lamports<=0n) throw new Error("Amount must be greater than zero."); return lamports; }
