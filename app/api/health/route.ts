import { checkDatabaseHealth } from "../../../db";

export async function GET() {
  let database: Awaited<ReturnType<typeof checkDatabaseHealth>> | { backend: "unknown"; status: "error" };
  try {
    database = await checkDatabaseHealth();
  } catch {
    database = { backend: "unknown", status: "error" };
  }
  return Response.json({
    status: "ok",
    service: "fate-platform",
    network: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    revision: process.env.APP_REVISION ?? "local",
    database,
    timestamp: new Date().toISOString(),
  }, {
    status: database.status === "error" ? 503 : 200,
    headers: { "cache-control": "no-store" },
  });
}
