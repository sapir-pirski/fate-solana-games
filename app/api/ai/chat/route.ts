import OpenAI from "openai";
import { asc, eq } from "drizzle-orm";
import { ensureAiSchema, getDb } from "../../../../db";
import { aiConversations, aiMessages, aiToolCalls, aiUsage } from "../../../../db/schema";
import { FATE_AI_SYSTEM_PROMPT, BASE58, redactError, safeModel, walletHash } from "../../../../lib/ai/policy";
import { AI_TOOLS, executeAiTool } from "../../../../lib/ai/tools";

const MAX_MESSAGE = 2_000;
const MAX_TOOL_ROUNDS = 3;
const memoryRate = new Map<string, { count: number; reset: number }>();

function allowRequest(key: string) {
  const limit = Math.max(1, Math.min(500, Number(process.env.AI_MAX_REQUESTS_PER_WALLET_DAY ?? 50)));
  const now = Date.now(); const current = memoryRate.get(key);
  if (!current || current.reset < now) { memoryRate.set(key, { count: 1, reset: now + 86_400_000 }); return true; }
  if (current.count >= limit) return false;
  current.count += 1; return true;
}

function streamAnswer(answer: string, metadata: Record<string, unknown>) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify(metadata)}\n\n`));
    const parts = answer.match(/\S+\s*/g) ?? [answer];
    for (const part of parts) controller.enqueue(encoder.encode(`event: delta\ndata: ${JSON.stringify({ delta: part })}\n\n`));
    controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); controller.close();
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive" } });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const body = await request.json() as { message?: unknown; conversationId?: unknown; walletAddress?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const walletAddress = typeof body.walletAddress === "string" && BASE58.test(body.walletAddress) ? body.walletAddress : null;
    if (!message || message.length > MAX_MESSAGE) return Response.json({ code: "INVALID_MESSAGE", requestId }, { status: 400 });
    const rateKey = walletHash(walletAddress) ?? request.headers.get("oai-authenticated-user-email") ?? "anonymous";
    if (!allowRequest(rateKey)) return Response.json({ code: "AI_RATE_LIMITED", requestId }, { status: 429, headers: { "retry-after": "3600" } });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey.startsWith("replace-")) return Response.json({ code: "AI_NOT_CONFIGURED", message: "Add a server-side OPENAI_API_KEY to .env.local.", requestId }, { status: 503 });

    await ensureAiSchema();
    const conversationId = typeof body.conversationId === "string" && /^[0-9a-f-]{36}$/i.test(body.conversationId) ? body.conversationId : crypto.randomUUID();
    await getDb().insert(aiConversations).values({ id: conversationId, walletAddress }).onConflictDoNothing({ target: aiConversations.id });
    await getDb().insert(aiMessages).values({ id: crypto.randomUUID(), conversationId, role: "user", content: message });
    const history = await getDb().select().from(aiMessages).where(eq(aiMessages.conversationId, conversationId)).orderBy(asc(aiMessages.createdAt)).limit(12);
    const client = new OpenAI({ apiKey }); const model = safeModel(process.env.OPENAI_MODEL);
    let responseInput: unknown[] = history.map(item => ({ role: item.role === "assistant" ? "assistant" as const : "user" as const, content: item.content }));
    let response = await client.responses.create({ model, instructions: FATE_AI_SYSTEM_PROMPT, input: responseInput as never, tools: AI_TOOLS as never, reasoning: { effort: "low" }, text: { verbosity: "medium" }, store: false, safety_identifier: rateKey });
    let toolRounds = 0;
    while (toolRounds < MAX_TOOL_ROUNDS) {
      const calls = response.output.filter(item => item.type === "function_call");
      if (!calls.length) break;
      const outputs: Array<{ type: "function_call_output"; call_id: string; output: string }> = [];
      for (const call of calls) {
        const started = Date.now(); let result: unknown; let status = "success"; let errorCode: string | null = null;
        try { result = await executeAiTool(call.name, JSON.parse(call.arguments) as Record<string, unknown>); }
        catch (error) { status = "failure"; errorCode = redactError(error); result = { error: errorCode }; }
        const output = JSON.stringify(result).slice(0, 20_000);
        await getDb().insert(aiToolCalls).values({ id: crypto.randomUUID(), conversationId, callId: call.call_id, toolName: call.name, argumentsJson: call.arguments.slice(0, 4_000), resultJson: output, status, durationMs: Date.now() - started, errorCode }).onConflictDoNothing({ target: aiToolCalls.callId });
        outputs.push({ type: "function_call_output", call_id: call.call_id, output });
      }
      responseInput = [...responseInput, ...response.output, ...outputs];
      response = await client.responses.create({ model, instructions: FATE_AI_SYSTEM_PROMPT, input: responseInput as never, tools: AI_TOOLS as never, reasoning: { effort: "low" }, text: { verbosity: "medium" }, store: false, safety_identifier: rateKey });
      toolRounds += 1;
    }
    const answer = response.output_text || "I could not produce a grounded answer. Please try a narrower question.";
    const assistantId = crypto.randomUUID();
    await getDb().insert(aiMessages).values({ id: assistantId, conversationId, role: "assistant", content: answer, model, responseId: response.id });
    const usage = response.usage;
    await getDb().insert(aiUsage).values({ id: crypto.randomUUID(), conversationId, walletHash: rateKey, model, inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0, reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? 0, cachedTokens: usage?.input_tokens_details?.cached_tokens ?? 0 });
    return streamAnswer(answer, { requestId, conversationId, messageId: assistantId, model, toolRounds });
  } catch (error) {
    console.error(JSON.stringify({ event: "ai_chat_failed", requestId, error: redactError(error) }));
    return Response.json({ code: "AI_UNAVAILABLE", requestId }, { status: 503, headers: { "retry-after": "5" } });
  }
}
