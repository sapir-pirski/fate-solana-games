# Multisig and signing-key separation runbook

FATE supports multisig administration by assigning each privileged Solana role to a distinct Squads vault PDA. The program accepts a signer pubkey; a Squads vault becomes that signer only through an approved multisig execution. The application, AI, database, Sites runtime, GitHub Actions and indexer never receive member seed phrases or private keys.

## Required role topology

| Role | Recommended control | Capability |
|---|---|---|
| Program upgrade authority | dedicated 3-of-5 Squads vault | program upgrades only |
| Configuration authority (`Config.admin`) | separate 3-of-5 Squads vault | propose economics/VRF/treasury changes, cancel proposals, unpause |
| Pause authority | separate 2-of-3 or 3-of-5 Squads vault | pause only; cannot unpause, withdraw, upgrade or change economics |
| Treasury | separate treasury vault | receive fees only; no program administration |
| Deployment identity | short-lived non-custodial identity | build/deploy preparation; never approve or sign privileged instructions |

No address may hold more than one role. Human members use hardware wallets, are geographically/organizationally separated, and never enter recovery material into a browser-hosted application. At least one recovery member is offline.

## Provisioning

1. Create the three Squads multisigs and treasury under reviewed organizational ownership. Record member public keys, threshold and recovery contacts offline.
2. Copy `config/authorities.example.json` to an untracked release manifest, replace every placeholder, and run `node scripts/verify-authority-separation.mjs <manifest>`.
3. Initialize a new devnet config with the configuration vault as `admin`, the separate pause vault as `pause_authority`, and the treasury vault as `treasury`.
4. Transfer the BPF upgrade authority with the Solana CLI to the upgrade vault using a Squads-approved transaction. Verify `solana program show <PROGRAM_ID>` independently from two RPC providers.
5. Submit every privileged instruction as a Squads proposal. CI may construct or simulate an unsigned transaction, but must never possess enough signing authority to approve it.
6. After the 24-hour on-chain delay, execute configuration or authority acceptance through the relevant multisig. Compare emitted events and account state to the proposal before execution.

## Emergency behavior

The pause authority may set `paused=true`. Only the configuration multisig may set `paused=false`; therefore a compromised emergency key cannot restart play. Pausing does not block settlement or refund paths. Alert on every `PauseChanged`, `AuthorityTransferProposed`, `AuthorityTransferAccepted`, configuration event, program upgrade and treasury movement.

For a compromised member: pause if user funds may be affected, remove/replace the member through the multisig policy, rotate any affected role to a fresh vault through the on-chain delayed transfer, verify authorities from independent RPCs, and publish an incident record. Never lower a threshold merely to recover convenience.

## Release evidence

The release attestation must contain the immutable program commit/hash, program-data address, all five distinct role addresses, multisig thresholds/member count (not private identities), executed proposal IDs, simulation logs, timelock timestamps, independent RPC verification and auditor sign-off. Mainnet remains blocked until this evidence exists and the external auditor retests the final authority topology.
