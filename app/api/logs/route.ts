import { ensureEventLogSchema, getDb, pruneEventLogs, withDatabase } from "../../../db";
import { eventLogs } from "../../../db/schema";

const EVENT_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const ID_PATTERN = /^[0-9a-f-]{36}$/i;
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/;
const STATUSES = new Set(["info", "pending", "success", "failure"]);
const CATEGORIES = new Set(["navigation", "wallet", "gameplay", "transaction", "system"]);
const GAME_TYPES = new Set(["jackpot", "coinflip", "daily", "history"]);
const MAX_BATCH = 20;
const RETENTION_DAYS = 90;
let lastRetentionRun = 0;

type RawEvent = Record<string, unknown>;
type ValidEvent = {
  id: string; eventType: string; category: string; status: string;
  sessionId: string | null; walletAddress: string | null; gameType: string | null;
  gameId: string | null; amountLamports: number | null; transactionSignature: string | null;
  metadataJson: string;
};

function optionalString(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
}

function validate(raw: RawEvent): { value?: ValidEvent; code?: string } {
  const id = optionalString(raw.id, 36);
  const eventType = optionalString(raw.eventType, 64);
  const category = optionalString(raw.category, 32);
  const status = optionalString(raw.status, 16) ?? "info";
  const sessionId = optionalString(raw.sessionId, 80);
  const installationId = optionalString(raw.installationId, 80);
  const clientCreatedAt = optionalString(raw.clientCreatedAt, 32);
  const walletAddress = optionalString(raw.walletAddress, 44);
  const gameType = optionalString(raw.gameType, 24);
  const gameId = optionalString(raw.gameId, 80);
  const transactionSignature = optionalString(raw.transactionSignature, 100);
  if (!id || !ID_PATTERN.test(id)) return { code: "INVALID_EVENT_ID" };
  if (!eventType || !EVENT_PATTERN.test(eventType)) return { code: "INVALID_EVENT_TYPE" };
  if (!category || !CATEGORIES.has(category)) return { code: "INVALID_CATEGORY" };
  if (!STATUSES.has(status)) return { code: "INVALID_STATUS" };
  if (!sessionId || !ID_PATTERN.test(sessionId)) return { code: "INVALID_SESSION" };
  if (!installationId || !ID_PATTERN.test(installationId)) return { code: "INVALID_INSTALLATION" };
  if (!clientCreatedAt || !Number.isFinite(Date.parse(clientCreatedAt))) return { code: "INVALID_CLIENT_TIME" };
  if (walletAddress && !BASE58_PATTERN.test(walletAddress)) return { code: "INVALID_WALLET" };
  if (gameType && !GAME_TYPES.has(gameType)) return { code: "INVALID_GAME" };
  if (transactionSignature && !BASE58_PATTERN.test(transactionSignature)) return { code: "INVALID_TRANSACTION" };
  const amountLamports = raw.amountLamports == null ? null : Number(raw.amountLamports);
  if (amountLamports !== null && (!Number.isSafeInteger(amountLamports) || amountLamports < 0)) return { code: "INVALID_AMOUNT" };

  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata as Record<string, unknown> : {};
  const safeMetadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/secret|private|signed|token|signature/i.test(key)) return { code: "SENSITIVE_METADATA_KEY" };
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return { code: "INVALID_METADATA" };
    safeMetadata[key.slice(0, 64)] = typeof value === "string" ? value.slice(0, 256) : value;
  }
  const metadataJson = JSON.stringify({ ...safeMetadata, installationId, clientCreatedAt });
  if (metadataJson.length > 2_048) return { code: "METADATA_TOO_LARGE" };
  return { value: { id, eventType, category, status, sessionId, walletAddress, gameType, gameId, amountLamports, transactionSignature, metadataJson } };
}

async function runRetentionIfDue() {
  const now = Date.now();
  if (now - lastRetentionRun < 24 * 60 * 60 * 1_000) return;
  lastRetentionRun = now;
  await pruneEventLogs(RETENTION_DAYS);
}

async function handlePost(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 65_536) return Response.json({ code: "PAYLOAD_TOO_LARGE", requestId }, { status: 413 });
    const payload = await request.json() as { events?: unknown };
    if (!Array.isArray(payload.events) || payload.events.length < 1 || payload.events.length > MAX_BATCH) {
      return Response.json({ code: "INVALID_BATCH", requestId }, { status: 400 });
    }

    const accepted: ValidEvent[] = [];
    const rejected: { id: string; code: string }[] = [];
    for (const raw of payload.events) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { rejected.push({ id: "unknown", code: "INVALID_EVENT" }); continue; }
      const result = validate(raw as RawEvent);
      if (result.value) accepted.push(result.value);
      else rejected.push({ id: optionalString((raw as RawEvent).id, 36) ?? "unknown", code: result.code ?? "INVALID_EVENT" });
    }

    await ensureEventLogSchema();
    if (accepted.length) await getDb().insert(eventLogs).values(accepted).onConflictDoNothing({ target: eventLogs.id });
    await runRetentionIfDue();
    return Response.json({ requestId, accepted: accepted.map(e => e.id), rejected }, { status: 201 });
  } catch (error) {
    console.error(JSON.stringify({ event: "event_log_batch_failed", requestId, error: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ code: "STORAGE_UNAVAILABLE", requestId }, { status: 503, headers: { "retry-after": "5" } });
  }
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
