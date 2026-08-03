import { env } from "cloudflare:workers";
import { ensureAuthSchema, ensureGameSchema } from "../../../../db";

const allowedTypes = new Set(["jackpot", "coinflip", "daily"]);
const allowedStates = new Set(["open", "randomness_requested", "settled", "refunded", "closed"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const state = url.searchParams.get("state");
  const wallet = url.searchParams.get("wallet");
  if ((type && !allowedTypes.has(type)) || (state && !allowedStates.has(state)) || (wallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet))) {
    return Response.json({ error: "Invalid query." }, { status: 400 });
  }

  await Promise.all([ensureAuthSchema(), ensureGameSchema()]);
  const predicates: string[] = [];
  const bindings: string[] = [];
  if (type) { predicates.push("game_type=?"); bindings.push(type); }
  if (state) { predicates.push("state=?"); bindings.push(state); }
  if (wallet) {
    predicates.push("(creator=? OR winner=? OR EXISTS (SELECT 1 FROM game_entries e WHERE e.game_address=games.address AND e.wallet_address=?))");
    bindings.push(wallet, wallet, wallet);
  }
  const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  const query = `SELECT address,game_type,numeric_id,state,creator,winner,wager_lamports,pot_lamports,payout_lamports,fee_lamports,randomness_hex,opened_at,expires_at,settled_at,last_signature,last_slot,updated_at FROM games ${where} ORDER BY last_slot DESC LIMIT 100`;
  const games = (await env.DB.prepare(query).bind(...bindings).all()).results;
  const cursor = await env.DB.prepare("SELECT last_slot,updated_at FROM indexer_checkpoints WHERE consumer=?").bind(`fate-program:${process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet"}`).first<{ last_slot: number; updated_at: string }>();
  const payload = { games, commitment: "finalized", indexedSlot: cursor?.last_slot ?? null, indexedAt: cursor?.updated_at ?? new Date().toISOString() };
  return Response.json(payload, { headers: { "cache-control": "private, no-store" } });
}
