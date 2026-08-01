# Independent audit package

The auditor must receive an immutable Git commit, reproducible build instructions, program ID/deployment attestation, IDL, account/instruction matrix, threat model, test output and every prior finding. The review must cover the Anchor program and the backend/indexer trust boundary; it must not rely on this internal report as assurance.

Required program work: account substitution and signer/owner checks; PDA collisions; initialization/reinitialization; vault solvency; fee/payout/refund invariants; concurrent transactions; randomness ownership, commitment, replay and selective-abort behavior; timeout liveness; close/revival behavior; admin/upgrade authority; CPI/sysvar misuse; arithmetic and compute/account-size denial of service.

Required backend work: wallet signature/session replay; CSRF/origin policy; IDOR; client-signature semantic validation; RPC/indexer reorg and finality; queue/lease races; rate-limit bypass; SQL/query safety; backup access; secret/log leakage; AI prompt/tool boundaries; CI and deployment provenance.

Deliverables must include severity methodology, proof or reproducible test for each finding, affected commit, remediation guidance, final retest status and explicit unresolved risks. The project will publish the report or a disclosure-approved version and the exact audited commit before any mainnet decision.
