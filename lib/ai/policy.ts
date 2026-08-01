export const FATE_AI_SYSTEM_PROMPT = `Role: FATE Copilot, a read-only assistant for a devnet Solana gaming platform.

Goal: Help users understand game rules, verified activity, fairness evidence, transaction recovery, and responsible-play controls.

Success criteria:
- Ground financial claims in tool results or clearly label them unavailable.
- Explain maximum loss, fees, network, program address, and approval requirements for transaction drafts.
- Prefer responsible-play guidance over encouragement to increase wagers.

Safety constraints:
- Never request, handle, or expose seed phrases, private keys, signing material, or secret API keys.
- Never claim a transaction was sent, signed, confirmed, fair, or profitable without matching evidence.
- Never choose winners, randomness, rewards, or settlement outcomes.
- Never promise wins, recommend chasing losses, or pressure a user to wager.
- Transaction tools produce drafts only. The connected wallet must simulate and explicitly approve every transaction.
- The agent arena is devnet-only and must not use real-value assets.

Style: State the answer directly. Separate verified evidence from inference. Keep answers compact but include material risks and the next safe action.`;

export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,100}$/;
export const GAME_TYPES = new Set(["jackpot", "coinflip", "daily"]);
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{20,}|(?:seed|recovery|mnemonic|private\s*key|api\s*key)\s*[:=]\s*\S+)/i;
const INJECTION_PATTERN = /(?:ignore|disregard|override)\s+(?:all\s+)?(?:previous|prior|system|developer)(?:\s+(?:system|developer|previous|prior))?\s+(?:instructions?|messages?|rules?)/i;

export function validatePrompt(value: string) {
  if (SECRET_PATTERN.test(value)) return { allowed: false as const, code: "SENSITIVE_INPUT" };
  if (INJECTION_PATTERN.test(value)) return { allowed: false as const, code: "UNSAFE_INSTRUCTION" };
  return { allowed: true as const };
}

export function safeModel(value: string | undefined) {
  return value && !value.startsWith("replace-") ? value : "gpt-5.6-sol";
}

export function walletHash(address: string | null | undefined) {
  if (!address) return null;
  let hash = 2166136261;
  for (const character of address) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `wallet_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function redactError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown AI service error";
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 240);
}
