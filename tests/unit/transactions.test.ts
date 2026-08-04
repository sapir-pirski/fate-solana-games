import assert from "node:assert/strict";
import test from "node:test";
import { isValidGameAction, parseLamports, serializeLamports } from "../../lib/transactions";

test("lamports cross the JSON boundary as a lossless decimal string", () => {
  const amount = 4_850_000_001n;
  const payload = JSON.stringify({ amountLamports: serializeLamports(amount) });
  assert.equal(payload, '{"amountLamports":"4850000001"}');
  assert.equal(parseLamports(JSON.parse(payload).amountLamports), Number(amount));
});

test("lamport parsing rejects malformed and unsafe values", () => {
  for (const value of [1, 1n, -1, "-1", "1.5", "01", "", "9007199254740992"]) assert.equal(parseLamports(value), null);
  assert.equal(parseLamports("0"), 0);
  assert.equal(parseLamports(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
});

test("game actions must match their game type", () => {
  assert.equal(isValidGameAction("jackpot", "enter_jackpot"), true);
  assert.equal(isValidGameAction("coinflip", "create_coinflip"), true);
  assert.equal(isValidGameAction("coinflip", "join_coinflip"), true);
  assert.equal(isValidGameAction("coinflip", "settle_coinflip"), true);
  assert.equal(isValidGameAction("coinflip", "cancel_coinflip"), true);
  assert.equal(isValidGameAction("coinflip", "refund_coinflip_timeout"), true);
  assert.equal(isValidGameAction("daily", "open_daily"), true);
  assert.equal(isValidGameAction("daily", "settle_daily"), true);
  assert.equal(isValidGameAction("daily", "cancel_daily_timeout"), true);
  assert.equal(isValidGameAction("jackpot", "create_coinflip"), false);
  assert.equal(isValidGameAction("unknown", "enter_jackpot"), false);
});
