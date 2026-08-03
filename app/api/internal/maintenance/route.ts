import { env } from "cloudflare:workers";
import { authorizeAutomation, unauthorized } from "@/server/services/internal-api";
import { ensureAuthSchema, ensureEventLogSchema } from "../../../../db";

export async function POST(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });

  await Promise.all([ensureAuthSchema(), ensureEventLogSchema()]);
  const now = Math.floor(Date.now() / 1000);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM wallet_auth_challenges WHERE expires_at < ?").bind(now - 3600),
    env.DB.prepare("DELETE FROM wallet_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(now - 86400, now - 86400),
    env.DB.prepare("DELETE FROM rate_limit_buckets WHERE expires_at < ?").bind(now),
    env.DB.prepare("UPDATE transaction_operations SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE status IN ('draft','awaiting_signature') AND expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM background_jobs WHERE status = 'complete' AND updated_at < datetime('now', '-7 days')"),
    env.DB.prepare("DELETE FROM event_logs WHERE created_at < datetime('now', '-90 days')"),
  ]);

  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    changes: results.map((result) => result.meta.changes ?? 0),
  }, { headers: { "cache-control": "no-store" } });
}
