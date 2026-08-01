import { RpcError, withRetry } from "./retry.ts";

type Provider = { url: string; failures: number; openUntil: number; latencyMs: number };
export type SignatureInfo = { signature: string; slot: number; err: unknown; blockTime: number | null; confirmationStatus?: string };

function retryAfter(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export class RpcPool {
  private id = 0;
  readonly providers: Provider[];
  private readonly timeoutMs: number;
  constructor(urls: string[], timeoutMs = 12_000) {
    this.timeoutMs = timeoutMs;
    if (!urls.length) throw new Error("At least one SOLANA_RPC_URL is required.");
    this.providers = urls.map(url => ({ url, failures: 0, openUntil: 0, latencyMs: 0 }));
  }
  private candidates() {
    const now = Date.now();
    const available = this.providers.filter(provider => provider.openUntil <= now);
    return (available.length ? available : this.providers).sort((a, b) => a.failures - b.failures || a.latencyMs - b.latencyMs);
  }
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    return withRetry(async () => {
      const provider = this.candidates()[0];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const started = Date.now();
      try {
        const response = await fetch(provider.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }), signal: controller.signal });
        if (!response.ok) throw new RpcError(`RPC ${method} returned HTTP ${response.status}`, response.status, retryAfter(response.headers.get("retry-after")));
        const payload = await response.json() as { result?: T; error?: { code: number; message: string } };
        if (payload.error) throw new RpcError(`RPC ${method} failed (${payload.error.code}): ${payload.error.message}`, payload.error.code === -32005 ? 429 : payload.error.code <= -32600 ? 400 : 503);
        provider.failures = 0; provider.latencyMs = Date.now() - started;
        return payload.result as T;
      } catch (error) {
        provider.failures++;
        if (provider.failures >= 3) provider.openUntil = Date.now() + Math.min(60_000, 5_000 * provider.failures);
        throw error;
      } finally { clearTimeout(timer); }
    });
  }
  getSignatures(programId: string, commitment: "confirmed" | "finalized", limit = 250, before?: string, until?: string) {
    return this.call<SignatureInfo[]>("getSignaturesForAddress", [programId, { limit, commitment, ...(before ? { before } : {}), ...(until ? { until } : {}) }]);
  }
  getTransaction(signature: string, commitment: "confirmed" | "finalized") {
    return this.call<Record<string, unknown> | null>("getTransaction", [signature, { commitment, encoding: "json", maxSupportedTransactionVersion: 0 }]);
  }
  getGenesisHash() { return this.call<string>("getGenesisHash"); }
  getSlot(commitment: "confirmed" | "finalized") { return this.call<number>("getSlot", [{ commitment }]); }
}
