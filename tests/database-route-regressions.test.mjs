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

test("the finalized Solana index has a writer and an authenticated scheduler route", () => {
  const service = readFileSync(new URL("../server/services/solana-indexer.ts", import.meta.url), "utf8");
  const projections = readFileSync(new URL("../lib/solana/indexer-events.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/internal/indexer/route.ts", import.meta.url), "utf8");
  assert.match(service, /INSERT OR IGNORE INTO chain_events/);
  assert.match(projections, /INSERT INTO games/);
  assert.match(projections, /game_entries/);
  assert.match(service, /indexer_checkpoints/);
  assert.match(route, /authorizeAutomation/);
  assert.match(route, /syncSolanaIndexer/);
});
