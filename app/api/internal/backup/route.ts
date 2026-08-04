import { env } from "cloudflare:workers";
import { authorizeAutomation, unauthorized } from "@/server/services/internal-api";

const TABLES = [
  "event_logs", "chain_events", "games", "game_entries", "indexer_checkpoints",
  "wallet_sessions", "transaction_operations", "background_jobs",
  "ai_conversations", "ai_messages", "ai_tool_calls", "ai_usage", "ai_feedback",
  "responsible_play_limits", "compliance_profiles", "compliance_audit_events", "privacy_requests",
] as const;

export async function GET(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });

  const tables: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    try {
      const result = await env.DB.prepare(`SELECT * FROM ${table}`).all();
      tables[table] = result.results;
    } catch (error) {
      if (!(error instanceof Error) || !/no such table/i.test(error.message)) throw error;
      tables[table] = [];
    }
  }
  return Response.json({
    format: "fate-d1-json-v1",
    createdAt: new Date().toISOString(),
    tables,
  }, {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="fate-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
