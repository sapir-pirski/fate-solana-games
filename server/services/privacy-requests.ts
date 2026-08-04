import { createHash } from "node:crypto";
import { increment, jsonLog } from "@/lib/telemetry";

export const PRIVACY_QUEUE = "privacy-request";
export const PRIVACY_REQUEST_TYPES = new Set(["access", "export", "erasure", "restriction", "rectification", "objection"]);
export const PRIVACY_ACTIVE_STATES = new Set(["received", "in_review", "approved", "processing"]);
export const PRIVACY_TERMINAL_STATES = new Set(["fulfilled", "partially_fulfilled", "rejected", "failed"]);

type PrivacyJob = { id: string; payload_json: string; attempts: number; max_attempts: number };
type PrivacyRequestRow = {
  id: string;
  wallet_address: string;
  request_type: string;
  status: string;
  requested_at: string;
  due_at: number;
  request_details_json: string;
};
type PrivacySummary = { claimed: number; completed: number; rescheduled: number; dead: number; reviewQueued: number; fulfilled: number; partiallyFulfilled: number; failed: number };
type WorkerOptions = { db: D1Database; limit?: number; workerId?: string; now?: () => number; random?: () => number };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const EXPORT_FORMAT = "fate-privacy-export-v1";
const EXPORT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_EXPORT_BYTES = 750_000;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const changed = (result: D1Result<unknown>) => Number(result.meta.changes ?? 0) > 0;
const boundedLimit = (value?: number) => Number.isInteger(value) && value! > 0 ? Math.min(value!, 25) : 10;

async function query<T>(db: D1Database, sql: string, ...params: unknown[]) {
  return (await db.prepare(sql).bind(...params).all<T>()).results;
}

async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}

function auditStatement(db: D1Database, wallet: string, eventType: string, decision: string, reason: string | null, evidence: Record<string, unknown>) {
  return db.prepare("INSERT INTO compliance_audit_events (id,wallet_hash,event_type,decision,reason,evidence_json) VALUES (?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), sha256(wallet), eventType, decision, reason, JSON.stringify(evidence).slice(0, 4_000));
}

async function claimJob(db: D1Database, workerId: string, now: number) {
  return db.prepare(`UPDATE background_jobs
    SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=(SELECT id FROM background_jobs WHERE queue=? AND attempts<max_attempts AND (
      (status='pending' AND available_at<=?) OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)
    ) ORDER BY available_at,id LIMIT 1)
    RETURNING id,payload_json,attempts,max_attempts`)
    .bind(workerId, now + 60, PRIVACY_QUEUE, now, now).first<PrivacyJob>();
}

async function completeJob(db: D1Database, job: PrivacyJob, workerId: string) {
  return db.prepare("UPDATE background_jobs SET status='complete',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND lease_owner=?")
    .bind(job.id, workerId).run();
}

async function deadJob(db: D1Database, job: PrivacyJob, workerId: string, code: string) {
  return db.prepare("UPDATE background_jobs SET status='dead',lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND lease_owner=?")
    .bind(code.slice(0, 180), job.id, workerId).run();
}

async function retryJob(db: D1Database, job: PrivacyJob, workerId: string, now: number, random: () => number, code: string) {
  if (job.attempts >= job.max_attempts) return { dead: true, result: await deadJob(db, job, workerId, "MAX_ATTEMPTS_EXCEEDED") };
  const delay = Math.min(3_600, 2 ** Math.min(job.attempts + 2, 11) + Math.floor(random() * 30));
  const result = await db.prepare("UPDATE background_jobs SET status='pending',available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND lease_owner=?")
    .bind(now + delay, code.slice(0, 180), job.id, workerId).run();
  return { dead: false, result };
}

function parseRequestId(payload: string) {
  try {
    const value = JSON.parse(payload) as { requestId?: unknown };
    return typeof value.requestId === "string" && UUID_PATTERN.test(value.requestId) ? value.requestId : null;
  } catch { return null; }
}

async function collectWalletData(db: D1Database, request: PrivacyRequestRow, generatedAt: string) {
  const wallet = request.wallet_address;
  const walletHash = sha256(wallet);
  const ownerKey = `wallet:${wallet}`;
  const likeWallet = `%${wallet}%`;
  const [
    complianceProfile, responsiblePlayLimits, gameEntries, games, transactionOperations,
    walletAuthChallenges, walletSessions, eventLogs, aiConversations, aiMessages,
    aiToolCalls, aiUsage, aiFeedback, agentRuns, agentAlerts, privacyRequests,
    complianceAuditEvents, chainEvents, rateLimitBuckets, backgroundJobs,
  ] = await Promise.all([
    query(db, "SELECT * FROM compliance_profiles WHERE wallet_address=?", wallet),
    query(db, "SELECT * FROM responsible_play_limits WHERE wallet_address=?", wallet),
    query(db, "SELECT * FROM game_entries WHERE wallet_address=? ORDER BY slot,event_index", wallet),
    query(db, "SELECT * FROM games WHERE creator=? OR winner=? OR address IN (SELECT game_address FROM game_entries WHERE wallet_address=?) ORDER BY last_slot", wallet, wallet, wallet),
    query(db, "SELECT * FROM transaction_operations WHERE wallet_address=? ORDER BY created_at", wallet),
    query(db, "SELECT id,wallet_address,expires_at,used_at,created_at FROM wallet_auth_challenges WHERE wallet_address=? ORDER BY created_at", wallet),
    query(db, "SELECT id,wallet_address,expires_at,last_seen_at,revoked_at,created_at FROM wallet_sessions WHERE wallet_address=? ORDER BY created_at", wallet),
    query(db, "SELECT * FROM event_logs WHERE wallet_address=? ORDER BY created_at", wallet),
    query(db, "SELECT * FROM ai_conversations WHERE owner_key=? ORDER BY created_at", ownerKey),
    query(db, "SELECT m.* FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.owner_key=? ORDER BY m.created_at", ownerKey),
    query(db, "SELECT t.* FROM ai_tool_calls t JOIN ai_conversations c ON c.id=t.conversation_id WHERE c.owner_key=? ORDER BY t.created_at", ownerKey),
    query(db, "SELECT u.* FROM ai_usage u LEFT JOIN ai_conversations c ON c.id=u.conversation_id WHERE u.wallet_hash=? OR c.owner_key=? ORDER BY u.created_at", walletHash, ownerKey),
    query(db, "SELECT f.* FROM ai_feedback f JOIN ai_messages m ON m.id=f.message_id JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.owner_key=? ORDER BY f.created_at", ownerKey),
    query(db, "SELECT * FROM agent_runs WHERE wallet_address=? ORDER BY started_at", wallet),
    query(db, "SELECT * FROM agent_alerts WHERE subject=? OR evidence_json LIKE ? ORDER BY created_at", wallet, `%${walletHash}%`),
    query(db, "SELECT id,request_type,status,requested_at,due_at,reviewed_at,completed_at,decision_reason,result_summary_json,updated_at FROM privacy_requests WHERE wallet_address=? ORDER BY requested_at", wallet),
    query(db, "SELECT * FROM compliance_audit_events WHERE wallet_hash=? ORDER BY created_at", walletHash),
    query(db, "SELECT * FROM chain_events WHERE payload_json LIKE ? ORDER BY slot,instruction_index,event_index", likeWallet),
    query(db, "SELECT scope,window_start,count,expires_at FROM rate_limit_buckets WHERE subject_hash=? ORDER BY window_start", walletHash),
    query(db, "SELECT id,queue,status,attempts,max_attempts,available_at,last_error,created_at,updated_at FROM background_jobs WHERE payload_json LIKE ? ORDER BY created_at", likeWallet),
  ]);
  return {
    format: EXPORT_FORMAT,
    generatedAt,
    request: { id: request.id, type: request.request_type, requestedAt: request.requested_at, dueAt: request.due_at },
    subject: { walletAddress: wallet },
    retentionNotice: [
      "Solana transactions and program state are public records outside FATE's control and cannot be erased by this service.",
      "Minimized security, fraud-prevention, compliance-audit, and active responsible-play records may be retained where required.",
    ],
    data: { complianceProfile, responsiblePlayLimits, gameEntries, games, transactionOperations, walletAuthChallenges, walletSessions, eventLogs, aiConversations, aiMessages, aiToolCalls, aiUsage, aiFeedback, agentRuns, agentAlerts, privacyRequests, complianceAuditEvents, chainEvents, rateLimitBuckets, backgroundJobs },
  };
}

async function fulfillExport(db: D1Database, request: PrivacyRequestRow, now: number) {
  const generatedAt = new Date(now * 1_000).toISOString();
  const payload = JSON.stringify(await collectWalletData(db, request, generatedAt));
  const bytes = new TextEncoder().encode(payload).byteLength;
  if (bytes > MAX_EXPORT_BYTES) {
    const summary = { outcome: "manual_delivery_required", reason: "export_exceeds_inline_limit", bytes, maximumBytes: MAX_EXPORT_BYTES };
    await db.batch([
      db.prepare("UPDATE privacy_requests SET status='partially_fulfilled',result_summary_json=?,completed_at=?,updated_at=? WHERE id=? AND status='processing'").bind(JSON.stringify(summary), generatedAt, generatedAt, request.id),
      auditStatement(db, request.wallet_address, "privacy_request_fulfilled", "partially_fulfilled", "export_exceeds_inline_limit", { requestId: request.id, requestType: request.request_type, bytes }),
    ]);
    return "partially_fulfilled" as const;
  }
  const checksum = await digest(payload);
  const configuredTtl = Number(process.env.PRIVACY_EXPORT_TTL_SECONDS ?? EXPORT_TTL_SECONDS);
  const exportTtl = Number.isFinite(configuredTtl) ? Math.min(30 * 86_400, Math.max(3_600, configuredTtl)) : EXPORT_TTL_SECONDS;
  const expiresAt = now + exportTtl;
  const summary = { outcome: "download_ready", checksumSha256: checksum, bytes, expiresAt };
  await db.batch([
    db.prepare(`INSERT INTO privacy_request_artifacts (id,request_id,wallet_address,payload_json,checksum_sha256,expires_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET wallet_address=excluded.wallet_address,payload_json=excluded.payload_json,checksum_sha256=excluded.checksum_sha256,expires_at=excluded.expires_at,downloaded_at=NULL,created_at=CURRENT_TIMESTAMP`)
      .bind(crypto.randomUUID(), request.id, request.wallet_address, payload, checksum, expiresAt),
    db.prepare("UPDATE privacy_requests SET status='fulfilled',result_summary_json=?,completed_at=?,updated_at=? WHERE id=? AND status='processing'").bind(JSON.stringify(summary), generatedAt, generatedAt, request.id),
    auditStatement(db, request.wallet_address, "privacy_request_fulfilled", "fulfilled", null, { requestId: request.id, requestType: request.request_type, checksumSha256: checksum, bytes, expiresAt }),
  ]);
  return "fulfilled" as const;
}

async function fulfillRestriction(db: D1Database, request: PrivacyRequestRow, now: number) {
  const completedAt = new Date(now * 1_000).toISOString();
  const summary = { outcome: "processing_restricted", scope: request.request_type };
  await db.batch([
    db.prepare("UPDATE compliance_profiles SET status='privacy_restricted',jurisdiction_status='review_required',updated_at=? WHERE wallet_address=?").bind(completedAt, request.wallet_address),
    db.prepare("UPDATE wallet_sessions SET revoked_at=? WHERE wallet_address=? AND revoked_at IS NULL").bind(now, request.wallet_address),
    db.prepare("UPDATE privacy_requests SET status='fulfilled',result_summary_json=?,completed_at=?,updated_at=? WHERE id=? AND status='processing'").bind(JSON.stringify(summary), completedAt, completedAt, request.id),
    auditStatement(db, request.wallet_address, "privacy_request_fulfilled", "fulfilled", null, { requestId: request.id, requestType: request.request_type, action: "processing_restricted" }),
  ]);
  return "fulfilled" as const;
}

async function fulfillRectification(db: D1Database, request: PrivacyRequestRow, now: number) {
  const details = JSON.parse(request.request_details_json || "{}") as { countryCode?: unknown };
  const countryCode = typeof details.countryCode === "string" ? details.countryCode.toUpperCase() : "";
  if (!COUNTRY_PATTERN.test(countryCode)) throw new Error("RECTIFICATION_DETAILS_REQUIRED");
  const completedAt = new Date(now * 1_000).toISOString();
  const profile = await db.prepare("SELECT wallet_address FROM compliance_profiles WHERE wallet_address=? LIMIT 1")
    .bind(request.wallet_address).first<{ wallet_address: string }>();
  if (!profile) {
    const summary = { outcome: "manual_review_required", reason: "compliance_profile_not_found", requestedCountryCode: countryCode };
    await db.batch([
      db.prepare("UPDATE privacy_requests SET status='partially_fulfilled',result_summary_json=?,completed_at=?,updated_at=? WHERE id=? AND status='processing'")
        .bind(JSON.stringify(summary), completedAt, completedAt, request.id),
      auditStatement(db, request.wallet_address, "privacy_request_fulfilled", "partially_fulfilled", "compliance_profile_not_found", { requestId: request.id, requestType: request.request_type, countryCode }),
    ]);
    return "partially_fulfilled" as const;
  }
  const summary = { outcome: "corrected", field: "countryCode", value: countryCode, complianceReviewRequired: true };
  await db.batch([
    db.prepare("UPDATE compliance_profiles SET country_code=?,status='manual_review',jurisdiction_status='review_required',updated_at=? WHERE wallet_address=?").bind(countryCode, completedAt, request.wallet_address),
    db.prepare("UPDATE privacy_requests SET status='fulfilled',result_summary_json=?,completed_at=?,updated_at=? WHERE id=? AND status='processing'").bind(JSON.stringify(summary), completedAt, completedAt, request.id),
    auditStatement(db, request.wallet_address, "privacy_request_fulfilled", "fulfilled", null, { requestId: request.id, requestType: request.request_type, correctedField: "countryCode", countryCode }),
  ]);
  return "fulfilled" as const;
}

async function fulfillErasure(db: D1Database, request: PrivacyRequestRow, now: number) {
  const active = await db.prepare("SELECT COUNT(*) count FROM transaction_operations WHERE wallet_address=? AND status NOT IN ('finalized','failed','rejected','expired')")
    .bind(request.wallet_address).first<{ count: number }>();
  if (Number(active?.count ?? 0) > 0) throw new Error("ACTIVE_TRANSACTIONS_PENDING");
  const limits = await db.prepare("SELECT cooldown_until,self_excluded_until FROM responsible_play_limits WHERE wallet_address=?").bind(request.wallet_address).first<{ cooldown_until: number | null; self_excluded_until: number | null }>();
  const activeRestriction = Math.max(limits?.cooldown_until ?? 0, limits?.self_excluded_until ?? 0) > now;
  const walletHash = sha256(request.wallet_address);
  const ownerKey = `wallet:${request.wallet_address}`;
  const erasedIdentity = `erased:${walletHash.slice(0, 24)}`;
  const completedAt = new Date(now * 1_000).toISOString();
  const summary = {
    outcome: "partially_fulfilled",
    erased: ["wallet sessions and challenges", "AI conversations and feedback", "agent runs", "eligibility profile", "direct identifiers in event and transaction recovery records"],
    retained: ["public Solana/indexer records", "hashed compliance audit evidence", ...(activeRestriction ? ["active responsible-play restriction until expiry"] : [])],
  };
  const statements = [
    db.prepare("DELETE FROM privacy_request_artifacts WHERE wallet_address=?").bind(request.wallet_address),
    db.prepare("DELETE FROM ai_feedback WHERE message_id IN (SELECT m.id FROM ai_messages m JOIN ai_conversations c ON c.id=m.conversation_id WHERE c.owner_key=?)").bind(ownerKey),
    db.prepare("DELETE FROM ai_tool_calls WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE owner_key=?)").bind(ownerKey),
    db.prepare("DELETE FROM ai_usage WHERE wallet_hash=? OR conversation_id IN (SELECT id FROM ai_conversations WHERE owner_key=?)").bind(walletHash, ownerKey),
    db.prepare("DELETE FROM ai_messages WHERE conversation_id IN (SELECT id FROM ai_conversations WHERE owner_key=?)").bind(ownerKey),
    db.prepare("DELETE FROM ai_conversations WHERE owner_key=?").bind(ownerKey),
    db.prepare("DELETE FROM agent_runs WHERE wallet_address=?").bind(request.wallet_address),
    db.prepare("DELETE FROM wallet_auth_challenges WHERE wallet_address=?").bind(request.wallet_address),
    db.prepare("DELETE FROM wallet_sessions WHERE wallet_address=?").bind(request.wallet_address),
    db.prepare("DELETE FROM rate_limit_buckets WHERE subject_hash=?").bind(walletHash),
    db.prepare("DELETE FROM background_jobs WHERE queue='transaction-confirmation' AND payload_json LIKE ?").bind(`%${request.wallet_address}%`),
    db.prepare("UPDATE event_logs SET wallet_address=NULL,session_id=NULL WHERE wallet_address=?").bind(request.wallet_address),
    db.prepare("UPDATE transaction_operations SET wallet_address=? WHERE wallet_address=?").bind(erasedIdentity, request.wallet_address),
    db.prepare("DELETE FROM compliance_profiles WHERE wallet_address=?").bind(request.wallet_address),
    ...(!activeRestriction ? [db.prepare("DELETE FROM responsible_play_limits WHERE wallet_address=?").bind(request.wallet_address)] : []),
    db.prepare("UPDATE privacy_requests SET wallet_address=? WHERE wallet_address=?").bind(erasedIdentity, request.wallet_address),
    db.prepare("UPDATE privacy_requests SET status='partially_fulfilled',result_summary_json=?,completed_at=?,updated_at=? WHERE id=? AND status='processing'").bind(JSON.stringify(summary), completedAt, completedAt, request.id),
    auditStatement(db, request.wallet_address, "privacy_request_fulfilled", "partially_fulfilled", "immutable_and_required_records_retained", { requestId: request.id, requestType: request.request_type, activeRestriction }),
  ];
  await db.batch(statements);
  return "partially_fulfilled" as const;
}

async function fulfill(db: D1Database, request: PrivacyRequestRow, now: number) {
  if (request.request_type === "access" || request.request_type === "export") return fulfillExport(db, request, now);
  if (request.request_type === "erasure") return fulfillErasure(db, request, now);
  if (request.request_type === "restriction" || request.request_type === "objection") return fulfillRestriction(db, request, now);
  if (request.request_type === "rectification") return fulfillRectification(db, request, now);
  throw new Error("UNSUPPORTED_PRIVACY_REQUEST");
}

export async function processPrivacyRequestJobs(options: WorkerOptions): Promise<PrivacySummary> {
  const summary: PrivacySummary = { claimed: 0, completed: 0, rescheduled: 0, dead: 0, reviewQueued: 0, fulfilled: 0, partiallyFulfilled: 0, failed: 0 };
  const now = options.now ?? (() => Math.floor(Date.now() / 1_000));
  const random = options.random ?? Math.random;
  const workerId = options.workerId ?? crypto.randomUUID();

  const exhausted = await query<{ request_id: string }>(options.db, `SELECT json_extract(payload_json,'$.requestId') request_id FROM background_jobs WHERE queue=? AND attempts>=max_attempts AND (status='pending' OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?))`, PRIVACY_QUEUE, now());
  if (exhausted.length) {
    await options.db.batch([
      ...exhausted.filter(row => UUID_PATTERN.test(row.request_id ?? "")).map(row => options.db.prepare("UPDATE privacy_requests SET status='failed',decision_reason='processing_retry_limit_exceeded',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('approved','processing')").bind(row.request_id)),
      options.db.prepare("UPDATE background_jobs SET status='dead',lease_owner=NULL,lease_expires_at=NULL,last_error='MAX_ATTEMPTS_EXCEEDED',updated_at=CURRENT_TIMESTAMP WHERE queue=? AND attempts>=max_attempts AND (status='pending' OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?))").bind(PRIVACY_QUEUE, now()),
    ]);
    summary.dead += exhausted.length;
    summary.failed += exhausted.length;
  }

  for (let index = 0; index < boundedLimit(options.limit); index += 1) {
    const job = await claimJob(options.db, workerId, now());
    if (!job) break;
    summary.claimed += 1;
    const requestId = parseRequestId(job.payload_json);
    if (!requestId) {
      if (changed(await deadJob(options.db, job, workerId, "INVALID_PRIVACY_PAYLOAD"))) summary.dead += 1;
      continue;
    }
    const privacyRequest = await options.db.prepare("SELECT id,wallet_address,request_type,status,requested_at,due_at,request_details_json FROM privacy_requests WHERE id=?")
      .bind(requestId).first<PrivacyRequestRow>();
    if (!privacyRequest || !PRIVACY_REQUEST_TYPES.has(privacyRequest.request_type)) {
      if (changed(await deadJob(options.db, job, workerId, "PRIVACY_REQUEST_NOT_FOUND"))) summary.dead += 1;
      continue;
    }
    if (privacyRequest.status === "received") {
      const reviewed = await options.db.batch([
        options.db.prepare("UPDATE privacy_requests SET status='in_review',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='received'").bind(requestId),
        auditStatement(options.db, privacyRequest.wallet_address, "privacy_request_review", "queued", null, { requestId, requestType: privacyRequest.request_type }),
      ]);
      if (changed(reviewed[0])) summary.reviewQueued += 1;
      if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
      continue;
    }
    if (privacyRequest.status === "in_review" || PRIVACY_TERMINAL_STATES.has(privacyRequest.status)) {
      if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
      continue;
    }
    if (!["approved", "processing"].includes(privacyRequest.status)) {
      if (changed(await deadJob(options.db, job, workerId, "INVALID_PRIVACY_STATE"))) summary.dead += 1;
      continue;
    }
    try {
      await options.db.prepare("UPDATE privacy_requests SET status='processing',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('approved','processing')").bind(requestId).run();
      const outcome = await fulfill(options.db, privacyRequest, now());
      if (outcome === "fulfilled") summary.fulfilled += 1;
      else summary.partiallyFulfilled += 1;
      if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
      increment("fate_privacy_requests_total", { outcome, type: privacyRequest.request_type });
    } catch (error) {
      const code = error instanceof Error ? error.message : "PRIVACY_PROCESSING_FAILED";
      const retry = await retryJob(options.db, job, workerId, now(), random, code);
      if (changed(retry.result)) {
        if (retry.dead) {
          summary.dead += 1;
          summary.failed += 1;
          await options.db.prepare("UPDATE privacy_requests SET status='failed',decision_reason=?,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='processing'").bind(code.slice(0, 180), requestId).run();
        } else summary.rescheduled += 1;
      }
      jsonLog("warn", "privacy_request_retry", "Privacy request processing will retry.", { component: "privacy", requestId, requestType: privacyRequest.request_type, errorCode: code });
    }
  }
  return summary;
}
