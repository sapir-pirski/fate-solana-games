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
