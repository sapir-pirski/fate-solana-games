import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { Connection, PublicKey } from "@solana/web3.js";
import { decodeProgramEvents } from "./decoder.ts";
import { RpcPool, type SignatureInfo } from "./rpc.ts";
import { isTransient } from "./retry.ts";
import { IndexerStore } from "./store.ts";

type Commitment = "confirmed" | "finalized";
export class FateIndexer {
  readonly store: IndexerStore; readonly rpc: RpcPool; readonly workerId = randomUUID();
  private timer?: ReturnType<typeof setTimeout>; private server?: Server; private running = false; private stopped = false; private subscription?: number; private latestFinalized = 0;
  constructor(readonly config: { databaseUrl: string; rpcUrls: string[]; programId: string; cluster: string; expectedGenesisHash?: string; pollMs?: number; healthPort?: number }) {
    new PublicKey(config.programId); this.store = new IndexerStore(config.databaseUrl, config.cluster); this.rpc = new RpcPool(config.rpcUrls);
  }
  async initialize() {
    await this.store.initialize();
    if (!await this.store.lock()) throw new Error(`Another indexer owns cluster ${this.config.cluster}.`);
    const genesis = await this.rpc.getGenesisHash();
    if (this.config.expectedGenesisHash && genesis !== this.config.expectedGenesisHash) throw new Error(`Genesis hash mismatch: expected ${this.config.expectedGenesisHash}, received ${genesis}.`);
    await this.store.log("info", "indexer_initialized", "Indexer identity and cluster validated.", { workerId: this.workerId, cluster: this.config.cluster, genesis });
  }
  async processSignature(info: SignatureInfo, commitment: Commitment) {
    try {
      const transaction = await this.rpc.getTransaction(info.signature, commitment);
      if (!transaction) throw new Error("RPC returned no transaction at requested commitment.");
      const meta = transaction.meta as { err?: unknown; logMessages?: string[] | null } | undefined;
      const events = meta?.err ? [] : decodeProgramEvents(meta?.logMessages ?? [], this.config.programId);
      const slot = typeof transaction.slot === "number" ? transaction.slot : info.slot;
      const blockTime = typeof transaction.blockTime === "number" ? transaction.blockTime : info.blockTime;
      await this.store.ingest({ signature: info.signature, slot, blockTime, commitment, succeeded: !meta?.err, raw: transaction, events });
      return events.length;
    } catch (error) {
      await this.store.failure({ signature: info.signature, slot: info.slot, stage: "transaction", error, retryable: isTransient(error), context: { commitment } });
      await this.store.log("error", "transaction_failed", "Transaction ingestion failed.", { signature: info.signature, slot: info.slot, commitment, error: error instanceof Error ? error.message : String(error) });
      return -1;
    }
  }
  private async signatures(commitment: Commitment) {
    const cursor = await this.store.cursor(commitment); const collected: SignatureInfo[] = []; const seen = new Set<string>();
    let before: string | undefined; const maxPages = Number(process.env.INDEXER_MAX_BACKFILL_PAGES ?? 100);
    for (let page = 0; page < maxPages; page++) {
      const batch = await this.rpc.getSignatures(this.config.programId, commitment, 250, before, page === 0 ? undefined : cursor.last_signature ?? undefined);
      for (const item of batch) if (!seen.has(item.signature)) { seen.add(item.signature); collected.push(item); }
      if (batch.length < 250 || (cursor.last_signature && batch.some(item => item.signature === cursor.last_signature))) break;
      before = batch.at(-1)?.signature; if (!before) break;
    }
    return collected;
  }
  async cycle() {
    if (this.running) return; this.running = true;
    const runId = await this.store.startRun(this.workerId); let transactions = 0; let events = 0; let reorged = 0; let slots: number[] = [];
    try {
      for (const commitment of ["confirmed", "finalized"] as const) {
        const signatures = await this.signatures(commitment);
        slots = slots.concat(signatures.map(item => item.slot));
        let ingestionFailed = false;
        for (const info of [...signatures].reverse()) { const count = await this.processSignature(info, commitment); if (count >= 0) events += count; else ingestionFailed = true; transactions++; }
        if (ingestionFailed) throw new Error(`${commitment} cursor not advanced because one or more transactions failed.`);
        if (commitment === "confirmed" && signatures.length) {
          const newest = signatures.reduce((a, b) => a.slot > b.slot ? a : b);
          await this.store.advanceCursor("confirmed", newest.signature, newest.slot);
        }
        if (commitment === "finalized" && signatures.length) {
          const minSlot = Math.min(...signatures.map(item => item.slot)); const maxSlot = Math.max(...signatures.map(item => item.slot));
          reorged += await this.store.reconcile(minSlot, maxSlot, signatures.map(item => item.signature));
          await this.store.rebuildProjections();
          const newest = signatures.reduce((a, b) => a.slot > b.slot ? a : b);
          await this.store.advanceCursor("finalized", newest.signature, newest.slot); this.latestFinalized = newest.slot;
        } else if (commitment === "finalized") {
          const head = await this.rpc.getSlot("finalized");
          await this.store.advanceCursor("finalized", null, head); this.latestFinalized = head;
        }
      }
      await this.store.finishRun(runId, { status: "complete", startSlot: slots.length ? Math.min(...slots) : undefined, endSlot: slots.length ? Math.max(...slots) : undefined, transactions, events, reorged });
      await this.store.log("info", "indexer_cycle", "Reconciliation cycle completed.", { transactions, events, reorged, finalizedSlot: this.latestFinalized });
    } catch (error) {
      await this.store.finishRun(runId, { status: "failed", transactions, events, reorged, error: error instanceof Error ? error.message : String(error) });
      await this.store.failure({ stage: "cycle", error, retryable: isTransient(error) }); throw error;
    } finally { this.running = false; }
  }
  async replayFailures() {
    const failures = await this.store.retryableFailures();
    for (const failure of failures) {
      const info = { signature: failure.signature!, slot: 0, err: null, blockTime: null };
      await this.store.resolveFailure(failure.id, await this.processSignature(info, "finalized") >= 0 ? "resolved" : "dead");
    }
    await this.store.rebuildProjections(); return failures.length;
  }
  private schedule(delay = this.config.pollMs ?? 15_000) { if (this.stopped) return; clearTimeout(this.timer); this.timer = setTimeout(() => void this.cycle().catch(() => undefined).finally(() => this.schedule()), delay); }
  private subscribe() {
    const connection = new Connection(this.config.rpcUrls[0], { commitment: "confirmed" });
    this.subscription = connection.onLogs(new PublicKey(this.config.programId), () => this.schedule(100), "confirmed");
    return connection;
  }
  private healthServer() {
    this.server = createServer(async (request, response) => {
      if (request.url !== "/health" && request.url !== "/metrics") { response.writeHead(404).end(); return; }
      try {
        const status = await this.store.status(); const head = await this.rpc.getSlot("finalized"); const lag = Math.max(0, head - Number(status.cursor?.last_slot ?? 0));
        if (request.url === "/metrics") { response.writeHead(200, { "content-type": "text/plain" }); response.end(`fate_indexer_up 1\nfate_indexer_finalized_slot ${this.latestFinalized}\nfate_indexer_finalized_lag ${lag}\nfate_indexer_dead_letters ${status.deadLetters}\n`); }
        else { const ready = Boolean(status.cursor) && lag < 500; response.writeHead(ready ? 200 : 503, { "content-type": "application/json" }); response.end(JSON.stringify({ status: ready ? "ready" : "syncing", cluster: this.config.cluster, finalizedSlot: this.latestFinalized, head, lag, deadLetters: status.deadLetters })); }
      } catch (error) { response.writeHead(503, { "content-type": "application/json" }); response.end(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) })); }
    }).listen(this.config.healthPort ?? 9464, "0.0.0.0");
  }
  async start() { await this.initialize(); const connection = this.subscribe(); this.healthServer(); await this.cycle(); this.schedule(); return async () => { this.stopped = true; clearTimeout(this.timer); if (this.subscription !== undefined) await connection.removeOnLogsListener(this.subscription); await new Promise<void>(resolve => this.server?.close(() => resolve())); await this.store.close(); }; }
}
