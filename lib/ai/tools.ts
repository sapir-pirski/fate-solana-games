import { desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { gameEntries, games, responsiblePlayLimits, transactionIntents } from "../../db/schema";
import { BASE58, GAME_TYPES } from "./policy";

export const AI_TOOLS = [
  { type: "function", name: "explain_game", description: "Explain deterministic FATE game rules and failure recovery.", strict: true, parameters: { type: "object", properties: { gameType: { type: "string", enum: ["jackpot", "coinflip", "daily"] } }, required: ["gameType"], additionalProperties: false } },
  { type: "function", name: "get_wallet_activity", description: "Read indexed on-chain activity for a wallet. Never estimates missing records.", strict: true, parameters: { type: "object", properties: { walletAddress: { type: "string" } }, required: ["walletAddress"], additionalProperties: false } },
  { type: "function", name: "verify_fairness", description: "Return stored settlement and randomness evidence for a game address.", strict: true, parameters: { type: "object", properties: { gameAddress: { type: "string" } }, required: ["gameAddress"], additionalProperties: false } },
  { type: "function", name: "diagnose_transaction", description: "Check a tracked transaction intent and optionally its Solana RPC status.", strict: true, parameters: { type: "object", properties: { signature: { type: "string" } }, required: ["signature"], additionalProperties: false } },
  { type: "function", name: "check_responsible_limits", description: "Read deterministic responsible-play limits for a wallet.", strict: true, parameters: { type: "object", properties: { walletAddress: { type: "string" }, proposedLamports: { type: "integer", minimum: 0 } }, required: ["walletAddress", "proposedLamports"], additionalProperties: false } },
  { type: "function", name: "draft_game_action", description: "Create a non-signing devnet action draft. This never submits or signs a transaction.", strict: true, parameters: { type: "object", properties: { walletAddress: { type: "string" }, action: { type: "string", enum: ["enter_jackpot", "create_coinflip", "join_coinflip", "open_daily"] }, gameType: { type: "string", enum: ["jackpot", "coinflip", "daily"] }, amountLamports: { type: "integer", minimum: 0 }, side: { type: ["string", "null"], enum: ["heads", "tails", null] } }, required: ["walletAddress", "action", "gameType", "amountLamports", "side"], additionalProperties: false } },
] as const;

const rules = {
  jackpot: { summary: "Players deposit SOL into a program-owned round vault. A weighted selection maps verified randomness across cumulative lamport ranges.", recovery: "After the randomness timeout, refunds can be enabled and each entrant claims their deposited total once." },
  coinflip: { summary: "Two different wallets escrow equal wagers on opposite sides. Verified randomness selects the winner and the program transfers the net pot.", recovery: "An unmatched game can be cancelled after expiry; a joined game refunds both players if randomness times out." },
  daily: { summary: "A wallet may request one free case per 24-hour cooldown. The configured randomness authority fulfills a deterministic reward tier from the funded daily vault.", recovery: "A pending request must settle or be handled operationally; no player deposit is required." },
};

function requireWallet(value: unknown) {
  if (typeof value !== "string" || !BASE58.test(value)) throw new Error("INVALID_WALLET");
  return value;
}

export async function executeAiTool(name: string, raw: Record<string, unknown>) {
  if (name === "explain_game") {
    const gameType = String(raw.gameType);
    if (!GAME_TYPES.has(gameType)) throw new Error("INVALID_GAME_TYPE");
    return { gameType, ...rules[gameType as keyof typeof rules], source: "program-design", network: "devnet" };
  }
  if (name === "get_wallet_activity") {
    const wallet = requireWallet(raw.walletAddress);
    const entries = await getDb().select().from(gameEntries).where(eq(gameEntries.walletAddress, wallet)).orderBy(desc(gameEntries.slot)).limit(25);
    return { wallet, count: entries.length, totalLamports: entries.reduce((sum, entry) => sum + entry.amountLamports, 0), entries };
  }
  if (name === "verify_fairness") {
    const address = String(raw.gameAddress);
    const [game] = await getDb().select().from(games).where(eq(games.address, address)).limit(1);
    return game ? { verified: game.state === "settled" && Boolean(game.randomnessHex), evidence: game } : { verified: false, reason: "No indexed settlement evidence was found." };
  }
  if (name === "diagnose_transaction") {
    const signature = String(raw.signature);
    if (!BASE58.test(signature)) throw new Error("INVALID_SIGNATURE");
    const [intent] = await getDb().select().from(transactionIntents).where(eq(transactionIntents.signature, signature)).limit(1);
    let rpcStatus: unknown = null;
    try {
      const response = await fetch(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "getSignatureStatuses", params: [[signature], { searchTransactionHistory: true }] }) });
      rpcStatus = (await response.json() as { result?: { value?: unknown[] } }).result?.value?.[0] ?? null;
    } catch { rpcStatus = null; }
    return { signature, trackedIntent: intent ?? null, rpcStatus };
  }
  if (name === "check_responsible_limits") {
    const wallet = requireWallet(raw.walletAddress); const proposed = Number(raw.proposedLamports);
    const [limits] = await getDb().select().from(responsiblePlayLimits).where(eq(responsiblePlayLimits.walletAddress, wallet)).limit(1);
    const now = Math.floor(Date.now() / 1000); const blocked = Boolean(limits && ((limits.cooldownUntil ?? 0) > now || (limits.selfExcludedUntil ?? 0) > now || (limits.dailyLamports != null && proposed > limits.dailyLamports)));
    return { wallet, proposedLamports: proposed, allowed: !blocked, limits: limits ?? null, reason: blocked ? "A configured limit or cooldown blocks this draft." : null };
  }
  if (name === "draft_game_action") {
    const wallet = requireWallet(raw.walletAddress); const gameType = String(raw.gameType); const amount = Number(raw.amountLamports);
    if (!GAME_TYPES.has(gameType) || !Number.isSafeInteger(amount) || amount < 0) throw new Error("INVALID_DRAFT");
    const limit = await executeAiTool("check_responsible_limits", { walletAddress: wallet, proposedLamports: amount }) as { allowed: boolean; reason: string | null };
    return { id: crypto.randomUUID(), network: "devnet", wallet, gameType, action: raw.action, amountLamports: amount, side: raw.side, simulationRequired: true, walletApprovalRequired: true, submitted: false, allowed: limit.allowed, blocker: limit.reason, expiresAt: Date.now() + 10 * 60_000 };
  }
  throw new Error("UNKNOWN_TOOL");
}
