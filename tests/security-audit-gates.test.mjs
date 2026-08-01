import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mainnet remains gated pending independent audit and licensing", async () => {
  const [security, compliance, audit] = await Promise.all([
    read("SECURITY.md"), read("lib/compliance.ts"), read("docs/SECURITY_AUDIT.md"),
  ]);
  assert.match(security, /independent Solana program audit/i);
  assert.match(compliance, /MAINNET_DISABLED_PENDING_LICENSE/);
  assert.match(audit, /not approved for real-value custody or mainnet/i);
});

test("threat model covers custody, randomness, authentication, supply chain and AI", async () => {
  const model = await read("docs/THREAT_MODEL.md");
  for (const marker of ["PDA vault", "randomness", "wallet session", "Supply chain", "AI abuse", "Security invariants"]) assert.match(model, new RegExp(marker, "i"));
});

test("external audit scope requires immutable evidence and retesting", async () => {
  const scope = await read("docs/EXTERNAL_AUDIT_SCOPE.md");
  assert.match(scope, /immutable Git commit/i);
  assert.match(scope, /reproducible test/i);
  assert.match(scope, /final retest status/i);
});
