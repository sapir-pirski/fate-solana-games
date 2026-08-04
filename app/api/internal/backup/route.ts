import { env } from "cloudflare:workers";
import { authorizeAutomation, unauthorized } from "@/server/services/internal-api";
import { BACKUP_TABLES, BackupValidationError, createDatabaseBackup, type BackupColumns, type BackupRow, type BackupTables } from "@/lib/database-backup";
import { ensureApplicationSchema } from "@/db";

export async function GET(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });

  try {
    await ensureApplicationSchema();
    const tables = {} as BackupTables;
    const columns = {} as BackupColumns;
    for (const table of BACKUP_TABLES) {
      const columnResult = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
      if (!columnResult.results.length) throw new BackupValidationError("BACKUP_SCHEMA_INCOMPLETE", `Required table ${table} is missing.`);
      columns[table] = columnResult.results.map(column => column.name);
      const result = await env.DB.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all<BackupRow>();
      tables[table] = result.results;
    }
    let appliedMigrations: string[] = [];
    try {
      const migrations = await env.DB.prepare("SELECT name FROM d1_migrations ORDER BY id").all<{ name: string }>();
      appliedMigrations = migrations.results.map(migration => migration.name);
    } catch (error) {
      if (!(error instanceof Error) || !/no such table/i.test(error.message)) throw error;
    }
    const backup = await createDatabaseBackup({ tables, columns, appliedMigrations });
    return Response.json(backup, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="fate-backup-${backup.createdAt.replaceAll(":", "-")}.json"`,
        "x-fate-backup-checksum": backup.checksum.value,
      },
    });
  } catch (error) {
    if (error instanceof BackupValidationError) return Response.json({ code: error.code, message: error.message }, { status: 409, headers: { "cache-control": "no-store" } });
    throw error;
  }
}
