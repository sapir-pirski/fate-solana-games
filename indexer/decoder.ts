import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export type DecodedEvent = { name: string; payload: Record<string, unknown>; rawBase64: string; instructionIndex: number; eventIndex: number };
const names = ["JackpotCreated","JackpotEntered","CoinflipCreated","CoinflipJoined","RandomnessRequested","GameSettled","GameRefunded","JackpotRefundsEnabled","DailyCaseSettled","DailyCaseTimedOut","GameAccountsClosed"];
const discriminators = new Map(names.map(name => [createHash("sha256").update(`event:${name}`).digest().subarray(0, 8).toString("hex"), name]));
const gameTypes = ["jackpot", "coinflip", "daily"];
class Reader {
  offset = 8;
  readonly data: Buffer;
  constructor(data: Buffer) { this.data = data; }
  key() { const value = new PublicKey(this.data.subarray(this.offset, this.offset += 32)).toBase58(); return value; }
  u8() { return this.data[this.offset++]; }
  u16() { const value = this.data.readUInt16LE(this.offset); this.offset += 2; return value; }
  u64() { const value = this.data.readBigUInt64LE(this.offset); this.offset += 8; return value.toString(); }
  i64() { const value = this.data.readBigInt64LE(this.offset); this.offset += 8; return value.toString(); }
  bytes32() { const value = this.data.subarray(this.offset, this.offset += 32).toString("hex"); return value; }
}
function decode(name: string, data: Buffer): Record<string, unknown> {
  const r = new Reader(data);
  if (name === "JackpotCreated") return { game: r.key(), numericId: r.u64(), expiresAt: r.i64(), gameType: "jackpot", state: "open" };
  if (name === "JackpotEntered") return { game: r.key(), player: r.key(), amount: r.u64(), total: r.u64(), role: "player", gameType: "jackpot" };
  if (name === "CoinflipCreated") return { game: r.key(), creator: r.key(), amount: r.u64(), side: r.u8(), gameType: "coinflip", state: "open" };
  if (name === "CoinflipJoined") return { game: r.key(), player: r.key(), role: "joiner", gameType: "coinflip" };
  if (name === "RandomnessRequested") return { game: r.key(), gameType: gameTypes[r.u8()], randomnessAccount: r.key(), seedSlot: r.u64(), state: "randomness_requested" };
  if (name === "GameSettled") return { game: r.key(), gameType: gameTypes[r.u8()], winner: r.key(), wager: r.u64(), payout: r.u64(), fee: r.u64(), randomnessHex: r.bytes32(), randomnessAccount: r.key(), seedSlot: r.u64(), revealSlot: r.u64(), state: "settled" };
  if (name === "GameRefunded") return { game: r.key(), player: r.key(), amount: r.u64(), state: "refunded" };
  if (name === "JackpotRefundsEnabled") return { game: r.key(), gameType: "jackpot", state: "refunded" };
  if (name === "DailyCaseSettled") return { game: r.key(), player: r.key(), reward: r.u64(), randomnessHex: r.bytes32(), randomnessAccount: r.key(), seedSlot: r.u64(), revealSlot: r.u64(), gameType: "daily", state: "settled" };
  if (name === "DailyCaseTimedOut") return { game: r.key(), player: r.key(), gameType: "daily", state: "timed_out" };
  if (name === "GameAccountsClosed") return { game: r.key(), gameType: gameTypes[r.u8()], rentRecipient: r.key(), state: "closed" };
  return {};
}
export function decodeProgramEvents(logs: string[], programId: string): DecodedEvent[] {
  const events: DecodedEvent[] = []; let instructionIndex = -1; let active = false;
  for (const line of logs) {
    if (line === `Program ${programId} invoke [1]`) { instructionIndex++; active = true; continue; }
    if (line === `Program ${programId} success` || line.startsWith(`Program ${programId} failed`)) { active = false; continue; }
    if (!active || !line.startsWith("Program data: ")) continue;
    try {
      const rawBase64 = line.slice(14); const data = Buffer.from(rawBase64, "base64");
      const name = discriminators.get(data.subarray(0, 8).toString("hex"));
      if (name) events.push({ name, payload: decode(name, data), rawBase64, instructionIndex: Math.max(0, instructionIndex), eventIndex: events.length });
    } catch { /* malformed provider logs are ignored and diagnosed by raw transaction storage */ }
  }
  return events;
}
