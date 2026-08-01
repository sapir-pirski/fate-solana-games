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
- Treasury, randomness provider/queue, fees, and wager limits use a 24-hour
  propose/apply timelock; the administrator can cancel a pending update.
- Pausing prevents new wagers and opens while preserving settlement/refund paths.
- Terminal games can be closed only after their vault has no remaining spendable
  lamports. Refunded jackpots additionally require every recorded entry to have
  claimed its refund.
- Players can close idle or completed Daily Case accounts, but never a request
  awaiting randomness.

## Fund lifecycle

Each paid game has a program-derived vault. Transfers into a vault occur only when
the corresponding state transition succeeds. Settlement pays the configured fee
to the recorded treasury and the remainder to the verified winner. If randomness
is not delivered before the timeout, users recover their original wagers through
permissionless refund state transitions. Rent-bearing game and vault accounts can
then be reclaimed only when the game is terminal and no spendable balance or
refund liability remains.

Configuration changes do not take effect immediately. An administrator proposes
the complete replacement configuration, waits `CONFIG_TIMELOCK_SECONDS`, and then
any caller may apply it. New proposals replace older pending proposals and every
proposal, application, or cancellation emits an on-chain event.

## Randomness boundary

Randomness uses Switchboard On-Demand's Solana commit/reveal accounts. The
configured provider program and queue are timelocked. Every game binds one
provider-owned randomness account before reveal and records its seed slot. A
permanent `RandomnessReceipt` PDA makes that commitment account single-use across
all FATE games.

At commitment, the program verifies the provider owner, account discriminator,
configured queue, an unrevealed value, and the strict `seed_slot == clock.slot - 1`
freshness rule. At settlement, it requires the same account and seed slot and calls
`RandomnessAccountData::get_value(clock.slot)`. Consequently, the provider reveal
and permissionless FATE settlement instruction must be composed in the same
transaction. The raw value, account, seed slot, reveal slot, and deterministic
outcome are stored on-chain and emitted in settlement events.

Provider liveness is not assumed: the existing ten-minute timeout paths return
paid wagers or clear a free Daily Case request. Before mainnet, pin the audited
provider deployment and queue for that cluster, run validator-level adversarial
transaction tests, and obtain an independent program audit.

The `/verify` browser page reads both accounts directly from the configured Solana
RPC, checks provider ownership and queue binding, compares slots and random bytes,
and independently reproduces the winner/reward without using the FATE API.

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
