# Devnet acceptance record

Status: **BLOCKED — transactional acceptance has not started**  

Devnet evidence date: 2026-08-01

Application validation refreshed: 2026-08-06 at revision `f31e930`

Target program: `Fg6PaFpoGXkYsidMpWxqSWY4vF8zqRkMnJx9QpMvdWvZ`

## Verified gates

| Gate | Result | Evidence |
|---|---|---|
| Public application health | Pass | Sites production health reports devnet and managed database `ok` |
| Solana devnet RPC | Pass | `getHealth` returned `ok` |
| Program compilation | Pass | 7 Rust program tests pass on Rust 1.89 |
| Application/security suite | Pass | production build, 59 policy/security tests, 41 TypeScript unit tests, and 1 D1 integration test pass |
| Program deployed at configured ID | **Fail** | finalized `getAccountInfo` returned `value: null` at slot 480440319 |
| Config PDA and multisig authorities | Blocked | cannot exist or be verified before program deployment |
| Real Jackpot/Coinflip/Daily transactions | Blocked | no executable program exists at the configured address |

The passing web and unit tests are not substitutes for on-chain acceptance. No transaction signatures or successful game journeys are claimed.

## Required transactional matrix

After deploying the exact reviewed program to devnet and initializing its config with distinct Squads authorities, execute every row using disposable devnet wallets and devnet SOL only. Record transaction signature, finalized slot, expected/actual state, verifier result and defect ID.

| Area | Required cases |
|---|---|
| Jackpot | create; multiple weighted entries; settle; independent fairness verification; maximum entries; late entry rejection; VRF timeout; each refund; terminal close |
| Coinflip | create each side; distinct joiner; settle each outcome; self-join rejection; wrong amount; creator cancellation; VRF timeout refund; terminal close |
| Daily Case | initialize; fund vault; open; settle every reward tier by controlled validator fixture; cooldown rejection; insufficient vault; timeout clear; account close |
| Adversarial accounts | wrong program owner, PDA, bump, vault, winner, treasury, signer, randomness owner/queue/seed, reused commitment and duplicate settlement |
| Wallet/API recovery | signature rejection, disconnect, expired blockhash, delayed/finalized confirmation, RPC failover, duplicate operation and restored session |
| Administration | pause by pause multisig; unauthorized unpause rejection; unpause by config multisig; timelocked config update/cancel/apply; delayed authority rotation |
| Data integrity | finalized events exactly reconcile into games, entries, transaction operations and public history; re-run is idempotent |
| Operations | load/concurrency, provider failure, backup export, clean restore, alerts, mobile/accessibility and supported wallets/browsers |

## Acceptance criteria

- Every required case passes twice from a clean deployment with immutable evidence.
- All financial and fairness results reproduce from finalized Solana state without trusting the API.
- Zero unresolved critical/high defects; medium defects have written risk acceptance and owner/date.
- External auditor retests the final program commit and deployed authority topology.
- Legal/licensing approval and production compliance providers are complete.
- Mainnet remains technically disabled until a signed release decision references this evidence.

The live verifier is `npm run test:acceptance`. It intentionally exits non-zero while the program/config gates are absent.
