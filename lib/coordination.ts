import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { backgroundJobs, distributedLeases, rateLimitBuckets, responseCache } from "../db/schema";
import { nowSeconds, randomToken, sha256 } from "./auth";
import { increment } from "./telemetry";

export async function enforceRateLimit(input:{scope:string;subject:string;limit:number;windowSeconds:number}){
  const now=nowSeconds(),windowStart=Math.floor(now/input.windowSeconds)*input.windowSeconds,subjectHash=sha256(input.subject),key=`${input.scope}:${subjectHash}:${windowStart}`;
  const [bucket]=await getDb().insert(rateLimitBuckets).values({key,scope:input.scope,subjectHash,windowStart,count:1,expiresAt:windowStart+input.windowSeconds*2}).onConflictDoUpdate({target:rateLimitBuckets.key,set:{count:sql`${rateLimitBuckets.count}+1`}}).returning();
  const remaining=Math.max(0,input.limit-bucket.count),resetAt=windowStart+input.windowSeconds;
  const allowed=bucket.count<=input.limit;increment("fate_rate_limit_decisions_total",{scope:input.scope,decision:allowed?"allowed":"rejected"});return {allowed,limit:input.limit,remaining,resetAt,retryAfter:Math.max(1,resetAt-now)};
}

export function rateLimitResponse(limit:Awaited<ReturnType<typeof enforceRateLimit>>){return Response.json({code:"RATE_LIMITED",retryAfter:limit.retryAfter},{status:429,headers:{"retry-after":String(limit.retryAfter),"x-ratelimit-limit":String(limit.limit),"x-ratelimit-remaining":"0","x-ratelimit-reset":String(limit.resetAt)}});}

export async function enqueueJob(input:{queue:string;dedupeKey:string;payload:unknown;delaySeconds?:number;maxAttempts?:number}){
  const now=nowSeconds(),id=crypto.randomUUID();const [job]=await getDb().insert(backgroundJobs).values({id,queue:input.queue,dedupeKey:input.dedupeKey,payloadJson:JSON.stringify(input.payload),availableAt:now+(input.delaySeconds??0),maxAttempts:input.maxAttempts??8}).onConflictDoUpdate({target:[backgroundJobs.queue,backgroundJobs.dedupeKey],set:{payloadJson:JSON.stringify(input.payload),status:"pending",availableAt:now+(input.delaySeconds??0),updatedAt:new Date().toISOString()}}).returning();increment("fate_jobs_enqueued_total",{queue:input.queue});return job;
}

export async function acquireLease(name:string,owner:string,ttlSeconds=30){const now=nowSeconds(),token=randomToken();const [lease]=await getDb().insert(distributedLeases).values({name,owner,tokenHash:sha256(token),expiresAt:now+ttlSeconds}).onConflictDoUpdate({target:distributedLeases.name,set:{owner,tokenHash:sha256(token),expiresAt:now+ttlSeconds,updatedAt:new Date().toISOString()},where:or(lt(distributedLeases.expiresAt,now),eq(distributedLeases.owner,owner))}).returning();return lease?.owner===owner?{token,expiresAt:lease.expiresAt}:null;}
export async function renewLease(name:string,owner:string,token:string,ttlSeconds=30){const now=nowSeconds();const rows=await getDb().update(distributedLeases).set({expiresAt:now+ttlSeconds,updatedAt:new Date().toISOString()}).where(and(eq(distributedLeases.name,name),eq(distributedLeases.owner,owner),eq(distributedLeases.tokenHash,sha256(token)),gt(distributedLeases.expiresAt,now))).returning();return rows.length===1;}
export async function releaseLease(name:string,owner:string,token:string){await getDb().delete(distributedLeases).where(and(eq(distributedLeases.name,name),eq(distributedLeases.owner,owner),eq(distributedLeases.tokenHash,sha256(token))));}

export async function cacheGet<T>(key:string){const [row]=await getDb().select().from(responseCache).where(and(eq(responseCache.key,key),gt(responseCache.expiresAt,nowSeconds()))).limit(1);if(!row)return null;try{return JSON.parse(row.valueJson) as T;}catch{return null;}}
export async function cacheSet(key:string,value:unknown,ttlSeconds:number){await getDb().insert(responseCache).values({key,valueJson:JSON.stringify(value),expiresAt:nowSeconds()+ttlSeconds,updatedAt:new Date().toISOString()}).onConflictDoUpdate({target:responseCache.key,set:{valueJson:JSON.stringify(value),expiresAt:nowSeconds()+ttlSeconds,updatedAt:new Date().toISOString()}});}
