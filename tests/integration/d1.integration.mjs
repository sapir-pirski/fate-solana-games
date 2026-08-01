import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("D1 migrations build the complete single-database schema", () => {
  const directory = mkdtempSync(join(tmpdir(), "fate-d1-"));
  const database = new DatabaseSync(join(directory, "fate.sqlite"));
  try {
    for (const file of readdirSync(new URL("../../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
      const migration = readFileSync(new URL(`../../drizzle/${file}`, import.meta.url), "utf8");
      for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) database.exec(statement);
    }
    const tables = new Set(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map((row) => row.name));
    for (const table of ["event_logs", "games", "game_entries", "indexer_checkpoints", "wallet_sessions", "transaction_operations", "ai_conversations", "responsible_play_limits"]) {
      assert.ok(tables.has(table), `${table} must be managed by D1 migrations`);
    }
    assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
