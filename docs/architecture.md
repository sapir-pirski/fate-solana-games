# FATE architecture

FATE is split by responsibility so custody and game rules cannot accidentally leak into presentation code.

## Boundaries

- `app/` contains routing and thin HTTP handlers.
- `features/` contains user-facing product features and their orchestration.
- `components/ui/` contains reusable presentation primitives.
- `components/three/` contains reusable WebGL infrastructure and scenes.
- `lib/` contains environment-neutral clients, contracts, validation and utilities.
- `server/services/` is the application-service boundary used by API handlers.
- `server/repositories/` defines persistence contracts; database adapters remain replaceable.
- `db/` owns Drizzle schemas and concrete D1/PostgreSQL connections.
- `indexer/` owns finalized Solana ingestion, retry and reconciliation.
- `programs/` owns Anchor programs and on-chain custody rules.
- `infra/` documents provider-neutral deployment and observability assets.

## Trust boundaries

The browser may prepare and request transactions but never holds treasury, oracle or administrative keys. API handlers authenticate wallet signatures, validate compliance and delegate policy decisions to server services. On-chain programs enforce escrow, settlement, timeouts and authority separation. The indexer is a read model and cannot decide outcomes.

## Dependency direction

`app routes -> features/components -> lib contracts` for browser code and `app API -> server services -> db/indexer` for server code. Features and components are linted against importing server, database or API internals.

## Release units

The web application and API ship together. Anchor programs and the indexer have independent validation and release gates because they have different security and rollback constraints.
