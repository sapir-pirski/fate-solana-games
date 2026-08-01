# FATE Solana indexer

The indexer is a standalone TypeScript worker. WebSocket logs wake the worker for
low latency, while `getSignaturesForAddress` polling is the authoritative recovery
and gap-detection path. It indexes both `confirmed` and `finalized` observations;
only canonical finalized events build public game projections.

## Guarantees

- Transaction/event identity is `(cluster, signature, instruction_index, event_index)`.
- All ingestion writes are idempotent upserts.
- Raw RPC transactions and raw Anchor event bytes are retained.
- Every finalized overlap window is reconciled; missing signatures are marked
  non-canonical and their events are retained as reorganization evidence.
- Projections are rebuilt deterministically from canonical finalized events.
- The finalized cursor advances only after every fetched transaction is persisted.
- A PostgreSQL advisory lock permits one worker per cluster.
- Transient RPC failures use capped exponential backoff with jitter, provider
  health scoring, circuit breaking, and failover.
- Deterministic failures and exhausted transaction failures are recorded in
  `indexer_failures`; operators can replay them.

## Commands

```sh
npm run indexer
npm run indexer:once
npm run indexer:rebuild
npm run indexer:retry
npx tsx indexer/cli.ts status
```

Required configuration: `DATABASE_URL`, `FATE_PROGRAM_ID`, and one or more
comma-separated `SOLANA_RPC_URLS`. Set `SOLANA_GENESIS_HASH` in production to pin
the worker to the intended cluster. Use at least two independent RPC providers.

The worker exposes `/health` and `/metrics` on `INDEXER_HEALTH_PORT` (9464 by
default). Readiness fails when no finalized cursor exists or lag exceeds 500 slots.

## Reorganization model

Confirmed observations can disappear before finalization, so they never update
`games` or `game_entries`. On every finalized overlap, transactions absent from
canonical RPC history are marked `canonical=false`; their raw evidence remains.
The worker then replays the finalized event ledger into projections transactionally.
