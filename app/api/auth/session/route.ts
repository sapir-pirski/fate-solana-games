import { eq } from "drizzle-orm";
import { getDb, withDatabase } from "../../../../db";
import { walletSessions } from "../../../../db/schema";
import { authenticatedWallet, clearSessionCookie, nowSeconds, requireSameOrigin } from "@/server/services/auth";

export async function GET(request:Request){return withDatabase(async()=>{const session=await authenticatedWallet(request);return session?Response.json({authenticated:true,...session},{headers:{"cache-control":"no-store"}}):Response.json({authenticated:false},{status:401,headers:{"cache-control":"no-store"}});});}
export async function DELETE(request:Request){return withDatabase(async()=>{if(!requireSameOrigin(request))return Response.json({code:"INVALID_ORIGIN"},{status:403});const session=await authenticatedWallet(request);if(session)await getDb().update(walletSessions).set({revokedAt:nowSeconds()}).where(eq(walletSessions.id,session.sessionId));return Response.json({authenticated:false},{headers:{"set-cookie":clearSessionCookie(),"cache-control":"no-store"}});});}
