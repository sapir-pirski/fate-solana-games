import { env } from "cloudflare:workers";
import { authorizeAutomation, unauthorized } from "@/server/services/internal-api";
import { ensureAuthSchema, ensureComplianceSchema, ensureEventLogSchema } from "../../../../db";
import { processTransactionConfirmationJobs } from "@/server/services/transaction-confirmation";
import { processPrivacyRequestJobs } from "@/server/services/privacy-requests";

export async function POST(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });

  await Promise.all([ensureAuthSchema(), ensureComplianceSchema(), ensureEventLogSchema()]);
  const confirmations = await processTransactionConfirmationJobs({ db: env.DB, limit: 20 });
  const privacy = await processPrivacyRequestJobs({ db: env.DB, limit: 10 });
  const now = Math.floor(Date.now() / 1000);
  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM wallet_auth_challenges WHERE expires_at < ?").bind(now - 3600),
    env.DB.prepare("DELETE FROM wallet_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)").bind(now - 86400, now - 86400),
    env.DB.prepare("DELETE FROM rate_limit_buckets WHERE expires_at < ?").bind(now),
    env.DB.prepare("UPDATE transaction_operations SET status = 'expired', updated_at = CURRENT_TIMESTAMP WHERE (status IN ('draft','awaiting_signature','rejected') OR (status='unknown' AND signature IS NULL)) AND expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM background_jobs WHERE status = 'complete' AND updated_at < datetime('now', '-7 days')"),
    env.DB.prepare("DELETE FROM event_logs WHERE created_at < datetime('now', '-90 days')"),
    env.DB.prepare("DELETE FROM privacy_request_artifacts WHERE expires_at < ?").bind(now),
    env.DB.prepare(`INSERT INTO agent_alerts (id,alert_type,severity,status,subject,evidence_json)
      SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
      'privacy_request_overdue','high','open',p.id,json_object('requestType',p.request_type,'dueAt',p.due_at)
      FROM privacy_requests p WHERE p.status IN ('received','in_review','approved','processing') AND p.due_at<?
      AND NOT EXISTS (SELECT 1 FROM agent_alerts a WHERE a.alert_type='privacy_request_overdue' AND a.subject=p.id AND a.status='open')`).bind(now),
  ]);

  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    confirmations,
    privacy,
    changes: results.map((result) => result.meta.changes ?? 0),
  }, { headers: { "cache-control": "no-store" } });
}
