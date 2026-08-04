import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { processPrivacyRequestJobs } from "../../server/services/privacy-requests.ts";

const WALLET = "3".repeat(32);
const REQUEST_ID = "55f73606-3064-4d03-b1cd-3ecfd9b3c047";

function migratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fate-privacy-"));
  const sqlite = new DatabaseSync(join(directory, "privacy.sqlite"));
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

function seedRequest(sqlite: DatabaseSync, status: string, type = "export") {
  sqlite.prepare("INSERT INTO privacy_requests (id,wallet_address,request_type,status,due_at,request_details_json) VALUES (?,?,?,?,?,?)")
    .run(REQUEST_ID, WALLET, type, status, 2_000, type === "rectification" ? JSON.stringify({ countryCode: "IL" }) : "{}");
  sqlite.prepare("INSERT INTO background_jobs (id,queue,dedupe_key,payload_json,status,attempts,max_attempts,available_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("job-row", "privacy-request", REQUEST_ID, JSON.stringify({ requestId: REQUEST_ID }), "pending", 0, 8, 900);
}

test("new privacy requests durably enter human review", async () => {
  const database = migratedDatabase();
  try {
    seedRequest(database.sqlite, "received", "access");
    const summary = await processPrivacyRequestJobs({ db: database.db, limit: 1, now: () => 1_000, workerId: "privacy-review" });
    assert.equal(summary.reviewQueued, 1);
    assert.equal(database.sqlite.prepare("SELECT status FROM privacy_requests WHERE id=?").get(REQUEST_ID)!.status, "in_review");
    assert.equal(database.sqlite.prepare("SELECT status FROM background_jobs WHERE id='job-row'").get()!.status, "complete");
    assert.equal(database.sqlite.prepare("SELECT decision FROM compliance_audit_events WHERE event_type='privacy_request_review'").get()!.decision, "queued");
  } finally { database.sqlite.close(); rmSync(database.directory, { recursive: true, force: true }); }
});

test("approved exports are complete, checksummed, expiring, and omit authentication secrets", async () => {
  const database = migratedDatabase();
  try {
    seedRequest(database.sqlite, "approved");
    database.sqlite.prepare("INSERT INTO wallet_sessions (id,token_hash,wallet_address,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run("session", "never-export-this-token-hash", WALLET, 9_999, 900);
    database.sqlite.prepare("INSERT INTO compliance_profiles (wallet_address,country_code,status,jurisdiction_status,sanctions_status) VALUES (?,?,?,?,?)").run(WALLET, "IL", "approved_devnet", "allowed_devnet", "not_required_devnet");
    const summary = await processPrivacyRequestJobs({ db: database.db, limit: 1, now: () => 1_000, workerId: "privacy-export" });
    assert.equal(summary.fulfilled, 1);
    const artifact = database.sqlite.prepare("SELECT payload_json,checksum_sha256,expires_at FROM privacy_request_artifacts WHERE request_id=?").get(REQUEST_ID)!;
    assert.equal(String(artifact.checksum_sha256).length, 64);
    assert.equal(artifact.expires_at, 605_800);
    assert.match(String(artifact.payload_json), new RegExp(WALLET));
    assert.doesNotMatch(String(artifact.payload_json), /never-export-this-token-hash/);
    assert.equal(JSON.parse(String(artifact.payload_json)).format, "fate-privacy-export-v1");
    assert.equal(database.sqlite.prepare("SELECT status FROM privacy_requests WHERE id=?").get(REQUEST_ID)!.status, "fulfilled");
  } finally { database.sqlite.close(); rmSync(database.directory, { recursive: true, force: true }); }
});

test("erasure removes eligible off-chain data and truthfully retains immutable chain records", async () => {
  const database = migratedDatabase();
  try {
    seedRequest(database.sqlite, "approved", "erasure");
    database.sqlite.prepare("INSERT INTO wallet_sessions (id,token_hash,wallet_address,expires_at,last_seen_at) VALUES (?,?,?,?,?)").run("session", "secret", WALLET, 9_999, 900);
    database.sqlite.prepare("INSERT INTO ai_conversations (id,wallet_address,owner_key) VALUES (?,?,?)").run("conversation", WALLET, `wallet:${WALLET}`);
    database.sqlite.prepare("INSERT INTO ai_messages (id,conversation_id,role,content) VALUES (?,?,?,?)").run("message", "conversation", "user", "private text");
    database.sqlite.prepare("INSERT INTO event_logs (id,event_type,category,status,session_id,wallet_address) VALUES (?,?,?,?,?,?)").run("log", "privacy_test", "system", "info", "session", WALLET);
    database.sqlite.prepare("INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)").run("entry", "game", WALLET, "player", 1, "signature", 0, 1, 1);
    database.sqlite.prepare("INSERT INTO transaction_operations (id,operation_id,wallet_address,game_type,action,status,expires_at) VALUES (?,?,?,?,?,?,?)").run("operation", "operation-id", WALLET, "jackpot", "enter_jackpot", "finalized", 1_000);
    const summary = await processPrivacyRequestJobs({ db: database.db, limit: 1, now: () => 1_000, workerId: "privacy-erasure" });
    assert.equal(summary.partiallyFulfilled, 1);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM wallet_sessions WHERE wallet_address=?").get(WALLET)!.count, 0);
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM ai_conversations WHERE owner_key=?").get(`wallet:${WALLET}`)!.count, 0);
    assert.equal(database.sqlite.prepare("SELECT wallet_address,session_id FROM event_logs WHERE id='log'").get()!.wallet_address, null);
    assert.equal(database.sqlite.prepare("SELECT wallet_address FROM game_entries WHERE id='entry'").get()!.wallet_address, WALLET);
    assert.match(String(database.sqlite.prepare("SELECT wallet_address FROM transaction_operations WHERE id='operation'").get()!.wallet_address), /^erased:/);
    const request = database.sqlite.prepare("SELECT status,wallet_address,result_summary_json FROM privacy_requests WHERE id=?").get(REQUEST_ID)!;
    assert.equal(request.status, "partially_fulfilled");
    assert.match(String(request.wallet_address), /^erased:/);
    assert.deepEqual(JSON.parse(String(request.result_summary_json)).retained[0], "public Solana/indexer records");
  } finally { database.sqlite.close(); rmSync(database.directory, { recursive: true, force: true }); }
});

test("erasure waits for active transaction recovery instead of deleting it", async () => {
  const database = migratedDatabase();
  try {
    seedRequest(database.sqlite, "approved", "erasure");
    database.sqlite.prepare("INSERT INTO transaction_operations (id,operation_id,wallet_address,game_type,action,status,expires_at) VALUES (?,?,?,?,?,?,?)").run("operation", "operation-id", WALLET, "jackpot", "enter_jackpot", "submitted", 2_000);
    const summary = await processPrivacyRequestJobs({ db: database.db, limit: 1, now: () => 1_000, random: () => 0, workerId: "privacy-wait" });
    assert.equal(summary.rescheduled, 1);
    assert.equal(database.sqlite.prepare("SELECT status FROM privacy_requests WHERE id=?").get(REQUEST_ID)!.status, "processing");
    assert.deepEqual({ ...database.sqlite.prepare("SELECT status,attempts,last_error FROM background_jobs WHERE id='job-row'").get()! }, { status: "pending", attempts: 1, last_error: "ACTIVE_TRANSACTIONS_PENDING" });
  } finally { database.sqlite.close(); rmSync(database.directory, { recursive: true, force: true }); }
});
