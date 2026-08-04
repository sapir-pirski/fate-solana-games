import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { backgroundJobs, rateLimitBuckets } from "../db/schema";
import { nowSeconds, sha256 } from "./auth";
import { increment } from "./telemetry";

export async function enforceRateLimit(input:{scope:string;subject:string;limit:number;windowSeconds:number}){
  const now=nowSeconds(),windowStart=Math.floor(now/input.windowSeconds)*input.windowSeconds,subjectHash=sha256(input.subject),key=`${input.scope}:${subjectHash}:${windowStart}`;
  const [bucket]=await getDb().insert(rateLimitBuckets).values({key,scope:input.scope,subjectHash,windowStart,count:1,expiresAt:windowStart+input.windowSeconds*2}).onConflictDoUpdate({target:rateLimitBuckets.key,set:{count:sql`${rateLimitBuckets.count}+1`}}).returning();
  const remaining=Math.max(0,input.limit-bucket.count),resetAt=windowStart+input.windowSeconds;
  const allowed=bucket.count<=input.limit;increment("fate_rate_limit_decisions_total",{scope:input.scope,decision:allowed?"allowed":"rejected"});return {allowed,limit:input.limit,remaining,resetAt,retryAfter:Math.max(1,resetAt-now)};
}

export function rateLimitResponse(limit:Awaited<ReturnType<typeof enforceRateLimit>>){return Response.json({code:"RATE_LIMITED",retryAfter:limit.retryAfter},{status:429,headers:{"retry-after":String(limit.retryAfter),"x-ratelimit-limit":String(limit.limit),"x-ratelimit-remaining":"0","x-ratelimit-reset":String(limit.resetAt)}});}

export async function enqueueJob(input:{queue:string;dedupeKey:string;payload:unknown;delaySeconds?:number;maxAttempts?:number}){
  const now=nowSeconds(),id=crypto.randomUUID();const [job]=await getDb().insert(backgroundJobs).values({id,queue:input.queue,dedupeKey:input.dedupeKey,payloadJson:JSON.stringify(input.payload),availableAt:now+(input.delaySeconds??0),maxAttempts:input.maxAttempts??8}).onConflictDoUpdate({target:[backgroundJobs.queue,backgroundJobs.dedupeKey],set:{payloadJson:JSON.stringify(input.payload),status:"pending",attempts:sql`CASE WHEN ${backgroundJobs.status}='dead' THEN 0 ELSE ${backgroundJobs.attempts} END`,maxAttempts:input.maxAttempts??8,availableAt:now+(input.delaySeconds??0),leaseOwner:null,leaseExpiresAt:null,lastError:null,updatedAt:new Date().toISOString()}}).returning();increment("fate_jobs_enqueued_total",{queue:input.queue});return job;
}
