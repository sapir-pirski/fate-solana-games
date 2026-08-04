import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  assertCompatibleSchema,
  BACKUP_TABLES,
  buildAtomicRestorePlan,
  buildRestoreCleanupPlan,
  buildRestoreStageLoadPlan,
  buildRestoreStagePlan,
  createDatabaseBackup,
  validateDatabaseBackup,
  type BackupColumns,
  type BackupTables,
} from "../../lib/database-backup";

function fixture() {
  const columns = {} as BackupColumns;
  const tables = {} as BackupTables;
  for (const table of BACKUP_TABLES) {
    columns[table] = table === "event_logs" ? ["id", "event_type", "category", "status", "metadata_json", "schema_version"] : ["id"];
    tables[table] = table === "event_logs"
      ? [{ id: "original-log", event_type: "test", category: "test", status: "info", metadata_json: "{}", schema_version: 1 }]
      : [{ id: `${table}-row` }];
  }
  return { columns, tables };
}

test("backup manifest covers every current application table", () => {
  for (const table of ["chain_events", "games", "game_entries", "indexer_checkpoints", "wallet_auth_challenges", "rate_limit_buckets", "agent_runs", "agent_alerts", "privacy_request_artifacts"]) {
    assert.ok(BACKUP_TABLES.includes(table as never), `${table} must be backed up`);
  }
});

test("backup checksum detects modified rows", async () => {
  const backup = await createDatabaseBackup({ ...fixture(), createdAt: "2026-08-04T00:00:00.000Z", appliedMigrations: ["0011_gray_madrox.sql"] });
  assert.equal((await validateDatabaseBackup(backup)).checksum.value, backup.checksum.value);
  backup.tables.games[0].id = "tampered";
  await assert.rejects(() => validateDatabaseBackup(backup), /checksum does not match/i);
});

test("restore rejects a live schema mismatch before producing writes", async () => {
  const data = fixture();
  const backup = await createDatabaseBackup(data);
  const incompatible = structuredClone(data.columns);
  incompatible.games = ["id", "unexpected"];
  assert.throws(() => assertCompatibleSchema(backup, incompatible), /live schema for games/i);
});

test("restore plan replaces all table data and records an audit event", async () => {
  const data = fixture();
  const backup = await createDatabaseBackup(data);
  const database = new DatabaseSync(":memory:");
  try {
    for (const table of BACKUP_TABLES) {
      database.exec(`CREATE TABLE "${table}" (${data.columns[table].map(column => `"${column}" ${column === "schema_version" ? "INTEGER" : "TEXT"}`).join(",")})`);
      if (table === "games") database.prepare("INSERT INTO games (id) VALUES (?)").run("stale-row");
    }
    const restoreId = "test_restore";
    for (const statement of buildRestoreStagePlan(backup, restoreId)) database.prepare(statement.sql).run(...statement.params);
    for (const statement of buildRestoreStageLoadPlan(backup, restoreId)) database.prepare(statement.sql).run(...statement.params);
    database.exec("BEGIN");
    for (const statement of buildAtomicRestorePlan(backup, restoreId)) database.prepare(statement.sql).run(...statement.params);
    database.exec("COMMIT");
    for (const statement of buildRestoreCleanupPlan(restoreId)) database.prepare(statement.sql).run(...statement.params);
    assert.deepEqual(database.prepare("SELECT id FROM games ORDER BY id").all().map(row => ({ ...row })), [{ id: "games-row" }]);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM event_logs").get()?.count, 2);
    assert.equal(database.prepare("SELECT event_type FROM event_logs WHERE event_type='database_restore'").get()?.event_type, "database_restore");
    assert.equal(database.prepare("PRAGMA integrity_check").get()?.integrity_check, "ok");
  } finally {
    database.close();
  }
});
