import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { decodeProgramEvents } from "../indexer/decoder.ts";
import { RpcPool } from "../indexer/rpc.ts";
import { isTransient, retryDelay, RpcError, withRetry } from "../indexer/retry.ts";

const program = Keypair.generate().publicKey.toBase58();
function event(name, fields) {
  const discriminator = createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
  return `Program data: ${Buffer.concat([discriminator, ...fields]).toString("base64")}`;
}
function u64(value) { const data = Buffer.alloc(8); data.writeBigUInt64LE(BigInt(value)); return data; }
function i64(value) { const data = Buffer.alloc(8); data.writeBigInt64LE(BigInt(value)); return data; }

test("Anchor event decoder creates stable instruction and event positions", () => {
  const game = Keypair.generate().publicKey;
  const logs = [
    `Program ${program} invoke [1]`,
    event("JackpotCreated", [game.toBuffer(), u64(42), i64(1234)]),
    `Program ${program} success`,
  ];
  const [decoded] = decodeProgramEvents(logs, program);
  assert.equal(decoded.name, "JackpotCreated");
  assert.deepEqual(decoded.payload, { game: game.toBase58(), numericId: "42", expiresAt: "1234", gameType: "jackpot", state: "open" });
  assert.equal(decoded.instructionIndex, 0);
  assert.equal(decoded.eventIndex, 0);
});

test("retry policy retries transient failures with capped jitter", async () => {
  let attempts = 0; const sleeps = [];
  const result = await withRetry(async () => { attempts++; if (attempts < 3) throw new RpcError("limited", 429); return "ok"; }, { sleep: async ms => { sleeps.push(ms); } });
  assert.equal(result, "ok"); assert.equal(attempts, 3); assert.equal(sleeps.length, 2);
  assert.equal(isTransient(new RpcError("bad request", 400)), false);
  assert.equal(retryDelay(20, undefined, () => 1), 30_000);
});

test("RPC pool fails over after a rate-limited provider", async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes("primary")) return new Response("limited", { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: 99 }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try { assert.equal(await new RpcPool(["https://primary.invalid", "https://secondary.invalid"]).getSlot("finalized"), 99); assert.deepEqual(calls, ["https://primary.invalid", "https://secondary.invalid"]); }
  finally { globalThis.fetch = original; }
});
