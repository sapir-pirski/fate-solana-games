# FATE — Solana games

FATE is a responsive Solana gaming platform for Jackpot, Coinflip, and Daily Case. The repository contains the animated web application, an Anchor on-chain program, durable event and financial schemas, and CI checks.

> Status: devnet engineering build. The UI is usable locally, wallet connection is real, and the on-chain program compiles and passes its unit tests. Do not use real-value funds before audit, legal review, production VRF integration, and a controlled mainnet deployment.

## Architecture

- `app/`: React 19/Vinext interface, Wallet Standard connection, 3D and reduced-motion experiences, and batched offline-capable product logging.
- `programs/fate-games/`: Anchor program with PDA state, escrow vaults, Jackpot and Coinflip settlement, Daily Case rewards, timeout recovery, pause controls, and event emission.
- `db/`: D1/Drizzle models for append-only product logs, canonical chain events, game projections, entries, transaction intents, and indexer checkpoints.
- `drizzle/`: versioned database migrations.
- `.github/workflows/ci.yml`: repeatable web and Rust checks.

## Run locally

Prerequisites: Node.js 22+, npm, and stable Rust. Copy `.env.example` to `.env.local`, keep the cluster on devnet, then run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Install a Wallet Standard-compatible Solana wallet and switch it to devnet to connect. A missing wallet produces an explicit error instead of a simulated connection.

## Validate

```bash
npm run lint
npm test
cargo fmt --all -- --check
cargo test --workspace --locked
```

`npm test` performs a production web build before the logging-policy tests. Rust tests cover weighted jackpot selection, fee calculations, and reward tiers; full validator tests should be added alongside the selected VRF adapter before deployment.

## On-chain safety model

- Each game and vault is a deterministic PDA.
- SOL wagers are held by program-owned accounts rather than an application wallet.
- Outcomes can only be settled by the configured randomness authority boundary.
- Jackpot settlement selects a winner proportional to deposited lamports.
- Coinflips refund both players if randomness times out; Jackpots switch to wallet-claimed refunds after timeout.
- Arithmetic is checked, wagers and fees are bounded, and state transitions are explicit.
- Administration supports pause and two-step authority transfer.

The randomness authority is deliberately an adapter boundary, not a claim that server-generated randomness is sufficient. Bind it to audited VRF fulfillment before launch.

## Data and logging

Product events are queued in IndexedDB, flushed asynchronously in bounded batches, retried with exponential backoff and jitter, deduplicated by UUID, and retained for 90 days. Logs exclude secrets, signatures, raw user agents, and IP-derived fields.

Financial state is separate from product analytics. `chain_events` is replay-safe via transaction position uniqueness; `games` and `game_entries` are query projections; `transaction_intents` supports pending/confirmed/failed recovery; `indexer_checkpoints` records consumer progress and health.

Run `npm run db:generate` after schema changes. Apply generated migrations through the hosting environment before enabling indexer writes.

## Deployment gates

1. Install the Solana/Anchor deployment toolchain and generate a dedicated program keypair.
2. Integrate and test an audited VRF provider on a local validator and devnet.
3. Add end-to-end validator tests, economic fuzzing, and keeper/indexer replay tests.
4. Deploy to devnet, initialize config/vault PDAs, and verify program bytes.
5. Complete independent security and legal reviews.
6. Move authorities to multisig, configure production RPC/monitoring, and only then consider mainnet.

See [SECURITY.md](SECURITY.md) for the launch security requirements.
