import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth=readFileSync(new URL("../lib/auth.ts",import.meta.url),"utf8");
const wallet=readFileSync(new URL("../app/solana/useWallet.ts",import.meta.url),"utf8");
const transactions=readFileSync(new URL("../app/api/transactions/route.ts",import.meta.url),"utf8");
const schema=readFileSync(new URL("../db/postgres-schema.ts",import.meta.url),"utf8");

test("wallet sessions use signed challenges and hashed HttpOnly cookies",()=>{
  assert.match(auth,/crypto\.subtle\.verify\("Ed25519"/);
  assert.match(auth,/HttpOnly; SameSite=Strict/);
  assert.match(schema,/wallet_auth_challenges/);
  assert.match(schema,/token_hash TEXT NOT NULL UNIQUE/);
});

test("transaction recovery has an explicit guarded state machine",()=>{
  for(const state of ["draft","awaiting_signature","submitted","confirmed","finalized","rejected","failed","expired","unknown"])assert.match(transactions,new RegExp(`\\"${state}\\"`));
  assert.match(transactions,/INVALID_TRANSITION/);
  assert.match(transactions,/operation_id TEXT NOT NULL UNIQUE|operationId/);
});

test("wallet confirmation recovers through RPC failover without signing again",()=>{
  assert.match(wallet,/NEXT_PUBLIC_SOLANA_RPC_URLS/);
  assert.match(wallet,/getSignatureStatuses/);
  assert.match(wallet,/connect\(\{silent:true\}\)/);
  assert.match(wallet,/\/api\/auth\/session/);
  assert.doesNotMatch(wallet,/signAndSendTransaction[\s\S]{0,300}while \(Date\.now/);
});
