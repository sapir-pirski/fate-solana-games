import OpenAI from "openai";
import { and, asc, eq } from "drizzle-orm";
import { ensureAiSchema, getD1, getDb, withDatabase } from "../../../../db";
import { aiConversations, aiMessages, aiToolCalls, aiUsage } from "../../../../db/schema";
import { FATE_AI_SYSTEM_PROMPT, BASE58, redactError, safeModel, validatePrompt, walletHash } from "../../../../lib/ai/policy";
import { AI_TOOLS, executeAiTool } from "../../../../lib/ai/tools";
import { AI_ANONYMOUS_COOKIE, aiAnonymousCookie, authenticatedWallet, parseCookie, randomToken, requireSameOrigin, sha256 } from "@/server/services/auth";
import { enforceRateLimit, rateLimitResponse } from "@/server/services/coordination";
import { increment, jsonLog, observe, withSpan } from "../../../../lib/telemetry";
import { addAiUsage, EMPTY_AI_USAGE, estimateAiCostUsd, normalizeAiUsage, type AiUsageTotals, type ProviderUsage } from "../../../../lib/ai/usage";

const MAX_MESSAGE = 2_000;
const MAX_TOOL_ROUNDS = 3;
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function usageBudgetResponse(rateKey: string, requestId: string) {
  const [daily, monthly] = await Promise.all([
    getD1().prepare("SELECT COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens FROM ai_usage WHERE wallet_hash=? AND unixepoch(created_at)>=unixepoch('now','start of day')").bind(rateKey).first<{ input_tokens: number; output_tokens: number }>(),
    getD1().prepare("SELECT COALESCE(SUM(input_tokens),0) input_tokens,COALESCE(SUM(output_tokens),0) output_tokens,COALESCE(SUM(cached_tokens),0) cached_tokens FROM ai_usage WHERE unixepoch(created_at)>=unixepoch('now','start of month')").first<{ input_tokens: number; output_tokens: number; cached_tokens: number }>(),
  ]);
  const dailyTokens = (daily?.input_tokens ?? 0) + (daily?.output_tokens ?? 0);
  const dailyTokenLimit = Math.max(1_000, Number(process.env.AI_MAX_TOKENS_PER_WALLET_DAY ?? 100_000));
  if (dailyTokens >= dailyTokenLimit) return Response.json({ code: "AI_TOKEN_BUDGET_EXCEEDED", message: "Your daily Copilot allowance has been reached.", requestId }, { status: 429, headers: { "retry-after": "3600" } });
  const monthlyCost = estimateAiCostUsd({ inputTokens: monthly?.input_tokens ?? 0, outputTokens: monthly?.output_tokens ?? 0, cachedTokens: monthly?.cached_tokens ?? 0 }, Number(process.env.AI_INPUT_USD_PER_MILLION_TOKENS ?? 1.25), Number(process.env.AI_OUTPUT_USD_PER_MILLION_TOKENS ?? 10), Number(process.env.AI_CACHED_INPUT_USD_PER_MILLION_TOKENS ?? 0.125));
  if (monthlyCost >= Math.max(0, Number(process.env.AI_MONTHLY_BUDGET_USD ?? 25))) return Response.json({ code: "AI_SERVICE_BUDGET_EXCEEDED", message: "Copilot has reached its monthly service budget.", requestId }, { status: 503, headers: { "retry-after": "3600" } });
  return null;
}

async function recordProviderUsage(response: { id: string; usage?: ProviderUsage }, context: { conversationId: string; walletHash: string; requestId: string; model: string; round: number }): Promise<AiUsageTotals> {
  const usage = normalizeAiUsage(response.usage);
  await getDb().insert(aiUsage).values({ id: crypto.randomUUID(), conversationId: context.conversationId, walletHash: context.walletHash, requestId: context.requestId, responseId: response.id, round: context.round, model: context.model, ...usage }).onConflictDoNothing({ target: aiUsage.responseId });
  return usage;
}

function streamAnswer(answer: string, metadata: Record<string, unknown>, setCookie?: string) {
  const encoder = new TextEncoder();
  const headers = new Headers({ "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify(metadata)}\n\n`));
    const parts = answer.match(/\S+\s*/g) ?? [answer];
    for (const part of parts) controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: part })}\n\n`));
    controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); controller.close();
  } }), { headers });
}

async function handlePost(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN", requestId }, { status: 403 });
    const body = await request.json() as { message?: unknown; conversationId?: unknown; walletAddress?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const walletAddress = typeof body.walletAddress === "string" && BASE58.test(body.walletAddress) ? body.walletAddress : null;
    if (!message || message.length > MAX_MESSAGE) return Response.json({ code: "INVALID_MESSAGE", requestId }, { status: 400 });
    const promptCheck = validatePrompt(message);
    if (!promptCheck.allowed) return Response.json({ code: promptCheck.code, message: "Remove secrets or instruction-override text and try again.", requestId }, { status: 400 });
    const session = await authenticatedWallet(request);
    if (walletAddress && session?.walletAddress !== walletAddress) return Response.json({ code: "WALLET_AUTH_REQUIRED", message: "Authenticate the connected wallet to access wallet-specific data.", requestId }, { status: 401 });
    const storedAnonymousToken = session ? null : parseCookie(request, AI_ANONYMOUS_COOKIE);
    const validAnonymousToken = storedAnonymousToken && /^[A-Za-z0-9_-]{32,128}$/.test(storedAnonymousToken) ? storedAnonymousToken : null;
    const anonymousToken = session ? null : validAnonymousToken ?? randomToken();
    const ownerKey = session ? `wallet:${session.walletAddress}` : `anonymous:${sha256(anonymousToken!)}`;
    const anonymousCookieHeader = !session && !validAnonymousToken ? aiAnonymousCookie(anonymousToken!) : undefined;
    const rateSubject = session?.walletAddress ?? ownerKey;
    const rateKey = walletHash(session?.walletAddress) ?? ownerKey;
    const limit = Math.max(1, Math.min(500, Number(process.env.AI_MAX_REQUESTS_PER_WALLET_DAY ?? 50)));
    const rate = await enforceRateLimit({ scope: "ai_chat", subject: rateSubject, limit, windowSeconds: 86_400 });
    if (!rate.allowed) return rateLimitResponse(rate);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.startsWith("replace-")) return Response.json({ code: "AI_NOT_CONFIGURED", message: "Add a server-side OPENAI_API_KEY to .env.local.", requestId }, { status: 503 });

    await ensureAiSchema();
    const initialBudgetBlock = await usageBudgetResponse(rateKey, requestId);
    if (initialBudgetBlock) return initialBudgetBlock;
    const requestedConversationId = typeof body.conversationId === "string" ? body.conversationId.trim() : "";
    if (requestedConversationId && !CONVERSATION_ID.test(requestedConversationId)) {
      return Response.json({ code: "INVALID_CONVERSATION", requestId }, { status: 400 });
    }
    const ownerWallet = session?.walletAddress ?? null;
    let conversationId: string;
    if (requestedConversationId) {
      const [ownedConversation] = await getDb().select({ id: aiConversations.id }).from(aiConversations).where(and(
        eq(aiConversations.id, requestedConversationId),
        eq(aiConversations.ownerKey, ownerKey),
        eq(aiConversations.status, "active"),
      )).limit(1);
      if (!ownedConversation) {
        return Response.json({ code: "CONVERSATION_NOT_FOUND", requestId }, { status: 404 });
      }
      conversationId = ownedConversation.id;
      await getDb().update(aiConversations).set({ updatedAt: new Date().toISOString() }).where(and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.ownerKey, ownerKey),
      ));
    } else {
      conversationId = crypto.randomUUID();
      await getDb().insert(aiConversations).values({ id: conversationId, walletAddress: ownerWallet, ownerKey });
    }
    await getDb().insert(aiMessages).values({ id: crypto.randomUUID(), conversationId, role: "user", content: message });
    const history = await getDb().select({ role: aiMessages.role, content: aiMessages.content }).from(aiMessages).innerJoin(aiConversations, and(
      eq(aiMessages.conversationId, aiConversations.id),
      eq(aiConversations.ownerKey, ownerKey),
    )).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.createdAt)).limit(12);
    const client = new OpenAI({ apiKey, maxRetries: 2, timeout: Math.max(5_000, Math.min(60_000, Number(process.env.AI_PROVIDER_TIMEOUT_MS ?? 30_000))) }); const model = safeModel(process.env.OPENAI_MODEL);
    let responseInput: unknown[] = history.map(item => ({ role: item.role === "assistant" ? "assistant" as const : "user" as const, content: item.content }));
    const providerStarted = Date.now();
    let response = await withSpan("ai.provider.response", { component: "ai", model }, () => client.responses.create({ model, instructions: FATE_AI_SYSTEM_PROMPT, input: responseInput as never, tools: AI_TOOLS as never, reasoning: { effort: "low" }, text: { verbosity: "medium" }, store: false, safety_identifier: rateKey }), request.headers.get("traceparent"));
    let requestUsage = await recordProviderUsage(response, { conversationId, walletHash: rateKey, requestId, model, round: 0 });
    let toolRounds = 0;
    while (toolRounds < MAX_TOOL_ROUNDS) {
      const calls = response.output.filter(item => item.type === "function_call");
      if (!calls.length) break;
      const roundBudgetBlock = await usageBudgetResponse(rateKey, requestId);
      if (roundBudgetBlock) return roundBudgetBlock;
      const outputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
      for (const call of calls) {
        const started = Date.now(); let result: unknown; let status = "success"; let errorCode: string | null = null;
        try { result = await executeAiTool(call.name, JSON.parse(call.arguments) as Record<string, unknown>, { authenticatedWallet: session?.walletAddress ?? null }); }
        catch (error) { status = "failure"; errorCode = redactError(error); result = { error: errorCode }; }
        const output = JSON.stringify(result).slice(0, 20_000);
        await getDb().insert(aiToolCalls).values({ id: crypto.randomUUID(), conversationId, callId: call.call_id, toolName: call.name, argumentsJson: call.arguments.slice(0, 4_000), resultJson: output, status, durationMs: Date.now() - started, errorCode }).onConflictDoNothing({ target: aiToolCalls.callId });
        outputs.push({ type: "function_call_output", call_id: call.call_id, output });
      }
      responseInput = [...responseInput, ...response.output, ...outputs];
      toolRounds += 1;
      response = await withSpan("ai.provider.tool_response", { component: "ai", model }, () => client.responses.create({ model, instructions: FATE_AI_SYSTEM_PROMPT, input: responseInput as never, tools: AI_TOOLS as never, reasoning: { effort: "low" }, text: { verbosity: "medium" }, store: false, safety_identifier: rateKey }), request.headers.get("traceparent"));
      requestUsage = addAiUsage(requestUsage, await recordProviderUsage(response, { conversationId, walletHash: rateKey, requestId, model, round: toolRounds }));
    }
    const answer = response.output_text || "I could not produce a grounded answer. Please try a narrower question.";
    const assistantId = crypto.randomUUID();
    const feedbackToken = randomToken();
    await getDb().insert(aiMessages).values({ id: assistantId, conversationId, role: "assistant", content: answer, model, responseId: response.id, feedbackTokenHash: sha256(feedbackToken) });
    increment("fate_ai_requests_total", { status: "success", model }); observe("fate_ai_provider_duration_ms", Date.now() - providerStarted, { model });
    jsonLog("info", "ai_chat_complete", "AI response completed", { component: "ai", requestId, model, toolRounds, inputTokens: requestUsage.inputTokens, outputTokens: requestUsage.outputTokens, cachedTokens: requestUsage.cachedTokens, reasoningTokens: requestUsage.reasoningTokens });
    return streamAnswer(answer, { requestId, conversationId, messageId: assistantId, feedbackToken, model, toolRounds }, anonymousCookieHeader);
  } catch (error) {
    increment("fate_ai_requests_total", { status: "failure" }); jsonLog("error", "ai_chat_failed", "AI response failed", { component: "ai", requestId, errorCode: redactError(error) });
    return Response.json({ code: "AI_UNAVAILABLE", requestId }, { status: 503, headers: { "retry-after": "5" } });
  }
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
