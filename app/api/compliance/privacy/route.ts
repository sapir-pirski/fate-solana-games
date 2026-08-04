import { ensureApplicationSchema, getD1, withDatabase } from "@/db";
import { authenticatedWallet, nowSeconds, requireSameOrigin, sha256 } from "@/server/services/auth";
import { enforceRateLimit, rateLimitResponse } from "@/server/services/coordination";
import { PRIVACY_ACTIVE_STATES, PRIVACY_QUEUE, PRIVACY_REQUEST_TYPES } from "@/server/services/privacy-requests";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

type PrivacyRequestView = {
  id: string; request_type: string; status: string; requested_at: string; due_at: number;
  reviewed_at: string | null; completed_at: string | null; decision_reason: string | null;
  result_summary_json: string; updated_at: string; artifact_expires_at: number | null;
};

function requestView(row: PrivacyRequestView, now: number) {
  let resultSummary: Record<string, unknown> = {};
  try { resultSummary = JSON.parse(row.result_summary_json || "{}"); } catch { resultSummary = {}; }
  return {
    id: row.id,
    requestType: row.request_type,
    status: row.status,
    requestedAt: row.requested_at,
    dueAt: row.due_at,
    reviewedAt: row.reviewed_at,
    completedAt: row.completed_at,
    decisionReason: row.decision_reason,
    resultSummary,
    updatedAt: row.updated_at,
    artifactExpiresAt: row.artifact_expires_at,
    downloadAvailable: row.status === "fulfilled" && (row.artifact_expires_at ?? 0) > now,
  };
}

async function handleGet(request: Request) {
  const session = await authenticatedWallet(request);
  if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  await ensureApplicationSchema();
  const database = getD1();
  const now = nowSeconds();
  const downloadId = new URL(request.url).searchParams.get("download");
  if (downloadId) {
    if (!UUID_PATTERN.test(downloadId)) return Response.json({ code: "INVALID_PRIVACY_REQUEST" }, { status: 400 });
    const artifact = await database.prepare(`SELECT a.payload_json,a.checksum_sha256,a.expires_at,p.request_type,p.status
      FROM privacy_request_artifacts a JOIN privacy_requests p ON p.id=a.request_id
      WHERE a.request_id=? AND a.wallet_address=? AND p.wallet_address=?`)
      .bind(downloadId, session.walletAddress, session.walletAddress)
      .first<{ payload_json: string; checksum_sha256: string; expires_at: number; request_type: string; status: string }>();
    if (!artifact || artifact.status !== "fulfilled") return Response.json({ code: "PRIVACY_EXPORT_NOT_FOUND" }, { status: 404 });
    if (artifact.expires_at <= now) {
      await database.prepare("DELETE FROM privacy_request_artifacts WHERE request_id=? AND wallet_address=?").bind(downloadId, session.walletAddress).run();
      return Response.json({ code: "PRIVACY_EXPORT_EXPIRED" }, { status: 410 });
    }
    await database.prepare("UPDATE privacy_request_artifacts SET downloaded_at=CURRENT_TIMESTAMP WHERE request_id=? AND wallet_address=?").bind(downloadId, session.walletAddress).run();
    return new Response(artifact.payload_json, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="fate-${artifact.request_type}-${downloadId}.json"`,
        "cache-control": "no-store, private",
        "x-content-type-options": "nosniff",
        "x-fate-export-checksum": artifact.checksum_sha256,
      },
    });
  }
  const rows = await database.prepare(`SELECT p.id,p.request_type,p.status,p.requested_at,p.due_at,p.reviewed_at,p.completed_at,p.decision_reason,p.result_summary_json,p.updated_at,a.expires_at artifact_expires_at
    FROM privacy_requests p LEFT JOIN privacy_request_artifacts a ON a.request_id=p.id
    WHERE p.wallet_address=? ORDER BY p.requested_at DESC LIMIT 50`)
    .bind(session.walletAddress).all<PrivacyRequestView>();
  return Response.json({ requests: rows.results.map(row => requestView(row, now)) }, { headers: { "cache-control": "no-store, private" } });
}

async function handlePost(request: Request) {
  if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const session = await authenticatedWallet(request);
  if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  await ensureApplicationSchema();
  const body = await request.json() as { requestType?: unknown; details?: unknown };
  const requestType = typeof body.requestType === "string" ? body.requestType : "";
  if (!PRIVACY_REQUEST_TYPES.has(requestType)) return Response.json({ code: "INVALID_PRIVACY_REQUEST" }, { status: 400 });
  const detailsInput = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details as Record<string, unknown> : {};
  const details = requestType === "rectification" && typeof detailsInput.countryCode === "string" && COUNTRY_PATTERN.test(detailsInput.countryCode.toUpperCase())
    ? { countryCode: detailsInput.countryCode.toUpperCase() }
    : {};
  const rate = await enforceRateLimit({ scope: "privacy_request", subject: session.walletAddress, limit: 10, windowSeconds: 86_400 });
  if (!rate.allowed) return rateLimitResponse(rate);
  const database = getD1();
  const active = await database.prepare(`SELECT id,request_type,status,requested_at,due_at,reviewed_at,completed_at,decision_reason,result_summary_json,updated_at,NULL artifact_expires_at
    FROM privacy_requests WHERE wallet_address=? AND request_type=? AND status IN ('received','in_review','approved','processing') ORDER BY requested_at DESC LIMIT 1`)
    .bind(session.walletAddress, requestType).first<PrivacyRequestView>();
  if (active && PRIVACY_ACTIVE_STATES.has(active.status)) {
    return Response.json({ request: requestView(active, nowSeconds()), duplicate: true }, { status: 200, headers: { "cache-control": "no-store" } });
  }
  const now = nowSeconds();
  const id = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const configuredDeadline = Number(process.env.PRIVACY_REQUEST_DEADLINE_DAYS ?? 30);
  const deadlineDays = Number.isFinite(configuredDeadline) ? Math.min(90, Math.max(1, configuredDeadline)) : 30;
  const dueAt = now + deadlineDays * 86_400;
  await database.batch([
    database.prepare(`INSERT INTO privacy_requests (id,wallet_address,request_type,status,due_at,request_details_json,result_summary_json,updated_at)
      VALUES (?,?,?,'received',?,?,'{}',CURRENT_TIMESTAMP)`).bind(id, session.walletAddress, requestType, dueAt, JSON.stringify(details)),
    database.prepare(`INSERT INTO background_jobs (id,queue,dedupe_key,payload_json,status,attempts,max_attempts,available_at)
      VALUES (?,?,?,?,'pending',0,8,?)`).bind(jobId, PRIVACY_QUEUE, id, JSON.stringify({ requestId: id }), now),
    database.prepare("INSERT INTO compliance_audit_events (id,wallet_hash,event_type,decision,reason,evidence_json) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), sha256(session.walletAddress), "privacy_request", "received", null, JSON.stringify({ requestId: id, requestType, dueAt })),
  ]);
  return Response.json({ request: { id, requestType, status: "received", dueAt }, message: "Request received and queued for review." }, { status: 202, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) { return withDatabase(() => handleGet(request)); }
export async function POST(request: Request) { return withDatabase(() => handlePost(request)); }
