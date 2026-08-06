import { env } from "cloudflare:workers";
import { ensureAiSchema, ensureAuthSchema, ensureGameSchema } from "../../../../db";
import { authorizeAutomation, runtimeEnv, unauthorized } from "@/server/services/internal-api";

const FIXTURE_PREFIX = "local-observability-fixture";

function unavailable() {
  return Response.json({ code: "NOT_FOUND" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (runtimeEnv("APP_REVISION") !== "local-compose" || runtimeEnv("LOCAL_OBSERVABILITY_FIXTURES") !== "true") return unavailable();
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });
  await Promise.all([ensureAiSchema(), ensureAuthSchema(), ensureGameSchema()]);

  const now = Math.floor(Date.now() / 1_000);
  const statements: D1PreparedStatement[] = [];
  const operationCounts = { draft: 2, submitted: 3, confirmed: 2, finalized: 7, failed: 1 } as const;
  for (const [status, count] of Object.entries(operationCounts)) {
    for (let index = 0; index < count; index += 1) {
      const id = `${FIXTURE_PREFIX}:operation:${status}:${index}`;
      statements.push(env.DB.prepare(`INSERT OR REPLACE INTO transaction_operations
        (id,operation_id,wallet_address,game_type,action,status,amount_lamports,game_address,program_id,message_hash,reserved_at,signature,error_code,attempts,expires_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
        .bind(id, id, `${FIXTURE_PREFIX}:wallet`, index % 2 ? "coinflip" : "jackpot", "local_fixture", status, (index + 1) * 100_000_000, `${FIXTURE_PREFIX}:game:${index}`, "local-fixture-program", `fixture-${status}-${index}`, now - 300, null, status === "failed" ? "LOCAL_FIXTURE" : null, status === "failed" ? 1 : 0, now + 86_400));
    }
  }

  const gameCounts = { jackpot: 4, coinflip: 3, daily: 6 } as const;
  for (const [gameType, count] of Object.entries(gameCounts)) {
    for (let index = 0; index < count; index += 1) {
      const address = `${FIXTURE_PREFIX}:game:${gameType}:${index}`;
      const wager = (index + 1) * (gameType === "jackpot" ? 500_000_000 : gameType === "coinflip" ? 250_000_000 : 100_000_000);
      const open = index === 0;
      const fee = open ? 0 : Math.round(wager * 0.05);
      const payout = open ? 0 : wager - fee;
      statements.push(env.DB.prepare(`INSERT OR REPLACE INTO games
        (address,chain_address,game_type,numeric_id,state,creator,winner,wager_lamports,pot_lamports,payout_lamports,fee_lamports,randomness_hex,opened_at,expires_at,settled_at,last_signature,last_slot,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
        .bind(address, address, gameType, `fixture-${index}`, open ? "open" : "settled", `${FIXTURE_PREFIX}:creator`, open ? null : `${FIXTURE_PREFIX}:winner`, wager, wager, payout, fee, open ? null : "00", now - 3_600, now + (open ? 3_600 : -1_800), open ? null : now - 1_800, `${FIXTURE_PREFIX}:signature:${gameType}:${index}`, 1_000 + index));
    }
  }

  const toolDurations = [6.4, 9.8, 14.2, 21.6];
  for (const [index, duration] of toolDurations.entries()) {
    const id = `${FIXTURE_PREFIX}:tool:${index}`;
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO ai_tool_calls
      (id,conversation_id,call_id,tool_name,arguments_json,result_json,status,duration_ms,error_code,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(id, `${FIXTURE_PREFIX}:conversation`, id, index === 3 ? "verify_fairness" : "explain_game", "{}", '{"fixture":true}', "success", duration, null));
  }

  for (let index = 0; index < 7; index += 1) {
    const positive = index < 5;
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO ai_feedback
      (id,message_id,wallet_hash,rating,reason,created_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`)
      .bind(`${FIXTURE_PREFIX}:feedback:${index}`, `${FIXTURE_PREFIX}:message:${index}`, `${FIXTURE_PREFIX}:reviewer:${index}`, positive ? 1 : -1, FIXTURE_PREFIX));
  }

  await env.DB.batch(statements);
  return Response.json({
    status: "seeded",
    scope: "local-only",
    transactions: Object.values(operationCounts).reduce((total, count) => total + count, 0),
    games: Object.values(gameCounts).reduce((total, count) => total + count, 0),
    toolCalls: toolDurations.length,
    feedback: 7,
  }, { headers: { "cache-control": "no-store" } });
}
