export async function GET() {
  return Response.json({
    status: "ok",
    service: "fate-platform",
    network: process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet",
    revision: process.env.APP_REVISION ?? "local",
    timestamp: new Date().toISOString(),
  }, { headers: { "cache-control": "no-store" } });
}

