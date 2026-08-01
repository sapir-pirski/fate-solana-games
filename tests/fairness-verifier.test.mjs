import assert from "node:assert/strict";
import test from "node:test";
import { dailyReward, weightedWinner } from "../lib/fairness.ts";

test("public jackpot verifier reproduces weighted lamport ranges", () => {
  const randomness = new Uint8Array(32);
  randomness.set(new Uint8Array(new BigUint64Array([3n]).buffer), 0);
  assert.equal(weightedWinner([
    { player: "first", amount: 3n },
    { player: "second", amount: 7n },
  ], randomness), "second");
});

test("public Daily Case verifier exactly matches on-chain reward tiers", () => {
  assert.equal(dailyReward(0), 1_000_000_000n);
  assert.equal(dailyReward(2), 250_000_000n);
  assert.equal(dailyReward(12), 100_000_000n);
  assert.equal(dailyReward(52), 50_000_000n);
  assert.equal(dailyReward(255), 10_000_000n);
});
