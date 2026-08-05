import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8");

test("OpenAI safety identifiers are hashed to the provider's 64-character limit", () => {
  assert.match(route, /const safetyIdentifier = sha256\(`/);
  assert.doesNotMatch(route, /safety_identifier: rateKey/);
  assert.equal("0".repeat(64).length, 64);
});
