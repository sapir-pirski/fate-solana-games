import { ensureApplicationSchema, getD1, withDatabase } from "@/db";
import { nowSeconds, sha256 } from "@/server/services/auth";
import { authorizeAutomation, unauthorized } from "@/server/services/internal-api";
import { PRIVACY_QUEUE, PRIVACY_REQUEST_TYPES, processPrivacyRequestJobs } from "@/server/services/privacy-requests";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const FILTER_STATES = new Set(["received", "in_review", "approved", "processing", "fulfilled", "partially_fulfilled", "rejected", "failed"]);
const ACTIONS = new Set(["review", "approve", "reject"]);

async function handleGet(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "";
  const requestType = url.searchParams.get("type") ?? "";
  if (status && !FILTER_STATES.has(status)) return Response.json({ code: "INVALID_STATUS" }, { status: 400 });
  if (requestType && !PRIVACY_REQUEST_TYPES.has(requestType)) return Response.json({ code: "INVALID_PRIVACY_REQUEST" }, { status: 400 });
  const predicates: string[] = [];
  const params: string[] = [];
  if (status) { predicates.push("status=?"); params.push(status); }
  if (requestType) { predicates.push("request_type=?"); params.push(requestType); }
  const rows = await getD1().prepare(`SELECT id,wallet_address,request_type,status,requested_at,due_at,reviewed_at,completed_at,reviewer_id,decision_reason,request_details_json,result_summary_json,updated_at
    FROM privacy_requests ${predicates.length ? `WHERE ${predicates.join(" AND ")}` : ""} ORDER BY CASE status WHEN 'received' THEN 0 WHEN 'in_review' THEN 1 WHEN 'approved' THEN 2 WHEN 'processing' THEN 3 ELSE 4 END,due_at,requested_at LIMIT 100`)
    .bind(...params).all();
  return Response.json({ requests: rows.results }, { headers: { "cache-control": "no-store, private" } });
}

async function handlePost(request: Request) {
  const body = await request.json() as { requestId?: unknown; action?: unknown; reason?: unknown; details?: unknown };
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  if (!UUID_PATTERN.test(requestId) || !ACTIONS.has(action)) return Response.json({ code: "INVALID_ADMIN_DECISION" }, { status: 400 });
  if (action === "reject" && !reason) return Response.json({ code: "DECISION_REASON_REQUIRED" }, { status: 400 });
  const database = getD1();
  const current = await database.prepare("SELECT id,wallet_address,request_type,status,request_details_json FROM privacy_requests WHERE id=?").bind(requestId)
    .first<{ id: string; wallet_address: string; request_type: string; status: string; request_details_json: string }>();
  if (!current) return Response.json({ code: "PRIVACY_REQUEST_NOT_FOUND" }, { status: 404 });
  if (!PRIVACY_REQUEST_TYPES.has(current.request_type)) return Response.json({ code: "INVALID_PRIVACY_REQUEST" }, { status: 409 });
  const allowed = action === "review" ? ["received"] : ["received", "in_review"];
  if (!allowed.includes(current.status)) return Response.json({ code: "INVALID_PRIVACY_STATE", currentStatus: current.status }, { status: 409 });

  let detailsJson = current.request_details_json || "{}";
  if (action === "approve" && current.request_type === "rectification") {
    const details = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? body.details as Record<string, unknown> : {};
    const countryCode = typeof details.countryCode === "string" ? details.countryCode.toUpperCase() : "";
    if (!COUNTRY_PATTERN.test(countryCode)) return Response.json({ code: "RECTIFICATION_DETAILS_REQUIRED" }, { status: 400 });
    detailsJson = JSON.stringify({ countryCode });
  }
  const now = nowSeconds();
  const timestamp = new Date(now * 1_000).toISOString();
  const nextStatus = action === "review" ? "in_review" : action === "approve" ? "approved" : "rejected";
  const jobId = crypto.randomUUID();
  const statements = [
    database.prepare(`UPDATE privacy_requests SET status=?,reviewer_id='internal-automation',reviewed_at=?,decision_reason=?,request_details_json=?,completed_at=?,updated_at=? WHERE id=? AND status IN (${allowed.map(() => "?").join(",")})`)
      .bind(nextStatus, timestamp, reason || null, detailsJson, action === "reject" ? timestamp : null, timestamp, requestId, ...allowed),
    database.prepare("INSERT INTO compliance_audit_events (id,wallet_hash,event_type,decision,reason,evidence_json) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), sha256(current.wallet_address), "privacy_request_decision", nextStatus, reason || null, JSON.stringify({ requestId, requestType: current.request_type, action })),
  ];
  if (action === "approve") statements.push(database.prepare(`INSERT INTO background_jobs (id,queue,dedupe_key,payload_json,status,attempts,max_attempts,available_at)
    VALUES (?,?,?,?,'pending',0,8,?) ON CONFLICT(queue,dedupe_key) DO UPDATE SET payload_json=excluded.payload_json,status='pending',attempts=0,max_attempts=8,available_at=excluded.available_at,lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP`)
    .bind(jobId, PRIVACY_QUEUE, requestId, JSON.stringify({ requestId }), now));
  const results = await database.batch(statements);
  if (Number(results[0].meta.changes ?? 0) !== 1) return Response.json({ code: "PRIVACY_REQUEST_CONFLICT" }, { status: 409 });
  const processing = action === "approve" ? await processPrivacyRequestJobs({ db: database, limit: 1 }) : null;
  const updated = await database.prepare("SELECT id,wallet_address,request_type,status,requested_at,due_at,reviewed_at,completed_at,reviewer_id,decision_reason,result_summary_json,updated_at FROM privacy_requests WHERE id=?").bind(requestId).first();
  return Response.json({ request: updated, processing }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  await ensureApplicationSchema();
  return withDatabase(() => handleGet(request));
}

export async function POST(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  await ensureApplicationSchema();
  return withDatabase(() => handlePost(request));
}
