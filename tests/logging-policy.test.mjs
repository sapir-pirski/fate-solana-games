import assert from "node:assert/strict";
import test from "node:test";
import { computeBackoffMs, isRetryableStatus, MAX_LOG_ATTEMPTS, parseRetryAfterMs } from "../lib/logging-policy.mjs";

test("only transient HTTP failures are retried", () => {
  for (const status of [408, 425, 429, 500, 503]) assert.equal(isRetryableStatus(status), true);
  for (const status of [200, 201, 400, 401, 403, 413, 422]) assert.equal(isRetryableStatus(status), false);
});

test("backoff is exponential, jittered, and capped", () => {
  assert.equal(computeBackoffMs(1, 0), 750);
  assert.equal(computeBackoffMs(2, 0.5), 2_000);
  assert.equal(computeBackoffMs(MAX_LOG_ATTEMPTS, 1), 75_000);
});

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfterMs("5", 0), 5_000);
  assert.equal(parseRetryAfterMs("Thu, 01 Jan 1970 00:00:10 GMT", 1_000), 9_000);
  assert.equal(parseRetryAfterMs("invalid", 0), null);
});
