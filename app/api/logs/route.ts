import { ensureEventLogSchema, getDb } from "../../../db";
import { eventLogs } from "../../../db/schema";

const EVENT_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const SESSION_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,100}$/;
const STATUSES = new Set(["info", "pending", "success", "failure"]);
const CATEGORIES = new Set(["navigation", "wallet", "gameplay", "transaction", "system"]);
const GAME_TYPES = new Set(["jackpot", "coinflip", "daily", "history"]);

type LogPayload = {
  eventType?: unknown;
  category?: unknown;
  status?: unknown;
  sessionId?: unknown;
  walletAddress?: unknown;
  gameType?: unknown;
  gameId?: unknown;
  amountLamports?: unknown;
  transactionSignature?: unknown;
  metadata?: unknown;
};

function optionalString(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384) {
      return Response.json({ error: "payload too large" }, { status: 413 });
    }

    const payload = (await request.json()) as LogPayload;
    const eventType = optionalString(payload.eventType, 64);
    const category = optionalString(payload.category, 32);
    const status = optionalString(payload.status, 16) ?? "info";
    const sessionId = optionalString(payload.sessionId, 80);
    const walletAddress = optionalString(payload.walletAddress, 44);
    const gameType = optionalString(payload.gameType, 24);
    const gameId = optionalString(payload.gameId, 80);
    const transactionSignature = optionalString(payload.transactionSignature, 100);

    if (!eventType || !EVENT_PATTERN.test(eventType)) {
      return Response.json({ error: "invalid eventType" }, { status: 400 });
    }
    if (!category || !CATEGORIES.has(category)) {
      return Response.json({ error: "invalid category" }, { status: 400 });
    }
    if (!STATUSES.has(status)) {
      return Response.json({ error: "invalid status" }, { status: 400 });
    }
    if (sessionId && !SESSION_PATTERN.test(sessionId)) {
      return Response.json({ error: "invalid sessionId" }, { status: 400 });
    }
    if (walletAddress && !BASE58_PATTERN.test(walletAddress)) {
      return Response.json({ error: "invalid walletAddress" }, { status: 400 });
    }
    if (gameType && !GAME_TYPES.has(gameType)) {
      return Response.json({ error: "invalid gameType" }, { status: 400 });
    }
    if (transactionSignature && !SIGNATURE_PATTERN.test(transactionSignature)) {
      return Response.json({ error: "invalid transactionSignature" }, { status: 400 });
    }

    const amountLamports = payload.amountLamports == null ? null : Number(payload.amountLamports);
    if (amountLamports !== null && (!Number.isSafeInteger(amountLamports) || amountLamports < 0)) {
      return Response.json({ error: "invalid amountLamports" }, { status: 400 });
    }

    const metadata = payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? payload.metadata
      : {};
    const metadataJson = JSON.stringify(metadata);
    if (metadataJson.length > 2_048) {
      return Response.json({ error: "metadata too large" }, { status: 400 });
    }

    const id = crypto.randomUUID();
    await ensureEventLogSchema();
    await getDb().insert(eventLogs).values({
      id,
      eventType,
      category,
      status,
      sessionId,
      walletAddress,
      gameType,
      gameId,
      amountLamports,
      transactionSignature,
      metadataJson,
    });

    return Response.json({ id }, { status: 201 });
  } catch (error) {
    console.error("event_log_write_failed", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "log write failed" }, { status: 500 });
  }
}
