# FATE Solana program

This Anchor program implements the on-chain custody and settlement state machines
for Jackpot, Coinflip, and Daily Case.

## Implemented invariants

- Wagers transfer into program-owned PDA vaults.
- Jackpot selection is weighted by deposited lamports.
- Coinflip requires two distinct players with equal wagers.
- Daily Case cooldown is enforced by the on-chain clock.
- Checked arithmetic protects wagers, fees, payouts, and refunds.
- A game can settle only once.
- Incorrect winner and treasury accounts are rejected.
- Timed-out Jackpot and Coinflip games have permissionless refund paths.
- Timed-out Daily Case requests can be cleared by the player.
- Administration uses a two-step authority transfer and emits configuration events.
- Pausing prevents new wagers and opens while preserving settlement/refund paths.

## Randomness boundary

The current development interface accepts randomness from a configured signing
authority and records the full result in program state and settlement events. This
is deterministic and auditable after settlement, but it is **not production VRF**:
the authority could choose bytes or withhold an unfavorable result. Timeout paths
prevent fund loss but cannot prevent denial of service.

Before real-value deployment, replace `verify_randomness_authority` and raw byte
arguments with a pinned, audited Solana randomness-provider adapter that validates
provider-owned request accounts, request identity, fulfillment status, and freshness.
Do not enable mainnet wagers with the development randomness interface.

## Local verification

The repository pins Anchor 1.0.2. Its resolved Solana dependencies require Rust
1.89 or newer for host tests:

```sh
docker run --rm \
  -e CARGO_TARGET_DIR=/tmp/fate-target \
  -v "$PWD:/work" -w /work \
  rust:1.89-bookworm cargo test --workspace
```

Full transaction tests additionally require the Solana CLI, Anchor CLI, a local
validator, and a generated `.anchor/deployer.json` keypair. Never reuse production
wallet or upgrade-authority keys in local tests.
