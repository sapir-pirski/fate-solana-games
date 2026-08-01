import { safeModel } from "../../../../lib/ai/policy";

export async function GET() {
  const key = process.env.OPENAI_API_KEY;
  const configured = Boolean(key && !key.startsWith("replace-"));
  return Response.json({ enabled: configured, configured, model: configured ? safeModel(process.env.OPENAI_MODEL) : null, capabilities: configured ? ["rules", "fairness", "transaction_diagnostics", "wallet_activity", "unsigned_devnet_drafts"] : [] }, { headers: { "cache-control": "no-store" } });
}
