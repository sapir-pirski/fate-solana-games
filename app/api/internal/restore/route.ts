import { env } from "cloudflare:workers";
import { authorizeAutomation, runtimeEnv, unauthorized } from "@/server/services/internal-api";
import { assertCompatibleSchema, BACKUP_TABLES, BackupValidationError, buildAtomicRestorePlan, buildRestoreCleanupPlan, buildRestoreStageLoadPlan, buildRestoreStagePlan, chunkRestoreStatements, newRestoreId, validateDatabaseBackup, type BackupColumns, type RestoreStatement } from "@/lib/database-backup";
import { ensureApplicationSchema } from "@/db";

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_ROWS = 10_000;

function validationError(error: unknown) {
  if (error instanceof BackupValidationError) return Response.json({ code: error.code, message: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
  if (error instanceof SyntaxError) return Response.json({ code: "BACKUP_JSON_INVALID", message: "The backup is not valid JSON." }, { status: 400, headers: { "cache-control": "no-store" } });
  throw error;
}

const prepared = (statements: RestoreStatement[]) => statements.map(statement => env.DB.prepare(statement.sql).bind(...statement.params));

export async function POST(request: Request) {
  if (!authorizeAutomation(request)) return unauthorized();
  if (!env.DB) return Response.json({ code: "DATABASE_UNAVAILABLE" }, { status: 503 });

  const maxBytes = Math.max(1_024, Number(runtimeEnv("RESTORE_MAX_BYTES") ?? DEFAULT_MAX_BYTES));
  const declaredBytes = Number(request.headers.get("content-length") ?? 0);
  if (declaredBytes > maxBytes) return Response.json({ code: "BACKUP_TOO_LARGE", maxBytes }, { status: 413 });

  let backup;
  try {
    await ensureApplicationSchema();
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) return Response.json({ code: "BACKUP_TOO_LARGE", maxBytes }, { status: 413 });
    backup = await validateDatabaseBackup(JSON.parse(raw));

    const liveColumns = {} as BackupColumns;
    for (const table of BACKUP_TABLES) {
      const result = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>();
      liveColumns[table] = result.results.map(column => column.name);
    }
    assertCompatibleSchema(backup, liveColumns);
  } catch (error) {
    return validationError(error);
  }

  const totalRows = BACKUP_TABLES.reduce((sum, table) => sum + backup.tables[table].length, 0);
  const maxRows = Math.max(1, Number(runtimeEnv("RESTORE_MAX_ROWS") ?? DEFAULT_MAX_ROWS));
  if (totalRows > maxRows) return Response.json({ code: "BACKUP_ROW_LIMIT_EXCEEDED", totalRows, maxRows }, { status: 413 });

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true";
  const summary = { checksum: backup.checksum.value, createdAt: backup.createdAt, totalRows, rowCounts: backup.manifest.rowCounts };
  if (dryRun) return Response.json({ valid: true, dryRun: true, ...summary }, { headers: { "cache-control": "no-store" } });

  if (new URL(request.url).searchParams.get("mode") !== "replace") {
    return Response.json({ code: "RESTORE_MODE_REQUIRED", message: "Set mode=replace after a successful dry run." }, { status: 409, headers: { "cache-control": "no-store" } });
  }
  if (request.headers.get("x-fate-restore-confirm") !== backup.checksum.value) {
    return Response.json({ code: "RESTORE_CONFIRMATION_REQUIRED", message: "Set x-fate-restore-confirm to the verified backup checksum." }, { status: 409, headers: { "cache-control": "no-store" } });
  }

  const restoreId = newRestoreId();
  const stagePlan = buildRestoreStagePlan(backup, restoreId);
  const loadPlan = buildRestoreStageLoadPlan(backup, restoreId);
  const cleanupPlan = buildRestoreCleanupPlan(restoreId);
  let committed = false;
  try {
    for (const chunk of chunkRestoreStatements(stagePlan)) await env.DB.batch(prepared(chunk));
    for (const chunk of chunkRestoreStatements(loadPlan)) await env.DB.batch(prepared(chunk));
    for (const table of BACKUP_TABLES) {
      const stageName = `_fate_restore_${restoreId}_${table}`;
      const count = await env.DB.prepare(`SELECT COUNT(*) count FROM "${stageName}"`).first<{ count: number }>();
      if (count?.count !== backup.manifest.rowCounts[table]) throw new BackupValidationError("RESTORE_STAGE_COUNT_MISMATCH", `Staged row count for ${table} is invalid.`);
    }
    const atomicPlan = buildAtomicRestorePlan(backup, restoreId);
    await env.DB.batch(prepared(atomicPlan));
    committed = true;
  } finally {
    try {
      for (const chunk of chunkRestoreStatements(cleanupPlan)) await env.DB.batch(prepared(chunk));
    } catch (cleanupError) {
      if (!committed) throw cleanupError;
    }
  }
  return Response.json({ restored: true, dryRun: false, stagedStatements: loadPlan.length, ...summary }, { headers: { "cache-control": "no-store" } });
}
