import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const coordination=readFileSync(new URL("../lib/coordination.ts",import.meta.url),"utf8");
const confirmationWorker=readFileSync(new URL("../server/services/transaction-confirmation.ts",import.meta.url),"utf8");
const maintenance=readFileSync(new URL("../app/api/internal/maintenance/route.ts",import.meta.url),"utf8");
const compose=readFileSync(new URL("../compose.local.yaml",import.meta.url),"utf8");

test("database rate limits are atomic and identifiers are hashed",()=>{assert.match(coordination,/sha256\(input\.subject\)/);assert.match(coordination,/rateLimitBuckets\.count\}\+1/);assert.match(coordination,/retry-after/);});
test("durable D1 jobs are idempotent",()=>{assert.match(coordination,/dedupeKey/);assert.match(coordination,/onConflictDoUpdate/);assert.match(coordination,/backgroundJobs/);});
test("transaction confirmation jobs use leases, bounded retries, and scheduled processing",()=>{assert.match(confirmationWorker,/lease_expires_at/);assert.match(confirmationWorker,/attempts<max_attempts/);assert.match(confirmationWorker,/getSignatureStatuses/);assert.match(confirmationWorker,/searchTransactionHistory: true/);assert.match(confirmationWorker,/MAX_ATTEMPTS_EXCEEDED/);assert.match(maintenance,/processTransactionConfirmationJobs/);});
test("local platform uses one D1 database and only approved services",()=>{const serviceBlock=compose.slice(compose.indexOf("services:"),compose.indexOf("\nnetworks:"));const services=[...serviceBlock.matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map(match=>match[1]);assert.deepEqual(services,["app","prometheus","loki","tempo","renderer","alloy","grafana"]);assert.match(compose,/app_state:\s*\{\}/);});
