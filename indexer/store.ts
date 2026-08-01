import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { INDEXER_SCHEMA } from "./schema.ts";
import type { DecodedEvent } from "./decoder.ts";

type TransactionRecord = { signature: string; slot: number; blockTime: number | null; commitment: "confirmed" | "finalized"; succeeded: boolean; raw: unknown; events: DecodedEvent[] };
export class IndexerStore {
  readonly sql;
  constructor(readonly url: string, readonly cluster: string) { this.sql = postgres(url, { max: 1, prepare: false, idle_timeout: 20, onnotice: () => undefined }); }
  async initialize() { for (const statement of INDEXER_SCHEMA) await this.sql.unsafe(statement); }
  async close() { await this.sql.end({ timeout: 5 }); }
  async lock() { const [{ locked }] = await this.sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${`fate-indexer:${this.cluster}`})) AS locked`; return locked; }
  async cursor(commitment: string) { const rows = await this.sql<{ last_slot: string; last_signature: string | null }[]>`SELECT last_slot, last_signature FROM indexer_cursors WHERE cluster=${this.cluster} AND consumer='fate-program' AND commitment=${commitment}`; return rows[0] ?? { last_slot: "0", last_signature: null }; }
  async startRun(workerId: string) { const id = randomUUID(); await this.sql`INSERT INTO indexer_runs (id, cluster, worker_id, status) VALUES (${id},${this.cluster},${workerId},'running')`; return id; }
  async finishRun(id: string, values: { status: string; startSlot?: number; endSlot?: number; transactions: number; events: number; reorged: number; error?: string }) { await this.sql`UPDATE indexer_runs SET status=${values.status}, completed_at=NOW(), start_slot=${values.startSlot ?? null}, end_slot=${values.endSlot ?? null}, transactions_seen=${values.transactions}, events_seen=${values.events}, reorged_transactions=${values.reorged}, error_message=${values.error ?? null} WHERE id=${id}`; }
  async ingest(record: TransactionRecord) {
    await this.sql.begin(async sql => {
      await sql`INSERT INTO solana_transactions (cluster,signature,slot,block_time,commitment,succeeded,canonical,raw_json) VALUES (${this.cluster},${record.signature},${record.slot},${record.blockTime},${record.commitment},${record.succeeded},TRUE,${sql.json(record.raw as never)}) ON CONFLICT (cluster,signature) DO UPDATE SET slot=EXCLUDED.slot,block_time=EXCLUDED.block_time,commitment=CASE WHEN solana_transactions.commitment='finalized' THEN 'finalized' ELSE EXCLUDED.commitment END,succeeded=EXCLUDED.succeeded,canonical=TRUE,raw_json=EXCLUDED.raw_json,updated_at=NOW()`;
      for (const event of record.events) await sql`INSERT INTO program_events (cluster,signature,instruction_index,event_index,slot,block_time,program_id,event_name,payload_json,raw_base64,commitment,canonical) VALUES (${this.cluster},${record.signature},${event.instructionIndex},${event.eventIndex},${record.slot},${record.blockTime},${process.env.FATE_PROGRAM_ID!},${event.name},${sql.json(event.payload as never)},${event.rawBase64},${record.commitment},TRUE) ON CONFLICT (cluster,signature,instruction_index,event_index) DO UPDATE SET slot=EXCLUDED.slot,block_time=EXCLUDED.block_time,payload_json=EXCLUDED.payload_json,raw_base64=EXCLUDED.raw_base64,commitment=CASE WHEN program_events.commitment='finalized' THEN 'finalized' ELSE EXCLUDED.commitment END,canonical=TRUE`;
    });
  }
  async advanceCursor(commitment: "confirmed" | "finalized", signature: string | null, slot: number) { await this.sql`INSERT INTO indexer_cursors (cluster,consumer,commitment,last_signature,last_slot) VALUES (${this.cluster},'fate-program',${commitment},${signature},${slot}) ON CONFLICT (cluster,consumer,commitment) DO UPDATE SET last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot,updated_at=NOW()`; }
  async reconcile(minSlot: number, maxSlot: number, canonical: string[]) {
    if (!canonical.length) return 0;
    const orphaned = await this.sql<{ signature: string }[]>`UPDATE solana_transactions SET canonical=FALSE,updated_at=NOW() WHERE cluster=${this.cluster} AND slot BETWEEN ${minSlot} AND ${maxSlot} AND canonical=TRUE AND signature NOT IN ${this.sql(canonical)} RETURNING signature`;
    if (orphaned.length) await this.sql`UPDATE program_events SET canonical=FALSE WHERE cluster=${this.cluster} AND signature IN ${this.sql(orphaned.map(row => row.signature))}`;
    return orphaned.length;
  }
  async rebuildProjections() {
    await this.sql.begin(async sql => {
      await sql`DELETE FROM game_entries`; await sql`DELETE FROM games`;
      const events = await sql<{ event_name: string; payload_json: Record<string, string>; signature: string; slot: string; block_time: string | null }[]>`SELECT event_name,payload_json,signature,slot,block_time FROM program_events WHERE cluster=${this.cluster} AND canonical=TRUE AND commitment='finalized' ORDER BY slot,instruction_index,event_index`;
      for (const event of events) await this.project(sql, event);
    });
  }
  private async project(sql: postgres.Sql, event: { event_name: string; payload_json: Record<string, string>; signature: string; slot: string; block_time: string | null }) {
    const p = event.payload_json; const game = p.game; if (!game) return;
    const type = p.gameType ?? "unknown"; const state = p.state ?? "open";
    await sql`INSERT INTO games (address,game_type,numeric_id,state,creator,winner,wager_lamports,pot_lamports,payout_lamports,fee_lamports,randomness_hex,expires_at,settled_at,last_signature,last_slot) VALUES (${game},${type},${p.numericId ?? game},${state},${p.creator ?? null},${p.winner ?? null},${p.wager ?? p.amount ?? 0},${p.total ?? p.wager ?? p.amount ?? 0},${p.payout ?? p.reward ?? 0},${p.fee ?? 0},${p.randomnessHex ?? null},${p.expiresAt ?? null},${state === "settled" ? event.block_time : null},${event.signature},${event.slot}) ON CONFLICT (address) DO UPDATE SET state=EXCLUDED.state,winner=COALESCE(EXCLUDED.winner,games.winner),wager_lamports=CASE WHEN EXCLUDED.wager_lamports>0 THEN EXCLUDED.wager_lamports ELSE games.wager_lamports END,pot_lamports=GREATEST(games.pot_lamports,EXCLUDED.pot_lamports),payout_lamports=GREATEST(games.payout_lamports,EXCLUDED.payout_lamports),fee_lamports=GREATEST(games.fee_lamports,EXCLUDED.fee_lamports),randomness_hex=COALESCE(EXCLUDED.randomness_hex,games.randomness_hex),settled_at=COALESCE(EXCLUDED.settled_at,games.settled_at),last_signature=EXCLUDED.last_signature,last_slot=EXCLUDED.last_slot,updated_at=NOW()`;
    if (p.player && p.amount) await sql`INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,slot) VALUES (${`${event.signature}:${p.player}:${p.role ?? "player"}`},${game},${p.player},${p.role ?? "player"},${p.amount},${event.signature},${event.slot}) ON CONFLICT (id) DO NOTHING`;
  }
  async failure(input: { signature?: string; slot?: number; stage: string; error: unknown; retryable: boolean; context?: object }) { const error = input.error instanceof Error ? input.error : new Error(String(input.error)); await this.sql`INSERT INTO indexer_failures (cluster,signature,slot,stage,error_class,error_message,retryable,status,next_retry_at,context_json) VALUES (${this.cluster},${input.signature ?? null},${input.slot ?? null},${input.stage},${error.name},${error.message.slice(0,2000)},${input.retryable},${input.retryable ? "pending" : "dead"},${input.retryable ? this.sql`NOW() + INTERVAL '1 minute'` : null},${this.sql.json((input.context ?? {}) as never)})`; }
  async log(level: string, event: string, message: string, context: object = {}) { console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, event, message, ...context })); await this.sql`INSERT INTO indexer_logs (level,event,message,context_json) VALUES (${level},${event},${message},${this.sql.json(context as never)})`; }
  async status() { const [cursor] = await this.sql<{ last_slot: string; updated_at: string }[]>`SELECT last_slot,updated_at FROM indexer_cursors WHERE cluster=${this.cluster} AND consumer='fate-program' AND commitment='finalized'`; const [{ dead }] = await this.sql<{ dead: string }[]>`SELECT COUNT(*)::TEXT AS dead FROM indexer_failures WHERE status='dead'`; return { cursor: cursor ?? null, deadLetters: Number(dead) }; }
  async retryableFailures(limit = 100) { return this.sql<{ id: string; signature: string | null }[]>`SELECT id::TEXT,signature FROM indexer_failures WHERE status IN ('pending','dead') AND signature IS NOT NULL ORDER BY created_at LIMIT ${limit}`; }
  async resolveFailure(id: string, status: "resolved" | "dead") { await this.sql`UPDATE indexer_failures SET status=${status},updated_at=NOW() WHERE id=${id}`; }
}
