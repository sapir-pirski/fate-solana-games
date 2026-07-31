import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

let eventLogSchemaReady: Promise<unknown> | null = null;

/** Keeps local previews and newly provisioned environments safe before their
 * deployment migration has run. The migration remains the canonical schema. */
export async function ensureEventLogSchema() {
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!eventLogSchemaReady) {
    const d1 = env.DB;
    eventLogSchemaReady = d1.batch([
      d1.prepare(`CREATE TABLE IF NOT EXISTS event_logs (
        id TEXT PRIMARY KEY NOT NULL,
        event_type TEXT NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'info',
        session_id TEXT,
        wallet_address TEXT,
        game_type TEXT,
        game_id TEXT,
        amount_lamports INTEGER,
        transaction_signature TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        schema_version INTEGER NOT NULL DEFAULT 1,
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
  if (!env.DB) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("Invalid event log retention period.");
  }
  await env.DB.prepare("DELETE FROM event_logs WHERE created_at < datetime('now', ?)")
    .bind(`-${retentionDays} days`)
    .run();
}

let aiSchemaReady: Promise<unknown> | null = null;
export async function ensureAiSchema() {
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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS ai_feedback (id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL, wallet_hash TEXT, rating INTEGER NOT NULL, comment TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS ai_feedback_message_wallet_uidx ON ai_feedback (message_id, wallet_hash)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS responsible_play_limits (wallet_address TEXT PRIMARY KEY NOT NULL, daily_lamports INTEGER, weekly_lamports INTEGER, cooldown_until INTEGER, self_excluded_until INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY NOT NULL, agent_type TEXT NOT NULL, wallet_address TEXT, status TEXT NOT NULL, input_json TEXT NOT NULL, output_json TEXT, error_code TEXT, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_alerts (id TEXT PRIMARY KEY NOT NULL, alert_type TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', subject TEXT NOT NULL, evidence_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT)"),
  ]).catch((error: unknown) => { aiSchemaReady = null; throw error; });
  await aiSchemaReady;
}
