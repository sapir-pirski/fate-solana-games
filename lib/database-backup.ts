export const BACKUP_FORMAT = "fate-d1-json-v2" as const;
export const BACKUP_SCHEMA_VERSION = 2 as const;

/**
 * All tables in the current application schema. System tables and abandoned
 * migration-era tables are intentionally not restored into a clean database.
 */
export const BACKUP_TABLES = [
  "event_logs",
  "chain_events",
  "games",
  "game_entries",
  "wallet_auth_challenges",
  "wallet_sessions",
  "transaction_operations",
  "rate_limit_buckets",
  "background_jobs",
  "indexer_checkpoints",
  "ai_conversations",
  "ai_messages",
  "ai_tool_calls",
  "ai_usage",
  "ai_feedback",
  "agent_runs",
  "agent_alerts",
  "responsible_play_limits",
  "compliance_profiles",
  "compliance_audit_events",
  "privacy_requests",
] as const;

export type BackupTable = typeof BACKUP_TABLES[number];
export type BackupScalar = string | number | null;
export type BackupRow = Record<string, BackupScalar>;
export type BackupTables = Record<BackupTable, BackupRow[]>;
export type BackupColumns = Record<BackupTable, string[]>;

type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  createdAt: string;
  manifest: {
    tables: BackupTable[];
    columns: BackupColumns;
    rowCounts: Record<BackupTable, number>;
    appliedMigrations: string[];
    schemaFingerprint: string;
  };
  tables: BackupTables;
};

export type FateDatabaseBackup = BackupPayload & {
  checksum: { algorithm: "SHA-256"; value: string };
};

export type RestoreStatement = { sql: string; params: BackupScalar[] };

export class BackupValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isScalar = (value: unknown): value is BackupScalar => value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value) && Number.isSafeInteger(value));
const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

const expectedTables = () => [...BACKUP_TABLES];

function assertExactTableNames(value: unknown): asserts value is BackupTable[] {
  if (!Array.isArray(value) || value.length !== BACKUP_TABLES.length || value.some((table, index) => table !== BACKUP_TABLES[index])) {
    throw new BackupValidationError("BACKUP_TABLE_MANIFEST_INVALID", "The backup table manifest does not match this application version.");
  }
}

function assertColumns(value: unknown): asserts value is BackupColumns {
  if (!isRecord(value)) throw new BackupValidationError("BACKUP_COLUMNS_INVALID", "The backup does not contain a valid column manifest.");
  for (const table of BACKUP_TABLES) {
    const columns = value[table];
    if (!Array.isArray(columns) || columns.length === 0 || columns.some(column => typeof column !== "string" || !/^[a-z][a-z0-9_]*$/.test(column))) {
      throw new BackupValidationError("BACKUP_COLUMNS_INVALID", `The column manifest for ${table} is invalid.`);
    }
    if (new Set(columns).size !== columns.length) throw new BackupValidationError("BACKUP_COLUMNS_INVALID", `The column manifest for ${table} contains duplicates.`);
  }
}

function assertTables(value: unknown, columns: BackupColumns): asserts value is BackupTables {
  if (!isRecord(value)) throw new BackupValidationError("BACKUP_DATA_INVALID", "The backup table data is invalid.");
  for (const table of BACKUP_TABLES) {
    const rows = value[table];
    if (!Array.isArray(rows)) throw new BackupValidationError("BACKUP_DATA_INVALID", `Backup rows for ${table} are missing.`);
    const expected = columns[table];
    for (const row of rows) {
      if (!isRecord(row)) throw new BackupValidationError("BACKUP_ROW_INVALID", `A backup row in ${table} is invalid.`);
      const keys = Object.keys(row);
      if (keys.length !== expected.length || expected.some(column => !Object.hasOwn(row, column)) || keys.some(column => !expected.includes(column))) {
        throw new BackupValidationError("BACKUP_ROW_SHAPE_INVALID", `A backup row in ${table} does not match its column manifest.`);
      }
      if (Object.values(row).some(value => !isScalar(value))) throw new BackupValidationError("BACKUP_VALUE_INVALID", `A backup row in ${table} contains an unsupported value.`);
    }
  }
}

export async function schemaFingerprint(columns: BackupColumns) {
  return sha256(canonicalJson(columns));
}

export async function createDatabaseBackup(input: { createdAt?: string; columns: BackupColumns; tables: BackupTables; appliedMigrations?: string[] }): Promise<FateDatabaseBackup> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new BackupValidationError("BACKUP_TIMESTAMP_INVALID", "The backup timestamp is invalid.");
  const rowCounts = Object.fromEntries(BACKUP_TABLES.map(table => [table, input.tables[table].length])) as Record<BackupTable, number>;
  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt,
    manifest: {
      tables: expectedTables(),
      columns: input.columns,
      rowCounts,
      appliedMigrations: [...(input.appliedMigrations ?? [])],
      schemaFingerprint: await schemaFingerprint(input.columns),
    },
    tables: input.tables,
  };
  return { ...payload, checksum: { algorithm: "SHA-256", value: await sha256(canonicalJson(payload)) } };
}

export async function validateDatabaseBackup(value: unknown): Promise<FateDatabaseBackup> {
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new BackupValidationError("BACKUP_FORMAT_UNSUPPORTED", `Only ${BACKUP_FORMAT} backups can be restored.`);
  }
  if (typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) throw new BackupValidationError("BACKUP_TIMESTAMP_INVALID", "The backup timestamp is invalid.");
  if (!isRecord(value.manifest)) throw new BackupValidationError("BACKUP_MANIFEST_INVALID", "The backup manifest is missing.");
  assertExactTableNames(value.manifest.tables);
  assertColumns(value.manifest.columns);
  assertTables(value.tables, value.manifest.columns);
  if (!isRecord(value.manifest.rowCounts) || !Array.isArray(value.manifest.appliedMigrations) || value.manifest.appliedMigrations.some(item => typeof item !== "string")) {
    throw new BackupValidationError("BACKUP_MANIFEST_INVALID", "The backup manifest metadata is invalid.");
  }
  for (const table of BACKUP_TABLES) {
    if (value.manifest.rowCounts[table] !== value.tables[table].length) throw new BackupValidationError("BACKUP_ROW_COUNT_MISMATCH", `The row count for ${table} does not match the backup data.`);
  }
  const fingerprint = await schemaFingerprint(value.manifest.columns);
  if (value.manifest.schemaFingerprint !== fingerprint) throw new BackupValidationError("BACKUP_SCHEMA_CHECKSUM_MISMATCH", "The backup schema fingerprint is invalid.");
  if (!isRecord(value.checksum) || value.checksum.algorithm !== "SHA-256" || typeof value.checksum.value !== "string") {
    throw new BackupValidationError("BACKUP_CHECKSUM_MISSING", "The backup checksum is missing.");
  }
  const payload: BackupPayload = {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: value.createdAt,
    manifest: value.manifest as BackupPayload["manifest"],
    tables: value.tables,
  };
  const expectedChecksum = await sha256(canonicalJson(payload));
  if (value.checksum.value !== expectedChecksum) throw new BackupValidationError("BACKUP_CHECKSUM_MISMATCH", "The backup checksum does not match its contents.");
  return value as FateDatabaseBackup;
}

export function assertCompatibleSchema(backup: FateDatabaseBackup, liveColumns: BackupColumns) {
  for (const table of BACKUP_TABLES) {
    const expected = backup.manifest.columns[table];
    const actual = liveColumns[table];
    if (!actual || expected.length !== actual.length || expected.some((column, index) => column !== actual[index])) {
      throw new BackupValidationError("RESTORE_SCHEMA_MISMATCH", `The live schema for ${table} does not match the backup.`);
    }
  }
}

const restoreStageName = (restoreId: string, table: BackupTable) => `_fate_restore_${restoreId}_${table}`;

export function newRestoreId() {
  return `${Math.floor(Date.now() / 1_000).toString(36)}_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

export function buildRestoreStagePlan(backup: FateDatabaseBackup, restoreId: string): RestoreStatement[] {
  if (!/^[a-z0-9_]+$/.test(restoreId)) throw new BackupValidationError("RESTORE_ID_INVALID", "The restore identifier is invalid.");
  return BACKUP_TABLES.flatMap(table => {
    const stage = restoreStageName(restoreId, table);
    const columns = backup.manifest.columns[table].map(quoteIdentifier).join(",");
    return [
      { sql: `DROP TABLE IF EXISTS ${quoteIdentifier(stage)}`, params: [] },
      { sql: `CREATE TABLE ${quoteIdentifier(stage)} AS SELECT ${columns} FROM ${quoteIdentifier(table)} WHERE 0`, params: [] },
    ];
  });
}

function rowChunks(rows: BackupRow[], maximumBytes = 64 * 1024) {
  const chunks: BackupRow[][] = [];
  let chunk: BackupRow[] = [];
  let bytes = 2;
  for (const row of rows) {
    const rowBytes = new TextEncoder().encode(JSON.stringify(row)).byteLength + (chunk.length ? 1 : 0);
    if (chunk.length && bytes + rowBytes > maximumBytes) {
      chunks.push(chunk);
      chunk = [];
      bytes = 2;
    }
    chunk.push(row);
    bytes += rowBytes;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function buildRestoreStageLoadPlan(backup: FateDatabaseBackup, restoreId: string): RestoreStatement[] {
  const statements: RestoreStatement[] = [];
  for (const table of BACKUP_TABLES) {
    const columns = backup.manifest.columns[table];
    const selection = columns.map(column => `json_extract(value, '$.${column}')`).join(",");
    const sql = `INSERT INTO ${quoteIdentifier(restoreStageName(restoreId, table))} (${columns.map(quoteIdentifier).join(",")}) SELECT ${selection} FROM json_each(?)`;
    for (const rows of rowChunks(backup.tables[table])) statements.push({ sql, params: [JSON.stringify(rows)] });
  }
  return statements;
}

/** Production data changes in one small atomic batch after staging succeeds. */
export function buildAtomicRestorePlan(backup: FateDatabaseBackup, restoreId: string): RestoreStatement[] {
  const statements: RestoreStatement[] = [];
  for (const table of [...BACKUP_TABLES].reverse()) statements.push({ sql: `DELETE FROM ${quoteIdentifier(table)}`, params: [] });
  for (const table of BACKUP_TABLES) {
    const columns = backup.manifest.columns[table].map(quoteIdentifier).join(",");
    statements.push({ sql: `INSERT INTO ${quoteIdentifier(table)} (${columns}) SELECT ${columns} FROM ${quoteIdentifier(restoreStageName(restoreId, table))}`, params: [] });
  }
  statements.push({
    sql: "INSERT INTO event_logs (id,event_type,category,status,metadata_json,schema_version) VALUES (?,?,?,?,?,?)",
    params: [crypto.randomUUID(), "database_restore", "operations", "info", JSON.stringify({ checksum: backup.checksum.value, createdAt: backup.createdAt }), 1],
  });
  return statements;
}

export function buildRestoreCleanupPlan(restoreId: string): RestoreStatement[] {
  return [...BACKUP_TABLES].reverse().map(table => ({ sql: `DROP TABLE IF EXISTS ${quoteIdentifier(restoreStageName(restoreId, table))}`, params: [] }));
}

export function chunkRestoreStatements(statements: RestoreStatement[], size = 40) {
  const chunks: RestoreStatement[][] = [];
  for (let index = 0; index < statements.length; index += size) chunks.push(statements.slice(index, index + size));
  return chunks;
}
