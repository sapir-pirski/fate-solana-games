"use client";

import { computeBackoffMs, isRetryableStatus, MAX_LOG_ATTEMPTS, parseRetryAfterMs } from "../lib/logging-policy.mjs";

export type GameView = "jackpot" | "coinflip" | "daily" | "history";
export type LogInput = {
  eventType: string;
  category: "navigation" | "wallet" | "gameplay" | "transaction" | "system";
  status?: "info" | "pending" | "success" | "failure";
  gameType?: GameView;
  gameId?: string;
  walletAddress?: string;
  amountLamports?: number;
  transactionSignature?: string;
  metadata?: Record<string, string | number | boolean>;
};

type QueuedEvent = LogInput & {
  id: string;
  sessionId: string;
  installationId: string;
  clientCreatedAt: string;
  attemptCount: number;
  nextAttemptAt: number;
};

const DB_NAME = "fate_telemetry";
const STORE_NAME = "pending_events";
const MAX_QUEUE_SIZE = 1_000;
const BATCH_SIZE = 20;
const SESSION_IDLE_MS = 30 * 60 * 1_000;
let flushPromise: Promise<void> | null = null;
let fallbackQueue: QueuedEvent[] = [];

function openQueue() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("nextAttemptAt", "nextAttemptAt");
      store.createIndex("clientCreatedAt", "clientCreatedAt");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, done: (value: T) => void) => void) {
  return openQueue().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    operation(tx.objectStore(STORE_NAME), resolve);
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => db.close();
  }));
}

async function addToQueue(event: QueuedEvent) {
  try {
    await transaction<void>("readwrite", (store, done) => {
      store.put(event);
      const countRequest = store.count();
      countRequest.onsuccess = () => {
        const overflow = countRequest.result - MAX_QUEUE_SIZE;
        if (overflow <= 0) return done();
        const cursorRequest = store.index("clientCreatedAt").openCursor();
        let removed = 0;
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor || removed >= overflow) return done();
          cursor.delete(); removed += 1; cursor.continue();
        };
      };
    });
  } catch {
    fallbackQueue = [...fallbackQueue.filter(item => item.id !== event.id), event].slice(-MAX_QUEUE_SIZE);
  }
}

async function readyEvents() {
  try {
    return await transaction<QueuedEvent[]>("readonly", (store, done) => {
      const request = store.getAll();
      request.onsuccess = () => done((request.result as QueuedEvent[]).filter(e => e.nextAttemptAt <= Date.now()).slice(0, BATCH_SIZE));
    });
  } catch {
    return fallbackQueue.filter(e => e.nextAttemptAt <= Date.now()).slice(0, BATCH_SIZE);
  }
}

async function deleteEvents(ids: string[]) {
  fallbackQueue = fallbackQueue.filter(e => !ids.includes(e.id));
  try {
    await transaction<void>("readwrite", (store, done) => { ids.forEach(id => store.delete(id)); done(); });
  } catch { /* The in-memory fallback was still cleared. */ }
}

async function rescheduleEvents(events: QueuedEvent[], delayMs: number) {
  const exhausted: string[] = [];
  for (const event of events) {
    event.attemptCount += 1;
    if (event.attemptCount >= MAX_LOG_ATTEMPTS) exhausted.push(event.id);
    else {
      event.nextAttemptAt = Date.now() + Math.max(delayMs, computeBackoffMs(event.attemptCount));
      await addToQueue(event);
    }
  }
  if (exhausted.length) await deleteEvents(exhausted);
}

function installationId() {
  const key = "fate_installation_id";
  let id = localStorage.getItem(key);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
  return id;
}

function sessionId() {
  const key = "fate_session";
  const now = Date.now();
  try {
    const current = JSON.parse(sessionStorage.getItem(key) ?? "null") as { id?: string; lastActivityAt?: number } | null;
    const id = current?.id && current.lastActivityAt && now - current.lastActivityAt < SESSION_IDLE_MS ? current.id : crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ id, lastActivityAt: now }));
    return id;
  } catch {
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, JSON.stringify({ id, lastActivityAt: now }));
    return id;
  }
}

export function logEvent(input: LogInput) {
  const event: QueuedEvent = {
    ...input,
    id: crypto.randomUUID(),
    sessionId: sessionId(),
    installationId: installationId(),
    clientCreatedAt: new Date().toISOString(),
    attemptCount: 0,
    nextAttemptAt: Date.now(),
  };
  void addToQueue(event).then(() => flushLogs());
}

function flushLogs() {
  if (flushPromise || (typeof navigator !== "undefined" && !navigator.onLine)) return flushPromise ?? Promise.resolve();
  flushPromise = (async () => {
    const events = await readyEvents();
    if (!events.length) return;
    try {
      const response = await fetch("/api/logs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-log-schema-version": "1" },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      if (response.ok) {
        const result = await response.json() as { accepted?: string[]; rejected?: { id: string }[] };
        await deleteEvents([...(result.accepted ?? []), ...(result.rejected ?? []).map(r => r.id)]);
      } else if (isRetryableStatus(response.status)) {
        await rescheduleEvents(events, parseRetryAfterMs(response.headers.get("retry-after")) ?? 0);
      } else {
        await deleteEvents(events.map(e => e.id));
      }
    } catch {
      await rescheduleEvents(events, 0);
    }
  })().finally(() => { flushPromise = null; });
  return flushPromise;
}

export function startLogging() {
  const flush = () => { void flushLogs(); };
  const onVisible = () => { if (document.visibilityState === "visible") flush(); };
  window.addEventListener("online", flush);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(flush, 15_000);
  flush();
  return () => {
    window.removeEventListener("online", flush);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
    flush();
  };
}
