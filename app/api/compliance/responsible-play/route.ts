import { eq } from "drizzle-orm";
import { ensureAiSchema, ensureAuthSchema, ensureGameSchema, getD1, getDb, withDatabase } from "../../../../db";
import { responsiblePlayLimits } from "../../../../db/schema";
import { authenticatedWallet, nowSeconds, requireSameOrigin } from "@/server/services/auth";
import { auditCompliance } from "@/server/services/compliance";
import { readSpendingSnapshot } from "@/server/services/wager-reservations";

export async function GET(request: Request) { return withDatabase(async () => {
  const session = await authenticatedWallet(request); if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  await Promise.all([ensureAiSchema(), ensureAuthSchema(), ensureGameSchema()]);
  const [current] = await getDb().select().from(responsiblePlayLimits).where(eq(responsiblePlayLimits.walletAddress, session.walletAddress)).limit(1);
  const spending = await readSpendingSnapshot(getD1(), session.walletAddress);
  return Response.json({
    limits: current ?? null,
    ...spending,
    dailyRemaining: current?.dailyLamports == null ? null : Math.max(0, current.dailyLamports - spending.dailySpent),
    weeklyRemaining: current?.weeklyLamports == null ? null : Math.max(0, current.weeklyLamports - spending.weeklySpent),
  }, { headers: { "cache-control": "private, no-store" } });
}); }

export async function POST(request: Request) { return withDatabase(async () => {
  if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 }); const session = await authenticatedWallet(request); if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? ""); const now = nowSeconds(); await ensureAiSchema(); const [current] = await getDb().select().from(responsiblePlayLimits).where(eq(responsiblePlayLimits.walletAddress, session.walletAddress)).limit(1);
  let cooldownUntil = current?.cooldownUntil ?? null; let selfExcludedUntil = current?.selfExcludedUntil ?? null;
  let dailyLamports = current?.dailyLamports ?? null; let weeklyLamports = current?.weeklyLamports ?? null;
  if (action === "limits") { const daily = Number(body.dailyLamports); const weekly = Number(body.weeklyLamports); if (![daily, weekly].every(value => Number.isSafeInteger(value) && value >= 0) || weekly < daily) return Response.json({ code: "INVALID_LIMIT" }, { status: 400 }); dailyLamports = daily; weeklyLamports = weekly; }
  else if (action === "cooldown") { const hours = Number(body.hours); if (![24, 72, 168, 720].includes(hours)) return Response.json({ code: "INVALID_COOLDOWN" }, { status: 400 }); cooldownUntil = Math.max(cooldownUntil ?? 0, now + hours * 3600); }
  else if (action === "self_exclude") { const days = Number(body.days); if (![180, 365, 1825].includes(days)) return Response.json({ code: "INVALID_EXCLUSION" }, { status: 400 }); selfExcludedUntil = Math.max(selfExcludedUntil ?? 0, now + days * 86400); }
  else return Response.json({ code: "INVALID_ACTION" }, { status: 400 });
  const values = { walletAddress: session.walletAddress, dailyLamports, weeklyLamports, cooldownUntil, selfExcludedUntil, updatedAt: new Date().toISOString() }; await getDb().insert(responsiblePlayLimits).values(values).onConflictDoUpdate({ target: responsiblePlayLimits.walletAddress, set: values }); await auditCompliance(session.walletAddress, action, "activated", null, { dailyLamports, weeklyLamports, cooldownUntil, selfExcludedUntil }); return Response.json({ limits: values }, { status: 201 });
}); }
