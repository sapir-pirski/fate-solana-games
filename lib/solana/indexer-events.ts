export type FateGameType = "jackpot" | "coinflip" | "daily";

export type FateEvent = {
  name: string;
  payload: Record<string, string | number | boolean>;
};

export type ProjectionContext = {
  signature: string;
  eventIndex?: number;
  slot: number;
  blockTime: number | null;
  signer: string | null;
  coinflipId?: string | null;
  coinflipExpiresAt?: number | null;
};

export type DatabaseMutation = { sql: string; params: Array<string | number | null> };

const EVENT_DISCRIMINATORS: Record<string, readonly number[]> = {
  JackpotCreated: [236, 185, 15, 9, 64, 171, 39, 36],
  JackpotEntered: [30, 137, 135, 206, 251, 181, 30, 154],
  CoinflipCreated: [87, 231, 27, 46, 243, 70, 221, 239],
  CoinflipJoined: [209, 233, 131, 156, 187, 130, 76, 55],
  RandomnessRequested: [10, 64, 183, 29, 104, 63, 90, 149],
  GameSettled: [63, 109, 128, 85, 229, 63, 167, 176],
  GameRefunded: [56, 111, 24, 209, 243, 165, 85, 255],
  JackpotRefundsEnabled: [216, 127, 183, 74, 94, 55, 0, 240],
  DailyCaseSettled: [119, 219, 181, 65, 204, 14, 234, 251],
  DailyCaseTimedOut: [4, 11, 38, 146, 43, 122, 117, 105],
  GameAccountsClosed: [172, 69, 105, 99, 75, 19, 166, 83],
};

const GAME_TYPES: FateGameType[] = ["jackpot", "coinflip", "daily"];
const COIN_SIDES = ["heads", "tails"];

class BorshReader {
  private offset = 0;
  constructor(private readonly value: Uint8Array) {}
  private take(length: number) {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.value.length) throw new Error("Truncated Anchor event.");
    const result = this.value.subarray(this.offset, this.offset + length);
    this.offset += length;
    return result;
  }
  u8() { return this.take(1)[0]; }
  u64() { return littleEndianUnsigned(this.take(8)).toString(); }
  i64() {
    const unsigned = littleEndianUnsigned(this.take(8));
    const signed = unsigned >= (1n << 63n) ? unsigned - (1n << 64n) : unsigned;
    return safeNumber(signed, "timestamp");
  }
  pubkey() { return base58Encode(this.take(32)); }
  bytes(length: number) { return this.take(length); }
}

function littleEndianUnsigned(bytes: Uint8Array) {
  let value = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[index]);
  return value;
}

function safeNumber(value: bigint, label: string) {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the safe integer range.`);
  return Number(value);
}

function lamports(value: string | number | boolean | undefined) {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : -1n;
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Lamport value exceeds the D1 safe integer range.");
  return Number(parsed);
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function enumValue<T>(values: readonly T[], index: number, label: string) {
  const value = values[index];
  if (value === undefined) throw new Error(`Unknown ${label} enum value.`);
  return value;
}

function fromBase64(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function matches(bytes: Uint8Array, discriminator: readonly number[]) {
  return discriminator.every((value, index) => bytes[index] === value);
}

export function decodeFateAnchorEvent(encoded: string): FateEvent | null {
  let bytes: Uint8Array;
  try { bytes = fromBase64(encoded.trim()); } catch { return null; }
  if (bytes.length < 8) return null;
  const name = Object.keys(EVENT_DISCRIMINATORS).find(candidate => matches(bytes, EVENT_DISCRIMINATORS[candidate]));
  if (!name) return null;
  try {
    const reader = new BorshReader(bytes.subarray(8));
    switch (name) {
      case "JackpotCreated": return { name, payload: { round: reader.pubkey(), roundId: reader.u64(), endTs: reader.i64() } };
      case "JackpotEntered": return { name, payload: { round: reader.pubkey(), player: reader.pubkey(), amount: reader.u64(), total: reader.u64() } };
      case "CoinflipCreated": return { name, payload: { game: reader.pubkey(), creator: reader.pubkey(), amount: reader.u64(), side: enumValue(COIN_SIDES, reader.u8(), "coin side") } };
      case "CoinflipJoined": return { name, payload: { game: reader.pubkey(), joiner: reader.pubkey() } };
      case "RandomnessRequested": return { name, payload: { game: reader.pubkey(), gameType: enumValue(GAME_TYPES, reader.u8(), "game type"), randomnessAccount: reader.pubkey(), seedSlot: reader.u64() } };
      case "GameSettled": return { name, payload: { game: reader.pubkey(), gameType: enumValue(GAME_TYPES, reader.u8(), "game type"), winner: reader.pubkey(), wager: reader.u64(), payout: reader.u64(), fee: reader.u64(), randomness: hex(reader.bytes(32)), randomnessAccount: reader.pubkey(), seedSlot: reader.u64(), revealSlot: reader.u64() } };
      case "GameRefunded": return { name, payload: { game: reader.pubkey(), player: reader.pubkey(), amount: reader.u64() } };
      case "JackpotRefundsEnabled": return { name, payload: { game: reader.pubkey() } };
      case "DailyCaseSettled": return { name, payload: { account: reader.pubkey(), player: reader.pubkey(), reward: reader.u64(), randomness: hex(reader.bytes(32)), randomnessAccount: reader.pubkey(), seedSlot: reader.u64(), revealSlot: reader.u64() } };
      case "DailyCaseTimedOut": return { name, payload: { account: reader.pubkey(), player: reader.pubkey() } };
      case "GameAccountsClosed": return { name, payload: { game: reader.pubkey(), gameType: enumValue(GAME_TYPES, reader.u8(), "game type"), rentRecipient: reader.pubkey() } };
      default: return null;
    }
  } catch {
    return null;
  }
}

export function decodeFateLogEvents(logMessages: readonly string[] | null | undefined) {
  const events: FateEvent[] = [];
  for (const message of logMessages ?? []) {
    const encoded = message.startsWith("Program data: ") ? message.slice("Program data: ".length) : null;
    if (!encoded) continue;
    const event = decodeFateAnchorEvent(encoded);
    if (event) events.push(event);
  }
  return events;
}

const GAME_UPSERT = `INSERT INTO games (address,chain_address,game_type,numeric_id,state,creator,winner,wager_lamports,pot_lamports,payout_lamports,fee_lamports,randomness_hex,opened_at,expires_at,settled_at,last_signature,last_slot,updated_at)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
ON CONFLICT(address) DO UPDATE SET chain_address=excluded.chain_address,game_type=excluded.game_type,numeric_id=CASE WHEN excluded.numeric_id=excluded.chain_address THEN games.numeric_id ELSE excluded.numeric_id END,state=excluded.state,creator=COALESCE(excluded.creator,games.creator),winner=COALESCE(excluded.winner,games.winner),wager_lamports=excluded.wager_lamports,pot_lamports=excluded.pot_lamports,payout_lamports=excluded.payout_lamports,fee_lamports=excluded.fee_lamports,randomness_hex=COALESCE(excluded.randomness_hex,games.randomness_hex),opened_at=COALESCE(games.opened_at,excluded.opened_at),expires_at=COALESCE(excluded.expires_at,games.expires_at),settled_at=COALESCE(excluded.settled_at,games.settled_at),last_signature=excluded.last_signature,last_slot=excluded.last_slot,updated_at=CURRENT_TIMESTAMP
WHERE games.last_slot<=excluded.last_slot`;

function gameUpsert(context: ProjectionContext, values: { address: string; chainAddress?: string; gameType: FateGameType; numericId?: string; state: string; creator?: string | null; winner?: string | null; wager?: number; pot?: number; payout?: number; fee?: number; randomness?: string | null; openedAt?: number | null; expiresAt?: number | null; settledAt?: number | null }): DatabaseMutation {
  const chainAddress = values.chainAddress ?? values.address;
  return { sql: GAME_UPSERT, params: [values.address, chainAddress, values.gameType, values.numericId ?? chainAddress, values.state, values.creator ?? null, values.winner ?? null, values.wager ?? 0, values.pot ?? 0, values.payout ?? 0, values.fee ?? 0, values.randomness ?? null, values.openedAt ?? null, values.expiresAt ?? null, values.settledAt ?? null, context.signature, context.slot] };
}

function entry(context: ProjectionContext, game: string, wallet: string, role: string, amount: number): DatabaseMutation {
  const eventIndex = context.eventIndex ?? 0;
  const occurredAt = context.blockTime ?? Math.floor(Date.now() / 1000);
  return { sql: "INSERT OR IGNORE INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)", params: [`${context.signature}:${eventIndex}:${role}:${wallet}`, game, wallet, role, amount, context.signature, eventIndex, context.slot, occurredAt] };
}

export function projectFateEvent(event: FateEvent, context: ProjectionContext): DatabaseMutation[] {
  const payload = event.payload;
  const mutations: DatabaseMutation[] = [];
  switch (event.name) {
    case "JackpotCreated": {
      const address = String(payload.round);
      mutations.push(gameUpsert(context, { address, gameType: "jackpot", numericId: String(payload.roundId), state: "open", creator: context.signer, openedAt: context.blockTime, expiresAt: Number(payload.endTs) }));
      mutations.push({ sql: "UPDATE games SET numeric_id=? WHERE address=? AND numeric_id=chain_address", params: [String(payload.roundId), address] });
      break;
    }
    case "JackpotEntered": {
      const address = String(payload.round), amount = lamports(payload.amount), total = lamports(payload.total), player = String(payload.player);
      mutations.push({ sql: "UPDATE games SET state='open',wager_lamports=?,pot_lamports=?,last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE address=? AND last_slot<=?", params: [total, total, context.signature, context.slot, address, context.slot] });
      mutations.push(entry(context, address, player, "player", amount));
      break;
    }
    case "CoinflipCreated": {
      const address = String(payload.game), amount = lamports(payload.amount), creator = String(payload.creator);
      mutations.push(gameUpsert(context, { address, gameType: "coinflip", numericId: context.coinflipId ?? address, state: "open", creator, wager: amount, pot: amount, openedAt: context.blockTime, expiresAt: context.coinflipExpiresAt ?? null }));
      if (context.coinflipId) mutations.push({ sql: "UPDATE games SET numeric_id=? WHERE address=? AND numeric_id=chain_address", params: [context.coinflipId, address] });
      mutations.push(entry(context, address, creator, "creator", amount));
      break;
    }
    case "CoinflipJoined": {
      const address = String(payload.game), joiner = String(payload.joiner);
      mutations.push({ sql: "UPDATE games SET state='randomness_requested',pot_lamports=wager_lamports*2,last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE address=? AND last_slot<=?", params: [context.signature, context.slot, address, context.slot] });
      const eventIndex = context.eventIndex ?? 0;
      mutations.push({ sql: "INSERT OR IGNORE INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) SELECT ?,address,?,'joiner',wager_lamports,?,?,?,? FROM games WHERE address=?", params: [`${context.signature}:${eventIndex}:joiner:${joiner}`, joiner, context.signature, eventIndex, context.slot, context.blockTime ?? Math.floor(Date.now() / 1000), address] });
      break;
    }
    case "RandomnessRequested": {
      const address = String(payload.game), gameType = String(payload.gameType) as FateGameType;
      if (gameType === "daily") {
        const player = context.signer;
        const seedSlot = String(payload.seedSlot), recordId = `${address}:${seedSlot}`;
        mutations.push(gameUpsert(context, { address: recordId, chainAddress: address, gameType, numericId: seedSlot, state: "randomness_requested", creator: player, openedAt: context.blockTime, expiresAt: context.blockTime === null ? null : context.blockTime + 600 }));
        if (player) mutations.push(entry(context, recordId, player, "player", 0));
      } else {
        mutations.push({ sql: "UPDATE games SET state='randomness_requested',last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE address=? AND last_slot<=?", params: [context.signature, context.slot, address, context.slot] });
      }
      break;
    }
    case "GameSettled": {
      const address = String(payload.game), gameType = String(payload.gameType) as FateGameType, total = lamports(payload.wager);
      const currentStake = gameType === "coinflip" ? Math.floor(total / 2) : total;
      mutations.push(gameUpsert(context, { address, gameType, state: "settled", winner: String(payload.winner), wager: currentStake, pot: total, payout: lamports(payload.payout), fee: lamports(payload.fee), randomness: String(payload.randomness), settledAt: context.blockTime }));
      break;
    }
    case "GameRefunded": {
      const address = String(payload.game), player = String(payload.player), amount = lamports(payload.amount);
      mutations.push({ sql: "UPDATE games SET state='refunded',last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE address=? AND last_slot<=?", params: [context.signature, context.slot, address, context.slot] });
      mutations.push(entry(context, address, player, "refund", amount));
      break;
    }
    case "JackpotRefundsEnabled":
      mutations.push({ sql: "UPDATE games SET state='refunded',last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE address=? AND last_slot<=?", params: [context.signature, context.slot, String(payload.game), context.slot] });
      break;
    case "DailyCaseSettled": {
      const chainAddress = String(payload.account), player = String(payload.player), reward = lamports(payload.reward), seedSlot = String(payload.seedSlot), recordId = `${chainAddress}:${seedSlot}`;
      mutations.push(gameUpsert(context, { address: recordId, chainAddress, gameType: "daily", numericId: seedSlot, state: "settled", creator: player, winner: player, payout: reward, randomness: String(payload.randomness), settledAt: context.blockTime }));
      mutations.push(entry(context, recordId, player, "player", 0));
      break;
    }
    case "DailyCaseTimedOut": {
      const chainAddress = String(payload.account), player = String(payload.player);
      mutations.push({ sql: "UPDATE games SET state='refunded',settled_at=?,last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE address=(SELECT address FROM games WHERE chain_address=? AND game_type='daily' AND state='randomness_requested' ORDER BY last_slot DESC LIMIT 1) AND last_slot<=?", params: [context.blockTime, context.signature, context.slot, chainAddress, context.slot] });
      const eventIndex = context.eventIndex ?? 0;
      mutations.push({ sql: "INSERT OR IGNORE INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) SELECT ?,address,?,'player',0,?,?,?,? FROM games WHERE chain_address=? AND game_type='daily' ORDER BY last_slot DESC LIMIT 1", params: [`${context.signature}:${eventIndex}:player:${player}`, player, context.signature, eventIndex, context.slot, context.blockTime ?? Math.floor(Date.now() / 1000), chainAddress] });
      break;
    }
    case "GameAccountsClosed":
      mutations.push({ sql: "UPDATE games SET last_signature=?,last_slot=?,updated_at=CURRENT_TIMESTAMP WHERE chain_address=? AND last_slot<=?", params: [context.signature, context.slot, String(payload.game), context.slot] });
      break;
  }
  return mutations;
}

export function base58Encode(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) { const value = digits[index] * 256 + carry; digits[index] = value % 58; carry = Math.floor(value / 58); }
    while (carry) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let output = "";
  for (const byte of bytes) { if (byte !== 0) break; output += "1"; }
  return output + digits.reverse().map(value => alphabet[value]).join("");
}

export function base58Decode(value: string) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = [0];
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58 value.");
    let carry = digit;
    for (let index = 0; index < bytes.length; index += 1) { const next = bytes[index] * 58 + carry; bytes[index] = next & 255; carry = next >> 8; }
    while (carry) { bytes.push(carry & 255); carry >>= 8; }
  }
  let leading = 0;
  for (const character of value) { if (character !== "1") break; leading += 1; }
  return Uint8Array.from([...Array(Math.max(0, leading - 1)).fill(0), ...bytes.reverse()]);
}
