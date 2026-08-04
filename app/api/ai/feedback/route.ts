import { and, eq } from "drizzle-orm";
import { ensureAiSchema, getDb, withDatabase } from "../../../../db";
import { aiConversations, aiFeedback, aiMessages } from "../../../../db/schema";
import { BASE58, walletHash } from "../../../../lib/ai/policy";
import { AI_ANONYMOUS_COOKIE, authenticatedWallet, parseCookie, requireSameOrigin, sha256 } from "@/server/services/auth";
import { enforceRateLimit, rateLimitResponse } from "@/server/services/coordination";

async function handlePost(request: Request) {
  if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const feedbackToken = typeof body.feedbackToken === "string" ? body.feedbackToken : "";
  const rating = Number(body.rating);
  const suppliedWallet = typeof body.walletAddress === "string" ? body.walletAddress : null;
  if (suppliedWallet && !BASE58.test(suppliedWallet)) return Response.json({ code: "INVALID_FEEDBACK" }, { status: 400 });
  const session = await authenticatedWallet(request);
  if (suppliedWallet && session?.walletAddress !== suppliedWallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(messageId) || !/^[A-Za-z0-9_-]{32,128}$/.test(feedbackToken) || ![1, -1].includes(rating)) return Response.json({ code: "INVALID_FEEDBACK" }, { status: 400 });
  const anonymousToken = session ? null : parseCookie(request, AI_ANONYMOUS_COOKIE);
  if (!session && (!anonymousToken || !/^[A-Za-z0-9_-]{32,128}$/.test(anonymousToken))) return Response.json({ code: "FEEDBACK_AUTH_REQUIRED" }, { status: 401 });
  const ownerKey = session ? `wallet:${session.walletAddress}` : `anonymous:${sha256(anonymousToken!)}`;
  const identity = walletHash(session?.walletAddress) ?? `anonymous_${sha256(anonymousToken!)}`;
  const rate = await enforceRateLimit({ scope: "ai_feedback", subject: identity, limit: 60, windowSeconds: 86_400 });
  if (!rate.allowed) return rateLimitResponse(rate);
  await ensureAiSchema();
  const [message] = await getDb().select({ id: aiMessages.id }).from(aiMessages).innerJoin(aiConversations, and(
    eq(aiMessages.conversationId, aiConversations.id),
    eq(aiConversations.ownerKey, ownerKey),
  )).where(and(
    eq(aiMessages.id, messageId),
    eq(aiMessages.role, "assistant"),
    eq(aiMessages.feedbackTokenHash, sha256(feedbackToken)),
  )).limit(1);
  if (!message) return Response.json({ code: "MESSAGE_NOT_FOUND" }, { status: 404 });
  const values = { id: crypto.randomUUID(), messageId, walletHash: identity, rating };
  await getDb().insert(aiFeedback).values(values).onConflictDoUpdate({ target: [aiFeedback.messageId, aiFeedback.walletHash], set: { rating } });
  return Response.json({ saved: true }, { status: 201 });
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
