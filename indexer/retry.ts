export class RpcError extends Error {
  readonly status?: number; readonly retryAfterMs?: number;
  constructor(message: string, status?: number, retryAfterMs?: number) { super(message); this.status = status; this.retryAfterMs = retryAfterMs; }
}

export function retryDelay(attempt: number, retryAfterMs?: number, random = Math.random) {
  if (retryAfterMs !== undefined) return Math.min(60_000, Math.max(0, retryAfterMs));
  const cap = Math.min(30_000, 300 * 2 ** attempt);
  return Math.floor(cap / 2 + random() * cap / 2);
}

export function isTransient(error: unknown) {
  if (error instanceof RpcError) return !error.status || error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  return error instanceof TypeError || (error instanceof Error && /timeout|ECONNRESET|ENOTFOUND|fetch failed/i.test(error.message));
}

export async function withRetry<T>(operation: (attempt: number) => Promise<T>, options: { attempts?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (error: unknown, attempt: number, delay: number) => void } = {}) {
  const attempts = options.attempts ?? 6;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await operation(attempt); }
    catch (error) {
      lastError = error;
      if (!isTransient(error) || attempt === attempts - 1) throw error;
      const delay = retryDelay(attempt, error instanceof RpcError ? error.retryAfterMs : undefined);
      options.onRetry?.(error, attempt + 1, delay);
      await sleep(delay);
    }
  }
  throw lastError;
}
