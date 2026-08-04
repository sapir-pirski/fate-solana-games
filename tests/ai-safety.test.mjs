import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Copilot policy forbids secrets, signing, and outcome control", async () => {
  const policy = await read("lib/ai/policy.ts");
  assert.match(policy, /Never request, handle, or expose seed phrases/);
  assert.match(policy, /Transaction tools produce drafts only/);
  assert.match(policy, /Never choose winners, randomness, rewards/);
});

test("Responses calls are stateless and tool rounds are bounded", async () => {
  const route = await read("app/api/ai/chat/route.ts");
  assert.match(route, /const MAX_TOOL_ROUNDS = 3/);
  assert.match(route, /store: false/);
  assert.doesNotMatch(route, /previous_response_id/);
  assert.match(route, /authenticatedWallet/);
  assert.match(route, /enforceRateLimit/);
  assert.match(route, /AI_MAX_TOKENS_PER_WALLET_DAY/);
  assert.match(route, /recordProviderUsage\(response/);
  assert.match(route, /round: 0/);
  assert.match(route, /round: toolRounds/);
  assert.match(route, /unixepoch\(created_at\)>=unixepoch\('now','start of day'\)/);
  assert.match(route, /unixepoch\(created_at\)>=unixepoch\('now','start of month'\)/);
  assert.match(route, /onConflictDoNothing\(\{ target: aiUsage\.responseId \}\)/);
});

test("saved AI conversations are scoped to the authenticated wallet", async () => {
  const route = await read("app/api/ai/chat/route.ts");
  assert.match(route, /CONVERSATION_NOT_FOUND/);
  assert.match(route, /eq\(aiConversations\.id, requestedConversationId\)/);
  assert.match(route, /eq\(aiConversations\.ownerKey, ownerKey\)/);
  assert.match(route, /eq\(aiConversations\.status, "active"\)/);
  assert.match(route, /innerJoin\(aiConversations/);
  assert.match(route, /walletAddress: ownerWallet, ownerKey/);
  assert.doesNotMatch(route, /values\(\{ id: conversationId, walletAddress \}\)\.onConflictDoNothing/);
});

test("AI feedback requires message ownership and a message-bound capability", async () => {
  const route = await read("app/api/ai/feedback/route.ts");
  assert.match(route, /const session = await authenticatedWallet\(request\)/);
  assert.match(route, /innerJoin\(aiConversations/);
  assert.match(route, /eq\(aiConversations\.ownerKey, ownerKey\)/);
  assert.match(route, /eq\(aiMessages\.role, "assistant"\)/);
  assert.match(route, /eq\(aiMessages\.feedbackTokenHash, sha256\(feedbackToken\)\)/);
  assert.match(route, /enforceRateLimit\(\{ scope: "ai_feedback"/);
  assert.doesNotMatch(route, /\?\? "anonymous"/);
});

test("unfinished Arena is not exposed in the production Copilot UI", async () => {
  const component = await read("app/ai/FateCopilot.tsx");
  assert.doesNotMatch(component, /runArena|Devnet Agent Arena|\"arena\"/);
});

test("operations automation remains non-signing", async () => {
  const ops = await read("app/api/ai/ops/route.ts");
  assert.match(ops, /automaticSigning: false/);
});

test("transaction diagnostics read only the authenticated wallet's tracked operation", async () => {
  const tools = await read("lib/ai/tools.ts");
  assert.match(tools, /transactionOperations/);
  assert.doesNotMatch(tools, /transactionIntents|trackedIntent/);
  assert.match(tools, /WALLET_AUTH_REQUIRED/);
  assert.match(tools, /eq\(transactionOperations\.signature, signature\)/);
  assert.match(tools, /eq\(transactionOperations\.walletAddress, context\.authenticatedWallet\)/);
  assert.match(tools, /trackedOperation/);
});
