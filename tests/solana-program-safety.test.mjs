import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../programs/fate-games/src/lib.rs", import.meta.url), "utf8");
const anchor = await readFile(new URL("../Anchor.toml", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const programReadme = await readFile(new URL("../programs/fate-games/README.md", import.meta.url), "utf8");
const verifier = await readFile(new URL("../lib/fairness.ts", import.meta.url), "utf8");

test("program IDs stay consistent across Anchor and web configuration", () => {
  const id = source.match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
  assert.ok(id, "declare_id must exist");
  assert.match(anchor, new RegExp(`fate_games = "${id}"`));
  assert.match(envExample, new RegExp(`NEXT_PUBLIC_FATE_PROGRAM_ID=${id}`));
});

test("all games retain settlement failure recovery", () => {
  assert.match(source, /enable_jackpot_refunds/);
  assert.match(source, /refund_coinflip_timeout/);
  assert.match(source, /cancel_daily_timeout/);
  assert.match(source, /RANDOMNESS_TIMEOUT_SECONDS/);
});

test("custody paths use checked arithmetic and constrained PDA vaults", () => {
  assert.match(source, /checked_add/);
  assert.match(source, /checked_sub/);
  assert.match(source, /checked_mul/);
  assert.match(source, /seeds = \[JACKPOT_VAULT_SEED/);
  assert.match(source, /seeds = \[COINFLIP_VAULT_SEED/);
  assert.match(source, /seeds = \[DAILY_VAULT_SEED\]/);
});

test("Switchboard commitments are provider-bound, fresh, and replay protected", () => {
  assert.match(source, /RandomnessAccountData::parse/);
  assert.match(source, /get_value\(clock_slot\)/);
  assert.match(source, /data\.seed_slot == expected_seed_slot/);
  assert.match(source, /data\.reveal_slot == 0 && data\.value == \[0; 32\]/);
  assert.match(source, /RANDOMNESS_RECEIPT_SEED/);
  assert.match(source, /InvalidRandomnessProgram/);
  assert.match(source, /InvalidRandomnessQueue/);
  assert.match(programReadme, /Switchboard On-Demand/i);
});

test("randomness receipts return rent only on settlement or timeout recovery", () => {
  assert.match(source, /pub rent_payer: Pubkey/);
  assert.match(source, /receipt\.rent_payer = rent_payer/);
  assert.equal((source.match(/close = rent_payer/g) ?? []).length, 6);
  assert.equal((source.match(/RandomnessReceiptClosed \{/g) ?? []).length, 7);
  assert.match(source, /address = randomness_receipt\.rent_payer/);
  assert.match(programReadme, /returns all receipt rent to that original payer/i);
});

test("public verifier reads Solana directly and reproduces every game outcome", () => {
  assert.match(verifier, /connection\.getAccountInfo/);
  assert.match(verifier, /providerInfo\.owner\.equals/);
  assert.match(verifier, /provider\.seedSlot === game\.seedSlot/);
  assert.match(verifier, /sameBytes\(provider\.value, game\.randomness\)/);
  assert.match(verifier, /weightedWinner/);
  assert.match(verifier, /dailyReward/);
});

test("economic configuration changes are delayed and observable", () => {
  assert.match(source, /CONFIG_TIMELOCK_SECONDS: i64 = 86_400/);
  assert.match(source, /pub fn propose_config_update/);
  assert.match(source, /pub fn apply_config_update/);
  assert.match(source, /pub fn cancel_config_update/);
  assert.match(source, /ConfigTimelockActive/);
  assert.match(source, /ConfigUpdateProposed/);
  assert.match(source, /ConfigUpdateCancelled/);
});

test("privileged roles are separated, delayed, and multisig compatible", () => {
  assert.match(source, /pub pause_authority: Pubkey/);
  assert.match(source, /pending_admin_effective_at/);
  assert.match(source, /pending_pause_effective_at/);
  assert.match(source, /AuthorityTransferProposed/);
  assert.match(source, /AuthorityTransferAccepted/);
  assert.match(source, /let expected = if paused[\s\S]*pause_authority[\s\S]*config\.admin/);
  assert.match(programReadme, /Squads\s+vault PDAs/i);
});

test("accounts close only after games are terminal and liabilities are cleared", () => {
  assert.match(source, /pub fn close_jackpot/);
  assert.match(source, /pub fn close_coinflip/);
  assert.match(source, /pub fn close_daily_player/);
  assert.match(source, /GameNotTerminal/);
  assert.match(source, /OutstandingLiabilities/);
  assert.match(source, /vault_available/);
  assert.match(programReadme, /no spendable balance or\s+refund liability remains/i);
});
