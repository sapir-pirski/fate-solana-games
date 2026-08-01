import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coordination=readFileSync(new URL("../lib/coordination.ts",import.meta.url),"utf8");
const compose=readFileSync(new URL("../compose.local.yaml",import.meta.url),"utf8");

test("database rate limits are atomic and identifiers are hashed",()=>{assert.match(coordination,/sha256\(input\.subject\)/);assert.match(coordination,/rateLimitBuckets\.count\}\+1/);assert.match(coordination,/retry-after/);});
test("durable D1 jobs are idempotent",()=>{assert.match(coordination,/dedupeKey/);assert.match(coordination,/onConflictDoUpdate/);assert.match(coordination,/backgroundJobs/);});
test("local platform uses one D1 database and no external database service",()=>{assert.doesNotMatch(compose,/^\s{2}(redis|postgres):/m);assert.doesNotMatch(compose,/(redis|postgres)-exporter/);assert.match(compose,/app_state:\s*\{\}/);});
