# Security policy

FATE is currently a devnet implementation and is not approved to custody real-value funds.

Report vulnerabilities privately to the repository owner. Do not include seed phrases, private keys, wallet signatures, or exploitable production details in public issues.

Before mainnet launch, require:

- an independent Solana program audit and remediation pass;
- a legal review for every intended jurisdiction;
- production VRF integration and failure-mode testing;
- multisig-controlled administration and treasury accounts;
- deployment verification, reproducible builds, monitoring, and an incident runbook;
- load, economic-invariant, fuzz, and adversarial integration tests.

The program includes wager bounds, checked arithmetic, program-owned escrow vaults, timeout refunds, a pause switch, and two-step admin transfer. These controls reduce risk but do not replace an audit.

