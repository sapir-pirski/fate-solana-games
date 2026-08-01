import OpenAI from "openai";
import { asc, eq, gte } from "drizzle-orm";
import { ensureAiSchema, getDb, withDatabase } from "../../../../db";
import { aiConversations, aiMessages, aiToolCalls, aiUsage } from "../../../../db/schema";
import { FATE_AI_SYSTEM_PROMPT, BASE58, redactError, safeModel, validatePrompt, walletHash } from "../../../../lib/ai/policy";
import { AI_TOOLS, executeAiTool } from "../../../../lib/ai/tools";
import { authenticatedWallet, anonymousRequestSubject, requireSameOrigin } from "../../../../lib/auth";
import { enforceRateLimit, rateLimitResponse } from "../../../../lib/coordination";
import { increment, jsonLog, observe, withSpan } from "../../../../lib/telemetry";

const MAX_MESSAGE = 2_000;
const MAX_TOOL_ROUNDS = 3;
function streamAnswer(answer: string, metadata: Record<string, unknown>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify(metadata)}\n\n`));
    const parts = answer.match(/\S+\s*/g) ?? [answer];
    for (const part of parts) controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: part })}\n\n`));
    controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" } });
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
    const rateSubject = session?.walletAddress ?? anonymousRequestSubject(request);
    const rateKey = walletHash(session?.walletAddress) ?? `anonymous_${walletHash(rateSubject)}`;
    const limit = Math.max(1, Math.min(500, Number(process.env.AI_MAX_REQUESTS_PER_WALLET_DAY ?? 50)));
    const rate = await enforceRateLimit({ scope: "ai_chat", subject: rateSubject, limit, windowSeconds: 86_400 });
    if (!rate.allowed) return rateLimitResponse(rate);
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.startsWith("replace-")) return Response.json({ code: "AI_NOT_CONFIGURED", message: "Add a server-side OPENAI_API_KEY to .env.local.", requestId }, { status: 503 });

    await ensureAiSchema();
    const now = new Date(); const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(); const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const recentUsage = await getDb().select().from(aiUsage).where(gte(aiUsage.createdAt, monthStart));
    const identityUsage = recentUsage.filter(item => item.walletHash === rateKey);
    const dailyTokens = identityUsage.filter(item => item.createdAt >= dayStart).reduce((sum, item) => sum + item.inputTokens + item.outputTokens, 0);
    const dailyTokenLimit = Math.max(1_000, Number(process.env.AI_MAX_TOKENS_PER_WALLET_DAY ?? 100_000));
    if (dailyTokens >= dailyTokenLimit) return Response.json({ code: "AI_TOKEN_BUDGET_EXCEEDED", message: "Your daily Copilot allowance has been reached.", requestId }, { status: 429, headers: { "retry-after": "3600" } });
    const inputUsdPerMillion = Number(process.env.AI_INPUT_USD_PER_MILLION_TOKENS ?? 1.25); const outputUsdPerMillion = Number(process.env.AI_OUTPUT_USD_PER_MILLION_TOKENS ?? 10);
    const estimatedMonthlyUsd = recentUsage.reduce((sum, item) => sum + item.inputTokens * inputUsdPerMillion / 1_000_000 + item.outputTokens * outputUsdPerMillion / 1_000_000, 0);
    if (estimatedMonthlyUsd >= Math.max(0, Number(process.env.AI_MONTHLY_BUDGET_USD ?? 25))) return Response.json({ code: "AI_SERVICE_BUDGET_EXCEEDED", message: "Copilot has reached its monthly service budget.", requestId }, { status: 503, headers: { "retry-after": "3600" } });
    const conversationId = typeof body.conversationId === "string" && /^[0-9a-f-]{36}$/i.test(body.conversationId) ? body.conversationId : crypto.randomUUID();
    await getDb().insert(aiConversations).values({ id: conversationId, walletAddress }).onConflictDoNothing({ target: aiConversations.id });
    await getDb().insert(aiMessages).values({ id: crypto.randomUUID(), conversationId, role: "user", content: message });
    const history = await getDb().select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.createdAt)).limit(12);
    const client = new OpenAI({ apiKey, maxRetries: 2, timeout: Math.max(5_000, Math.min(60_000, Number(process.env.AI_PROVIDER_TIMEOUT_MS ?? 30_000))) }); const model = safeModel(process.env.OPENAI_MODEL);
    let responseInput: unknown[] = history.map(item => ({ role: item.role === "assistant" ? "assistant" as const : "user" as const, content: item.content }));
    const providerStarted = Date.now();
    let response = await withSpan("ai.provider.response", { component: "ai", model }, () => client.responses.create({ model, instructions: FATE_AI_SYSTEM_PROMPT, input: responseInput as never, tools: AI_TOOLS as never, reasoning: { effort: "low" }, text: { verbosity: "medium" }, store: false, safety_identifier: rateKey }), request.headers.get("traceparent"));
    let toolRounds = 0;
    while (toolRounds < MAX_TOOL_ROUNDS) {
      const calls = response.output.filter(item => item.type === "function_call");
      if (!calls.length) break;
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
      response = await withSpan("ai.provider.tool_response", { component: "ai", model }, () => client.responses.create({ model, instructions: FATE_AI_SYSTEM_PROMPT, input: responseInput as never, tools: AI_TOOLS as never, reasoning: { effort: "low" }, text: { verbosity: "medium" }, store: false, safety_identifier: rateKey }), request.headers.get("traceparent"));
      toolRounds += 1;
    }
    const answer = response.output_text || "I could not produce a grounded answer. Please try a narrower question.";
    const assistantId = crypto.randomUUID();
    await getDb().insert(aiMessages).values({ id: assistantId, conversationId, role: "assistant", content: answer, model, responseId: response.id });
    const usage = response.usage;
    await getDb().insert(aiUsage).values({ id: crypto.randomUUID(), conversationId, walletHash: rateKey, model, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0, cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0 });
    increment("fate_ai_requests_total", { status: "success", model }); observe("fate_ai_provider_duration_ms", Date.now() - providerStarted, { model });
    jsonLog("info", "ai_chat_complete", "AI response completed", { requestId, model, toolRounds, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0 });
    return streamAnswer(answer, { requestId, conversationId, messageId: assistantId, model, toolRounds });
  } catch (error) {
    increment("fate_ai_requests_total", { status: "failure" }); jsonLog("error", "ai_chat_failed", "AI response failed", { requestId, errorCode: redactError(error) });
    return Response.json({ code: "AI_UNAVAILABLE", requestId }, { status: 503, headers: { "retry-after": "5" } });
  }
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
