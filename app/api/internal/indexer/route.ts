import { env } from "cloudflare:workers";
import { ensureGameSchema } from "../../../../db";
import { authorizeAutomation, unauthorized } from "@/server/services/internal-api";
import { syncSolanaIndexer, type IndexerMode } from "@/server/services/solana-indexer";

const MODES = new Set<IndexerMode>(["live", "backfill", "full"]);

export async function POST(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });
  let mode: IndexerMode = "full";
  try {
    const body = await request.json() as { mode?: unknown };
    if (typeof body.mode === "string" && MODES.has(body.mode as IndexerMode)) mode = body.mode as IndexerMode;
  } catch { /* An empty body runs the complete indexer. */ }
  await ensureGameSchema();
  try {
    const result = await syncSolanaIndexer({ db: env.DB, mode, force: true });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ code: "INDEXER_SYNC_FAILED", retryable: true, detail: error instanceof Error ? error.message.slice(0, 180) : "unknown" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
