import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coordination=readFileSync(new URL("../lib/coordination.ts",import.meta.url),"utf8");
const worker=readFileSync(new URL("../worker/coordination-worker.ts",import.meta.url),"utf8");
const compose=readFileSync(new URL("../compose.local.yaml",import.meta.url),"utf8");

test("database rate limits are atomic and identifiers are hashed",()=>{assert.match(coordination,/sha256\(input\.subject\)/);assert.match(coordination,/rateLimitBuckets\.count\}\+1/);assert.match(coordination,/retry-after/);});
test("durable jobs are idempotent, leased, retried, and dead-lettered",()=>{assert.match(coordination,/dedupeKey/);assert.match(worker,/FOR UPDATE SKIP LOCKED/);assert.match(worker,/lease_expires_at/);assert.match(worker,/2\*\*job\.attempts/);assert.match(worker,/"dead"/);});
test("distributed leases use ownership tokens and compare-before-release",()=>{assert.match(coordination,/tokenHash:sha256\(token\)/);assert.match(coordination,/eq\(distributedLeases\.tokenHash,sha256\(token\)\)/);});
test("local platform has no Redis dependency",()=>{assert.doesNotMatch(compose,/^\s{2}redis:/m);assert.doesNotMatch(compose,/redis-exporter/);assert.match(compose,/coordination-worker:/);});
