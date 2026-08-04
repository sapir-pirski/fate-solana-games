import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { base58Encode, decodeFateAnchorEvent, projectFateEvent } from "../../lib/solana/indexer-events.ts";
import { syncSolanaIndexer } from "../../server/services/solana-indexer.ts";

const PROGRAM_ID = "Fg6PaFpoGXkYsidMpWxqSWY4vF8zqRkMnJx9QpMvdWvZ";
const JACKPOT_CREATED = [236, 185, 15, 9, 64, 171, 39, 36];

function little(value: bigint) {
  const result = Buffer.alloc(8);
  result.writeBigUInt64LE(BigInt.asUintN(64, value));
  return result;
}

function jackpotCreatedFixture() {
  const roundBytes = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  return {
    round: base58Encode(roundBytes),
    base64: Buffer.concat([Buffer.from(JACKPOT_CREATED), Buffer.from(roundBytes), little(71n), little(1_900_000_000n)]).toString("base64"),
  };
}

function migratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fate-indexer-"));
  const sqlite = new DatabaseSync(join(directory, "indexer.sqlite"));
  for (const file of readdirSync(new URL("../../drizzle/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
    const migration = readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint").map(value => value.trim()).filter(Boolean)) sqlite.exec(statement);
  }
  class Statement {
    constructor(readonly sql: string, readonly params: SQLInputValue[] = []) {}
    bind(...params: SQLInputValue[]) { return new Statement(this.sql, params); }
    async first<T>() { return (sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null; }
    async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.params) as T[] }; }
    async run() { const result = sqlite.prepare(this.sql).run(...this.params); return { meta: { changes: Number(result.changes) } }; }
    execute() { return sqlite.prepare(this.sql).run(...this.params); }
  }
  const db = {
    prepare(sql: string) { return new Statement(sql); },
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN");
      try { const results = statements.map(statement => ({ meta: { changes: Number(statement.execute().changes) } })); sqlite.exec("COMMIT"); return results; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { directory, sqlite, db };
}

test("Anchor Jackpot events decode into lossless public data", () => {
  const fixture = jackpotCreatedFixture();
  assert.deepEqual(decodeFateAnchorEvent(fixture.base64), {
    name: "JackpotCreated",
    payload: { round: fixture.round, roundId: "71", endTs: 1_900_000_000 },
  });
});

test("finalized RPC events populate chain events, games, and checkpoints", async () => {
  const fixture = jackpotCreatedFixture();
  const database = migratedDatabase();
  try {
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = request.method === "getSignaturesForAddress"
        ? [{ signature: "5FinalizedSignature", slot: 321, err: null, blockTime: 1_800_000_000, confirmationStatus: "finalized" }]
        : request.method === "getTransaction"
          ? { slot: 321, blockTime: 1_800_000_000, meta: { err: null, logMessages: [`Program data: ${fixture.base64}`] }, transaction: { message: { accountKeys: ["7CreatorWallet11111111111111111111111111111", PROGRAM_ID], instructions: [] } } }
          : null;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
    };
    const result = await syncSolanaIndexer({ db: database.db, mode: "live", force: true, fetchImpl, rpcUrls: ["https://rpc.invalid"], programId: PROGRAM_ID, cluster: "devnet" });
    assert.equal(result.events, 1);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM chain_events").get()!.count, 1);
    const game = database.sqlite.prepare("SELECT address,numeric_id,state,last_slot FROM games").get()!;
    assert.deepEqual({ ...game }, { address: fixture.round, numeric_id: "71", state: "open", last_slot: 321 });
    const checkpoint = database.sqlite.prepare("SELECT last_signature,last_slot,status FROM indexer_checkpoints WHERE consumer='fate-program:devnet'").get()!;
    assert.deepEqual({ ...checkpoint }, { last_signature: "5FinalizedSignature", last_slot: 321, status: "healthy" });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("older backfill projections cannot overwrite newer finalized state", () => {
  const newer = projectFateEvent({ name: "GameSettled", payload: { game: "game", gameType: "coinflip", winner: "winner", wager: "200", payout: "194", fee: "6", randomness: "ab".repeat(32) } }, { signature: "new", slot: 20, blockTime: 200, signer: null });
  const older = projectFateEvent({ name: "CoinflipCreated", payload: { game: "game", creator: "creator", amount: "100", side: "heads" } }, { signature: "old", slot: 10, blockTime: 100, signer: "creator", coinflipId: "9", coinflipExpiresAt: 150 });
  assert.match(newer[0].sql, /WHERE games\.last_slot<=excluded\.last_slot/);
  assert.match(older[0].sql, /WHERE games\.last_slot<=excluded\.last_slot/);
});
