import assert from "node:assert/strict";
import test from "node:test";
import { isAuthenticatedAccount, selectAccountForChain, supportsConfiguredChain } from "../../lib/solana/wallet-chain.ts";

const mainnet = { address: "mainnet-account", chains: ["solana:mainnet"] };
const devnet = { address: "devnet-account", chains: ["solana:devnet"] };
const multiChain = { address: "multi-account", chains: ["solana:mainnet", "solana:devnet"] };

test("wallet chain support is exact and never bypasses devnet validation", () => {
  assert.equal(supportsConfiguredChain(mainnet, "solana:devnet"), false);
  assert.equal(supportsConfiguredChain(devnet, "solana:devnet"), true);
  assert.equal(supportsConfiguredChain(multiChain, "solana:devnet"), true);
});

test("account selection never falls back to an account on the wrong chain", () => {
  assert.equal(selectAccountForChain([mainnet], "solana:devnet"), null);
  assert.equal(selectAccountForChain([mainnet, devnet], "solana:devnet"), devnet);
  assert.equal(selectAccountForChain([mainnet, devnet], "solana:devnet", "mainnet-account"), null);
  assert.equal(selectAccountForChain([mainnet, devnet], "solana:devnet", "devnet-account"), devnet);
});

test("authentication is bound to the exact displayed account", () => {
  assert.equal(isAuthenticatedAccount("wallet-a", "wallet-a"), true);
  assert.equal(isAuthenticatedAccount("wallet-b", "wallet-a"), false);
  assert.equal(isAuthenticatedAccount(null, "wallet-a"), false);
  assert.equal(isAuthenticatedAccount("wallet-a", null), false);
});
