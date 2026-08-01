#![allow(clippy::result_large_err)]

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWxqSWY4vF8zqRkMnJx9QpMvdWvZ");

const CONFIG_SEED: &[u8] = b"config";
const JACKPOT_SEED: &[u8] = b"jackpot";
const JACKPOT_VAULT_SEED: &[u8] = b"jackpot-vault";
const COINFLIP_SEED: &[u8] = b"coinflip";
const COINFLIP_VAULT_SEED: &[u8] = b"coinflip-vault";
const DAILY_SEED: &[u8] = b"daily";
const DAILY_VAULT_SEED: &[u8] = b"daily-vault";
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
        randomness_authority: Pubkey,
        treasury: Pubkey,
        fee_bps: u16,
        min_wager: u64,
        max_wager: u64,
    ) -> Result<()> {
        require!(
            randomness_authority != Pubkey::default() && treasury != Pubkey::default(),
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
        config.randomness_authority = randomness_authority;
        config.treasury = treasury;
        config.pending_randomness_authority = Pubkey::default();
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
            randomness_authority,
            treasury
        });
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminConfig>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PauseChanged { paused });
        Ok(())
    }

    pub fn propose_config_update(
        ctx: Context<AdminConfig>,
        randomness_authority: Pubkey,
        treasury: Pubkey,
        fee_bps: u16,
        min_wager: u64,
        max_wager: u64,
    ) -> Result<()> {
        require!(
            randomness_authority != Pubkey::default() && treasury != Pubkey::default(),
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
        config.pending_randomness_authority = randomness_authority;
        config.pending_treasury = treasury;
        config.pending_fee_bps = fee_bps;
        config.pending_min_wager = min_wager;
        config.pending_max_wager = max_wager;
        config.pending_config_effective_at = effective_at;
        emit!(ConfigUpdateProposed {
            admin: config.admin,
            randomness_authority,
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
        let previous_randomness_authority = config.randomness_authority;
        let previous_treasury = config.treasury;
        config.randomness_authority = config.pending_randomness_authority;
        config.treasury = config.pending_treasury;
        config.fee_bps = config.pending_fee_bps;
        config.min_wager = config.pending_min_wager;
        config.max_wager = config.pending_max_wager;
        clear_pending_config(config);
        emit!(ConfigUpdated {
            admin: config.admin,
            previous_randomness_authority,
            randomness_authority: config.randomness_authority,
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
        ctx.accounts.config.pending_admin = pending_admin;
        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_eq!(
            config.pending_admin,
            ctx.accounts.pending_admin.key(),
            FateError::InvalidAuthority
        );
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();
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
        let now = Clock::get()?.unix_timestamp;
        let round = &mut ctx.accounts.round;
        require!(round.state == GameState::Open, FateError::InvalidGameState);
        require!(now >= round.end_ts, FateError::RoundStillOpen);
        require!(round.total_lamports > 0, FateError::EmptyGame);
        round.state = GameState::RandomnessRequested;
        round.randomness_requested_at = now;
        emit!(RandomnessRequested {
            game: round.key(),
            game_type: GameType::Jackpot
        });
        Ok(())
    }

    pub fn settle_jackpot(ctx: Context<SettleJackpot>, randomness: [u8; 32]) -> Result<()> {
        verify_randomness_authority(&ctx.accounts.config, &ctx.accounts.randomness_authority)?;
        let round = &mut ctx.accounts.round;
        require!(
            round.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        require!(randomness != [0; 32], FateError::InvalidRandomness);
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
        round.winner = selected;
        emit!(GameSettled {
            game: round.key(),
            game_type: GameType::Jackpot,
            winner: selected,
            wager: round.total_lamports,
            payout,
            fee,
            randomness
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
        emit!(CoinflipJoined {
            game: game.key(),
            joiner: game.joiner
        });
        emit!(RandomnessRequested {
            game: game.key(),
            game_type: GameType::Coinflip
        });
        Ok(())
    }

    pub fn settle_coinflip(ctx: Context<SettleCoinflip>, randomness: [u8; 32]) -> Result<()> {
        verify_randomness_authority(&ctx.accounts.config, &ctx.accounts.randomness_authority)?;
        let game = &mut ctx.accounts.game;
        require!(
            game.state == GameState::RandomnessRequested,
            FateError::InvalidGameState
        );
        require!(randomness != [0; 32], FateError::InvalidRandomness);
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
        game.winner = winner;
        emit!(GameSettled {
            game: game.key(),
            game_type: GameType::Coinflip,
            winner,
            wager: pot,
            payout,
            fee,
            randomness
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
        Ok(())
    }

    pub fn close_coinflip(ctx: Context<CloseCoinflip>) -> Result<()> {
        require!(is_terminal(ctx.accounts.game.state), FateError::GameNotTerminal);
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
        daily.reward = 0;
        daily.bump = ctx.bumps.daily;
        Ok(())
    }

    pub fn open_daily_case(ctx: Context<OpenDailyCase>) -> Result<()> {
        assert_live(&ctx.accounts.config)?;
        let now = Clock::get()?.unix_timestamp;
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
        daily.reward = 0;
        emit!(RandomnessRequested {
            game: daily.key(),
            game_type: GameType::DailyCase
        });
        Ok(())
    }

    pub fn settle_daily_case(ctx: Context<SettleDailyCase>, randomness: [u8; 32]) -> Result<()> {
        verify_randomness_authority(&ctx.accounts.config, &ctx.accounts.randomness_authority)?;
        require!(randomness != [0; 32], FateError::InvalidRandomness);
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
        daily.reward = reward;
        emit!(DailyCaseSettled {
            account: daily.key(),
            player: daily.player,
            reward,
            randomness
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
    config.pending_randomness_authority = Pubkey::default();
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
fn verify_randomness_authority(config: &Config, signer: &Signer) -> Result<()> {
    require_keys_eq!(
        config.randomness_authority,
        signer.key(),
        FateError::InvalidRandomnessAuthority
    );
    Ok(())
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
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,
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
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
}

#[derive(Accounts)]
pub struct SettleJackpot<'info> {
    pub randomness_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
    #[account(mut, seeds = [JACKPOT_VAULT_SEED, round.key().as_ref()], bump = vault.bump, has_one = round)]
    pub vault: Account<'info, JackpotVault>,
    /// CHECK: Validated against the deterministic selected winner.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: Validated against configuration.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EnableJackpotRefunds<'info> {
    #[account(mut, seeds = [JACKPOT_SEED, &round.id.to_le_bytes()], bump = round.bump)]
    pub round: Account<'info, JackpotRound>,
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
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleCoinflip<'info> {
    pub randomness_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [COINFLIP_SEED, &game.id.to_le_bytes()], bump = game.bump)]
    pub game: Account<'info, CoinflipGame>,
    #[account(mut, seeds = [COINFLIP_VAULT_SEED, game.key().as_ref()], bump = vault.bump, has_one = game)]
    pub vault: Account<'info, CoinflipVault>,
    /// CHECK: Validated against the deterministic winner.
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,
    /// CHECK: Validated against configuration.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
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
    pub player: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player)]
    pub daily: Account<'info, DailyPlayer>,
}

#[derive(Accounts)]
pub struct SettleDailyCase<'info> {
    pub randomness_authority: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player)]
    pub daily: Account<'info, DailyPlayer>,
    /// CHECK: Address constrained through daily.player.
    #[account(mut, address = daily.player)]
    pub player: UncheckedAccount<'info>,
    #[account(mut, seeds = [DAILY_VAULT_SEED], bump = vault.bump)]
    pub vault: Account<'info, DailyVault>,
}

#[derive(Accounts)]
pub struct CancelDailyTimeout<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [DAILY_SEED, player.key().as_ref()], bump = daily.bump, has_one = player)]
    pub daily: Account<'info, DailyPlayer>,
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
    pub randomness_authority: Pubkey,
    pub treasury: Pubkey,
    pub pending_randomness_authority: Pubkey,
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
    pub const SPACE: usize = 8 + 32 * 6 + 2 + 2 + 8 * 5 + 1 + 1;
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
    pub winner: Pubkey,
    pub bump: u8,
}
impl CoinflipGame {
    pub const SPACE: usize = 8 + 8 + 32 + 32 + 1 + 8 + 1 + 8 + 8 + 32 + 32 + 1;
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
    pub reward: u64,
    pub bump: u8,
}
impl DailyPlayer {
    pub const SPACE: usize = 8 + 32 + 1 + 8 + 8 + 32 + 8 + 1;
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

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub randomness_authority: Pubkey,
    pub treasury: Pubkey,
}
#[event]
pub struct PauseChanged {
    pub paused: bool,
}
#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub previous_randomness_authority: Pubkey,
    pub randomness_authority: Pubkey,
    pub previous_treasury: Pubkey,
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub min_wager: u64,
    pub max_wager: u64,
}
#[event]
pub struct ConfigUpdateProposed {
    pub admin: Pubkey,
    pub randomness_authority: Pubkey,
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
    #[msg("Invalid randomness authority.")]
    InvalidRandomnessAuthority,
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
