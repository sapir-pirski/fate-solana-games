import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("runtime routes do not query tables removed by the current migration", () => {
  for (const route of ["app/api/indexer/games/route.ts", "app/api/internal/maintenance/route.ts", "app/api/metrics/route.ts"]) {
    const source = read(route);
    assert.doesNotMatch(source, /response_cache|distributed_leases/, route);
  }
});

test("wallet operations serialize lamports before JSON encoding", () => {
  const source = read("app/solana/useWallet.ts");
  assert.match(source, /serializeLamports\(operation\.amountLamports\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(operation\)/);
});
