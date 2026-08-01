# FATE threat model

Status: internal engineering threat model, 2026-08-01. It is not an independent audit or a mainnet approval.

## Scope and security objectives

The scope is the Solana program, PDA vaults, Switchboard randomness accounts, wallet-authenticated web API, D1 data, Sites runtime, OpenAI integration, CI/CD, chain-read and operator interfaces. The primary objectives are:

1. no unauthorized movement of escrow or treasury lamports;
2. no outcome chosen or replayed by a player, operator, API or AI system;
3. refunds remain available when settlement or randomness fails;
4. wallet identity cannot be forged or confused between sessions;
5. operational data and secrets remain confidential and auditable;
6. mainnet and real-value play remain disabled until all launch gates pass.

## Assets, actors and trust boundaries

| Asset | Required property | Principal threats |
|---|---|---|
| PDA vault lamports | integrity, availability | forged accounts, arithmetic error, insolvency, blocked refund |
| Program configuration and upgrade authority | integrity | stolen key, malicious upgrade, unsafe fee/VRF change |
| Randomness commitment and result | integrity, freshness | replay, provider substitution, selective settlement |
| Wallet session | authenticity, confidentiality | signature replay, session theft, CSRF, wallet confusion |
| Transaction and compliance records | integrity, privacy | IDOR, forged status, excessive retention, backup exposure |
| API/AI secrets and automation token | confidentiality | client bundling, logs, CI leakage, SSRF or prompt exfiltration |
| Build and deployment | provenance | dependency compromise, malicious workflow, wrong program ID |

Untrusted actors include anonymous clients, players, wallet extensions, RPC endpoints, supplied transaction signatures, AI prompts and all browser state. Partially trusted services are Sites, D1, OpenAI, Solana RPC and Switchboard. High-trust principals are the Solana upgrade authority, configuration admin, treasury authority and deployment administrators. AI is never a trusted signer or outcome authority.

Trust boundaries exist at browser/API, API/database, API/provider, client/Solana RPC, Solana program/external randomness account, CI/hosting, and operator/admin key boundaries.

## Abuse cases and controls

| ID | STRIDE | Scenario | Existing control | Residual action |
|---|---|---|---|---|
| TM-01 | Spoofing | attacker authenticates as another wallet | single-use nonce, Ed25519 verification, nonce expiry, hashed HttpOnly session | validator replay tests and independent review |
| TM-02 | Tampering | client forges transaction status/signature | guarded state machine; on-chain program remains authority | indexer must verify signer, program and instruction semantics before projection |
| TM-03 | Tampering | substitute or reuse randomness | owner/queue checks, fresh seed slot, unrevealed value, per-account receipt PDA | external VRF integration audit and adversarial validator test |
| TM-04 | Elevation | forged vault/game/config account | canonical seeds, bumps, `has_one`, signer and owner constraints | independent Anchor account-validation review |
| TM-05 | DoS | settlement withheld or VRF unavailable | permissionless settlement and timeout refund/cancel paths | keeper SLO and validator failure tests |
| TM-06 | Tampering | fee/payout overflow or vault insolvency | checked arithmetic, rent-aware balance, terminal close conditions | property/fuzz test every economic invariant |
| TM-07 | Repudiation | administrator changes economics silently | 24-hour timelock and emitted events | multisig, alerting and deployment runbook |
| TM-08 | Information disclosure | secret appears in browser, log, backup or AI response | server-only variables, log scrubbing, protected backup, AI policy | secret scanner and backup access/restore drill |
| TM-09 | DoS | API or AI resource exhaustion | durable database rate limits, bounded AI/tool calls, request budgets | platform-level WAF limits and load test |
| TM-10 | Spoofing | CSRF or cross-site session use | SameSite=Strict, Secure/HttpOnly cookie, same-origin mutation checks | keep CORS closed and test every mutation route |
| TM-11 | Supply chain | compromised npm/Rust/action dependency | lockfiles, pinned major actions, CI audit | pin actions by commit and enable dependency review/CodeQL |
| TM-12 | Elevation | compromised upgrade/admin key | mainnet disabled and config timelock | hardware-backed multisig; remove single-key authority |
| TM-13 | Compliance | prohibited or self-excluded user prepares play | fail-closed mainnet policy, wallet gate, limits and immutable decisions | licensed KYC/sanctions provider before real value |
| TM-14 | AI abuse | prompt causes signing, secret access or outcome control | read-only tools, no keys/signing, bounded tools, server-side policy | red-team provider/tool changes before release |

## Security invariants

- Only the appropriate PDA vault funds a game and every debit is bounded by its spendable balance.
- Sum of jackpot refunds never exceeds recorded contributions; a settled game cannot refund.
- Coinflip pays at most the two funded wagers less the configured fee.
- Randomness is provider-owned, queue-bound, committed before reveal and consumed once.
- A game is closed only in a terminal state with no spendable liability.
- Authentication proves control of the exact wallet in a fresh, single-use challenge.
- API or indexer state never authorizes an on-chain payout.
- Mainnet transaction preparation fails closed.
- AI and automation routes never hold wallet keys or sign transactions.

## Review triggers

Repeat this analysis after any program instruction/account change, randomness-provider change, authority migration, new token support, mainnet configuration, custody change, new AI tool, hosting/database migration, or critical dependency advisory.
