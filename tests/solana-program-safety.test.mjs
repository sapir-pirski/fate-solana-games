import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../programs/fate-games/src/lib.rs", import.meta.url), "utf8");
const anchor = await readFile(new URL("../Anchor.toml", import.meta.url), "utf8");
const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
const programReadme = await readFile(new URL("../programs/fate-games/README.md", import.meta.url), "utf8");

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

test("development randomness is explicitly forbidden for mainnet", () => {
  assert.match(programReadme, /not production VRF/i);
  assert.match(programReadme, /Do not enable mainnet wagers/i);
});
