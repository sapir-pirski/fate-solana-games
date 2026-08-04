import { increment, jsonLog, observe, withSpan } from "@/lib/telemetry";
import { base58Decode, decodeFateLogEvents, projectFateEvent, type ProjectionContext } from "@/lib/solana/indexer-events";

type SignatureInfo = { signature: string; slot: number; err: unknown; blockTime: number | null; confirmationStatus?: string | null };
type SolanaTransaction = {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; logMessages: string[] | null } | null;
  transaction: { message: { accountKeys: string[]; instructions: Array<{ programIdIndex: number; data?: string }> } };
};
type Checkpoint = { last_signature: string | null; last_slot: number; status: string; updated_at?: string };

export type IndexerMode = "live" | "backfill" | "full";
export type IndexerSummary = {
  status: "indexed" | "fresh" | "busy";
  liveTransactions: number;
  backfillTransactions: number;
  events: number;
  lastSlot: number;
  backfillComplete: boolean;
};

type IndexerOptions = {
  db: D1Database;
  mode?: IndexerMode;
  force?: boolean;
  fetchImpl?: typeof fetch;
  programId?: string;
  cluster?: string;
  rpcUrls?: string[];
  livePageSize?: number;
  liveMaxPages?: number;
  backfillPageSize?: number;
};

const PROGRAM_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CREATE_COINFLIP_DISCRIMINATOR = [23, 66, 225, 208, 103, 207, 25, 225];

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
const boundedInteger = (value: number | undefined, fallback: number, maximum: number) => Number.isInteger(value) && value! > 0 ? Math.min(value!, maximum) : fallback;

function configuredRpcUrls(cluster: string, input?: string[]) {
  const publicEndpoint = cluster === "mainnet-beta" ? "https://api.mainnet-beta.solana.com" : cluster === "testnet" ? "https://api.testnet.solana.com" : "https://api.devnet.solana.com";
  const publicFallbacks = cluster === "devnet" ? ["https://solana-devnet.api.onfinality.io/public"] : cluster === "mainnet-beta" ? ["https://solana-rpc.publicnode.com"] : [];
  const values = input ?? [
    process.env.SOLANA_RPC_URL,
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
    ...(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS ?? "").split(","),
    publicEndpoint,
    ...publicFallbacks,
  ];
  return values.filter((value): value is string => Boolean(value?.trim())).map(value => value.trim()).filter((value, index, all) => all.indexOf(value) === index);
}

function createRpc(fetchImpl: typeof fetch, endpoints: string[]) {
  let requestId = 0;
  return async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < Math.max(2, endpoints.length); attempt += 1) {
      const endpoint = endpoints[attempt % endpoints.length];
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);
        const body = await response.json() as { result?: T; error?: { code?: number } };
        if (body.error || body.result === undefined) throw new Error(`RPC_${body.error?.code ?? "INVALID_RESPONSE"}`);
        return body.result;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < Math.max(2, endpoints.length)) await sleep(150 * (2 ** attempt) + Math.floor(Math.random() * 100));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All Solana RPC providers failed.");
  };
}

function u64FromLittleEndian(bytes: Uint8Array, offset: number) {
  if (offset + 8 > bytes.length) return null;
  let value = 0n;
  for (let index = offset + 7; index >= offset; index -= 1) value = (value << 8n) | BigInt(bytes[index]);
  return value;
}

function i64FromLittleEndian(bytes: Uint8Array, offset: number) {
  const unsigned = u64FromLittleEndian(bytes, offset);
  if (unsigned === null) return null;
  const value = unsigned >= (1n << 63n) ? unsigned - (1n << 64n) : unsigned;
  return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function coinflipMetadata(transaction: SolanaTransaction, programId: string) {
  const message = transaction.transaction.message;
  for (const instruction of message.instructions ?? []) {
    if (message.accountKeys[instruction.programIdIndex] !== programId || !instruction.data) continue;
    try {
      const data = base58Decode(instruction.data);
      if (!CREATE_COINFLIP_DISCRIMINATOR.every((value, index) => data[index] === value)) continue;
      const gameId = u64FromLittleEndian(data, 8);
      const expiresAt = i64FromLittleEndian(data, 25);
      return { coinflipId: gameId?.toString() ?? null, coinflipExpiresAt: expiresAt };
    } catch { /* Ignore unrelated or malformed instructions. */ }
  }
  return { coinflipId: null, coinflipExpiresAt: null };
}

async function getCheckpoint(db: D1Database, consumer: string) {
  return db.prepare("SELECT last_signature,last_slot,status,updated_at FROM indexer_checkpoints WHERE consumer=?").bind(consumer).first<Checkpoint>();
}

async function claim(db: D1Database, consumer: string, force: boolean) {
  return db.prepare(`INSERT INTO indexer_checkpoints (consumer,last_signature,last_slot,status,last_error,updated_at) VALUES (?,NULL,0,'running',NULL,CURRENT_TIMESTAMP)
    ON CONFLICT(consumer) DO UPDATE SET status='running',last_error=NULL,updated_at=CURRENT_TIMESTAMP
    WHERE ?=1 OR (indexer_checkpoints.status!='running' AND indexer_checkpoints.updated_at<datetime('now','-20 seconds')) OR indexer_checkpoints.updated_at<datetime('now','-90 seconds')
    RETURNING last_signature,last_slot,status,updated_at`).bind(consumer, force ? 1 : 0).first<Checkpoint>();
}

async function markCheckpoint(db: D1Database, consumer: string, values: { signature?: string | null; slot?: number; status: string; error?: string | null }) {
  await db.prepare(`INSERT INTO indexer_checkpoints (consumer,last_signature,last_slot,status,last_error,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(consumer) DO UPDATE SET last_signature=COALESCE(excluded.last_signature,indexer_checkpoints.last_signature),last_slot=MAX(indexer_checkpoints.last_slot,excluded.last_slot),status=excluded.status,last_error=excluded.last_error,updated_at=CURRENT_TIMESTAMP`)
    .bind(consumer, values.signature ?? null, values.slot ?? 0, values.status, values.error ?? null).run();
}

async function markCheckpointError(db: D1Database, consumer: string, error: string) {
  await db.prepare("UPDATE indexer_checkpoints SET status='error',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE consumer=?")
    .bind(error, consumer).run();
}

async function signaturesPage(rpc: <T>(method: string, params: unknown[]) => Promise<T>, programId: string, options: { limit: number; until?: string; before?: string }) {
  const config: Record<string, string | number> = { commitment: "finalized", limit: options.limit };
  if (options.until) config.until = options.until;
  if (options.before) config.before = options.before;
  return rpc<SignatureInfo[]>("getSignaturesForAddress", [programId, config]);
}

async function collectLiveSignatures(rpc: <T>(method: string, params: unknown[]) => Promise<T>, programId: string, checkpoint: Checkpoint, pageSize: number, maxPages: number) {
  if (!checkpoint.last_signature) return signaturesPage(rpc, programId, { limit: pageSize });
  const collected: SignatureInfo[] = [];
  let before: string | undefined;
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await signaturesPage(rpc, programId, { limit: pageSize, until: checkpoint.last_signature, before });
    collected.push(...page);
    if (page.length < pageSize) return collected;
    before = page.at(-1)?.signature;
  }
  throw new Error(`INDEXER_BACKLOG_EXCEEDED_${pageSize * maxPages}`);
}

async function processTransaction(input: { db: D1Database; rpc: <T>(method: string, params: unknown[]) => Promise<T>; programId: string; signature: SignatureInfo }) {
  const transaction = await input.rpc<SolanaTransaction | null>("getTransaction", [input.signature.signature, { commitment: "finalized", encoding: "json", maxSupportedTransactionVersion: 0 }]);
  if (!transaction) throw new Error("FINALIZED_TRANSACTION_UNAVAILABLE");
  if (transaction.meta?.err) return { events: 0, slot: transaction.slot };
  const events = decodeFateLogEvents(transaction.meta?.logMessages);
  if (!events.length) return { events: 0, slot: transaction.slot };
  const metadata = coinflipMetadata(transaction, input.programId);
  const context: ProjectionContext = {
    signature: input.signature.signature,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    signer: transaction.transaction.message.accountKeys[0] ?? null,
    ...metadata,
  };
  const statements: D1PreparedStatement[] = [];
  events.forEach((event, eventIndex) => {
    statements.push(input.db.prepare("INSERT OR IGNORE INTO chain_events (id,signature,instruction_index,event_index,slot,block_time,program_id,event_name,payload_json,commitment) VALUES (?,?,?,?,?,?,?,?,?,'finalized')")
      .bind(`${context.signature}:0:${eventIndex}`, context.signature, 0, eventIndex, context.slot, context.blockTime, input.programId, event.name, JSON.stringify(event.payload)));
    for (const mutation of projectFateEvent(event, { ...context, eventIndex })) statements.push(input.db.prepare(mutation.sql).bind(...mutation.params));
  });
  await input.db.batch(statements);
  return { events: events.length, slot: transaction.slot };
}

async function processLive(input: { db: D1Database; rpc: <T>(method: string, params: unknown[]) => Promise<T>; programId: string; consumer: string; checkpoint: Checkpoint; pageSize: number; maxPages: number }) {
  const signatures = await collectLiveSignatures(input.rpc, input.programId, input.checkpoint, input.pageSize, input.maxPages);
  let events = 0, lastSlot = input.checkpoint.last_slot;
  for (const signature of [...signatures].reverse()) {
    const processed = await processTransaction({ db: input.db, rpc: input.rpc, programId: input.programId, signature });
    events += processed.events; lastSlot = Math.max(lastSlot, processed.slot);
    await markCheckpoint(input.db, input.consumer, { signature: signature.signature, slot: processed.slot, status: "running" });
  }
  await markCheckpoint(input.db, input.consumer, { signature: signatures[0]?.signature ?? input.checkpoint.last_signature, slot: lastSlot, status: "healthy" });
  if (!input.checkpoint.last_signature && signatures.length) {
    const oldest = signatures.at(-1)!;
    await input.db.prepare("INSERT OR IGNORE INTO indexer_checkpoints (consumer,last_signature,last_slot,status,last_error,updated_at) VALUES (?,?,?,'backfilling',NULL,CURRENT_TIMESTAMP)")
      .bind(`${input.consumer}:backfill`, oldest.signature, oldest.slot).run();
  }
  return { transactions: signatures.length, events, lastSlot };
}

async function processBackfill(input: { db: D1Database; rpc: <T>(method: string, params: unknown[]) => Promise<T>; programId: string; consumer: string; pageSize: number }) {
  const backfillConsumer = `${input.consumer}:backfill`;
  let checkpoint = await getCheckpoint(input.db, backfillConsumer);
  if (!checkpoint) {
    const oldest = await input.db.prepare("SELECT signature,slot FROM chain_events ORDER BY slot ASC,event_index ASC LIMIT 1").first<{ signature: string; slot: number }>();
    await markCheckpoint(input.db, backfillConsumer, { signature: oldest?.signature ?? null, slot: oldest?.slot ?? 0, status: "backfilling" });
    checkpoint = await getCheckpoint(input.db, backfillConsumer);
  }
  if (checkpoint?.status === "complete") return { transactions: 0, events: 0, complete: true };
  const signatures = await signaturesPage(input.rpc, input.programId, { limit: input.pageSize, before: checkpoint?.last_signature ?? undefined });
  let events = 0;
  for (const signature of [...signatures].reverse()) events += (await processTransaction({ db: input.db, rpc: input.rpc, programId: input.programId, signature })).events;
  if (!signatures.length) {
    await markCheckpoint(input.db, backfillConsumer, { signature: checkpoint?.last_signature ?? null, slot: checkpoint?.last_slot ?? 0, status: "complete" });
    return { transactions: 0, events, complete: true };
  }
  const oldest = signatures.at(-1)!;
  await input.db.prepare("UPDATE indexer_checkpoints SET last_signature=?,last_slot=?,status='backfilling',last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE consumer=?")
    .bind(oldest.signature, oldest.slot, backfillConsumer).run();
  return { transactions: signatures.length, events, complete: false };
}

export async function syncSolanaIndexer(options: IndexerOptions): Promise<IndexerSummary> {
  const started = Date.now();
  const cluster = options.cluster ?? process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";
  const programId = options.programId ?? process.env.FATE_PROGRAM_ID ?? process.env.NEXT_PUBLIC_FATE_PROGRAM_ID ?? "";
  if (!PROGRAM_PATTERN.test(programId)) throw new Error("FATE_PROGRAM_ID_NOT_CONFIGURED");
  const endpoints = configuredRpcUrls(cluster, options.rpcUrls);
  if (!endpoints.length) throw new Error("SOLANA_RPC_NOT_CONFIGURED");
  const mode = options.mode ?? "full";
  const consumer = `fate-program:${cluster}`;
  const checkpoint = await claim(options.db, consumer, Boolean(options.force));
  if (!checkpoint) {
    const current = await getCheckpoint(options.db, consumer);
    return { status: current?.status === "healthy" ? "fresh" : "busy", liveTransactions: 0, backfillTransactions: 0, events: 0, lastSlot: current?.last_slot ?? 0, backfillComplete: false };
  }
  const rpc = createRpc(options.fetchImpl ?? fetch, endpoints);
  let liveTransactions = 0, backfillTransactions = 0, events = 0, lastSlot = checkpoint.last_slot, backfillComplete = false;
  try {
    await withSpan("solana.indexer.sync", { component: "indexer", cluster, mode }, async () => {
      if (mode !== "backfill") {
        const live = await processLive({ db: options.db, rpc, programId, consumer, checkpoint, pageSize: boundedInteger(options.livePageSize, 50, 250), maxPages: boundedInteger(options.liveMaxPages, 4, 10) });
        liveTransactions = live.transactions; events += live.events; lastSlot = live.lastSlot;
      } else {
        await markCheckpoint(options.db, consumer, { signature: checkpoint.last_signature, slot: checkpoint.last_slot, status: "healthy" });
      }
      if (mode !== "live") {
        const backfill = await processBackfill({ db: options.db, rpc, programId, consumer, pageSize: boundedInteger(options.backfillPageSize, 40, 100) });
        backfillTransactions = backfill.transactions; events += backfill.events; backfillComplete = backfill.complete;
      }
    });
    increment("fate_indexer_runs_total", { status: "success", mode });
    increment("fate_indexer_events_total", { cluster }, events);
    observe("fate_indexer_run_duration_ms", Date.now() - started, { status: "success", mode });
    jsonLog("info", "indexer_sync_complete", "Finalized Solana index synchronized.", { cluster, mode, liveTransactions, backfillTransactions, events, lastSlot });
    return { status: "indexed", liveTransactions, backfillTransactions, events, lastSlot, backfillComplete };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 180) : "INDEXER_UNKNOWN_ERROR";
    await markCheckpointError(options.db, consumer, errorCode);
    increment("fate_indexer_runs_total", { status: "failure", mode });
    observe("fate_indexer_run_duration_ms", Date.now() - started, { status: "failure", mode });
    jsonLog("error", "indexer_sync_failed", "Finalized Solana index synchronization failed.", { cluster, mode, errorCode });
    throw error;
  }
}
