import { env } from "cloudflare:workers";
import { ensureAiSchema, ensureAuthSchema, ensureGameSchema, getDatabaseBackend } from "../../../db";
import { renderMetrics } from "../../../lib/telemetry";
import { estimateAiCostUsd } from "../../../lib/ai/usage";

const label = (value: unknown) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");

export async function GET() {
  const revision = process.env.APP_REVISION ?? "local";
  const network = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const dynamic: string[] = [];
  try {
    await Promise.all([ensureAuthSchema(), ensureAiSchema(), ensureGameSchema()]);
    const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
    const [operations, jobs, sessions, aiUsage, aiTools, aiFeedback, aiConversations, gameActivity, indexer] = await Promise.all([
      env.DB.prepare("SELECT status,COUNT(*) count FROM transaction_operations GROUP BY status").all<{ status: string; count: number }>(),
      env.DB.prepare("SELECT queue,status,COUNT(*) count,MAX(0,CAST(strftime('%s','now') AS INTEGER)-MIN(available_at)) oldest FROM background_jobs GROUP BY queue,status").all<{ queue: string; status: string; count: number; oldest: number }>(),
      env.DB.prepare("SELECT COUNT(*) sessions FROM wallet_sessions WHERE revoked_at IS NULL AND expires_at>CAST(strftime('%s','now') AS INTEGER)").first<{ sessions: number }>(),
      env.DB.prepare("SELECT model,SUM(input_tokens) input_tokens,SUM(output_tokens) output_tokens,SUM(reasoning_tokens) reasoning_tokens,SUM(cached_tokens) cached_tokens FROM ai_usage GROUP BY model").all<{ model: string; input_tokens: number; output_tokens: number; reasoning_tokens: number; cached_tokens: number }>(),
      env.DB.prepare("SELECT tool_name,status,COUNT(*) count,COALESCE(AVG(duration_ms),0) average_duration_ms FROM ai_tool_calls GROUP BY tool_name,status").all<{ tool_name: string; status: string; count: number; average_duration_ms: number }>(),
      env.DB.prepare("SELECT rating,COUNT(*) count FROM ai_feedback GROUP BY rating").all<{ rating: number; count: number }>(),
      env.DB.prepare("SELECT COUNT(*) count FROM ai_conversations").first<{ count: number }>(),
      env.DB.prepare("SELECT game_type,state,COUNT(*) count,SUM(wager_lamports) wager_lamports,SUM(payout_lamports) payout_lamports,SUM(fee_lamports) fee_lamports FROM games GROUP BY game_type,state").all<{ game_type: string; state: string; count: number; wager_lamports: number; payout_lamports: number; fee_lamports: number }>(),
      env.DB.prepare("SELECT last_slot,status,last_error,MAX(0,CAST(strftime('%s','now') AS INTEGER)-CAST(strftime('%s',updated_at) AS INTEGER)) lag_seconds FROM indexer_checkpoints WHERE consumer=?").bind(`fate-program:${cluster}`).first<{ last_slot: number; status: string; last_error: string | null; lag_seconds: number }>(),
    ]);
    const expectedOperationStates = ["draft", "submitted", "confirmed", "finalized", "failed", "rejected", "expired"];
    const operationCounts = new Map(operations.results.map(row => [row.status, row.count]));
    for (const status of expectedOperationStates) dynamic.push(`fate_transaction_operations{status="${status}"} ${operationCounts.get(status) ?? 0}`);
    for (const row of operations.results) if (!expectedOperationStates.includes(row.status)) dynamic.push(`fate_transaction_operations{status="${label(row.status)}"} ${row.count}`);
    for (const row of jobs.results) {
      dynamic.push(`fate_queue_jobs{queue="${label(row.queue)}",status="${label(row.status)}"} ${row.count}`);
      dynamic.push(`fate_queue_oldest_age_seconds{queue="${label(row.queue)}",status="${label(row.status)}"} ${Math.max(0, row.oldest)}`);
    }
    dynamic.push(`fate_active_sessions ${sessions?.sessions ?? 0}`);
    dynamic.push(`fate_indexer_checkpoint_slot{cluster="${label(cluster)}"} ${indexer?.last_slot ?? 0}`);
    dynamic.push(`fate_indexer_healthy{cluster="${label(cluster)}"} ${indexer?.status === "healthy" ? 1 : 0}`);
    dynamic.push(`fate_indexer_lag_seconds{cluster="${label(cluster)}"} ${indexer?.lag_seconds ?? 0}`);
    const inputPrice = Number(process.env.AI_INPUT_USD_PER_MILLION_TOKENS ?? 1.25);
    const cachedInputPrice = Number(process.env.AI_CACHED_INPUT_USD_PER_MILLION_TOKENS ?? 0.125);
    const outputPrice = Number(process.env.AI_OUTPUT_USD_PER_MILLION_TOKENS ?? 10);
    let estimatedCost = 0;
    for (const row of aiUsage.results) {
      const model = label(row.model);
      dynamic.push(`fate_ai_tokens{model="${model}",type="input"} ${row.input_tokens ?? 0}`);
      dynamic.push(`fate_ai_tokens{model="${model}",type="output"} ${row.output_tokens ?? 0}`);
      dynamic.push(`fate_ai_tokens{model="${model}",type="reasoning"} ${row.reasoning_tokens ?? 0}`);
      dynamic.push(`fate_ai_tokens{model="${model}",type="cached"} ${row.cached_tokens ?? 0}`);
      estimatedCost += estimateAiCostUsd({ inputTokens: row.input_tokens ?? 0, outputTokens: row.output_tokens ?? 0, cachedTokens: row.cached_tokens ?? 0 }, inputPrice, outputPrice, cachedInputPrice);
    }
    for (const row of aiTools.results) {
      dynamic.push(`fate_ai_tool_calls{tool="${label(row.tool_name)}",status="${label(row.status)}"} ${row.count}`);
      dynamic.push(`fate_ai_tool_duration_ms{tool="${label(row.tool_name)}",status="${label(row.status)}"} ${row.average_duration_ms}`);
    }
    const feedbackCounts = new Map(aiFeedback.results.map(row => [row.rating > 0 ? "positive" : "negative", row.count]));
    dynamic.push(`fate_ai_feedback{rating="positive"} ${feedbackCounts.get("positive") ?? 0}`);
    dynamic.push(`fate_ai_feedback{rating="negative"} ${feedbackCounts.get("negative") ?? 0}`);
    dynamic.push(`fate_ai_conversations ${aiConversations?.count ?? 0}`);
    dynamic.push(`fate_ai_estimated_cost_usd ${estimatedCost}`);
    dynamic.push(`fate_ai_monthly_budget_usd ${Math.max(0, Number(process.env.AI_MONTHLY_BUDGET_USD ?? 25))}`);
    dynamic.push(`fate_ai_configured ${process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith("replace-") ? 1 : 0}`);
    for (const row of gameActivity.results) {
      const gameType = label(row.game_type), state = label(row.state);
      dynamic.push(`fate_games{game_type="${gameType}",state="${state}"} ${row.count}`);
      dynamic.push(`fate_game_lamports{game_type="${gameType}",state="${state}",kind="wager"} ${row.wager_lamports ?? 0}`);
      dynamic.push(`fate_game_lamports{game_type="${gameType}",state="${state}",kind="payout"} ${row.payout_lamports ?? 0}`);
      dynamic.push(`fate_game_lamports{game_type="${gameType}",state="${state}",kind="fee"} ${row.fee_lamports ?? 0}`);
    }
    dynamic.push("fate_database_metrics_available 1");
  } catch {
    dynamic.push("fate_database_metrics_available 0");
  }

  return new Response([
    "# HELP fate_up Whether the FATE web process is serving requests.",
    "# TYPE fate_up gauge",
    `fate_up{revision="${label(revision)}",network="${label(network)}",database="${getDatabaseBackend()}"} 1`,
    "# HELP fate_build_info Static build information for this release.",
    "# TYPE fate_build_info gauge",
    `fate_build_info{revision="${label(revision)}"} 1`,
    "# HELP fate_transaction_operations Current durable transaction operations by state.",
    "# TYPE fate_transaction_operations gauge",
    ...dynamic,
    renderMetrics(),
    "",
  ].join("\n"), { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" } });
}
