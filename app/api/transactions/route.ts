import { and, desc, eq, inArray } from "drizzle-orm";
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { env } from "cloudflare:workers";
import { ensureAuthSchema, getDb, withDatabase } from "../../../db";
import { transactionOperations } from "../../../db/schema";
import { authenticatedWallet, nowSeconds, OPERATION_PATTERN, requireSameOrigin } from "@/server/services/auth";
import { enforceRateLimit, enqueueJob, rateLimitResponse } from "@/server/services/coordination";
import { auditCompliance, wagerDecision } from "@/server/services/compliance";
import { isValidGameAction } from "@/lib/transactions";
import { decodeTransactionIntent, TransactionIntentError } from "@/lib/solana/transaction-intent";
import { processTransactionConfirmationJobs } from "@/server/services/transaction-confirmation";

const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{80,100}$/;
const CLIENT_STATES = new Set(["awaiting_signature", "submitted", "rejected", "failed", "expired", "unknown"]);
const transitions: Record<string, Set<string>> = {
  draft: new Set(["awaiting_signature", "failed"]),
  awaiting_signature: new Set(["submitted", "rejected", "failed", "expired"]),
  submitted: new Set(["failed", "expired", "unknown"]),
  unknown: new Set(["submitted", "failed", "expired"]),
};
const COINFLIP_GAME_DISCRIMINATOR = Buffer.from([103, 119, 176, 171, 170, 204, 73, 25]);

function configuredProgramId() {
  return process.env.FATE_PROGRAM_ID?.trim() || process.env.NEXT_PUBLIC_FATE_PROGRAM_ID?.trim() || "";
}

function configuredRpcUrls() {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const publicEndpoint = cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : cluster === "testnet" ? "https://api.testnet.solana.com" : "https://api.devnet.solana.com";
  return [process.env.SOLANA_RPC_URL, process.env.NEXT_PUBLIC_SOLANA_RPC_URL, ...(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS ?? "").split(","), publicEndpoint]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(value => value.trim())
    .filter((value, index, all) => all.indexOf(value) === index);
}

async function coinflipJoinAmount(gameAddress: string, programId: string) {
  let lastError: unknown;
  for (const endpoint of configuredRpcUrls()) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "getAccountInfo", params: [gameAddress, { encoding: "base64", commitment: "confirmed" }] }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
      const payload = await response.json() as { result?: { value?: { data?: [string, string]; owner?: string } | null }; error?: unknown };
      const value = payload.result?.value;
      if (!value || value.owner !== programId || !Array.isArray(value.data) || value.data[1] !== "base64") throw new Error("INVALID_COINFLIP_ACCOUNT");
      const data = Buffer.from(value.data[0], "base64");
      if (data.length < 90 || !data.subarray(0, 8).equals(COINFLIP_GAME_DISCRIMINATOR)) throw new Error("INVALID_COINFLIP_ACCOUNT");
      const id = data.readBigUInt64LE(8);
      const idBytes = Buffer.alloc(8); idBytes.writeBigUInt64LE(id);
      const expected = PublicKey.findProgramAddressSync([Buffer.from("coinflip"), idBytes], new PublicKey(programId))[0].toBase58();
      if (expected !== gameAddress || data[89] !== 0) throw new Error("COINFLIP_NOT_OPEN");
      const amount = data.readBigUInt64LE(81);
      if (amount === 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("INVALID_COINFLIP_WAGER");
      return Number(amount);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SOLANA_RPC_UNAVAILABLE");
}

export async function GET(request: Request) {
  return withDatabase(async () => {
    await ensureAuthSchema();
    const session = await authenticatedWallet(request);
    if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    if (env.DB) await processTransactionConfirmationJobs({ db: env.DB, limit: 3 }).catch(() => undefined);
    const terminal = new URL(request.url).searchParams.get("includeTerminal") === "true";
    const predicate = terminal
      ? eq(transactionOperations.walletAddress, session.walletAddress)
      : and(eq(transactionOperations.walletAddress, session.walletAddress), inArray(transactionOperations.status, ["draft", "awaiting_signature", "submitted", "confirmed", "unknown"]));
    const operations = await getDb().select().from(transactionOperations).where(predicate).orderBy(desc(transactionOperations.updatedAt)).limit(100);
    return Response.json({ operations }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(request: Request) {
  return withDatabase(async () => {
    if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
    await ensureAuthSchema();
    const session = await authenticatedWallet(request);
    if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const operationId = String(body.operationId ?? "");
    const declaredGameType = String(body.gameType ?? "");
    const declaredAction = String(body.action ?? "");
    const serializedTransactionBase64 = typeof body.unsignedTransaction === "string" ? body.unsignedTransaction : "";
    const lastValidBlockHeight = Number.isSafeInteger(body.lastValidBlockHeight) ? Number(body.lastValidBlockHeight) : null;
    const programId = configuredProgramId();
    if (!OPERATION_PATTERN.test(operationId) || !isValidGameAction(declaredGameType, declaredAction) || !programId || lastValidBlockHeight === null) {
      return Response.json({ code: "INVALID_OPERATION" }, { status: 400 });
    }

    let intent;
    try {
      intent = await decodeTransactionIntent({ serializedTransactionBase64, walletAddress: session.walletAddress, programId, requireUnsigned: true });
    } catch (error) {
      const code = error instanceof TransactionIntentError ? error.code : "INVALID_TRANSACTION";
      return Response.json({ code }, { status: 400 });
    }
    if (intent.gameType !== declaredGameType || intent.action !== declaredAction) return Response.json({ code: "TRANSACTION_METADATA_MISMATCH" }, { status: 400 });

    let amountLamports: number;
    try {
      amountLamports = intent.amountLamports === null ? await coinflipJoinAmount(intent.gameAddress, intent.programId) : Number(intent.amountLamports);
    } catch {
      return Response.json({ code: "WAGER_VERIFICATION_UNAVAILABLE" }, { status: 503 });
    }
    const compliance = await wagerDecision(session.walletAddress, amountLamports);
    if (!compliance.allowed) {
      await auditCompliance(session.walletAddress, "transaction_gate", "denied", compliance.code, { amountLamports, messageHash: intent.messageHash });
      return Response.json({ code: compliance.code, complianceRequired: true }, { status: 403 });
    }
    const rate = await enforceRateLimit({ scope: "transaction_create", subject: session.walletAddress, limit: 20, windowSeconds: 60 });
    if (!rate.allowed) return rateLimitResponse(rate);

    const [existing] = await getDb().select().from(transactionOperations).where(eq(transactionOperations.operationId, operationId)).limit(1);
    if (existing) {
      if (existing.walletAddress !== session.walletAddress) return Response.json({ code: "OPERATION_CONFLICT" }, { status: 409 });
      if (existing.messageHash !== intent.messageHash) return Response.json({ code: "OPERATION_INTENT_CONFLICT" }, { status: 409 });
      return Response.json({ operation: existing, idempotent: true });
    }

    const now = nowSeconds();
    const operation = {
      id: crypto.randomUUID(), operationId, walletAddress: session.walletAddress,
      gameType: intent.gameType, action: intent.action, status: "draft",
      amountLamports, gameAddress: intent.gameAddress, programId: intent.programId, messageHash: intent.messageHash,
      lastValidBlockHeight, expiresAt: now + 600, attempts: 0, updatedAt: new Date().toISOString(),
    };
    await getDb().insert(transactionOperations).values(operation);
    await auditCompliance(session.walletAddress, "transaction_gate", "allowed", null, {
      gameType: intent.gameType, action: intent.action, amountLamports, gameAddress: intent.gameAddress,
      messageHash: intent.messageHash, network: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    });
    return Response.json({ operation }, { status: 201 });
  });
}

export async function PATCH(request: Request) {
  return withDatabase(async () => {
    if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
    await ensureAuthSchema();
    const session = await authenticatedWallet(request);
    if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const operationId = String(body.operationId ?? "");
    const status = String(body.status ?? "");
    if (!OPERATION_PATTERN.test(operationId) || !CLIENT_STATES.has(status)) return Response.json({ code: "INVALID_STATE" }, { status: 400 });
    const [current] = await getDb().select().from(transactionOperations)
      .where(and(eq(transactionOperations.operationId, operationId), eq(transactionOperations.walletAddress, session.walletAddress))).limit(1);
    if (!current) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (current.status !== status && !transitions[current.status]?.has(status)) return Response.json({ code: "INVALID_TRANSITION", from: current.status, to: status }, { status: 409 });
    const submittedSignature = typeof body.signature === "string" ? body.signature : null;
    if (status === "submitted" && (!submittedSignature || !SIGNATURE_PATTERN.test(submittedSignature))) return Response.json({ code: "INVALID_SIGNATURE" }, { status: 400 });
    const signature = submittedSignature ?? current.signature;
    const errorCode = typeof body.errorCode === "string" ? body.errorCode.slice(0, 100) : null;
    const errorMessage = typeof body.errorMessage === "string" ? body.errorMessage.slice(0, 500) : null;
    await getDb().update(transactionOperations).set({
      status, signature, errorCode, errorMessage,
      attempts: current.attempts + (status === "submitted" ? 1 : 0), updatedAt: new Date().toISOString(),
    }).where(eq(transactionOperations.id, current.id));
    if (signature && status === "submitted") {
      await enqueueJob({ queue: "transaction-confirmation", dedupeKey: operationId, payload: { operationId, signature, walletAddress: session.walletAddress, traceparent: request.headers.get("traceparent") }, delaySeconds: 0 });
      if (env.DB) await processTransactionConfirmationJobs({ db: env.DB, limit: 1 }).catch(() => undefined);
    }
    return Response.json({ operation: { ...current, status, signature, errorCode, errorMessage } });
  });
}
