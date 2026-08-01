import postgres from "postgres";

const allowedTypes = new Set(["jackpot","coinflip","daily"]); const allowedStates = new Set(["open","randomness_requested","settled","refunded","closed"]);
export async function GET(request: Request) {
  const url = new URL(request.url), type = url.searchParams.get("type"), state = url.searchParams.get("state"), wallet = url.searchParams.get("wallet");
  if ((type && !allowedTypes.has(type)) || (state && !allowedStates.has(state)) || (wallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet))) return Response.json({ error: "Invalid query." }, { status: 400 });
  const databaseUrl = process.env.DATABASE_URL; if (!databaseUrl) return Response.json({ games: [], commitment: "finalized", indexedAt: new Date().toISOString(), unavailable: true });
  const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: process.env.DATABASE_SSL === "disable" ? false : "require" });
  try {
    const games = await sql`SELECT address,game_type,numeric_id,state,creator,winner,wager_lamports::TEXT,pot_lamports::TEXT,payout_lamports::TEXT,fee_lamports::TEXT,randomness_hex,opened_at,expires_at,settled_at,last_signature,last_slot::TEXT,updated_at FROM games WHERE (${type}::TEXT IS NULL OR game_type=${type}) AND (${state}::TEXT IS NULL OR state=${state}) AND (${wallet}::TEXT IS NULL OR creator=${wallet} OR winner=${wallet} OR EXISTS (SELECT 1 FROM game_entries e WHERE e.game_address=games.address AND e.wallet_address=${wallet})) ORDER BY last_slot DESC LIMIT 100`;
    const [cursor] = await sql<{ last_slot: string; updated_at: string }[]>`SELECT last_slot::TEXT,updated_at::TEXT FROM indexer_cursors WHERE cluster=${process.env.SOLANA_CLUSTER ?? "devnet"} AND consumer='fate-program' AND commitment='finalized'`;
    return Response.json({ games, commitment: "finalized", indexedSlot: cursor?.last_slot ?? null, indexedAt: cursor?.updated_at ?? new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } finally { await sql.end({ timeout: 2 }); }
}
