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

test("the server derives compliance amounts from the exact unsigned Solana message", () => {
  const wallet = read("app/solana/useWallet.ts");
  const route = read("app/api/transactions/route.ts");
  assert.match(wallet, /unsignedTransaction/);
  assert.doesNotMatch(wallet, /amountLamports:serializeLamports/);
  assert.match(route, /decodeTransactionIntent/);
  assert.match(route, /intent\.amountLamports/);
  assert.match(route, /messageHash/);
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

test("database backup and restore share a complete manifest and require guarded replacement", () => {
  const manifest = read("lib/database-backup.ts");
  const backup = read("app/api/internal/backup/route.ts");
  const restore = read("app/api/internal/restore/route.ts");
  for (const table of ["chain_events", "games", "game_entries", "indexer_checkpoints", "wallet_auth_challenges", "rate_limit_buckets", "agent_runs", "agent_alerts"]) {
    assert.match(manifest, new RegExp(`"${table}"`));
  }
  assert.match(backup, /createDatabaseBackup/);
  assert.match(restore, /validateDatabaseBackup/);
  assert.match(restore, /dryRun/);
  assert.match(restore, /get\("mode"\) !== "replace"/);
  assert.match(restore, /x-fate-restore-confirm/);
  assert.match(restore, /buildAtomicRestorePlan/);
  assert.match(restore, /RESTORE_STAGE_COUNT_MISMATCH/);
  assert.match(restore, /env\.DB\.batch/);
  assert.match(restore, /authorizeAutomation/);
  assert.match(read("lib/internal-api.ts"), /runtimeEnv\("AUTOMATION_TOKEN"\)/);
  assert.match(read("scripts/start-container.mjs"), /"AUTOMATION_TOKEN"/);
});
