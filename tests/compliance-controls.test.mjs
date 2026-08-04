import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
test("mainnet and unverified wallets fail closed", async () => { const policy = await read("lib/compliance.ts"); assert.match(policy, /MAINNET_DISABLED_PENDING_LICENSE/); assert.match(policy, /AGE_ATTESTATION_REQUIRED/); assert.match(policy, /CONSENT_RENEWAL_REQUIRED/); assert.match(policy, /JURISDICTION_BLOCKED/); });
test("transaction preparation enforces compliance and play limits", async () => { const route = await read("app/api/transactions/route.ts"); const policy = await read("lib/compliance.ts"); assert.match(route, /reserveWagerOperation/); assert.match(policy, /DAILY_LIMIT_EXCEEDED/); assert.match(policy, /WEEKLY_LIMIT_EXCEEDED/); assert.match(route, /transaction_gate/); });
test("self-exclusion cannot be shortened", async () => { const route = await read("app/api/compliance/responsible-play/route.ts"); assert.match(route, /Math\.max\(selfExcludedUntil/); assert.match(route, /\[180, 365, 1825\]/); });
test("privacy and consent records are durable and versioned", async () => { const schema = await read("db/schema.ts"); const policy = await read("lib/compliance.ts"); assert.match(schema, /complianceAuditEvents/); assert.match(schema, /privacyRequests/); assert.match(policy, /terms: "2026-08-01"/); assert.match(policy, /privacy: "2026-08-01"/); });
