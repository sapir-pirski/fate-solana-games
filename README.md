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

Coinflip creation, join, permissionless settlement, creator cancellation, and timeout refunds are wired to the Anchor program. Joining requires `NEXT_PUBLIC_COINFLIP_RANDOMNESS_ENDPOINT` to return a fresh committed Switchboard account as `{ "randomnessAccount": "..." }`; the static account setting is only a one-use local/devnet acceptance fixture. Settlement reads the revealed bytes and treasury directly from Solana before constructing the transaction.

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

Financial state is separate from product analytics. `chain_events` is replay-safe via transaction position uniqueness; `games` and `game_entries` are query projections; `transaction_operations` is the authoritative wallet transaction lifecycle and pending-spend reservation store; `indexer_checkpoints` records consumer progress and health.

The server-side Solana indexer reads only `finalized` program transactions, decodes Anchor events, and writes the raw event plus its query projections in one D1 batch. Public game reads trigger a bounded live synchronization; `POST /api/internal/indexer` performs authenticated live and historical backfill work for the scheduled operations workflow. Cursor claims prevent overlapping workers, failed runs retain the last durable cursor, and every mutation is idempotent and slot-monotonic so retries and older backfill pages cannot overwrite newer state.

## AI and agents

The floating FATE Copilot uses the OpenAI Responses API with read-only, allow-listed tools. It can explain rules, summarize indexed wallet activity, verify stored fairness evidence, diagnose transaction signatures, check responsible-play limits, and produce unsigned devnet action drafts. Every conversation, assistant message, tool call, token count, and user rating is stored in a dedicated audit table. Private keys and signing are never available to the model.

Set `OPENAI_API_KEY` in `.env.local` to enable Copilot. `OPENAI_MODEL` defaults to `gpt-5.6-sol`; provider credentials stay server-side. The operations audit endpoint requires `INDEXER_AUTH_TOKEN` and only returns a keeper plan—it does not sign. The unfinished agent arena was removed from production.

Responsible-play limits are deterministic application controls, not model judgments. Self-exclusion cannot be shortened while active, and AI drafts still require simulation plus explicit approval by the connected wallet.

## Compliance boundary

FATE is a test-token devnet demonstration, not a licensed real-money service. Wallet-authenticated age and jurisdiction attestations, versioned consent, play limits, cooling-off, self-exclusion, privacy requests, and immutable compliance decisions are enforced before transaction preparation. Mainnet is blocked in server policy. Configure ISO alpha-2 allow/block lists with `COMPLIANCE_ALLOWED_COUNTRIES` and `COMPLIANCE_BLOCKED_COUNTRIES`; a network/declaration mismatch requires review. Production KYC, sanctions screening, licensing and jurisdiction-specific legal approval remain mandatory before any real-value launch.

Privacy requests have a durable `received` → `in_review` → `approved` →
`processing` lifecycle. The protected `/api/internal/privacy` endpoint lists the
review queue and accepts `review`, `approve`, or `reject` decisions using the
same server-only automation credential as scheduled maintenance. Approval
immediately attempts processing and maintenance safely retries unfinished jobs.
Access and export requests produce a checksum-addressed, wallet-owner-only JSON
download that expires after seven days. Erasure removes eligible off-chain
records and reports immutable Solana data, minimized audit evidence, and active
responsible-play restrictions that were retained. Every decision and outcome is
written to the compliance audit log; overdue requests create operational alerts.

Run `npm run db:generate` after schema changes. Apply generated migrations through the hosting environment before enabling indexer writes.

## Deployment gates

1. Install the Solana/Anchor deployment toolchain and generate a dedicated program keypair.
2. Integrate and test an audited VRF provider on a local validator and devnet.
3. Expand end-to-end validator tests, economic fuzzing, and long-history indexer replay fixtures.
4. Deploy to devnet, initialize config/vault PDAs, and verify program bytes.
5. Complete independent security and legal reviews.
6. Move authorities to multisig, configure production RPC/monitoring, and only then consider mainnet.

See [SECURITY.md](SECURITY.md) for the launch security requirements.

## License

This project is available under the [MIT License](LICENSE).

# Hosting and local recovery

The public VM-free deployment is hosted on Sites at
`https://fate-solana-games.sapirp.chatgpt.site`, with its managed D1-compatible
database and server-side secrets. Scheduled GitHub Actions run production smoke
checks, lease-based Solana transaction confirmation, idempotent retention
maintenance, and a daily JSON backup retained as a private workflow artifact.
Configure the same random `AUTOMATION_TOKEN` in the
hosting environment and the `FATE_AUTOMATION_TOKEN` GitHub repository secret.

Backups use the versioned `fate-d1-json-v2` format and cover every
application-owned table. Each export contains its schema manifest, applied
migrations, row counts, and a SHA-256 checksum. To validate a backup without
changing data, run:

```sh
BASE_URL=https://fate-solana-games.sapirp.chatgpt.site \
AUTOMATION_TOKEN=... npm run db:restore -- fate-d1-backup.json
```

An actual replacement requires the additional `--apply` flag and
`RESTORE_CONFIRM_CHECKSUM` set to the checksum printed by the successful dry
run. Data is loaded into isolated staging tables, verified, and then swapped
into production in one atomic D1 batch. A failed staging operation leaves the
current production tables unchanged.

Object storage is intentionally not provisioned because FATE has no user-file
workload. A custom domain can be attached later without changing application
architecture. The application and recovery workflow are provider-neutral and
do not depend on resources from an inactive cloud deployment.

For isolated development and recovery testing, copy `local.env.example` to `local.env`, replace every
`replace-with-...` value, and run:

```sh
./scripts/local-platform.sh up
```

This starts the application with its persistent local D1 database on `http://localhost:3100`,
Prometheus on `http://localhost:9090`, Grafana on
`http://localhost:3001`, and Loki on port 3101. All published ports bind only to
localhost. The stack uses persistent Docker volumes and devnet-only application
settings. It never imports production secrets or production game state.

Use `./scripts/local-platform.sh status`, `health`, `logs`, and `down` to operate
the stack.

## Test matrix

Run the fast build, security, and unit suites with `npm test` and
`npm run test:unit`. With the local platform running, use
`npm run test:integration`, `npm run test:contract`, and
`npm run test:browser` for D1 integration, API-contract, and desktop/mobile browser
coverage. `npm run test:load` runs the read-only k6 workload against port 3100.

Failure recovery is deliberately opt-in because it restarts local containers:

```sh
FATE_RUN_FAILURE_TESTS=1 npm run test:failure
```

The devnet smoke check is also opt-in and refuses any non-devnet endpoint:

```sh
FATE_RUN_DEVNET_TESTS=1 npm run test:devnet
```

`npm run test:acceptance` verifies the public deployment, devnet RPC, executable
program account, and configuration PDA. It fails closed until those live gates
exist. The required transactional evidence matrix and current result are in
`docs/DEVNET_ACCEPTANCE.md`; passing local tests must never be reported as
completed devnet acceptance.
