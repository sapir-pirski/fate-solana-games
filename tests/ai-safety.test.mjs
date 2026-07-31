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
});

test("agent automation remains devnet-only and non-signing", async () => {
  const arena = await read("app/api/ai/arena/route.ts");
  const ops = await read("app/api/ai/ops/route.ts");
  assert.match(arena, /AI_AGENT_ARENA_NETWORK !== "devnet"/);
  assert.match(arena, /realValue: false/);
  assert.match(ops, /automaticSigning: false/);
});
