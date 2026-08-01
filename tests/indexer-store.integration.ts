import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { IndexerStore } from "../indexer/store.ts";

test("PostgreSQL ingestion is idempotent and preserves reorganization evidence", { skip: !process.env.DATABASE_URL }, async () => {
  const cluster = `test-${randomUUID()}`; const store = new IndexerStore(process.env.DATABASE_URL!, cluster);
  try {
    await store.initialize();
    const base = { slot: 42, blockTime: 100, commitment: "finalized" as const, succeeded: true, raw: { test: true }, events: [] };
    await store.ingest({ ...base, signature: "signature-a" });
    await store.ingest({ ...base, signature: "signature-a" });
    await store.ingest({ ...base, signature: "signature-b" });
    const [{ count }] = await store.sql<{ count: string }[]>`SELECT COUNT(*)::TEXT AS count FROM solana_transactions WHERE cluster=${cluster}`;
    assert.equal(Number(count), 2);
    assert.equal(await store.reconcile(42, 42, ["signature-b"]), 1);
    const rows = await store.sql<{ signature: string; canonical: boolean }[]>`SELECT signature,canonical FROM solana_transactions WHERE cluster=${cluster} ORDER BY signature`;
    assert.deepEqual(Array.from(rows), [{ signature: "signature-a", canonical: false }, { signature: "signature-b", canonical: true }]);
  } finally {
    await store.sql`DELETE FROM program_events WHERE cluster=${cluster}`;
    await store.sql`DELETE FROM solana_transactions WHERE cluster=${cluster}`;
    await store.sql`DELETE FROM indexer_cursors WHERE cluster=${cluster}`;
    await store.close();
  }
});
