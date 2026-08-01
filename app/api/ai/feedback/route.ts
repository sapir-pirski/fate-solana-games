import { eq } from "drizzle-orm";
import { ensureAiSchema, getDb, withDatabase } from "../../../../db";
import { aiFeedback, aiMessages } from "../../../../db/schema";
import { BASE58, walletHash } from "../../../../lib/ai/policy";
import { authenticatedWallet, requireSameOrigin } from "@/server/services/auth";

async function handlePost(request: Request) {
  if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const rating = Number(body.rating);
  const wallet = typeof body.walletAddress === "string" && BASE58.test(body.walletAddress) ? body.walletAddress : null;
  const session = wallet ? await authenticatedWallet(request) : null;
  if (wallet && session?.walletAddress !== wallet) return Response.json({ code: "WALLET_AUTH_REQUIRED" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(messageId) || ![1, -1].includes(rating)) return Response.json({ code: "INVALID_FEEDBACK" }, { status: 400 });
  await ensureAiSchema();
  const [message] = await getDb().select({ id: aiMessages.id }).from(aiMessages).where(eq(aiMessages.id, messageId)).limit(1);
  if (!message) return Response.json({ code: "MESSAGE_NOT_FOUND" }, { status: 404 });
  const identity = walletHash(wallet) ?? "anonymous";
  const values = { id: crypto.randomUUID(), messageId, walletHash: identity, rating };
  await getDb().insert(aiFeedback).values(values).onConflictDoUpdate({ target: [aiFeedback.messageId, aiFeedback.walletHash], set: { rating } });
  return Response.json({ saved: true }, { status: 201 });
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
