import { env } from "cloudflare:workers";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import * as schema from "./schema";
import { observe, withSpan } from "../lib/telemetry";

export function getDatabaseBackend() { return "d1" as const; }

export function getDb() {
  if (!env.DB) {
    throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  }
  return drizzleD1(env.DB, { schema });
}

export function getD1() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return env.DB;
}

export async function withDatabase<T>(operation: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try { return await withSpan("database.operation", { component: "database", backend: "d1" }, operation); }
  finally { observe("fate_database_operation_duration_ms", Date.now() - started, { backend: "d1" }); }
}

let eventLogSchemaReady: Promise<unknown> | null = null;
let gameSchemaReady: Promise<unknown> | null = null;
export async function ensureGameSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!gameSchemaReady) gameSchemaReady = (async () => {
    const existingColumns = await env.DB.prepare("PRAGMA table_info(games)").all<{ name: string }>();
    if (existingColumns.results.length && !existingColumns.results.some(column => column.name === "chain_address")) {
      await env.DB.prepare("ALTER TABLE games ADD COLUMN chain_address TEXT NOT NULL DEFAULT ''").run();
      await env.DB.prepare("UPDATE games SET chain_address=address WHERE chain_address=''").run();
    }
    const entryColumns = await env.DB.prepare("PRAGMA table_info(game_entries)").all<{ name: string }>();
    if (entryColumns.results.length && !entryColumns.results.some(column => column.name === "event_index")) {
      await env.DB.prepare("ALTER TABLE game_entries ADD COLUMN event_index INTEGER NOT NULL DEFAULT 0").run();
    }
    if (entryColumns.results.length && !entryColumns.results.some(column => column.name === "occurred_at")) {
      await env.DB.prepare("ALTER TABLE game_entries ADD COLUMN occurred_at INTEGER NOT NULL DEFAULT 0").run();
      await env.DB.prepare("UPDATE game_entries SET occurred_at=COALESCE(CAST(strftime('%s',created_at) AS INTEGER),CAST(strftime('%s','now') AS INTEGER)) WHERE occurred_at=0").run();
    }
    return env.DB.batch([
      env.DB.prepare("CREATE TABLE IF NOT EXISTS chain_events (id TEXT PRIMARY KEY NOT NULL, signature TEXT NOT NULL, instruction_index INTEGER NOT NULL, event_index INTEGER NOT NULL, slot INTEGER NOT NULL, block_time INTEGER, program_id TEXT NOT NULL, event_name TEXT NOT NULL, payload_json TEXT NOT NULL, commitment TEXT NOT NULL DEFAULT 'confirmed', ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS chain_events_position_uidx ON chain_events (signature,instruction_index,event_index)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS chain_events_slot_idx ON chain_events (slot)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS chain_events_name_slot_idx ON chain_events (event_name,slot)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS games (address TEXT PRIMARY KEY NOT NULL, chain_address TEXT NOT NULL, game_type TEXT NOT NULL, numeric_id TEXT NOT NULL, state TEXT NOT NULL, creator TEXT, winner TEXT, wager_lamports INTEGER NOT NULL DEFAULT 0, pot_lamports INTEGER NOT NULL DEFAULT 0, payout_lamports INTEGER NOT NULL DEFAULT 0, fee_lamports INTEGER NOT NULL DEFAULT 0, randomness_hex TEXT, opened_at INTEGER, expires_at INTEGER, settled_at INTEGER, last_signature TEXT NOT NULL, last_slot INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS games_type_numeric_id_uidx ON games (game_type,numeric_id)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS games_type_state_idx ON games (game_type,state)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS games_winner_idx ON games (winner)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS games_chain_address_idx ON games (chain_address,last_slot)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS game_entries (id TEXT PRIMARY KEY NOT NULL, game_address TEXT NOT NULL, wallet_address TEXT NOT NULL, role TEXT NOT NULL, amount_lamports INTEGER NOT NULL, signature TEXT NOT NULL, event_index INTEGER NOT NULL DEFAULT 0, slot INTEGER NOT NULL, occurred_at INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
      env.DB.prepare("DROP INDEX IF EXISTS game_entries_signature_wallet_uidx"),
      env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS game_entries_event_uidx ON game_entries (signature,event_index,role,wallet_address)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS game_entries_game_idx ON game_entries (game_address,slot)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS game_entries_wallet_idx ON game_entries (wallet_address,slot)"),
      env.DB.prepare("CREATE INDEX IF NOT EXISTS game_entries_wallet_occurred_idx ON game_entries (wallet_address,occurred_at)"),
      env.DB.prepare("CREATE TABLE IF NOT EXISTS indexer_checkpoints (consumer TEXT PRIMARY KEY NOT NULL, last_signature TEXT, last_slot INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'healthy', last_error TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    ]);
  })().catch((error: unknown) => { gameSchemaReady = null; throw error; });
  await gameSchemaReady;
}

export async function ensureEventLogSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!eventLogSchemaReady) {
    const d1 = env.DB;
    eventLogSchemaReady = d1.batch([
      d1.prepare(`CREATE TABLE IF NOT EXISTS event_logs (
        id TEXT PRIMARY KEY NOT NULL, event_type TEXT NOT NULL, category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'info', session_id TEXT, wallet_address TEXT,
        game_type TEXT, game_id TEXT, amount_lamports INTEGER, transaction_signature TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}', schema_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      d1.prepare("CREATE INDEX IF NOT EXISTS event_logs_created_at_idx ON event_logs (created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS event_logs_event_created_idx ON event_logs (event_type, created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS event_logs_wallet_created_idx ON event_logs (wallet_address, created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS event_logs_game_created_idx ON event_logs (game_type, game_id, created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS event_logs_tx_signature_idx ON event_logs (transaction_signature)"),
    ]).catch((error: unknown) => {
      eventLogSchemaReady = null;
      throw error;
    });
  }
  await eventLogSchemaReady;
}

export async function pruneEventLogs(retentionDays: number) {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("Invalid event log retention period.");
  }
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  await env.DB.prepare("DELETE FROM event_logs WHERE created_at < datetime('now', ?)")
    .bind(`-${retentionDays} days`)
    .run();
}

let aiSchemaReady: Promise<unknown> | null = null;
export async function ensureAiSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!aiSchemaReady) aiSchemaReady = (async () => {
    const conversationColumns = await env.DB.prepare("PRAGMA table_info(ai_conversations)").all<{ name: string }>();
    if (conversationColumns.results.length && !conversationColumns.results.some(column => column.name === "owner_key")) {
      await env.DB.prepare("ALTER TABLE ai_conversations ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'legacy'").run();
      await env.DB.prepare("UPDATE ai_conversations SET owner_key=CASE WHEN wallet_address IS NOT NULL THEN 'wallet:' || wallet_address ELSE 'legacy:' || id END WHERE owner_key='legacy'").run();
    }
    const messageColumns = await env.DB.prepare("PRAGMA table_info(ai_messages)").all<{ name: string }>();
    if (messageColumns.results.length && !messageColumns.results.some(column => column.name === "feedback_token_hash")) {
      await env.DB.prepare("ALTER TABLE ai_messages ADD COLUMN feedback_token_hash TEXT").run();
    }
    const usageColumns = await env.DB.prepare("PRAGMA table_info(ai_usage)").all<{ name: string }>();
    const usageNames = new Set(usageColumns.results.map(column => column.name));
    if (usageNames.size) {
      if (!usageNames.has("request_id")) await env.DB.prepare("ALTER TABLE ai_usage ADD COLUMN request_id TEXT NOT NULL DEFAULT 'legacy'").run();
      if (!usageNames.has("response_id")) await env.DB.prepare("ALTER TABLE ai_usage ADD COLUMN response_id TEXT").run();
      if (!usageNames.has("round")) await env.DB.prepare("ALTER TABLE ai_usage ADD COLUMN round INTEGER NOT NULL DEFAULT 0").run();
    }
    return env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_conversations (id TEXT PRIMARY KEY NOT NULL, wallet_address TEXT, owner_key TEXT NOT NULL DEFAULT 'legacy', title TEXT NOT NULL DEFAULT 'FATE Copilot', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_conversations_wallet_idx ON ai_conversations (wallet_address, updated_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_conversations_owner_idx ON ai_conversations (owner_key, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_messages (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, response_id TEXT, feedback_token_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_tool_calls (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, call_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, duration_ms INTEGER, error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ai_tool_calls_call_uidx ON ai_tool_calls (call_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT, wallet_hash TEXT, request_id TEXT NOT NULL DEFAULT 'legacy', response_id TEXT, round INTEGER NOT NULL DEFAULT 0, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_usage_wallet_created_idx ON ai_usage (wallet_hash, created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_response_uidx ON ai_usage (response_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_feedback (id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL, wallet_hash TEXT, rating INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ai_feedback_message_wallet_uidx ON ai_feedback (message_id, wallet_hash)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS responsible_play_limits (wallet_address TEXT PRIMARY KEY NOT NULL, daily_lamports INTEGER, weekly_lamports INTEGER, cooldown_until INTEGER, self_excluded_until INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY NOT NULL, agent_type TEXT NOT NULL, wallet_address TEXT, status TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, error_code TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_alerts (id TEXT PRIMARY KEY NOT NULL, alert_type TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', subject TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT)"),
    ]);
  })().catch((error: unknown) => { aiSchemaReady = null; throw error; });
  await aiSchemaReady;
}

let authSchemaReady: Promise<unknown> | null = null;
export async function ensureAuthSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!authSchemaReady) authSchemaReady = (async () => {
    const columns = await env.DB.prepare("PRAGMA table_info(transaction_operations)").all<{ name: string }>();
    const names = new Set(columns.results.map(column => column.name));
    if (names.size) {
      if (!names.has("amount_lamports")) await env.DB.prepare("ALTER TABLE transaction_operations ADD COLUMN amount_lamports INTEGER NOT NULL DEFAULT 0").run();
      if (!names.has("game_address")) await env.DB.prepare("ALTER TABLE transaction_operations ADD COLUMN game_address TEXT NOT NULL DEFAULT ''").run();
      if (!names.has("program_id")) await env.DB.prepare("ALTER TABLE transaction_operations ADD COLUMN program_id TEXT NOT NULL DEFAULT ''").run();
      if (!names.has("message_hash")) await env.DB.prepare("ALTER TABLE transaction_operations ADD COLUMN message_hash TEXT NOT NULL DEFAULT ''").run();
      if (!names.has("reserved_at")) {
        await env.DB.prepare("ALTER TABLE transaction_operations ADD COLUMN reserved_at INTEGER NOT NULL DEFAULT 0").run();
        await env.DB.prepare("UPDATE transaction_operations SET reserved_at=COALESCE(CAST(strftime('%s',created_at) AS INTEGER),CAST(strftime('%s','now') AS INTEGER)) WHERE reserved_at=0").run();
      }
    }
    return env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wallet_auth_challenges (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, nonce_hash TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS wallet_auth_challenges_wallet_idx ON wallet_auth_challenges (wallet_address, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wallet_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, wallet_address TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS wallet_sessions_wallet_idx ON wallet_sessions (wallet_address, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS transaction_operations (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, wallet_address TEXT NOT NULL, game_type TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, amount_lamports INTEGER NOT NULL DEFAULT 0, game_address TEXT NOT NULL DEFAULT '', program_id TEXT NOT NULL DEFAULT '', message_hash TEXT NOT NULL DEFAULT '', reserved_at INTEGER NOT NULL DEFAULT 0, signature TEXT UNIQUE, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_valid_block_height INTEGER, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS transaction_operations_wallet_status_idx ON transaction_operations (wallet_address, status)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS transaction_operations_wallet_reserved_idx ON transaction_operations (wallet_address,reserved_at,status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limit_buckets (key TEXT PRIMARY KEY, scope TEXT NOT NULL, subject_hash TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS background_jobs (id TEXT PRIMARY KEY, queue TEXT NOT NULL, dedupe_key TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 8, available_at INTEGER NOT NULL, lease_owner TEXT, lease_expires_at INTEGER, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(queue,dedupe_key))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS background_jobs_claim_idx ON background_jobs (queue,status,available_at)"),
    ]);
  })().catch((error: unknown) => { authSchemaReady = null; throw error; });
  await authSchemaReady;
}

let complianceSchemaReady: Promise<unknown> | null = null;
export async function ensureComplianceSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!complianceSchemaReady) complianceSchemaReady = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS compliance_profiles (wallet_address TEXT PRIMARY KEY, country_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', jurisdiction_status TEXT NOT NULL DEFAULT 'unreviewed', sanctions_status TEXT NOT NULL DEFAULT 'not_screened', age_attested_at INTEGER, terms_version TEXT, privacy_version TEXT, risk_version TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS compliance_profiles_status_idx ON compliance_profiles (status, jurisdiction_status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS compliance_audit_events (id TEXT PRIMARY KEY, wallet_hash TEXT NOT NULL, event_type TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT, evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS compliance_audit_wallet_created_idx ON compliance_audit_events (wallet_hash, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS privacy_requests (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, request_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received', requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS privacy_requests_wallet_created_idx ON privacy_requests (wallet_address, requested_at)"),
  ]).catch((error: unknown) => { complianceSchemaReady = null; throw error; });
  await complianceSchemaReady;
}

export async function ensureApplicationSchema() {
  await Promise.all([
    ensureEventLogSchema(),
    ensureGameSchema(),
    ensureAiSchema(),
    ensureAuthSchema(),
    ensureComplianceSchema(),
  ]);
}

export async function checkDatabaseHealth() {
  if (!env.DB) return { backend: "d1", status: "unavailable" } as const;
  await env.DB.prepare("SELECT 1").first();
  return { backend: "d1", status: "ok" } as const;
}
