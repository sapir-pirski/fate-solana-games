import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readSpendingSnapshot, reserveWagerOperation, type WagerReservation } from "../../server/services/wager-reservations.ts";

const NOW = 2_000_000;
const WALLET = "wallet-under-limit";

function migratedDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "fate-reservations-"));
  const sqlite = new DatabaseSync(join(directory, "reservations.sqlite"));
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
  }
  return {
    directory,
    sqlite,
    db: { prepare(sql: string) { return new Statement(sql); } } as unknown as D1Database,
  };
}

function operation(overrides: Partial<WagerReservation> = {}): WagerReservation {
  return {
    id: crypto.randomUUID(),
    operationId: crypto.randomUUID(),
    walletAddress: WALLET,
    gameType: "jackpot",
    action: "enter",
    amountLamports: 50,
    gameAddress: "game",
    programId: "program",
    messageHash: crypto.randomUUID().replaceAll("-", "").padEnd(64, "0"),
    lastValidBlockHeight: 500,
    reservedAt: NOW,
    expiresAt: NOW + 600,
    ...overrides,
  };
}

test("spend windows use epoch time and count wager roles without counting refunds", async () => {
  const database = migratedDatabase();
  try {
    database.sqlite.prepare("INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("recent", "game", WALLET, "player", 40, "recent-signature", 0, 1, NOW - 60);
    database.sqlite.prepare("INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("older", "game", WALLET, "creator", 20, "older-signature", 0, 2, NOW - 2 * 86_400);
    database.sqlite.prepare("INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("refund", "game", WALLET, "refund", 500, "refund-signature", 0, 3, NOW - 30);
    assert.deepEqual(await readSpendingSnapshot(database.db, WALLET, NOW), {
      dailySpent: 40,
      weeklySpent: 60,
      dailyFinalized: 40,
      weeklyFinalized: 60,
      dailyReserved: 0,
      weeklyReserved: 0,
    });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("atomic reservations prevent concurrent operations from exceeding a limit", async () => {
  const database = migratedDatabase();
  try {
    database.sqlite.prepare("INSERT INTO responsible_play_limits (wallet_address,daily_lamports,weekly_lamports) VALUES (?,?,?)").run(WALLET, 100, 150);
    database.sqlite.prepare("INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("existing", "game", WALLET, "player", 40, "existing-signature", 0, 1, NOW - 60);
    const first = operation({ amountLamports: 50 });
    const second = operation({ amountLamports: 20 });
    assert.deepEqual(await reserveWagerOperation(database.db, first), { reserved: true });
    assert.deepEqual(await reserveWagerOperation(database.db, second), { reserved: false });
    assert.equal(database.sqlite.prepare("SELECT COUNT(*) count FROM transaction_operations").get()!.count, 1);
    database.sqlite.prepare("UPDATE transaction_operations SET status='failed' WHERE operation_id=?").run(first.operationId);
    assert.deepEqual(await reserveWagerOperation(database.db, second), { reserved: true });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});

test("an indexed wager replaces its transaction reservation without double counting", async () => {
  const database = migratedDatabase();
  try {
    const reserved = operation({ amountLamports: 70 });
    assert.deepEqual(await reserveWagerOperation(database.db, reserved), { reserved: true });
    database.sqlite.prepare("UPDATE transaction_operations SET status='submitted',signature=? WHERE operation_id=?").run("same-signature", reserved.operationId);
    let spending = await readSpendingSnapshot(database.db, WALLET, NOW);
    assert.deepEqual({ finalized: spending.dailyFinalized, reserved: spending.dailyReserved, total: spending.dailySpent }, { finalized: 0, reserved: 70, total: 70 });
    database.sqlite.prepare("INSERT INTO game_entries (id,game_address,wallet_address,role,amount_lamports,signature,event_index,slot,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run("indexed", "game", WALLET, "player", 70, "same-signature", 0, 2, NOW + 10);
    spending = await readSpendingSnapshot(database.db, WALLET, NOW + 10);
    assert.deepEqual({ finalized: spending.dailyFinalized, reserved: spending.dailyReserved, total: spending.dailySpent }, { finalized: 70, reserved: 0, total: 70 });
  } finally {
    database.sqlite.close();
    rmSync(database.directory, { recursive: true, force: true });
  }
});
