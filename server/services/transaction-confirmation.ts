import { increment, jsonLog, observe, withSpan } from "@/lib/telemetry";
import { decodeTransactionIntent } from "@/lib/solana/transaction-intent";

type ConfirmationPayload = {
  operationId: string;
  signature: string;
  walletAddress: string;
  traceparent: string | null;
};

type ConfirmationJob = {
  id: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
};

type TransactionOperation = {
  id: string;
  status: string;
  signature: string | null;
  wallet_address: string;
  last_valid_block_height: number | null;
  expires_at: number;
  game_type: string;
  action: string;
  amount_lamports: number;
  game_address: string;
  program_id: string;
  message_hash: string;
};

type SignatureStatus = {
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized" | null;
};

type FinalizedTransaction = {
  transaction?: [string, "base64"];
  meta?: { err?: unknown } | null;
};

type WorkerSummary = {
  claimed: number;
  completed: number;
  rescheduled: number;
  dead: number;
  finalized: number;
  confirmed: number;
  failed: number;
  expired: number;
};

type WorkerOptions = {
  db: D1Database;
  limit?: number;
  fetchImpl?: typeof fetch;
  rpcUrls?: string[];
  cluster?: string;
  workerId?: string;
  now?: () => number;
  random?: () => number;
};

const QUEUE = "transaction-confirmation";
const OPERATION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{80,100}$/;
const TERMINAL_STATES = new Set(["finalized", "failed", "rejected", "expired"]);

function boundedLimit(value: number | undefined) {
  return Number.isInteger(value) && value! > 0 ? Math.min(value!, 50) : 10;
}

function configuredRpcUrls(cluster: string, input?: string[]) {
  const publicEndpoint = cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : cluster === "testnet" ? "https://api.testnet.solana.com" : "https://api.devnet.solana.com";
  const publicFallbacks = cluster === "devnet" ? ["https://solana-devnet.api.onfinality.io/public"] : cluster === "mainnet-beta" ? ["https://solana-rpc.publicnode.com"] : [];
  const values = input ?? [
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    ...(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS ?? "").split(","),
    publicEndpoint,
    ...publicFallbacks,
  ];
  return values.filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()).filter((value, index, all) => all.indexOf(value) === index);
}

function parsePayload(value: string): ConfirmationPayload | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const operationId = typeof parsed.operationId === "string" ? parsed.operationId : "";
    const signature = typeof parsed.signature === "string" ? parsed.signature : "";
    const walletAddress = typeof parsed.walletAddress === "string" ? parsed.walletAddress : "";
    const traceparent = typeof parsed.traceparent === "string" && parsed.traceparent.length <= 256 ? parsed.traceparent : null;
    if (!OPERATION_PATTERN.test(operationId) || !WALLET_PATTERN.test(walletAddress) || !SIGNATURE_PATTERN.test(signature)) return null;
    return { operationId, signature, walletAddress, traceparent };
  } catch {
    return null;
  }
}

function createRpc(fetchImpl: typeof fetch, endpoints: string[]) {
  let requestId = 0;
  return async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (const endpoint of endpoints) {
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
        const body = await response.json() as { result?: T; error?: { code?: number } };
        if (body.error || body.result === undefined) throw new Error(`RPC_${body.error?.code ?? "INVALID_RESPONSE"}`);
        return body.result;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("SOLANA_RPC_UNAVAILABLE");
  };
}

async function claimJob(db: D1Database, workerId: string, now: number) {
  return db.prepare(`UPDATE background_jobs
    SET status='running',lease_owner=?,lease_expires_at=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP
    WHERE id=(
      SELECT id FROM background_jobs
      WHERE queue=? AND attempts<max_attempts AND (
        (status='pending' AND available_at<=?) OR
        (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)
      )
      ORDER BY available_at ASC,id ASC LIMIT 1
    )
    RETURNING id,payload_json,attempts,max_attempts`)
    .bind(workerId, now + 60, QUEUE, now, now)
    .first<ConfirmationJob>();
}

async function deadLetterExhaustedJobs(db: D1Database, now: number) {
  return db.prepare(`UPDATE background_jobs
    SET status='dead',lease_owner=NULL,lease_expires_at=NULL,last_error='MAX_ATTEMPTS_EXCEEDED',updated_at=CURRENT_TIMESTAMP
    WHERE queue=? AND attempts>=max_attempts AND (
      status='pending' OR (status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)
    )`).bind(QUEUE, now).run();
}

async function completeJob(db: D1Database, job: ConfirmationJob, workerId: string) {
  return db.prepare("UPDATE background_jobs SET status='complete',lease_owner=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND lease_owner=?")
    .bind(job.id, workerId).run();
}

async function deadLetterJob(db: D1Database, job: ConfirmationJob, workerId: string, errorCode: string) {
  return db.prepare("UPDATE background_jobs SET status='dead',lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND lease_owner=?")
    .bind(errorCode.slice(0, 180), job.id, workerId).run();
}

async function rescheduleJob(db: D1Database, job: ConfirmationJob, workerId: string, now: number, random: () => number, errorCode: string) {
  if (job.attempts >= job.max_attempts) return { dead: true, result: await deadLetterJob(db, job, workerId, "MAX_ATTEMPTS_EXCEEDED") };
  const delay = Math.min(300, 2 ** Math.min(job.attempts, 8) + Math.floor(random() * 4));
  const result = await db.prepare("UPDATE background_jobs SET status='pending',available_at=?,lease_owner=NULL,lease_expires_at=NULL,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='running' AND lease_owner=?")
    .bind(now + delay, errorCode.slice(0, 180), job.id, workerId).run();
  return { dead: false, result };
}

async function updateOperation(db: D1Database, operation: TransactionOperation, status: string, errorCode: string | null = null) {
  const allowed = status === "confirmed" ? ["submitted", "unknown"] : status === "finalized" ? ["submitted", "confirmed", "unknown"] : ["submitted", "unknown"];
  const placeholders = allowed.map(() => "?").join(",");
  return db.prepare(`UPDATE transaction_operations SET status=?,error_code=?,error_message=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN (${placeholders})`)
    .bind(status, errorCode, operation.id, ...allowed).run();
}

async function verifyFinalizedIntent(operation: TransactionOperation, payload: ConfirmationPayload, rpc: <T>(method: string, params: unknown[]) => Promise<T>) {
  if (!operation.program_id || !operation.message_hash || !operation.game_address) throw new Error("MISSING_APPROVED_INTENT");
  const finalized = await rpc<FinalizedTransaction | null>("getTransaction", [payload.signature, { commitment: "finalized", encoding: "base64", maxSupportedTransactionVersion: 0 }]);
  const encoded = finalized?.transaction;
  if (!encoded || encoded[1] !== "base64") throw new Error("FINALIZED_TRANSACTION_UNAVAILABLE");
  if (finalized?.meta?.err) throw new Error("SOLANA_TRANSACTION_FAILED");
  const decoded = await decodeTransactionIntent({
    serializedTransactionBase64: encoded[0], walletAddress: payload.walletAddress,
    programId: operation.program_id, requireUnsigned: false,
  });
  const amountMatches = decoded.amountLamports === null || Number(decoded.amountLamports) === operation.amount_lamports;
  if (decoded.messageHash !== operation.message_hash || decoded.gameType !== operation.game_type || decoded.action !== operation.action || decoded.gameAddress !== operation.game_address || !amountMatches) {
    throw new Error("TRANSACTION_INTENT_MISMATCH");
  }
}

function changed(result: D1Result<unknown>) {
  return Number(result.meta.changes ?? 0) > 0;
}

export async function processTransactionConfirmationJobs(options: WorkerOptions): Promise<WorkerSummary> {
  const started = Date.now();
  const summary: WorkerSummary = { claimed: 0, completed: 0, rescheduled: 0, dead: 0, finalized: 0, confirmed: 0, failed: 0, expired: 0 };
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const random = options.random ?? Math.random;
  const workerId = options.workerId ?? crypto.randomUUID();
  const cluster = options.cluster ?? process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const endpoints = configuredRpcUrls(cluster, options.rpcUrls);
  const rpc = createRpc(options.fetchImpl ?? fetch, endpoints);

  const exhausted = await deadLetterExhaustedJobs(options.db, now());
  summary.dead += Number(exhausted.meta.changes ?? 0);
  if (summary.dead) increment("fate_confirmation_jobs_total", { outcome: "dead_abandoned" }, summary.dead);

  for (let index = 0; index < boundedLimit(options.limit); index += 1) {
    const job = await claimJob(options.db, workerId, now());
    if (!job) break;
    summary.claimed += 1;
    const payload = parsePayload(job.payload_json);
    if (!payload) {
      if (changed(await deadLetterJob(options.db, job, workerId, "INVALID_CONFIRMATION_PAYLOAD"))) summary.dead += 1;
      increment("fate_confirmation_jobs_total", { outcome: "dead_invalid_payload" });
      continue;
    }

    await withSpan("transaction.confirmation", { component: "confirmation-worker", cluster, attempt: job.attempts }, async () => {
      const operation = await options.db.prepare("SELECT id,status,signature,wallet_address,last_valid_block_height,expires_at,game_type,action,amount_lamports,game_address,program_id,message_hash FROM transaction_operations WHERE operation_id=?")
        .bind(payload.operationId).first<TransactionOperation>();
      if (!operation || operation.signature !== payload.signature || operation.wallet_address !== payload.walletAddress) {
        if (changed(await deadLetterJob(options.db, job, workerId, "OPERATION_MISMATCH"))) summary.dead += 1;
        increment("fate_confirmation_jobs_total", { outcome: "dead_operation_mismatch" });
        return;
      }
      if (TERMINAL_STATES.has(operation.status)) {
        if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
        increment("fate_confirmation_jobs_total", { outcome: "already_terminal" });
        return;
      }
      if (!["submitted", "confirmed", "unknown"].includes(operation.status)) {
        if (changed(await deadLetterJob(options.db, job, workerId, "INVALID_OPERATION_STATE"))) summary.dead += 1;
        increment("fate_confirmation_jobs_total", { outcome: "dead_invalid_state" });
        return;
      }

      try {
        const statuses = await rpc<{ value: Array<SignatureStatus | null> }>("getSignatureStatuses", [[payload.signature], { searchTransactionHistory: true }]);
        const status = statuses.value[0] ?? null;
        if (status?.err) {
          if (changed(await updateOperation(options.db, operation, "failed", "SOLANA_TRANSACTION_FAILED"))) summary.failed += 1;
          if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
          increment("fate_confirmation_jobs_total", { outcome: "failed" });
          return;
        }
        if (status?.confirmationStatus === "finalized") {
          try {
            await verifyFinalizedIntent(operation, payload, rpc);
          } catch (error) {
            const code = error instanceof Error ? error.message : "TRANSACTION_INTENT_MISMATCH";
            if (code === "FINALIZED_TRANSACTION_UNAVAILABLE") {
              const retry = await rescheduleJob(options.db, job, workerId, now(), random, code);
              if (changed(retry.result)) {
                if (retry.dead) summary.dead += 1;
                else summary.rescheduled += 1;
              }
              increment("fate_confirmation_jobs_total", { outcome: retry.dead ? "dead_finalized_fetch" : "finalized_fetch_retry" });
              return;
            }
            if (changed(await updateOperation(options.db, operation, "failed", code === "SOLANA_TRANSACTION_FAILED" ? code : "TRANSACTION_INTENT_MISMATCH"))) summary.failed += 1;
            if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
            increment("fate_confirmation_jobs_total", { outcome: "failed_intent_verification" });
            return;
          }
          if (changed(await updateOperation(options.db, operation, "finalized"))) summary.finalized += 1;
          if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
          increment("fate_confirmation_jobs_total", { outcome: "finalized" });
          return;
        }
        if (status?.confirmationStatus === "confirmed" && operation.status !== "confirmed") {
          if (changed(await updateOperation(options.db, operation, "confirmed"))) summary.confirmed += 1;
        }

        if (!status && operation.status !== "confirmed") {
          const blockHeight = await rpc<number>("getBlockHeight", [{ commitment: "confirmed" }]);
          const blockhashExpired = operation.last_valid_block_height !== null && blockHeight > operation.last_valid_block_height;
          if (blockhashExpired || operation.expires_at < now()) {
            if (changed(await updateOperation(options.db, operation, "expired", "TRANSACTION_EXPIRED"))) summary.expired += 1;
            if (changed(await completeJob(options.db, job, workerId))) summary.completed += 1;
            increment("fate_confirmation_jobs_total", { outcome: "expired" });
            return;
          }
        }

        const retry = await rescheduleJob(options.db, job, workerId, now(), random, status?.confirmationStatus === "confirmed" ? "AWAITING_FINALIZATION" : "SIGNATURE_NOT_FINALIZED");
        if (changed(retry.result)) {
          if (retry.dead) summary.dead += 1;
          else summary.rescheduled += 1;
        }
        increment("fate_confirmation_jobs_total", { outcome: retry.dead ? "dead_max_attempts" : "rescheduled" });
      } catch (error) {
        const errorCode = error instanceof Error ? error.message : "CONFIRMATION_UNKNOWN_ERROR";
        const retry = await rescheduleJob(options.db, job, workerId, now(), random, errorCode);
        if (changed(retry.result)) {
          if (retry.dead) summary.dead += 1;
          else summary.rescheduled += 1;
        }
        increment("fate_confirmation_jobs_total", { outcome: retry.dead ? "dead_rpc" : "rpc_retry" });
      }
    }, payload.traceparent ?? undefined);
  }

  observe("fate_confirmation_job_duration_ms", Date.now() - started, { cluster });
  jsonLog("info", "confirmation_worker_complete", "Transaction confirmation jobs processed.", { cluster, ...summary });
  return summary;
}
