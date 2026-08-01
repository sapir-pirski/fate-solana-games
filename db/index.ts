import { env } from "cloudflare:workers";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { POSTGRES_SCHEMA_STATEMENTS } from "./postgres-schema";
import * as schema from "./schema";

type DatabaseBackend = "d1" | "postgres";
type PostgresClient = ReturnType<typeof postgres>;

type PostgresContext = { client: PostgresClient; db: ReturnType<typeof drizzlePostgres> };
const postgresContext = new AsyncLocalStorage<PostgresContext>();

function databaseUrl() {
  return process.env.DATABASE_URL?.trim();
}

function createPostgresClient() {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return postgres(url, {
      max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
      onnotice: () => undefined,
  });
}

export function getDatabaseBackend(): DatabaseBackend {
  return databaseUrl() ? "postgres" : "d1";
}

/** The routes intentionally use the common Drizzle query surface. Both
 * backends emit the same table and column names; PostgreSQL uses BIGINT for
 * on-chain numeric values while D1 stores them as SQLite integers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): any {
  if (getDatabaseBackend() === "postgres") {
    const context = postgresContext.getStore();
    if (!context) throw new Error("PostgreSQL access must run inside withDatabase().");
    return context.db;
  }
  if (!env.DB) {
    throw new Error(
      "No database is configured. Set DATABASE_URL for PostgreSQL or provide the Cloudflare D1 `DB` binding."
    );
  }
  return drizzleD1(env.DB, { schema });
}

export async function withDatabase<T>(operation: () => Promise<T>): Promise<T> {
  if (getDatabaseBackend() === "d1") return operation();
  const existing = postgresContext.getStore();
  if (existing) return operation();
  const client = createPostgresClient();
  const context = { client, db: drizzlePostgres(client, { schema }) };
  try {
    return await postgresContext.run(context, operation);
  } finally {
    await client.end({ timeout: 5 });
  }
}

let postgresSchemaReady: Promise<void> | null = null;
async function ensurePostgresSchema() {
  if (!postgresSchemaReady) {
    postgresSchemaReady = (async () => {
      const context = postgresContext.getStore();
      if (!context) throw new Error("PostgreSQL schema setup must run inside withDatabase().");
      const client = context.client;
      for (const statement of POSTGRES_SCHEMA_STATEMENTS) await client.unsafe(statement);
    })().catch((error: unknown) => {
      postgresSchemaReady = null;
      throw error;
    });
  }
  await postgresSchemaReady;
}

let eventLogSchemaReady: Promise<unknown> | null = null;
export async function ensureEventLogSchema() {
  if (getDatabaseBackend() === "postgres") return ensurePostgresSchema();
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
  if (getDatabaseBackend() === "postgres") {
    const context = postgresContext.getStore();
    if (!context) throw new Error("PostgreSQL retention must run inside withDatabase().");
    await context.client.unsafe(
      "DELETE FROM event_logs WHERE created_at::timestamptz < NOW() - ($1 * INTERVAL '1 day')",
      [retentionDays],
    );
    return;
  }
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  await env.DB.prepare("DELETE FROM event_logs WHERE created_at < datetime('now', ?)")
    .bind(`-${retentionDays} days`)
    .run();
}

let aiSchemaReady: Promise<unknown> | null = null;
export async function ensureAiSchema() {
  if (getDatabaseBackend() === "postgres") return ensurePostgresSchema();
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!aiSchemaReady) aiSchemaReady = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_conversations (id TEXT PRIMARY KEY NOT NULL, wallet_address TEXT, title TEXT NOT NULL DEFAULT 'FATE Copilot', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_conversations_wallet_idx ON ai_conversations (wallet_address, updated_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_messages (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, model TEXT, response_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages (conversation_id, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_tool_calls (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT NOT NULL, call_id TEXT NOT NULL, tool_name TEXT NOT NULL, arguments_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, duration_ms INTEGER, error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ai_tool_calls_call_uidx ON ai_tool_calls (call_id)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_usage (id TEXT PRIMARY KEY NOT NULL, conversation_id TEXT, wallet_hash TEXT, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0, cached_tokens INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS ai_usage_wallet_created_idx ON ai_usage (wallet_hash, created_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_feedback (id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL, wallet_hash TEXT, rating INTEGER NOT NULL, reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ai_feedback_message_wallet_uidx ON ai_feedback (message_id, wallet_hash)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS responsible_play_limits (wallet_address TEXT PRIMARY KEY NOT NULL, daily_lamports INTEGER, weekly_lamports INTEGER, cooldown_until INTEGER, self_excluded_until INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY NOT NULL, agent_type TEXT NOT NULL, wallet_address TEXT, status TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, error_code TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_alerts (id TEXT PRIMARY KEY NOT NULL, alert_type TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', subject TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT)"),
  ]).catch((error: unknown) => { aiSchemaReady = null; throw error; });
  await aiSchemaReady;
}

let authSchemaReady: Promise<unknown> | null = null;
export async function ensureAuthSchema() {
  if (getDatabaseBackend() === "postgres") return ensurePostgresSchema();
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!authSchemaReady) authSchemaReady = env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wallet_auth_challenges (id TEXT PRIMARY KEY, wallet_address TEXT NOT NULL, nonce_hash TEXT NOT NULL, message TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS wallet_auth_challenges_wallet_idx ON wallet_auth_challenges (wallet_address, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS wallet_sessions (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, wallet_address TEXT NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS wallet_sessions_wallet_idx ON wallet_sessions (wallet_address, expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS transaction_operations (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, wallet_address TEXT NOT NULL, game_type TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL, signature TEXT UNIQUE, error_code TEXT, error_message TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_valid_block_height INTEGER, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS transaction_operations_wallet_status_idx ON transaction_operations (wallet_address, status)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS rate_limit_buckets (key TEXT PRIMARY KEY, scope TEXT NOT NULL, subject_hash TEXT NOT NULL, window_start INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, expires_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS rate_limit_buckets_expiry_idx ON rate_limit_buckets (expires_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS background_jobs (id TEXT PRIMARY KEY, queue TEXT NOT NULL, dedupe_key TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 8, available_at INTEGER NOT NULL, lease_owner TEXT, lease_expires_at INTEGER, last_error TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(queue,dedupe_key))"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS background_jobs_claim_idx ON background_jobs (queue,status,available_at)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS distributed_leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS response_cache (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, expires_at INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS response_cache_expiry_idx ON response_cache (expires_at)"),
  ]).catch((error: unknown) => { authSchemaReady = null; throw error; });
  await authSchemaReady;
}

export async function checkDatabaseHealth() {
  if (getDatabaseBackend() === "postgres") {
    await withDatabase(async () => {
      const context = postgresContext.getStore();
      if (!context) throw new Error("PostgreSQL context is unavailable.");
      await context.client.unsafe("SELECT 1");
    });
    return { backend: "postgres", status: "ok" } as const;
  }
  if (!env.DB) return { backend: "d1", status: "unavailable" } as const;
  await env.DB.prepare("SELECT 1").first();
  return { backend: "d1", status: "ok" } as const;
}
