import { withDatabase } from "../../../../db";
import { authenticatedWallet, requireSameOrigin } from "@/server/services/auth";
import { COMPLIANCE_POLICY, complianceDecision, recordAttestation } from "@/server/services/compliance";

export async function GET(request: Request) { return withDatabase(async () => { const session = await authenticatedWallet(request); if (!session) return Response.json({ code: "UNAUTHENTICATED", policy: COMPLIANCE_POLICY }, { status: 401 }); return Response.json({ decision: await complianceDecision(session.walletAddress), policy: COMPLIANCE_POLICY }, { headers: { "cache-control": "no-store" } }); }); }

export async function POST(request: Request) { return withDatabase(async () => {
  if (!requireSameOrigin(request)) return Response.json({ code: "INVALID_ORIGIN" }, { status: 403 });
  const session = await authenticatedWallet(request); if (!session) return Response.json({ code: "UNAUTHENTICATED" }, { status: 401 });
  const body = await request.json() as Record<string, unknown>;
  if (body.ageConfirmed !== true || body.termsAccepted !== true || body.privacyAccepted !== true || body.riskAccepted !== true) return Response.json({ code: "CONSENT_REQUIRED" }, { status: 400 });
  try { const decision = await recordAttestation(session.walletAddress, String(body.countryCode ?? ""), request.headers.get("cf-ipcountry")); return Response.json({ decision, policy: COMPLIANCE_POLICY }, { status: decision.allowed ? 201 : 403 }); }
  catch { return Response.json({ code: "INVALID_COUNTRY" }, { status: 400 }); }
}); }
