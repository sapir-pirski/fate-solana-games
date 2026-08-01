import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { ensureAuthSchema, getDb } from "../db";
import { walletSessions } from "../db/schema";

export const SESSION_COOKIE = "fate_wallet_session";
export const WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const OPERATION_PATTERN = /^[0-9a-f-]{36}$/i;
export const TX_STATES = new Set(["draft","awaiting_signature","submitted","confirmed","finalized","rejected","failed","expired","unknown"]);

export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export function parseCookie(request: Request, name: string) {
  for (const item of (request.headers.get("cookie") ?? "").split(";")) { const [key,...rest]=item.trim().split("="); if(key===name)return decodeURIComponent(rest.join("=")); }
  return null;
}
export function sessionCookie(token: string, maxAge: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}
export function clearSessionCookie() { return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`; }

export async function authenticatedWallet(request: Request) {
  await ensureAuthSchema(); const token=parseCookie(request,SESSION_COOKIE); if(!token)return null; const now=nowSeconds();
  const [session]=await getDb().select().from(walletSessions).where(and(eq(walletSessions.tokenHash,sha256(token)),gt(walletSessions.expiresAt,now),isNull(walletSessions.revokedAt))).limit(1);
  if(!session)return null; await getDb().update(walletSessions).set({lastSeenAt:now}).where(eq(walletSessions.id,session.id)); return {walletAddress:session.walletAddress,sessionId:session.id,expiresAt:session.expiresAt};
}

export function base58Decode(value: string) {
  const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; const bytes=[0];
  for(const char of value){const digit=alphabet.indexOf(char);if(digit<0)throw new Error("Invalid base58 value.");let carry=digit;for(let i=0;i<bytes.length;i++){const next=bytes[i]*58+carry;bytes[i]=next&255;carry=next>>8;}while(carry){bytes.push(carry&255);carry>>=8;}}
  for(let i=0;i<value.length-1&&value[i]==="1";i++)bytes.push(0); return Uint8Array.from(bytes.reverse());
}
export async function verifyWalletSignature(wallet: string, message: string, signature: string) {
  try { const key=await crypto.subtle.importKey("raw",base58Decode(wallet),{name:"Ed25519"},false,["verify"]); return crypto.subtle.verify("Ed25519",key,base58Decode(signature),new TextEncoder().encode(message)); } catch { return false; }
}

export function requireSameOrigin(request: Request) {
  const origin=request.headers.get("origin"); if(!origin)return true; return origin===new URL(request.url).origin;
}
