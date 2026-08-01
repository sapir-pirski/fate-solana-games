import { ensureAiSchema, getDb, withDatabase } from "../../../../db";
import { agentRuns } from "../../../../db/schema";

type ArenaAgent = { name: string; style: "cautious" | "balanced" | "bold"; budgetLamports: number };
function score(agent: ArenaAgent, round: number) {
  let hash = 2166136261;
  for (const character of `${agent.name}:${agent.style}:${round}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

async function handlePost(request: Request) {
  if (process.env.AI_AGENT_ARENA_NETWORK !== "devnet") return Response.json({ code: "ARENA_MUST_USE_DEVNET" }, { status: 403 });
  if (process.env.AI_AGENT_ARENA_ENABLED !== "true") return Response.json({ code: "ARENA_DISABLED", message: "Set AI_AGENT_ARENA_ENABLED=true for local devnet simulations." }, { status: 503 });
  const body = await request.json() as { agents?: ArenaAgent[]; rounds?: number }; const agents = body.agents ?? [];
  if (agents.length < 2 || agents.length > 8 || agents.some(agent => !agent.name || !["cautious", "balanced", "bold"].includes(agent.style) || !Number.isSafeInteger(agent.budgetLamports) || agent.budgetLamports < 1)) return Response.json({ code: "INVALID_AGENTS" }, { status: 400 });
  const rounds = Math.max(1, Math.min(25, Number(body.rounds ?? 5))); const balances = new Map(agents.map(agent => [agent.name, agent.budgetLamports])); const replay = [];
  for (let round = 1; round <= rounds; round += 1) {
    const entries = agents.map(agent => { const balance = balances.get(agent.name) ?? 0; const ratio = agent.style === "cautious" ? .05 : agent.style === "balanced" ? .12 : .22; return { name: agent.name, amount: Math.max(0, Math.floor(balance * ratio)), rationale: `${agent.style} fixed-budget policy; no LLM controls outcomes` }; }).filter(entry => entry.amount > 0);
    const pot = entries.reduce((sum, entry) => sum + entry.amount, 0); if (!pot) break;
    entries.forEach(entry => balances.set(entry.name, (balances.get(entry.name) ?? 0) - entry.amount));
    const winner = [...agents].sort((a, b) => score(b, round) - score(a, round))[0]; balances.set(winner.name, (balances.get(winner.name) ?? 0) + pot);
    replay.push({ round, entries, pot, winner: winner.name, source: "deterministic-devnet-simulation" });
  }
  const output = { network: "devnet", realValue: false, rounds: replay, leaderboard: agents.map(agent => ({ name: agent.name, balanceLamports: balances.get(agent.name) ?? 0 })).sort((a, b) => b.balanceLamports - a.balanceLamports) };
  await ensureAiSchema(); const runId = crypto.randomUUID(); await getDb().insert(agentRuns).values({ id: runId, agentType: "devnet_arena", status: "completed", inputJson: JSON.stringify(body), outputJson: JSON.stringify(output), completedAt: new Date().toISOString() });
  return Response.json({ runId, ...output }, { status: 201 });
}

export async function POST(request: Request) {
  return withDatabase(() => handlePost(request));
}
