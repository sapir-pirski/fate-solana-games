import { env } from "cloudflare:workers";
import { ensureAuthSchema, getDatabaseBackend } from "../../../db";
import { renderMetrics } from "../../../lib/telemetry";

const label = (value: unknown) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");

export async function GET() {
  const revision = process.env.APP_REVISION ?? "local";
  const network = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const dynamic: string[] = [];
  try {
    await ensureAuthSchema();
    const [operations, jobs, sessions, cache] = await Promise.all([
      env.DB.prepare("SELECT status,COUNT(*) count FROM transaction_operations GROUP BY status").all<{ status: string; count: number }>(),
      env.DB.prepare("SELECT queue,status,COUNT(*) count,MAX(0,CAST(strftime('%s','now') AS INTEGER)-MIN(available_at)) oldest FROM background_jobs GROUP BY queue,status").all<{ queue: string; status: string; count: number; oldest: number }>(),
      env.DB.prepare("SELECT COUNT(*) sessions FROM wallet_sessions WHERE revoked_at IS NULL AND expires_at>CAST(strftime('%s','now') AS INTEGER)").first<{ sessions: number }>(),
      env.DB.prepare("SELECT COUNT(*) cache_total,SUM(CASE WHEN expires_at>CAST(strftime('%s','now') AS INTEGER) THEN 1 ELSE 0 END) cache_live FROM response_cache").first<{ cache_total: number; cache_live: number | null }>(),
    ]);
    for (const row of operations.results) dynamic.push(`fate_transaction_operations{status="${label(row.status)}"} ${row.count}`);
    for (const row of jobs.results) {
      dynamic.push(`fate_queue_jobs{queue="${label(row.queue)}",status="${label(row.status)}"} ${row.count}`);
      dynamic.push(`fate_queue_oldest_age_seconds{queue="${label(row.queue)}",status="${label(row.status)}"} ${Math.max(0, row.oldest)}`);
    }
    dynamic.push(`fate_active_sessions ${sessions?.sessions ?? 0}`);
    dynamic.push(`fate_cache_entries{state="live"} ${cache?.cache_live ?? 0}`, `fate_cache_entries{state="total"} ${cache?.cache_total ?? 0}`);
    dynamic.push("fate_database_metrics_available 1");
  } catch {
    dynamic.push("fate_database_metrics_available 0");
  }

  return new Response([
    "# HELP fate_up Whether the FATE web process is serving requests.",
    "# TYPE fate_up gauge",
    `fate_up{revision="${label(revision)}",network="${label(network)}",database="${getDatabaseBackend()}"} 1`,
    "# HELP fate_build_info Static build information for this release.",
    "# TYPE fate_build_info gauge",
    `fate_build_info{revision="${label(revision)}"} 1`,
    "# HELP fate_transaction_operations Current durable transaction operations by state.",
    "# TYPE fate_transaction_operations gauge",
    ...dynamic,
    renderMetrics(),
    "",
  ].join("\n"), { headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" } });
}
