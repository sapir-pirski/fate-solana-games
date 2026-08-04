import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { processTransactionConfirmationJobs } from "../../server/services/transaction-confirmation.ts";
import { Keypair } from "@solana/web3.js";
import { enterJackpotTransaction } from "../../lib/solana/fate-client.ts";
import { decodeTransactionIntent } from "../../lib/solana/transaction-intent.ts";

const OPERATION_ID = "55f73606-3064-4d03-b1cd-3ecfd9b3c047";
const SIGNATURE = "3".repeat(88);

async function finalizedFixture() {
  const wallet = Keypair.generate();
  const program = Keypair.generate().publicKey;
  const transaction = enterJackpotTransaction({ programId: program.toBase58(), player: wallet.publicKey.toBase58(), roundId: 9n, amountLamports: 500_000_000n });
  transaction.feePayer = wallet.publicKey;
  transaction.recentBlockhash = Keypair.generate().publicKey.toBase58();
  transaction.sign(wallet);
  const encoded = Buffer.from(transaction.serialize()).toString("base64");
  const intent = await decodeTransactionIntent({ serializedTransactionBase64: encoded, walletAddress: wallet.publicKey.toBase58(), programId: program.toBase58(), requireUnsigned: false });
  return { walletAddress: wallet.publicKey.toBase58(), encoded, intent };
}

const FIXTURE = await finalizedFixture();

function migratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fate-confirmation-"));
  const sqlite = new DatabaseSync(join(directory, "confirmation.sqlite"));
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

function seed(sqlite: DatabaseSync, options: { jobStatus?: string; leaseExpiresAt?: number; attempts?: number; maxAttempts?: number; messageHash?: string } = {}) {
  sqlite.prepare("INSERT INTO transaction_operations (id,operation_id,wallet_address,game_type,action,status,amount_lamports,game_address,program_id,message_hash,signature,last_valid_block_height,expires_at) VALUES (?,?,?,?,?,'submitted',?,?,?,?,?,?,?)")
    .run("operation-row", OPERATION_ID, FIXTURE.walletAddress, FIXTURE.intent.gameType, FIXTURE.intent.action, Number(FIXTURE.intent.amountLamports), FIXTURE.intent.gameAddress, FIXTURE.intent.programId, options.messageHash ?? FIXTURE.intent.messageHash, SIGNATURE, 500, 2_000);
  sqlite.prepare("INSERT INTO background_jobs (id,queue,dedupe_key,payload_json,status,attempts,max_attempts,available_at,lease_owner,lease_expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run("job-row", "transaction-confirmation", OPERATION_ID, JSON.stringify({ operationId: OPERATION_ID, signature: SIGNATURE, walletAddress: FIXTURE.walletAddress }), options.jobStatus ?? "pending", options.attempts ?? 0, options.maxAttempts ?? 8, 900, options.jobStatus === "running" ? "abandoned-worker" : null, options.leaseExpiresAt ?? null);
}

test("finalized signatures complete jobs and operations", async () => {
  const database = migratedDatabase();
  try {
    seed(database.sqlite);
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = request.method === "getSignatureStatuses"
        ? { value: [{ err: null, confirmationStatus: "finalized" }] }
        : request.method === "getTransaction"
          ? { transaction: [FIXTURE.encoded, "base64"], meta: { err: null } }
          : null;
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    };
    const summary = await processTransactionConfirmationJobs({ db: database.db, limit: 1, now: () => 1_000, fetchImpl, rpcUrls: ["https://rpc.invalid"], workerId: "worker-finalized" });
    assert.deepEqual(summary, { claimed: 1, completed: 1, rescheduled: 0, dead: 0, finalized: 1, confirmed: 0, failed: 0, expired: 0 });
    assert.equal(database.sqlite.prepare("SELECT status FROM transaction_operations").get()!.status, "finalized");
    assert.deepEqual({ ...database.sqlite.prepare("SELECT status,attempts,lease_owner,last_error FROM background_jobs").get()! }, { status: "complete", attempts: 1, lease_owner: null, last_error: null });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("a finalized signature with a different message is failed instead of trusted", async () => {
  const database = migratedDatabase();
  try {
    seed(database.sqlite, { messageHash: "0".repeat(64) });
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = request.method === "getSignatureStatuses"
        ? { value: [{ err: null, confirmationStatus: "finalized" }] }
        : { transaction: [FIXTURE.encoded, "base64"], meta: { err: null } };
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    };
    const summary = await processTransactionConfirmationJobs({ db: database.db, limit: 1, now: () => 1_000, fetchImpl, rpcUrls: ["https://rpc.invalid"], workerId: "worker-mismatch" });
    assert.equal(summary.failed, 1);
    assert.deepEqual({ ...database.sqlite.prepare("SELECT status,error_code FROM transaction_operations").get()! }, { status: "failed", error_code: "TRANSACTION_INTENT_MISMATCH" });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("missing signatures are durably rescheduled with an incremented attempt", async () => {
  const database = migratedDatabase();
  try {
    seed(database.sqlite);
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = request.method === "getSignatureStatuses" ? { value: [null] } : 400;
      return Response.json({ jsonrpc: "2.0", id: request.id, result });
    };
    const summary = await processTransactionConfirmationJobs({ db: database.db, limit: 1, now: () => 1_000, random: () => 0, fetchImpl, rpcUrls: ["https://rpc.invalid"], workerId: "worker-retry" });
    assert.equal(summary.rescheduled, 1);
    assert.deepEqual({ ...database.sqlite.prepare("SELECT status,attempts,available_at,lease_owner,last_error FROM background_jobs").get()! }, { status: "pending", attempts: 1, available_at: 1002, lease_owner: null, last_error: "SIGNATURE_NOT_FINALIZED" });
    assert.equal(database.sqlite.prepare("SELECT status FROM transaction_operations").get()!.status, "submitted");
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("expired leases are reclaimed safely", async () => {
  const database = migratedDatabase();
  try {
    seed(database.sqlite, { jobStatus: "running", leaseExpiresAt: 999 });
    const fetchImpl: typeof fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] } });
    };
    const summary = await processTransactionConfirmationJobs({ db: database.db, limit: 1, now: () => 1_000, fetchImpl, rpcUrls: ["https://rpc.invalid"], workerId: "worker-recovery" });
    assert.equal(summary.failed, 1);
    assert.equal(database.sqlite.prepare("SELECT status,error_code FROM transaction_operations").get()!.status, "failed");
    assert.equal(database.sqlite.prepare("SELECT status FROM background_jobs").get()!.status, "complete");
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("a crashed final attempt becomes a visible dead letter", async () => {
  const database = migratedDatabase();
  try {
    seed(database.sqlite, { jobStatus: "running", leaseExpiresAt: 999, attempts: 8, maxAttempts: 8 });
    const summary = await processTransactionConfirmationJobs({ db: database.db, limit: 1, now: () => 1_000, rpcUrls: ["https://rpc.invalid"], workerId: "worker-dead" });
    assert.equal(summary.dead, 1);
    assert.equal(summary.claimed, 0);
    assert.deepEqual({ ...database.sqlite.prepare("SELECT status,lease_owner,last_error FROM background_jobs").get()! }, { status: "dead", lease_owner: null, last_error: "MAX_ATTEMPTS_EXCEEDED" });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});
