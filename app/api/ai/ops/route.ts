import { asc, eq } from "drizzle-orm";
import { ensureAiSchema, getDb, withDatabase } from "../../../../db";
import { agentAlerts, agentRuns, games, indexerCheckpoints } from "../../../../db/schema";

async function handlePost(request: Request) {
  const expected = process.env.INDEXER_AUTH_TOKEN;
  if (!expected || expected.startsWith("replace-") || request.headers.get("authorization") !== `Bearer ${expected}`) return Response.json({ code: "UNAUTHORIZED" }, { status: 401 });
  await ensureAiSchema(); const id = crypto.randomUUID();
  await getDb().insert(agentRuns).values({ id, agentType: "operations_audit", status: "running", inputJson: "{}" });
  try {
    const checkpoints = await getDb().select().from(indexerCheckpoints).orderBy(asc(indexerCheckpoints.lastSlot));
    const openGames = await getDb().select().from(games).where(eq(games.state, "randomness_requested")).limit(100);
    const now = Math.floor(Date.now() / 1000); const alerts = [] as Array<Record<string, unknown>>;
    for (const game of openGames) if (game.expiresAt && game.expiresAt + 300 < now) alerts.push({ type: "stuck_randomness", severity: "high", game: game.address, lastSignature: game.lastSignature });
    for (const checkpoint of checkpoints) if (checkpoint.status !== "healthy") alerts.push({ type: "indexer_unhealthy", severity: "high", consumer: checkpoint.consumer, error: checkpoint.lastError });
    for (const alert of alerts) await getDb().insert(agentAlerts).values({ id: crypto.randomUUID(), alertType: String(alert.type), severity: String(alert.severity), subject: String(alert.game ?? alert.consumer), evidenceJson: JSON.stringify(alert) });
    const output = { checkedAt: new Date().toISOString(), checkpoints, gamesAwaitingRandomness: openGames.length, alerts, keeperPlan: openGames.map(game => ({ game: game.address, action: "evaluate_timeout_or_settlement", automaticSigning: false })) };
    await getDb().update(agentRuns).set({ status: "completed", outputJson: JSON.stringify(output), completedAt: new Date().toISOString() }).where(eq(agentRuns.id, id));
    return Response.json({ runId: id, ...output });
  } catch (error) {
    await getDb().update(agentRuns).set({ status: "failed", errorCode: "OPS_AUDIT_FAILED", completedAt: new Date().toISOString() }).where(eq(agentRuns.id, id)); throw error;
  }
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
