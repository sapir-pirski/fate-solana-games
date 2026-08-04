import assert from "node:assert/strict";
import test from "node:test";
import { addAiUsage, estimateAiCostUsd, normalizeAiUsage } from "../../lib/ai/usage";

test("AI usage totals include every provider round", () => {
  const first = normalizeAiUsage({ input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 5 } });
  const second = normalizeAiUsage({ input_tokens: 140, output_tokens: 30, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 7 } });
  assert.deepEqual(addAiUsage(first, second), { inputTokens: 240, outputTokens: 50, cachedTokens: 50, reasoningTokens: 12 });
});

test("AI cost separates cached and uncached input tokens", () => {
  const cost = estimateAiCostUsd({ inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 200_000 }, 1.25, 10, 0.125);
  assert.equal(cost, 2.025);
});

test("AI usage normalization rejects invalid and negative counts", () => {
  assert.deepEqual(normalizeAiUsage({ input_tokens: -1, output_tokens: Number.NaN }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 });
});
