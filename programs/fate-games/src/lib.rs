#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use switchboard_on_demand::accounts::RandomnessAccountData;

declare_id!("Fg6PaFpoGXkYsidMpWxqSWY4vF8zqRkMnJx9QpMvdWvZ");

const CONFIG_SEED: &[u8] = b"config";
const JACKPOT_SEED: &[u8] = b"jackpot";
const JACKPOT_VAULT_SEED: &[u8] = b"jackpot-vault";
const COINFLIP_SEED: &[u8] = b"coinflip";
const COINFLIP_VAULT_SEED: &[u8] = b"coinflip-vault";
const DAILY_SEED: &[u8] = b"daily";
const DAILY_VAULT_SEED: &[u8] = b"daily-vault";
const RANDOMNESS_RECEIPT_SEED: &[u8] = b"randomness-use";
const MAX_JACKPOT_ENTRIES: usize = 128;
const BPS_DENOMINATOR: u64 = 10_000;
const RANDOMNESS_TIMEOUT_SECONDS: i64 = 600;
const DAILY_COOLDOWN_SECONDS: i64 = 86_400;
const CONFIG_TIMELOCK_SECONDS: i64 = 86_400;

#[program]
pub mod fate_games {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        randomness_program: Pubkey,
        randomness_queue: Pubkey,
        treasury: Pubkey,
        pause_authority: Pubkey,
        fee_bps: u16,
        min_wager: u64,
        max_wager: u64,
    ) -> Result<()> {
        require!(
            randomness_program != Pubkey::default()
                && randomness_queue != Pubkey::default()
                && treasury != Pubkey::default()
                && pause_authority != Pubkey::default()
                && pause_authority != treasury,
            FateError::InvalidAuthority
        );
        require!(fee_bps <= 1_000, FateError::FeeTooHigh);
        require!(
            min_wager > 0 && max_wager >= min_wager,
            FateError::InvalidWagerLimits
        );
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.pending_admin_effective_at = 0;
        config.pause_authority = pause_authority;
        config.pending_pause_authority = Pubkey::default();
        config.pending_pause_effective_at = 0;
        config.randomness_program = randomness_program;
        config.randomness_queue = randomness_queue;
        config.treasury = treasury;
        config.pending_randomness_program = Pubkey::default();
        config.pending_randomness_queue = Pubkey::default();
        config.pending_treasury = Pubkey::default();
        config.fee_bps = fee_bps;
        config.pending_fee_bps = 0;
        config.min_wager = min_wager;
        config.max_wager = max_wager;
        config.pending_min_wager = 0;
        config.pending_max_wager = 0;
        config.pending_config_effective_at = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            admin: config.admin,
            randomness_program,
            randomness_queue,
            treasury,
            pause_authority,
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AuthorityConfig>, paused: bool) -> Result<()> {
        let expected = if paused {
            ctx.accounts.config.pause_authority
        } else {
            ctx.accounts.config.admin
        };
        require_keys_eq!(
            ctx.accounts.authority.key(),
            expected,
            FateError::InvalidAuthority
        );
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged {
            authority: ctx.accounts.authority.key(),
            paused,
        });
        Ok(())
    }

    pub fn propose_config_update(
        ctx: Context<AdminConfig>,
        randomness_program: Pubkey,
        randomness_queue: Pubkey,
        treasury: Pubkey,
        fee_bps: u16,
        min_wager: u64,
        max_wager: u64,
    ) -> Result<()> {
        require!(
            randomness_program != Pubkey::default()
                && randomness_queue != Pubkey::default()
                && treasury != Pubkey::default(),
            FateError::InvalidAuthority
        );
        require!(fee_bps <= 1_000, FateError::FeeTooHigh);
        require!(
            min_wager > 0 && max_wager >= min_wager,
            FateError::InvalidWagerLimits
        );
        let effective_at = Clock::get()?
            .unix_timestamp
            .checked_add(CONFIG_TIMELOCK_SECONDS)
            .ok_or(FateError::ArithmeticOverflow)?;
        let config = &mut ctx.accounts.config;
        config.pending_randomness_program = randomness_program;
        config.pending_randomness_queue = randomness_queue;
        config.pending_treasury = treasury;
        config.pending_fee_bps = fee_bps;
        config.pending_min_wager = min_wager;
        config.pending_max_wager = max_wager;
        config.pending_config_effective_at = effective_at;
        emit!(ConfigUpdateProposed {
            admin: config.admin,
            randomness_program,
            randomness_queue,
            treasury,
            fee_bps,
            min_wager,
            max_wager,
            effective_at,
        });
        Ok(())
    }

    pub fn apply_config_update(ctx: Context<ApplyConfigUpdate>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_config_effective_at > 0,
            FateError::NoPendingConfigUpdate
        );
        require!(
            Clock::get()?.unix_timestamp >= config.pending_config_effective_at,
            FateError::ConfigTimelockActive
        );
        let previous_randomness_program = config.randomness_program;
        let previous_randomness_queue = config.randomness_queue;
        let previous_treasury = config.treasury;
        config.randomness_program = config.pending_randomness_program;
        config.randomness_queue = config.pending_randomness_queue;
        config.treasury = config.pending_treasury;
        config.fee_bps = config.pending_fee_bps;
        config.min_wager = config.pending_min_wager;
        config.max_wager = config.pending_max_wager;
        clear_pending_config(config);
        emit!(ConfigUpdated {
            admin: config.admin,
            previous_randomness_program,
            randomness_program: config.randomness_program,
            previous_randomness_queue,
            randomness_queue: config.randomness_queue,
            previous_treasury,
            treasury: config.treasury,
            fee_bps: config.fee_bps,
            min_wager: config.min_wager,
            max_wager: config.max_wager,
        });
        Ok(())
    }

    pub fn cancel_config_update(ctx: Context<AdminConfig>) -> Result<()> {
        require!(
            ctx.accounts.config.pending_config_effective_at > 0,
            FateError::NoPendingConfigUpdate
        );
        clear_pending_config(&mut ctx.accounts.config);
        emit!(ConfigUpdateCancelled {
            admin: ctx.accounts.admin.key(),
        });
        Ok(())
    }

    pub fn propose_admin(ctx: Context<AdminConfig>, pending_admin: Pubkey) -> Result<()> {
        require!(
            pending_admin != Pubkey::default(),
            FateError::InvalidAuthority
        );
        let config = &mut ctx.accounts.config;
        config.pending_admin = pending_admin;
        config.pending_admin_effective_at = Clock::get()?
            .unix_timestamp
            .checked_add(CONFIG_TIMELOCK_SECONDS)
            .ok_or(FateError::ArithmeticOverflow)?;
        emit!(AuthorityTransferProposed {
            role: AuthorityRole::Config,
            current_authority: config.admin,
            pending_authority: pending_admin,
            effective_at: config.pending_admin_effective_at,
        });
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_eq!(
            config.pending_admin,
            ctx.accounts.pending_admin.key(),
            FateError::InvalidAuthority
        );
        require!(
            config.pending_admin_effective_at > 0
                && Clock::get()?.unix_timestamp >= config.pending_admin_effective_at,
            FateError::AuthorityTimelockActive
        );
        let previous_authority = config.admin;
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
        config.pending_admin_effective_at = 0;
        emit!(AuthorityTransferAccepted {
            role: AuthorityRole::Config,
            previous_authority,
            authority: config.admin,
        });
        Ok(())
    }

    pub fn propose_pause_authority(
        ctx: Context<AdminConfig>,
        pending_authority: Pubkey,
    ) -> Result<()> {
        require!(
            pending_authority != Pubkey::default()
                && pending_authority != ctx.accounts.config.treasury,
            FateError::InvalidAuthority
        );
        let config = &mut ctx.accounts.config;
        config.pending_pause_authority = pending_authority;
        config.pending_pause_effective_at = Clock::get()?
            .unix_timestamp
            .checked_add(CONFIG_TIMELOCK_SECONDS)
            .ok_or(FateError::ArithmeticOverflow)?;
        emit!(AuthorityTransferProposed {
            role: AuthorityRole::Pause,
            current_authority: config.pause_authority,
            pending_authority,
            effective_at: config.pending_pause_effective_at,
        });
        Ok(())
    }

    pub fn accept_pause_authority(ctx: Context<AcceptPauseAuthority>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_eq!(
            config.pending_pause_authority,
            ctx.accounts.pending_pause_authority.key(),
            FateError::InvalidAuthority
        );
        require!(
            config.pending_pause_effective_at > 0
                && Clock::get()?.unix_timestamp >= config.pending_pause_effective_at,
            FateError::AuthorityTimelockActive
        );
        let previous_authority = config.pause_authority;
        config.pause_authority = config.pending_pause_authority;
        config.pending_pause_authority = Pubkey::default();
        config.pending_pause_effective_at = 0;
        emit!(AuthorityTransferAccepted {
            role: AuthorityRole::Pause,
            previous_authority,
            authority: config.pause_authority,
        });
        Ok(())
    }

    pub fn create_jackpot(ctx: Context<CreateJackpot>, round_id: u64, end_ts: i64) -> Result<()> {
        assert_live(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        require!(end_ts > now, FateError::InvalidEndTime);
        let round = &mut ctx.accounts.round;
        round.id = round_id;
        round.creator = ctx.accounts.creator.key();
        round.state = GameState::Open;
        round.end_ts = end_ts;
        round.randomness_requested_at = 0;
        round.total_lamports = 0;
        round.randomness = [0; 32];
        round.randomness_account = Pubkey::default();
        round.randomness_seed_slot = 0;
        round.randomness_reveal_slot = 0;
        round.winner = Pubkey::default();
        round.entries = Vec::new();
        round.refund_claimed = Vec::new();
        round.bump = ctx.bumps.round;
        ctx.accounts.vault.round = round.key();
        ctx.accounts.vault.bump = ctx.bumps.vault;
        emit!(JackpotCreated {
            round: round.key(),
            round_id,
            end_ts
        });
        Ok(())
    }

    pub fn enter_jackpot(ctx: Context<EnterJackpot>, amount: u64) -> Result<()> {
        assert_live(&ctx.accounts.config)?;
        assert_wager(&ctx.accounts.config, amount)?;
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.round;
        require!(round.state == GameState::Open, FateError::InvalidGameState);
        require!(now < round.end_ts, FateError::RoundClosed);
        require!(
            round.entries.len() < MAX_JACKPOT_ENTRIES,
            FateError::RoundFull
        );
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        round.total_lamports = round
            .total_lamports
            .checked_add(amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        round.entries.push(JackpotEntry {
            player: ctx.accounts.player.key(),
            amount,
        });
        emit!(JackpotEntered {
            round: round.key(),
            player: ctx.accounts.player.key(),
            amount,
            total: round.total_lamports
        });
        Ok(())
    }

    pub fn request_jackpot_randomness(ctx: Context<RequestJackpotRandomness>) -> Result<()> {
        let clock = Clock::get()?;
        let now = Clock::get()?.unix_timestamp;
        let game_key = ctx.accounts.round.key();
        let seed_slot = bind_randomness(
            &ctx.accounts.config,
            &ctx.accounts.randomness_account.to_account_info(),
            &mut ctx.accounts.randomness_receipt,
            game_key,
            GameType::Jackpot,
            ctx.accounts.payer.key(),
            clock.slot,
            ctx.bumps.randomness_receipt,
        )?;
        let round = &mut ctx.accounts.round;
        require!(round.state == GameState::Open, FateError::InvalidGameState);
        require!(now >= round.end_ts, FateError::RoundStillOpen);
        require!(round.total_lamports > 0, FateError::EmptyGame);
        round.state = GameState::RandomnessRequested;
        round.randomness_requested_at = now;
        round.randomness_account = ctx.accounts.randomness_account.key();
        round.randomness_seed_slot = seed_slot;
        round.randomness_reveal_slot = 0;
        emit!(RandomnessRequested {
            game: round.key(),
            game_type: GameType::Jackpot,
            randomness_account: round.randomness_account,
            seed_slot,
        });
        Ok(())
    }

    pub fn settle_jackpot(ctx: Context<SettleJackpot>) -> Result<()> {
        let (randomness, reveal_slot) = read_revealed_randomness(
            &ctx.accounts.config,
            &ctx.accounts.randomness_account.to_account_info(),
            ctx.accounts.round.randomness_account,
            ctx.accounts.round.randomness_seed_slot,
            Clock::get()?.slot,
        )?;
        let round = &mut ctx.accounts.round;
        require!(
            round.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        let selected = weighted_winner(&round.entries, round.total_lamports, &randomness)?;
        require_keys_eq!(
            selected,
            ctx.accounts.winner.key(),
            FateError::WrongWinnerAccount
        );
        require_keys_eq!(
            ctx.accounts.config.treasury,
            ctx.accounts.treasury.key(),
            FateError::WrongTreasury
        );
        let fee = calculate_fee(round.total_lamports, ctx.accounts.config.fee_bps)?;
        let payout = round
            .total_lamports
            .checked_sub(fee)
            .ok_or(FateError::ArithmeticOverflow)?;
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            payout,
        )?;
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            fee,
        )?;
        round.state = GameState::Settled;
        round.randomness = randomness;
        round.randomness_reveal_slot = reveal_slot;
        round.winner = selected;
        emit!(GameSettled {
            game: round.key(),
            game_type: GameType::Jackpot,
            winner: selected,
            wager: round.total_lamports,
            payout,
            fee,
            randomness,
            randomness_account: round.randomness_account,
            seed_slot: round.randomness_seed_slot,
            reveal_slot,
        });
        emit!(RandomnessReceiptClosed {
            receipt: ctx.accounts.randomness_receipt.key(),
            game: round.key(),
            randomness_account: ctx.accounts.randomness_receipt.randomness_account,
            rent_recipient: ctx.accounts.rent_payer.key(),
        });
        Ok(())
    }

    pub fn enable_jackpot_refunds(ctx: Context<EnableJackpotRefunds>) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= round.randomness_requested_at + RANDOMNESS_TIMEOUT_SECONDS,
            FateError::RandomnessNotTimedOut
        );
        round.state = GameState::Refunded;
        emit!(JackpotRefundsEnabled { game: round.key() });
        emit!(RandomnessReceiptClosed {
            receipt: ctx.accounts.randomness_receipt.key(),
            game: round.key(),
            randomness_account: ctx.accounts.randomness_receipt.randomness_account,
            rent_recipient: ctx.accounts.rent_payer.key(),
        });
        Ok(())
    }

    pub fn claim_jackpot_refund(ctx: Context<ClaimJackpotRefund>) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(
            round.state == GameState::Refunded,
            FateError::InvalidGameState
        );
        let player = ctx.accounts.player.key();
        require!(
            !round.refund_claimed.contains(&player),
            FateError::RefundAlreadyClaimed
        );
        let amount = round
            .entries
            .iter()
            .filter(|entry| entry.player == player)
            .try_fold(0u64, |sum, entry| {
                sum.checked_add(entry.amount)
                    .ok_or(FateError::ArithmeticOverflow)
            })?;
        require!(amount > 0, FateError::NoRefundAvailable);
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            amount,
        )?;
        round.refund_claimed.push(player);
        emit!(GameRefunded {
            game: round.key(),
            player,
            amount
        });
        Ok(())
    }

    pub fn close_jackpot(ctx: Context<CloseJackpot>) -> Result<()> {
        let round = &ctx.accounts.round;
        require!(is_terminal(round.state), FateError::GameNotTerminal);
        if round.state == GameState::Refunded {
            require!(
                round
                    .entries
                    .iter()
                    .all(|entry| round.refund_claimed.contains(&entry.player)),
                FateError::OutstandingLiabilities
            );
        }
        require!(
            vault_available(&ctx.accounts.vault.to_account_info(), JackpotVault::SPACE)? == 0,
            FateError::OutstandingLiabilities
        );
        emit!(GameAccountsClosed {
            game: round.key(),
            game_type: GameType::Jackpot,
            rent_recipient: ctx.accounts.creator.key(),
        });
        Ok(())
    }

    pub fn create_coinflip(
        ctx: Context<CreateCoinflip>,
        game_id: u64,
        side: CoinSide,
        amount: u64,
        expires_at: i64,
    ) -> Result<()> {
        assert_live(&ctx.accounts.config)?;
        assert_wager(&ctx.accounts.config, amount)?;
        let now = Clock::get()?.unix_timestamp;
        require!(expires_at > now, FateError::InvalidEndTime);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;
        let game = &mut ctx.accounts.game;
        game.id = game_id;
        game.creator = ctx.accounts.creator.key();
        game.joiner = Pubkey::default();
        game.creator_side = side;
        game.amount = amount;
        game.state = GameState::Open;
        game.expires_at = expires_at;
        game.randomness_requested_at = 0;
        game.randomness = [0; 32];
        game.randomness_account = Pubkey::default();
        game.randomness_seed_slot = 0;
        game.randomness_reveal_slot = 0;
        game.winner = Pubkey::default();
        game.bump = ctx.bumps.game;
        ctx.accounts.vault.game = game.key();
        ctx.accounts.vault.bump = ctx.bumps.vault;
        emit!(CoinflipCreated {
            game: game.key(),
            creator: game.creator,
            amount,
            side
        });
        Ok(())
    }

    pub fn join_coinflip(ctx: Context<JoinCoinflip>) -> Result<()> {
        assert_live(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let game_key = ctx.accounts.game.key();
        let seed_slot = bind_randomness(
            &ctx.accounts.config,
            &ctx.accounts.randomness_account.to_account_info(),
            &mut ctx.accounts.randomness_receipt,
            game_key,
            GameType::Coinflip,
            ctx.accounts.joiner.key(),
            Clock::get()?.slot,
            ctx.bumps.randomness_receipt,
        )?;
        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Open, FateError::InvalidGameState);
        require!(now < game.expires_at, FateError::GameExpired);
        require!(
            ctx.accounts.joiner.key() != game.creator,
            FateError::SelfJoin
        );
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.joiner.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            game.amount,
        )?;
        game.joiner = ctx.accounts.joiner.key();
        game.state = GameState::RandomnessRequested;
        game.randomness_requested_at = now;
        game.randomness_account = ctx.accounts.randomness_account.key();
        game.randomness_seed_slot = seed_slot;
        game.randomness_reveal_slot = 0;
        emit!(CoinflipJoined {
            game: game.key(),
            joiner: game.joiner
        });
        emit!(RandomnessRequested {
            game: game.key(),
            game_type: GameType::Coinflip,
            randomness_account: game.randomness_account,
            seed_slot,
        });
        Ok(())
    }

    pub fn settle_coinflip(ctx: Context<SettleCoinflip>) -> Result<()> {
        let (randomness, reveal_slot) = read_revealed_randomness(
            &ctx.accounts.config,
            &ctx.accounts.randomness_account.to_account_info(),
            ctx.accounts.game.randomness_account,
            ctx.accounts.game.randomness_seed_slot,
            Clock::get()?.slot,
        )?;
        let game = &mut ctx.accounts.game;
        require!(
            game.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        require_keys_eq!(
            ctx.accounts.config.treasury,
            ctx.accounts.treasury.key(),
            FateError::WrongTreasury
        );
        let landed = if randomness[0] & 1 == 0 {
            CoinSide::Heads
        } else {
            CoinSide::Tails
        };
        let winner = if landed == game.creator_side {
            game.creator
        } else {
            game.joiner
        };
        require_keys_eq!(
            winner,
            ctx.accounts.winner.key(),
            FateError::WrongWinnerAccount
        );
        let pot = game
            .amount
            .checked_mul(2)
            .ok_or(FateError::ArithmeticOverflow)?;
        let fee = calculate_fee(pot, ctx.accounts.config.fee_bps)?;
        let payout = pot.checked_sub(fee).ok_or(FateError::ArithmeticOverflow)?;
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            payout,
        )?;
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            fee,
        )?;
        game.state = GameState::Settled;
        game.randomness = randomness;
        game.randomness_reveal_slot = reveal_slot;
        game.winner = winner;
        emit!(GameSettled {
            game: game.key(),
            game_type: GameType::Coinflip,
            winner,
            wager: pot,
            payout,
            fee,
            randomness,
            randomness_account: game.randomness_account,
            seed_slot: game.randomness_seed_slot,
            reveal_slot,
        });
        emit!(RandomnessReceiptClosed {
            receipt: ctx.accounts.randomness_receipt.key(),
            game: game.key(),
            randomness_account: ctx.accounts.randomness_receipt.randomness_account,
            rent_recipient: ctx.accounts.rent_payer.key(),
        });
        Ok(())
    }

    pub fn cancel_coinflip(ctx: Context<CancelCoinflip>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(game.state == GameState::Open, FateError::InvalidGameState);
        require!(
            Clock::get()?.unix_timestamp >= game.expires_at,
            FateError::GameNotExpired
        );
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            game.amount,
        )?;
        game.state = GameState::Refunded;
        emit!(GameRefunded {
            game: game.key(),
            player: game.creator,
            amount: game.amount
        });
        Ok(())
    }

    pub fn refund_coinflip_timeout(ctx: Context<RefundCoinflipTimeout>) -> Result<()> {
        let game = &mut ctx.accounts.game;
        require!(
            game.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        let unlock_at = game
            .randomness_requested_at
            .checked_add(RANDOMNESS_TIMEOUT_SECONDS)
            .ok_or(FateError::ArithmeticOverflow)?;
        require!(
            Clock::get()?.unix_timestamp >= unlock_at,
            FateError::RandomnessNotTimedOut
        );
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.creator.to_account_info(),
            game.amount,
        )?;
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.joiner.to_account_info(),
            game.amount,
        )?;
        game.state = GameState::Refunded;
        emit!(GameRefunded {
            game: game.key(),
            player: game.creator,
            amount: game.amount
        });
        emit!(GameRefunded {
            game: game.key(),
            player: game.joiner,
            amount: game.amount
        });
        emit!(RandomnessReceiptClosed {
            receipt: ctx.accounts.randomness_receipt.key(),
            game: game.key(),
            randomness_account: ctx.accounts.randomness_receipt.randomness_account,
            rent_recipient: ctx.accounts.rent_payer.key(),
        });
        Ok(())
    }

    pub fn close_coinflip(ctx: Context<CloseCoinflip>) -> Result<()> {
        require!(
            is_terminal(ctx.accounts.game.state),
            FateError::GameNotTerminal
        );
        require!(
            vault_available(&ctx.accounts.vault.to_account_info(), CoinflipVault::SPACE)? == 0,
            FateError::OutstandingLiabilities
        );
        emit!(GameAccountsClosed {
            game: ctx.accounts.game.key(),
            game_type: GameType::Coinflip,
            rent_recipient: ctx.accounts.creator.key(),
        });
        Ok(())
    }

    pub fn initialize_daily_player(ctx: Context<InitializeDailyPlayer>) -> Result<()> {
        let daily = &mut ctx.accounts.daily;
        daily.player = ctx.accounts.player.key();
        daily.state = GameState::Settled;
        daily.last_opened_at = 0;
        daily.randomness_requested_at = 0;
        daily.randomness = [0; 32];
        daily.randomness_account = Pubkey::default();
        daily.randomness_seed_slot = 0;
        daily.randomness_reveal_slot = 0;
        daily.reward = 0;
        daily.bump = ctx.bumps.daily;
        Ok(())
    }

    pub fn open_daily_case(ctx: Context<OpenDailyCase>) -> Result<()> {
        assert_live(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
        let game_key = ctx.accounts.daily.key();
        let seed_slot = bind_randomness(
            &ctx.accounts.config,
            &ctx.accounts.randomness_account.to_account_info(),
            &mut ctx.accounts.randomness_receipt,
            game_key,
            GameType::DailyCase,
            ctx.accounts.player.key(),
            Clock::get()?.slot,
            ctx.bumps.randomness_receipt,
        )?;
        let daily = &mut ctx.accounts.daily;
        require!(
            daily.state != GameState::RandomnessRequested,
            FateError::PendingDailyCase
        );
        let eligible_at = daily
            .last_opened_at
            .checked_add(DAILY_COOLDOWN_SECONDS)
            .ok_or(FateError::ArithmeticOverflow)?;
        require!(
            daily.last_opened_at == 0 || now >= eligible_at,
            FateError::DailyCooldown
        );
        daily.state = GameState::RandomnessRequested;
        daily.randomness_requested_at = now;
        daily.randomness_account = ctx.accounts.randomness_account.key();
        daily.randomness_seed_slot = seed_slot;
        daily.randomness_reveal_slot = 0;
        daily.reward = 0;
        emit!(RandomnessRequested {
            game: daily.key(),
            game_type: GameType::DailyCase,
            randomness_account: daily.randomness_account,
            seed_slot,
        });
        Ok(())
    }

    pub fn settle_daily_case(ctx: Context<SettleDailyCase>) -> Result<()> {
        let (randomness, reveal_slot) = read_revealed_randomness(
            &ctx.accounts.config,
            &ctx.accounts.randomness_account.to_account_info(),
            ctx.accounts.daily.randomness_account,
            ctx.accounts.daily.randomness_seed_slot,
            Clock::get()?.slot,
        )?;
        let daily = &mut ctx.accounts.daily;
        require!(
            daily.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        let reward = daily_reward(randomness[0]);
        let available = ctx
            .accounts
            .vault
            .to_account_info()
            .lamports()
            .saturating_sub(Rent::get()?.minimum_balance(DailyVault::SPACE));
        require!(available >= reward, FateError::RewardVaultInsolvent);
        debit_program_vault(
            &ctx.accounts.vault.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            reward,
        )?;
        daily.state = GameState::Settled;
        daily.last_opened_at = Clock::get()?.unix_timestamp;
        daily.randomness = randomness;
        daily.randomness_reveal_slot = reveal_slot;
        daily.reward = reward;
        emit!(DailyCaseSettled {
            account: daily.key(),
            player: daily.player,
            reward,
            randomness,
            randomness_account: daily.randomness_account,
            seed_slot: daily.randomness_seed_slot,
            reveal_slot,
        });
        emit!(RandomnessReceiptClosed {
            receipt: ctx.accounts.randomness_receipt.key(),
            game: daily.key(),
            randomness_account: ctx.accounts.randomness_receipt.randomness_account,
            rent_recipient: ctx.accounts.rent_payer.key(),
        });
        Ok(())
    }

    pub fn cancel_daily_timeout(ctx: Context<CancelDailyTimeout>) -> Result<()> {
        let daily = &mut ctx.accounts.daily;
        require!(
            daily.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        let unlock_at = daily
            .randomness_requested_at
            .checked_add(RANDOMNESS_TIMEOUT_SECONDS)
            .ok_or(FateError::ArithmeticOverflow)?;
        require!(
            Clock::get()?.unix_timestamp >= unlock_at,
            FateError::RandomnessNotTimedOut
        );
        daily.state = GameState::Settled;
        daily.randomness_requested_at = 0;
        daily.randomness = [0; 32];
        daily.reward = 0;
        emit!(DailyCaseTimedOut {
            account: daily.key(),
            player: daily.player,
        });
        emit!(RandomnessReceiptClosed {
            receipt: ctx.accounts.randomness_receipt.key(),
            game: daily.key(),
            randomness_account: ctx.accounts.randomness_receipt.randomness_account,
            rent_recipient: ctx.accounts.rent_payer.key(),
        });
        Ok(())
    }

    pub fn close_daily_player(ctx: Context<CloseDailyPlayer>) -> Result<()> {
        require!(
            ctx.accounts.daily.state != GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        emit!(GameAccountsClosed {
            game: ctx.accounts.daily.key(),
            game_type: GameType::DailyCase,
            rent_recipient: ctx.accounts.player.key(),
        });
        Ok(())
    }

    pub fn initialize_daily_vault(ctx: Context<InitializeDailyVault>) -> Result<()> {
        ctx.accounts.vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn fund_daily_vault(ctx: Context<FundDailyVault>, amount: u64) -> Result<()> {
        require!(amount > 0, FateError::InvalidAmount);
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.funder.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )
    }
}

fn assert_live(config: &Config) -> Result<()> {
    require!(!config.paused, FateError::ProgramPaused);
    Ok(())
}
fn clear_pending_config(config: &mut Config) {
    config.pending_randomness_program = Pubkey::default();
    config.pending_randomness_queue = Pubkey::default();
    config.pending_treasury = Pubkey::default();
    config.pending_fee_bps = 0;
    config.pending_min_wager = 0;
    config.pending_max_wager = 0;
    config.pending_config_effective_at = 0;
}
fn is_terminal(state: GameState) -> bool {
    state == GameState::Settled || state == GameState::Refunded
}
fn vault_available(vault: &AccountInfo, space: usize) -> Result<u64> {
    Ok(vault
        .lamports()
        .saturating_sub(Rent::get()?.minimum_balance(space)))
}
fn assert_wager(config: &Config, amount: u64) -> Result<()> {
    require!(
        amount >= config.min_wager && amount <= config.max_wager,
        FateError::WagerOutOfRange
    );
    Ok(())
}
fn validate_randomness_account(config: &Config, account: &AccountInfo) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        config.randomness_program,
        FateError::InvalidRandomnessProgram
    );
    let data = RandomnessAccountData::parse(account.data.borrow())
        .map_err(|_| error!(FateError::InvalidRandomnessAccount))?;
    require!(
        data.queue.to_bytes() == config.randomness_queue.to_bytes(),
        FateError::InvalidRandomnessQueue
    );
    Ok(())
}

fn bind_randomness(
    config: &Config,
    account: &AccountInfo,
    receipt: &mut Account<RandomnessReceipt>,
    game: Pubkey,
    game_type: GameType,
    rent_payer: Pubkey,
    clock_slot: u64,
    bump: u8,
) -> Result<u64> {
    validate_randomness_account(config, account)?;
    let data = RandomnessAccountData::parse(account.data.borrow())
        .map_err(|_| error!(FateError::InvalidRandomnessAccount))?;
    let expected_seed_slot = clock_slot
        .checked_sub(1)
        .ok_or(FateError::RandomnessNotFresh)?;
    require!(
        data.seed_slot == expected_seed_slot,
        FateError::RandomnessNotFresh
    );
    require!(
        data.reveal_slot == 0 && data.value == [0; 32],
        FateError::RandomnessAlreadyRevealed
    );
    receipt.randomness_account = account.key();
    receipt.game = game;
    receipt.game_type = game_type;
    receipt.rent_payer = rent_payer;
    receipt.seed_slot = data.seed_slot;
    receipt.bump = bump;
    Ok(data.seed_slot)
}

fn read_revealed_randomness(
    config: &Config,
    account: &AccountInfo,
    expected_account: Pubkey,
    expected_seed_slot: u64,
    clock_slot: u64,
) -> Result<([u8; 32], u64)> {
    require_keys_eq!(
        account.key(),
        expected_account,
        FateError::WrongRandomnessAccount
    );
    validate_randomness_account(config, account)?;
    let data = RandomnessAccountData::parse(account.data.borrow())
        .map_err(|_| error!(FateError::InvalidRandomnessAccount))?;
    require!(
        data.seed_slot == expected_seed_slot,
        FateError::RandomnessSeedMismatch
    );
    let value = data
        .get_value(clock_slot)
        .map_err(|_| error!(FateError::RandomnessNotResolved))?;
    require!(value != [0; 32], FateError::InvalidRandomness);
    Ok((value, data.reveal_slot))
}
fn calculate_fee(amount: u64, fee_bps: u16) -> Result<u64> {
    amount
        .checked_mul(fee_bps as u64)
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or_else(|| error!(FateError::ArithmeticOverflow))
}

fn weighted_winner(entries: &[JackpotEntry], total: u64, randomness: &[u8; 32]) -> Result<Pubkey> {
    require!(!entries.is_empty() && total > 0, FateError::EmptyGame);
    let random = u64::from_le_bytes(
        randomness[0..8]
            .try_into()
            .map_err(|_| error!(FateError::InvalidRandomness))?,
    );
    let target = random % total;
    let mut cumulative = 0u64;
    for entry in entries {
        cumulative = cumulative
            .checked_add(entry.amount)
            .ok_or(FateError::ArithmeticOverflow)?;
        if target < cumulative {
            return Ok(entry.player);
        }
    }
    err!(FateError::InvalidRandomness)
}

fn daily_reward(byte: u8) -> u64 {
    match byte {
        0..=1 => 1_000_000_000,
        2..=11 => 250_000_000,
        12..=51 => 100_000_000,
        52..=151 => 50_000_000,
        _ => 10_000_000,
    }
}

fn debit_program_vault(vault: &AccountInfo, recipient: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let vault_balance = vault.lamports();
    let recipient_balance = recipient.lamports();
    **vault.try_borrow_mut_lamports()? = vault_balance
        .checked_sub(amount)
        .ok_or(FateError::VaultInsolvent)?;
    **recipient.try_borrow_mut_lamports()? = recipient_balance
        .checked_add(amount)
        .ok_or(FateError::ArithmeticOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = Config::SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AuthorityConfig<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptPauseAuthority<'info> {
    pub pending_pause_authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct ApplyConfigUpdate<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(round_id: u64)]
pub struct CreateJackpot<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = creator, space = JackpotRound::SPACE, seeds = [JACKPOT_SEED, &round_id.to_le_bytes()], bump)]
    pub round: Account<'info, JackpotRound>,
    #[account(init, payer = creator, space = JackpotVault::SPACE, seeds = [JACKPOT_VAULT_SEED, round.key().as_ref()], bump)]
    pub vault: Account<'info, JackpotVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnterJackpot<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
    #[account(mut, seeds = [JACKPOT_VAULT_SEED, round.key().as_ref()], bump = vault.bump, has_one = round)]
    pub vault: Account<'info, JackpotVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestJackpotRandomness<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
    /// CHECK: Owner, discriminator, queue, commitment, and freshness are verified.
    pub randomness_account: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = RandomnessReceipt::SPACE, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleJackpot<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
    #[account(mut, seeds = [JACKPOT_VAULT_SEED, round.key().as_ref()], bump = vault.bump, has_one = round)]
    pub vault: Account<'info, JackpotVault>,
    /// CHECK: Switchboard account is fully verified by the settlement handler.
    pub randomness_account: UncheckedAccount<'info>,
    #[account(mut, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump = randomness_receipt.bump, has_one = randomness_account, constraint = randomness_receipt.game == round.key() @ FateError::WrongRandomnessAccount, constraint = randomness_receipt.seed_slot == round.randomness_seed_slot @ FateError::RandomnessSeedMismatch, constraint = randomness_receipt.game_type == GameType::Jackpot @ FateError::WrongRandomnessAccount, close = rent_payer)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    /// CHECK: Validated against the deterministic selected winner.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: Validated against configuration.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: Receives only receipt rent and must equal the payer recorded at request time.
    #[account(mut, address = randomness_receipt.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EnableJackpotRefunds<'info> {
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
    /// CHECK: Address is constrained to the randomness account bound to this round.
    #[account(address = round.randomness_account)]
    pub randomness_account: UncheckedAccount<'info>,
    #[account(mut, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump = randomness_receipt.bump, has_one = randomness_account, constraint = randomness_receipt.game == round.key() @ FateError::WrongRandomnessAccount, constraint = randomness_receipt.seed_slot == round.randomness_seed_slot @ FateError::RandomnessSeedMismatch, constraint = randomness_receipt.game_type == GameType::Jackpot @ FateError::WrongRandomnessAccount, close = rent_payer)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    /// CHECK: Receives only receipt rent and must equal the payer recorded at request time.
    #[account(mut, address = randomness_receipt.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimJackpotRefund<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
    #[account(mut, seeds = [JACKPOT_VAULT_SEED, round.key().as_ref()], bump = vault.bump, has_one = round)]
    pub vault: Account<'info, JackpotVault>,
}

#[derive(Accounts)]
pub struct CloseJackpot<'info> {
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump, close = creator)]
    pub round: Account<'info, JackpotRound>,
    #[account(mut, seeds = [JACKPOT_VAULT_SEED, round.key().as_ref()], bump = vault.bump, has_one = round, close = creator)]
    pub vault: Account<'info, JackpotVault>,
    /// CHECK: Receives only rent and is constrained to the recorded creator.
    #[account(mut, address = round.creator)]
    pub creator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateCoinflip<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(init, payer = creator, space = CoinflipGame::SPACE, seeds = [COINFLIP_SEED, &game_id.to_le_bytes()], bump)]
    pub game: Account<'info, CoinflipGame>,
    #[account(init, payer = creator, space = CoinflipVault::SPACE, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump)]
    pub vault: Account<'info, CoinflipVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinCoinflip<'info> {
    #[account(mut)]
    pub joiner: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [COINFLIP_SEED, &game.id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, CoinflipGame>,
    #[account(mut, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump = vault.bump, has_one = game)]
    pub vault: Account<'info, CoinflipVault>,
    /// CHECK: Owner, discriminator, queue, commitment, and freshness are verified.
    pub randomness_account: UncheckedAccount<'info>,
    #[account(init, payer = joiner, space = RandomnessReceipt::SPACE, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleCoinflip<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [COINFLIP_SEED, &game.id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, CoinflipGame>,
    #[account(mut, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump = vault.bump, has_one = game)]
    pub vault: Account<'info, CoinflipVault>,
    /// CHECK: Switchboard account is fully verified by the settlement handler.
    pub randomness_account: UncheckedAccount<'info>,
    #[account(mut, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump = randomness_receipt.bump, has_one = randomness_account, constraint = randomness_receipt.game == game.key() @ FateError::WrongRandomnessAccount, constraint = randomness_receipt.seed_slot == game.randomness_seed_slot @ FateError::RandomnessSeedMismatch, constraint = randomness_receipt.game_type == GameType::Coinflip @ FateError::WrongRandomnessAccount, close = rent_payer)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    /// CHECK: Validated against the deterministic winner.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: Validated against configuration.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: Receives only receipt rent and must equal the payer recorded at join time.
    #[account(mut, address = randomness_receipt.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelCoinflip<'info> {
    #[account(mut, address = game.creator)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [COINFLIP_SEED, &game.id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, CoinflipGame>,
    #[account(mut, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump = vault.bump, has_one = game)]
    pub vault: Account<'info, CoinflipVault>,
}

#[derive(Accounts)]
pub struct RefundCoinflipTimeout<'info> {
    #[account(mut, seeds = [COINFLIP_SEED, &game.id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, CoinflipGame>,
    #[account(mut, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump = vault.bump, has_one = game)]
    pub vault: Account<'info, CoinflipVault>,
    /// CHECK: Address constrained to creator.
    #[account(mut, address = game.creator)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: Address constrained to joiner.
    #[account(mut, address = game.joiner)]
    pub joiner: UncheckedAccount<'info>,
    /// CHECK: Address is constrained to the randomness account bound to this game.
    #[account(address = game.randomness_account)]
    pub randomness_account: UncheckedAccount<'info>,
    #[account(mut, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump = randomness_receipt.bump, has_one = randomness_account, constraint = randomness_receipt.game == game.key() @ FateError::WrongRandomnessAccount, constraint = randomness_receipt.seed_slot == game.randomness_seed_slot @ FateError::RandomnessSeedMismatch, constraint = randomness_receipt.game_type == GameType::Coinflip @ FateError::WrongRandomnessAccount, close = rent_payer)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    /// CHECK: Receives only receipt rent and must equal the payer recorded at join time.
    #[account(mut, address = randomness_receipt.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseCoinflip<'info> {
    #[account(mut, seeds = [COINFLIP_SEED, &game.id.to_le_bytes()], bump = game.bump, close = creator)]
    pub game: Account<'info, CoinflipGame>,
    #[account(mut, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump = vault.bump, has_one = game, close = creator)]
    pub vault: Account<'info, CoinflipVault>,
    /// CHECK: Receives only rent and is constrained to the recorded creator.
    #[account(mut, address = game.creator)]
    pub creator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct InitializeDailyPlayer<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(init, payer = player, space = DailyPlayer::SPACE, seeds = [DAILY_SEED, player.key().as_ref()], bump)]
    pub daily: Account<'info, DailyPlayer>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenDailyCase<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player)]
    pub daily: Account<'info, DailyPlayer>,
    /// CHECK: Owner, discriminator, queue, commitment, and freshness are verified.
    pub randomness_account: UncheckedAccount<'info>,
    #[account(init, payer = player, space = RandomnessReceipt::SPACE, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleDailyCase<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player)]
    pub daily: Account<'info, DailyPlayer>,
    /// CHECK: Switchboard account is fully verified by the settlement handler.
    pub randomness_account: UncheckedAccount<'info>,
    #[account(mut, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump = randomness_receipt.bump, has_one = randomness_account, constraint = randomness_receipt.game == daily.key() @ FateError::WrongRandomnessAccount, constraint = randomness_receipt.seed_slot == daily.randomness_seed_slot @ FateError::RandomnessSeedMismatch, constraint = randomness_receipt.game_type == GameType::DailyCase @ FateError::WrongRandomnessAccount, close = rent_payer)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    /// CHECK: Address constrained through daily.player.
    #[account(mut, address = daily.player)]
    pub player: UncheckedAccount<'info>,
    #[account(mut, seeds = [DAILY_VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, DailyVault>,
    /// CHECK: Receives only receipt rent and must equal the payer recorded when the case opened.
    #[account(mut, address = randomness_receipt.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CancelDailyTimeout<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player)]
    pub daily: Account<'info, DailyPlayer>,
    /// CHECK: Address is constrained to the randomness account bound to this Daily Case.
    #[account(address = daily.randomness_account)]
    pub randomness_account: UncheckedAccount<'info>,
    #[account(mut, seeds = [RANDOMNESS_RECEIPT_SEED, randomness_account.key().as_ref()], bump = randomness_receipt.bump, has_one = randomness_account, constraint = randomness_receipt.game == daily.key() @ FateError::WrongRandomnessAccount, constraint = randomness_receipt.seed_slot == daily.randomness_seed_slot @ FateError::RandomnessSeedMismatch, constraint = randomness_receipt.game_type == GameType::DailyCase @ FateError::WrongRandomnessAccount, close = rent_payer)]
    pub randomness_receipt: Account<'info, RandomnessReceipt>,
    /// CHECK: Receives only receipt rent and must equal the payer recorded when the case opened.
    #[account(mut, address = randomness_receipt.rent_payer)]
    pub rent_payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseDailyPlayer<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player, close = player)]
    pub daily: Account<'info, DailyPlayer>,
}

#[derive(Accounts)]
pub struct InitializeDailyVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(init, payer = admin, space = DailyVault::SPACE, seeds = [DAILY_VAULT_SEED], bump)]
    pub vault: Account<'info, DailyVault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundDailyVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut, seeds = [DAILY_VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, DailyVault>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub pending_admin_effective_at: i64,
    pub pause_authority: Pubkey,
    pub pending_pause_authority: Pubkey,
    pub pending_pause_effective_at: i64,
    pub randomness_program: Pubkey,
    pub randomness_queue: Pubkey,
    pub treasury: Pubkey,
    pub pending_randomness_program: Pubkey,
    pub pending_randomness_queue: Pubkey,
    pub pending_treasury: Pubkey,
    pub fee_bps: u16,
    pub pending_fee_bps: u16,
    pub min_wager: u64,
    pub max_wager: u64,
    pub pending_min_wager: u64,
    pub pending_max_wager: u64,
    pub pending_config_effective_at: i64,
    pub paused: bool,
    pub bump: u8,
}
impl Config {
    pub const SPACE: usize = 8 + 32 * 10 + 2 + 2 + 8 * 7 + 1 + 1;
}

#[account]
pub struct JackpotRound {
    pub id: u64,
    pub creator: Pubkey,
    pub state: GameState,
    pub end_ts: i64,
    pub randomness_requested_at: i64,
    pub total_lamports: u64,
    pub randomness: [u8; 32],
    pub randomness_account: Pubkey,
    pub randomness_seed_slot: u64,
    pub randomness_reveal_slot: u64,
    pub winner: Pubkey,
    pub entries: Vec<JackpotEntry>,
    pub refund_claimed: Vec<Pubkey>,
    pub bump: u8,
}
impl JackpotRound {
    pub const SPACE: usize = 8
        + 8
        + 32
        + 1
        + 8
        + 8
        + 8
        + 32
        + 32
        + 8
        + 8
        + 32
        + 4
        + MAX_JACKPOT_ENTRIES * JackpotEntry::SPACE
        + 4
        + MAX_JACKPOT_ENTRIES * 32
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct JackpotEntry {
    pub player: Pubkey,
    pub amount: u64,
}
impl JackpotEntry {
    pub const SPACE: usize = 32 + 8;
}

#[account]
pub struct JackpotVault {
    pub round: Pubkey,
    pub bump: u8,
}
impl JackpotVault {
    pub const SPACE: usize = 8 + 32 + 1;
}

#[account]
pub struct CoinflipGame {
    pub id: u64,
    pub creator: Pubkey,
    pub joiner: Pubkey,
    pub creator_side: CoinSide,
    pub amount: u64,
    pub state: GameState,
    pub expires_at: i64,
    pub randomness_requested_at: i64,
    pub randomness: [u8; 32],
    pub randomness_account: Pubkey,
    pub randomness_seed_slot: u64,
    pub randomness_reveal_slot: u64,
    pub winner: Pubkey,
    pub bump: u8,
}
impl CoinflipGame {
    pub const SPACE: usize = 8 + 8 + 32 + 32 + 1 + 8 + 1 + 8 + 8 + 32 + 32 + 8 + 8 + 32 + 1;
}

#[account]
pub struct CoinflipVault {
    pub game: Pubkey,
    pub bump: u8,
}
impl CoinflipVault {
    pub const SPACE: usize = 8 + 32 + 1;
}

#[account]
pub struct DailyPlayer {
    pub player: Pubkey,
    pub state: GameState,
    pub last_opened_at: i64,
    pub randomness_requested_at: i64,
    pub randomness: [u8; 32],
    pub randomness_account: Pubkey,
    pub randomness_seed_slot: u64,
    pub randomness_reveal_slot: u64,
    pub reward: u64,
    pub bump: u8,
}
impl DailyPlayer {
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 32 + 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct RandomnessReceipt {
    pub randomness_account: Pubkey,
    pub game: Pubkey,
    pub game_type: GameType,
    pub rent_payer: Pubkey,
    pub seed_slot: u64,
    pub bump: u8,
}
impl RandomnessReceipt {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 32 + 8 + 1;
}

#[account]
pub struct DailyVault {
    pub bump: u8,
}
impl DailyVault {
    pub const SPACE: usize = 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum GameState {
    Open,
    RandomnessRequested,
    Settled,
    Refunded,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum CoinSide {
    Heads,
    Tails,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GameType {
    Jackpot,
    Coinflip,
    DailyCase,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AuthorityRole {
    Config,
    Pause,
}

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub randomness_program: Pubkey,
    pub randomness_queue: Pubkey,
    pub treasury: Pubkey,
    pub pause_authority: Pubkey,
}
#[event]
pub struct PauseChanged {
    pub authority: Pubkey,
    pub paused: bool,
}
#[event]
pub struct AuthorityTransferProposed {
    pub role: AuthorityRole,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
    pub effective_at: i64,
}
#[event]
pub struct AuthorityTransferAccepted {
    pub role: AuthorityRole,
    pub previous_authority: Pubkey,
    pub authority: Pubkey,
}
#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub previous_randomness_program: Pubkey,
    pub randomness_program: Pubkey,
    pub previous_randomness_queue: Pubkey,
    pub randomness_queue: Pubkey,
    pub previous_treasury: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub min_wager: u64,
    pub max_wager: u64,
}
#[event]
pub struct ConfigUpdateProposed {
    pub admin: Pubkey,
    pub randomness_program: Pubkey,
    pub randomness_queue: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub min_wager: u64,
    pub max_wager: u64,
    pub effective_at: i64,
}
#[event]
pub struct ConfigUpdateCancelled {
    pub admin: Pubkey,
}
#[event]
pub struct JackpotCreated {
    pub round: Pubkey,
    pub round_id: u64,
    pub end_ts: i64,
}
#[event]
pub struct JackpotEntered {
    pub round: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
    pub total: u64,
}
#[event]
pub struct CoinflipCreated {
    pub game: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub side: CoinSide,
}
#[event]
pub struct CoinflipJoined {
    pub game: Pubkey,
    pub joiner: Pubkey,
}
#[event]
pub struct RandomnessRequested {
    pub game: Pubkey,
    pub game_type: GameType,
    pub randomness_account: Pubkey,
    pub seed_slot: u64,
}
#[event]
pub struct RandomnessReceiptClosed {
    pub receipt: Pubkey,
    pub game: Pubkey,
    pub randomness_account: Pubkey,
    pub rent_recipient: Pubkey,
}
#[event]
pub struct GameSettled {
    pub game: Pubkey,
    pub game_type: GameType,
    pub winner: Pubkey,
    pub wager: u64,
    pub payout: u64,
    pub fee: u64,
    pub randomness: [u8; 32],
    pub randomness_account: Pubkey,
    pub seed_slot: u64,
    pub reveal_slot: u64,
}
#[event]
pub struct GameRefunded {
    pub game: Pubkey,
    pub player: Pubkey,
    pub amount: u64,
}
#[event]
pub struct JackpotRefundsEnabled {
    pub game: Pubkey,
}
#[event]
pub struct DailyCaseSettled {
    pub account: Pubkey,
    pub player: Pubkey,
    pub reward: u64,
    pub randomness: [u8; 32],
    pub randomness_account: Pubkey,
    pub seed_slot: u64,
    pub reveal_slot: u64,
}
#[event]
pub struct DailyCaseTimedOut {
    pub account: Pubkey,
    pub player: Pubkey,
}
#[event]
pub struct GameAccountsClosed {
    pub game: Pubkey,
    pub game_type: GameType,
    pub rent_recipient: Pubkey,
}

#[error_code]
pub enum FateError {
    #[msg("The program is paused.")]
    ProgramPaused,
    #[msg("The configured fee exceeds 10%.")]
    FeeTooHigh,
    #[msg("Invalid wager limits.")]
    InvalidWagerLimits,
    #[msg("The wager is outside configured limits.")]
    WagerOutOfRange,
    #[msg("The requested end time is invalid.")]
    InvalidEndTime,
    #[msg("The game is not in the required state.")]
    InvalidGameState,
    #[msg("The round is closed.")]
    RoundClosed,
    #[msg("The round is still open.")]
    RoundStillOpen,
    #[msg("The jackpot entry capacity was reached.")]
    RoundFull,
    #[msg("The game has no funds or entries.")]
    EmptyGame,
    #[msg("Arithmetic overflow.")]
    ArithmeticOverflow,
    #[msg("The randomness account is not owned by the configured provider program.")]
    InvalidRandomnessProgram,
    #[msg("The randomness account has invalid provider data.")]
    InvalidRandomnessAccount,
    #[msg("The randomness account belongs to an unconfigured oracle queue.")]
    InvalidRandomnessQueue,
    #[msg("The randomness commitment is stale or was not made in the previous slot.")]
    RandomnessNotFresh,
    #[msg("The randomness value was already revealed before the game committed to it.")]
    RandomnessAlreadyRevealed,
    #[msg("The supplied randomness account is not the one committed by this game.")]
    WrongRandomnessAccount,
    #[msg("The randomness seed slot differs from the committed slot.")]
    RandomnessSeedMismatch,
    #[msg("The provider has not revealed fresh randomness in this transaction slot.")]
    RandomnessNotResolved,
    #[msg("Randomness cannot be zero.")]
    InvalidRandomness,
    #[msg("The supplied winner account is incorrect.")]
    WrongWinnerAccount,
    #[msg("The supplied treasury is incorrect.")]
    WrongTreasury,
    #[msg("The game has expired.")]
    GameExpired,
    #[msg("A creator cannot join their own game.")]
    SelfJoin,
    #[msg("The game has not expired.")]
    GameNotExpired,
    #[msg("The randomness request has not timed out.")]
    RandomnessNotTimedOut,
    #[msg("The daily case already has a pending request.")]
    PendingDailyCase,
    #[msg("The daily case is still on cooldown.")]
    DailyCooldown,
    #[msg("The daily reward vault cannot cover this reward.")]
    RewardVaultInsolvent,
    #[msg("The vault cannot cover this transfer.")]
    VaultInsolvent,
    #[msg("Invalid amount.")]
    InvalidAmount,
    #[msg("Invalid authority.")]
    InvalidAuthority,
    #[msg("This wallet already claimed its refund.")]
    RefundAlreadyClaimed,
    #[msg("This wallet has no refundable jackpot entries.")]
    NoRefundAvailable,
    #[msg("No configuration update is pending.")]
    NoPendingConfigUpdate,
    #[msg("The configuration update timelock is still active.")]
    ConfigTimelockActive,
    #[msg("The authority transfer timelock is still active.")]
    AuthorityTimelockActive,
    #[msg("The game has not reached a terminal state.")]
    GameNotTerminal,
    #[msg("The game or vault still has outstanding liabilities.")]
    OutstandingLiabilities,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weighted_selection_respects_ranges() {
        let a = Pubkey::new_unique();
        let b = Pubkey::new_unique();
        let entries = [
            JackpotEntry {
                player: a,
                amount: 3,
            },
            JackpotEntry {
                player: b,
                amount: 7,
            },
        ];
        let mut randomness = [0u8; 32];
        randomness[0..8].copy_from_slice(&2u64.to_le_bytes());
        assert_eq!(weighted_winner(&entries, 10, &randomness).unwrap(), a);
        randomness[0..8].copy_from_slice(&3u64.to_le_bytes());
        assert_eq!(weighted_winner(&entries, 10, &randomness).unwrap(), b);
    }

    #[test]
    fn fee_math_is_bounded() {
        assert_eq!(calculate_fee(2_000_000_000, 300).unwrap(), 60_000_000);
        assert_eq!(calculate_fee(2_000_000_000, 0).unwrap(), 0);
        assert!(calculate_fee(u64::MAX, 1_000).is_err());
    }

    #[test]
    fn reward_tiers_are_monotonic() {
        assert_eq!(daily_reward(0), 1_000_000_000);
        assert_eq!(daily_reward(2), 250_000_000);
        assert_eq!(daily_reward(52), 50_000_000);
        assert_eq!(daily_reward(255), 10_000_000);
    }

    #[test]
    fn weighted_selection_rejects_empty_rounds() {
        assert!(weighted_winner(&[], 0, &[1u8; 32]).is_err());
    }

    #[test]
    fn every_random_target_selects_an_entry() {
        let entries = [
            JackpotEntry {
                player: Pubkey::new_unique(),
                amount: 1,
            },
            JackpotEntry {
                player: Pubkey::new_unique(),
                amount: 2,
            },
            JackpotEntry {
                player: Pubkey::new_unique(),
                amount: 3,
            },
        ];
        for target in 0..6u64 {
            let mut randomness = [0u8; 32];
            randomness[..8].copy_from_slice(&target.to_le_bytes());
            assert!(entries.iter().any(|entry| {
                weighted_winner(&entries, 6, &randomness).unwrap() == entry.player
            }));
        }
    }

    #[test]
    fn only_settled_and_refunded_games_are_terminal() {
        assert!(!is_terminal(GameState::Open));
        assert!(!is_terminal(GameState::RandomnessRequested));
        assert!(is_terminal(GameState::Settled));
        assert!(is_terminal(GameState::Refunded));
    }
}
