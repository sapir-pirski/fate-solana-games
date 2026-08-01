import { getDatabaseBackend } from "../../../db";
import postgres from "postgres";
import { renderMetrics } from "../../../lib/telemetry";

export async function GET() {
  const revision = process.env.APP_REVISION ?? "local";
  const network = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const backend = getDatabaseBackend();
  const dynamic:string[]=[];const url=process.env.DATABASE_URL;
  if(url){const sql=postgres(url,{max:1,prepare:false,ssl:process.env.DATABASE_SSL==="disable"?false:"require",connect_timeout:2});try{const operations=await sql<{status:string;count:string}[]>`SELECT status,COUNT(*)::TEXT count FROM transaction_operations GROUP BY status`;for(const row of operations)dynamic.push(`fate_transaction_operations{status="${row.status}"} ${row.count}`);const jobs=await sql<{queue:string;status:string;count:string;oldest:string}[]>`SELECT queue,status,COUNT(*)::TEXT count,COALESCE(EXTRACT(EPOCH FROM NOW())::BIGINT-MIN(available_at),0)::TEXT oldest FROM background_jobs GROUP BY queue,status`;for(const row of jobs){dynamic.push(`fate_queue_jobs{queue="${row.queue}",status="${row.status}"} ${row.count}`);dynamic.push(`fate_queue_oldest_age_seconds{queue="${row.queue}",status="${row.status}"} ${Math.max(0,Number(row.oldest))}`);}const [{sessions}]=await sql<{sessions:string}[]>`SELECT COUNT(*)::TEXT sessions FROM wallet_sessions WHERE revoked_at IS NULL AND expires_at>EXTRACT(EPOCH FROM NOW())::BIGINT`;dynamic.push(`fate_active_sessions ${sessions}`);const [{cache_total,cache_live}]=await sql<{cache_total:string;cache_live:string}[]>`SELECT COUNT(*)::TEXT cache_total,COUNT(*) FILTER (WHERE expires_at>EXTRACT(EPOCH FROM NOW())::BIGINT)::TEXT cache_live FROM response_cache`;dynamic.push(`fate_cache_entries{state="live"} ${cache_live}`,`fate_cache_entries{state="total"} ${cache_total}`);}catch{dynamic.push("fate_database_metrics_available 0");}finally{await sql.end({timeout:1});}}
  const body = [
    "# HELP fate_up Whether the FATE web process is serving requests.",
    "# TYPE fate_up gauge",
    `fate_up{revision="${revision}",network="${network}",database="${backend}"} 1`,
    "# HELP fate_build_info Static build information for this release.",
    "# TYPE fate_build_info gauge",
    `fate_build_info{revision="${revision}"} 1`,
    "# HELP fate_transaction_operations Current durable transaction operations by state.",
    "# TYPE fate_transaction_operations gauge",
    ...dynamic,
    renderMetrics(),
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
