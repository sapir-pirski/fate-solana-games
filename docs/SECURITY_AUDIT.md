# Internal security review

Review date: 2026-08-01  
Reviewed revision: update this field to the immutable external-audit commit after remediation.  
Conclusion: suitable only for devnet engineering use; not approved for real-value custody or mainnet.

## Work performed

- Manual review of Anchor account constraints, PDA derivation, vault transfers, fees, refunds, timeouts, closing, admin transfer/timelock and randomness binding.
- Manual review of wallet challenge/session handling, mutation-origin checks, transaction state recovery, rate limits, queues/leases, compliance gates, AI boundaries, internal automation and backups.
- Existing build and 34 policy/security tests executed successfully before this review.
- Security CI added for npm advisory checks, CodeQL, Rust formatting, Clippy, tests and `cargo audit`.
- Local advisory and Rust tool execution could not be independently repeated in this environment: registry DNS was unavailable and the Rust toolchain is not installed. CI is the required evidence source for those checks.

## Findings

### FATE-SEC-001 — Independent program audit absent (High, open)

No qualified external Solana auditor has reviewed an immutable release commit. Internal review cannot satisfy independence. Keep mainnet disabled, obtain at least one independent review, remediate all critical/high findings and request a written retest.

### FATE-SEC-002 — Deployed authorities not yet proven as multisig (High, partially remediated)

The program now separates configuration and pause authorities, restricts the pause role, delays both rotations, and provides a strict authority-manifest verifier and Squads runbook. Repository evidence still cannot prove that deployed program upgrade, configuration, pause and treasury authorities are hardware-backed multisigs. Execute and independently verify the migration, test recovery and record addresses in the release attestation.

### FATE-SEC-003 — Full validator adversarial/economic fuzz suite incomplete (High, open)

Source-policy and Rust unit tests cover important invariants, but they do not replace transaction-level tests against a local validator with malicious account substitutions, concurrency, CPI failure and randomized action sequences. Add LiteSVM/ProgramTest or Anchor validator tests and property-based economic state-machine tests before external audit.

### FATE-SEC-004 — Client-reported transaction signature is weakly bound (Medium, open)

The backend confirms that a supplied signature landed, but its transaction-operation record does not yet prove that the transaction invokes the configured FATE program, contains the expected instruction/accounts/amount, and is signed by the authenticated wallet. This cannot move on-chain funds because the program is authoritative, but it can poison off-chain status/history. Reconcile only parsed finalized program events and mark unmatched client reports invalid.

### FATE-SEC-005 — Backup restore drill is not automated (Medium, open)

Daily protected JSON export exists, but no disposable-database restore and record-count/hash verification is enforced in CI. Add a versioned restore utility and monthly recovery drill before relying on the backup for recovery.

### FATE-SEC-006 — GitHub scheduled operations not activated (Medium, open)

The production operations workflow is committed, but the local GitHub identity was expired during configuration, so repository-secret installation and observed scheduled runs are not evidenced. Reauthenticate, set `FATE_AUTOMATION_TOKEN`, run the workflow manually and retain the successful run.

### FATE-SEC-007 — Provider and legal controls are devnet demonstrations (High for mainnet, accepted for devnet)

Age/jurisdiction controls are attestations and sanctions screening is not production-grade. The server blocks mainnet. Do not weaken this gate until licensed providers and jurisdictional approval exist.

## Positive observations

- Canonical PDA seeds/bumps, `has_one` relations and signer constraints are consistently used on custody paths.
- Checked arithmetic, rent-aware spendable balances and explicit insolvency errors protect transfers.
- Jackpot, coinflip and daily-case randomness is owner/queue/freshness bound and replay protected by a receipt PDA.
- Permissionless settlement and explicit timeout refund/cancel paths reduce operator availability risk.
- Economic/VRF changes are timelocked and observable; admin transfer is two-step.
- Wallet challenges are expiring and single use; sessions are random, hashed, Secure/HttpOnly and SameSite=Strict in production.
- Mainnet preparation fails closed, AI is read-only/non-signing and internal operations require a separate secret.

## Release decision

Critical findings: 0. High open launch blockers: 4. Medium open: 3. The current deployment may remain a devnet demonstration. Mainnet, real-value deposits and claims of being independently audited are prohibited until FATE-SEC-001 through FATE-SEC-003 and FATE-SEC-007 are closed, all external critical/high findings are remediated, and a retest letter is issued.
