import { eq } from "drizzle-orm";
import { ensureAiSchema, getDb, withDatabase } from "../../../../db";
import { responsiblePlayLimits } from "../../../../db/schema";
import { BASE58 } from "../../../../lib/ai/policy";
import { authenticatedWallet, requireSameOrigin } from "@/server/services/auth";

async function handleGet(request: Request) {
  await ensureAiSchema();
  const wallet = new URL(request.url).searchParams.get("wallet");
  if (!wallet || !BASE58.test(wallet)) return Response.json({ code: "INVALID_WALLET" }, { status: 400 });
  const session = await authenticatedWallet(request); if (session?.walletAddress !== wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
  const [limits] = await getDb().select().from(responsiblePlayLimits).where(eq(responsiblePlayLimits.walletAddress, wallet)).limit(1);
  return Response.json({ limits: limits ?? null }, { headers: { "cache-control": "no-store" } });
}

async function handlePost(request: Request) {
  if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  await ensureAiSchema();
  const body = await request.json() as Record<string, unknown>; const wallet = String(body.walletAddress ?? "");
  if (!BASE58.test(wallet)) return Response.json({ code: "INVALID_WALLET" }, { status: 400 });
  const session = await authenticatedWallet(request); if (session?.walletAddress !== wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
  const safeInteger = (value: unknown) => value == null ? null : Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : NaN;
  const daily = safeInteger(body.dailyLamports); const weekly = safeInteger(body.weeklyLamports); const cooldown = safeInteger(body.cooldownUntil); const excluded = safeInteger(body.selfExcludedUntil);
  if ([daily, weekly, cooldown, excluded].some(Number.isNaN)) return Response.json({ code: "INVALID_LIMIT" }, { status: 400 });
  const [current] = await getDb().select().from(responsiblePlayLimits).where(eq(responsiblePlayLimits.walletAddress, wallet)).limit(1);
  const now = Math.floor(Date.now() / 1000);
  if ((current?.selfExcludedUntil ?? 0) > now && (excluded ?? 0) < (current?.selfExcludedUntil ?? 0)) return Response.json({ code: "SELF_EXCLUSION_CANNOT_BE_SHORTENED" }, { status: 409 });
  const values = { walletAddress: wallet, dailyLamports: daily, weeklyLamports: weekly, cooldownUntil: cooldown, selfExcludedUntil: excluded, updatedAt: new Date().toISOString() };
  await getDb().insert(responsiblePlayLimits).values(values).onConflictDoUpdate({ target: responsiblePlayLimits.walletAddress, set: values });
  return Response.json({ limits: values }, { status: 201 });
}

export async function GET(request: Request) {
  return withDatabase(() => handleGet(request));
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
