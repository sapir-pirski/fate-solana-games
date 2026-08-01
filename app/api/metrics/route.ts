import { getDatabaseBackend } from "../../../db";

export async function GET() {
  const revision = process.env.APP_REVISION ?? "local";
  const network = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const backend = getDatabaseBackend();
  const body = [
    "# HELP fate_up Whether the FATE web process is serving requests.",
    "# TYPE fate_up gauge",
    `fate_up{revision="${revision}",network="${network}",database="${backend}"} 1`,
    "# HELP fate_build_info Static build information for this release.",
    "# TYPE fate_build_info gauge",
    `fate_build_info{revision="${revision}"} 1`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "content-type": "text/plain; version=0.0.4; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
