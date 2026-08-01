import { and, eq, gte } from "drizzle-orm";
import { ensureComplianceSchema, getDb } from "../db";
import { complianceAuditEvents, complianceProfiles, gameEntries, responsiblePlayLimits } from "../db/schema";
import { nowSeconds, sha256 } from "./auth";

export const COMPLIANCE_POLICY = { terms: "2026-08-01", privacy: "2026-08-01", risk: "2026-08-01", minimumAge: 18 } as const;
const countryPattern = /^[A-Z]{2}$/;

function configuredCountries(name: string) { return new Set((process.env[name] ?? "").split(",").map(value => value.trim().toUpperCase()).filter(country => countryPattern.test(country))); }

export async function auditCompliance(wallet: string, eventType: string, decision: string, reason: string | null, evidence: Record<string, unknown> = {}) {
  await ensureComplianceSchema();
  await getDb().insert(complianceAuditEvents).values({ id: crypto.randomUUID(), walletHash: sha256(wallet), eventType, decision, reason, evidenceJson: JSON.stringify(evidence).slice(0, 4_000) });
}

export async function complianceDecision(wallet: string) {
  await ensureComplianceSchema();
  const [profile] = await getDb().select().from(complianceProfiles).where(eq(complianceProfiles.walletAddress, wallet)).limit(1);
  const [limits] = await getDb().select().from(responsiblePlayLimits).where(eq(responsiblePlayLimits.walletAddress, wallet)).limit(1);
  const now = nowSeconds(); const network = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  if (network === "mainnet-beta") return { allowed: false, code: "MAINNET_DISABLED_PENDING_LICENSE", profile: profile ?? null, limits: limits ?? null };
  if (!profile?.ageAttestedAt) return { allowed: false, code: "AGE_ATTESTATION_REQUIRED", profile: profile ?? null, limits: limits ?? null };
  if (profile.termsVersion !== COMPLIANCE_POLICY.terms || profile.privacyVersion !== COMPLIANCE_POLICY.privacy || profile.riskVersion !== COMPLIANCE_POLICY.risk) return { allowed: false, code: "CONSENT_RENEWAL_REQUIRED", profile, limits: limits ?? null };
  if (profile.status !== "approved_devnet" || profile.jurisdictionStatus !== "allowed_devnet") return { allowed: false, code: profile.status === "blocked" ? "JURISDICTION_BLOCKED" : "COMPLIANCE_REVIEW_REQUIRED", profile, limits: limits ?? null };
  if ((limits?.selfExcludedUntil ?? 0) > now) return { allowed: false, code: "SELF_EXCLUDED", profile, limits };
  if ((limits?.cooldownUntil ?? 0) > now) return { allowed: false, code: "COOLDOWN_ACTIVE", profile, limits };
  return { allowed: true, code: "APPROVED_DEVNET", profile, limits: limits ?? null };
}

export async function wagerDecision(wallet: string, proposedLamports: number) {
  const eligibility = await complianceDecision(wallet); if (!eligibility.allowed) return eligibility;
  if (!Number.isSafeInteger(proposedLamports) || proposedLamports < 0) return { ...eligibility, allowed: false, code: "INVALID_WAGER_AMOUNT" };
  const weekStart = new Date(Date.now() - 7 * 86_400_000).toISOString(); const dayStart = new Date(Date.now() - 86_400_000).toISOString();
  const recent = await getDb().select().from(gameEntries).where(and(eq(gameEntries.walletAddress, wallet), gte(gameEntries.createdAt, weekStart)));
  const dailySpent = recent.filter(entry => entry.createdAt >= dayStart).reduce((sum, entry) => sum + entry.amountLamports, 0); const weeklySpent = recent.reduce((sum, entry) => sum + entry.amountLamports, 0);
  if (eligibility.limits?.dailyLamports != null && dailySpent + proposedLamports > eligibility.limits.dailyLamports) return { ...eligibility, allowed: false, code: "DAILY_LIMIT_EXCEEDED" };
  if (eligibility.limits?.weeklyLamports != null && weeklySpent + proposedLamports > eligibility.limits.weeklyLamports) return { ...eligibility, allowed: false, code: "WEEKLY_LIMIT_EXCEEDED" };
  return { ...eligibility, dailySpent, weeklySpent, proposedLamports };
}

export async function recordAttestation(wallet: string, countryCode: string, detectedCountry: string | null) {
  const country = countryCode.toUpperCase(); if (!countryPattern.test(country)) throw new Error("INVALID_COUNTRY");
  const blocked = configuredCountries("COMPLIANCE_BLOCKED_COUNTRIES"); const allowed = configuredCountries("COMPLIANCE_ALLOWED_COUNTRIES");
  const mismatch = Boolean(detectedCountry && countryPattern.test(detectedCountry) && detectedCountry !== country);
  const denied = blocked.has(country) || (allowed.size > 0 && !allowed.has(country));
  const status = denied ? "blocked" : mismatch ? "manual_review" : "approved_devnet"; const jurisdictionStatus = denied ? "blocked" : mismatch ? "review_required" : "allowed_devnet";
  const values = { walletAddress: wallet, countryCode: country, status, jurisdictionStatus, sanctionsStatus: "not_required_devnet", ageAttestedAt: nowSeconds(), termsVersion: COMPLIANCE_POLICY.terms, privacyVersion: COMPLIANCE_POLICY.privacy, riskVersion: COMPLIANCE_POLICY.risk, updatedAt: new Date().toISOString() };
  await ensureComplianceSchema(); await getDb().insert(complianceProfiles).values(values).onConflictDoUpdate({ target: complianceProfiles.walletAddress, set: values });
  await auditCompliance(wallet, "eligibility_attestation", status, denied ? "configured_jurisdiction_block" : mismatch ? "country_signal_mismatch" : null, { declaredCountry: country, detectedCountry: detectedCountry ?? "unavailable", policy: COMPLIANCE_POLICY, network: "devnet" });
  return complianceDecision(wallet);
}
