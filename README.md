# FATE — Solana games

FATE is a responsive Solana gaming platform for Jackpot, Coinflip, and Daily Case. The repository contains the animated web application, an Anchor on-chain program, durable event and financial schemas, and CI checks.

> Status: devnet engineering build. The UI is usable locally, wallet connection is real, and the on-chain program compiles and passes its unit tests. Do not use real-value funds before audit, legal review, production VRF integration, and a controlled mainnet deployment.

## Architecture

- `app/`: React 19/Vinext interface, Wallet Standard connection, 3D and reduced-motion experiences, and batched offline-capable product logging.
- `programs/fate-games/`: Anchor program with PDA state, escrow vaults, Jackpot and Coinflip settlement, Daily Case rewards, timeout recovery, pause controls, and event emission.
- `db/`: D1/Drizzle models for append-only product logs, canonical chain events, game projections, entries, transaction intents, indexer checkpoints, and AI audit records.
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

## AI and agents

The floating FATE Copilot uses the OpenAI Responses API with read-only, allow-listed tools. It can explain rules, summarize indexed wallet activity, verify stored fairness evidence, diagnose transaction signatures, check responsible-play limits, and produce unsigned devnet action drafts. Every conversation, assistant message, tool call, token count, and user rating is stored in a dedicated audit table. Private keys and signing are never available to the model.

Set `OPENAI_API_KEY` in `.env.local` to enable Copilot. `OPENAI_MODEL` defaults to `gpt-5.6-sol`; provider credentials stay server-side. The operations audit endpoint requires `INDEXER_AUTH_TOKEN` and only returns a keeper plan—it does not sign. The transparent agent arena uses deterministic fixed policies, test balances, and devnet only; opt in locally with `AI_AGENT_ARENA_ENABLED=true`.

Responsible-play limits are deterministic application controls, not model judgments. Self-exclusion cannot be shortened while active, and AI drafts still require simulation plus explicit approval by the connected wallet.

Run `npm run db:generate` after schema changes. Apply generated migrations through the hosting environment before enabling indexer writes.

## Deployment gates

1. Install the Solana/Anchor deployment toolchain and generate a dedicated program keypair.
2. Integrate and test an audited VRF provider on a local validator and devnet.
3. Add end-to-end validator tests, economic fuzzing, and keeper/indexer replay tests.
4. Deploy to devnet, initialize config/vault PDAs, and verify program bytes.
5. Complete independent security and legal reviews.
6. Move authorities to multisig, configure production RPC/monitoring, and only then consider mainnet.

See [SECURITY.md](SECURITY.md) for the launch security requirements.
# Local platform

The production deployment remains on Nebius. For isolated development and
recovery testing, copy `local.env.example` to `local.env`, replace every
`replace-with-...` value, and run:

```sh
./scripts/local-platform.sh up
```

This starts the application on `http://localhost:3100`, PostgreSQL on port 55432,
the PostgreSQL-backed coordination worker, Prometheus on `http://localhost:9090`, Grafana on
`http://localhost:3001`, and Loki on port 3101. All published ports bind only to
localhost. The stack uses persistent Docker volumes and devnet-only application
settings. It never imports production secrets or production game state.

Use `./scripts/local-platform.sh status`, `health`, `logs`, and `down` to operate
the stack. `./scripts/local-platform.sh ai-up` starts optional Ollama separately.

## Test matrix

Run the fast build, security, and unit suites with `npm test` and
`npm run test:unit`. With the local platform running, use
`npm run test:integration`, `npm run test:contract`, and
`npm run test:browser` for PostgreSQL, API-contract, and desktop/mobile browser
coverage. `npm run test:load` runs the read-only k6 workload against port 3100.

Failure recovery is deliberately opt-in because it restarts local containers:

```sh
FATE_RUN_FAILURE_TESTS=1 npm run test:failure
```

The devnet smoke check is also opt-in and refuses any non-devnet endpoint:

```sh
FATE_RUN_DEVNET_TESTS=1 npm run test:devnet
```
