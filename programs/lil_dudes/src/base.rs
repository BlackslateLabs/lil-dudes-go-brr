//! Base-layer instructions: create / join / delegate / cancel, and settlement (TECH §4).
use crate::errors::GameError;
use crate::game::{pay, pay_out, pre_match_public, vault_send};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::access_control::structs::EphemeralPermission;
use ephemeral_rollups_sdk::anchor::{action, delegate};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephemeral_accounts::rent as er_rent;
use lil_dudes_sim::codec::encode_public;

/// `ActionArgs::new` default escrow index (the escrow PDA that signs the post-commit action).
pub const ACTION_ESCROW_INDEX: u8 = 255;

// ---------------------------------------------------------------------- create_match

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateMatch<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(init, payer = player, space = MATCH_SPACE,
        seeds = [MATCH_SEED, &id.to_le_bytes()], bump)]
    pub game: AccountLoader<'info, Match>,
    #[account(init, payer = player, space = SECRETS_SPACE,
        seeds = [SECRETS_SEED, &id.to_le_bytes()], bump)]
    pub secrets: AccountLoader<'info, Secrets>,
    #[account(init, payer = player, space = PEEK_SPACE,
        seeds = [PEEK_SEED, &id.to_le_bytes(), &[0]], bump)]
    pub peek0: AccountLoader<'info, Peek>,
    #[account(init, payer = player, space = PEEK_SPACE,
        seeds = [PEEK_SEED, &id.to_le_bytes(), &[1]], bump)]
    pub peek1: AccountLoader<'info, Peek>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Player A opens a match: escrows `pick`, registers the burner that will sign on the TEE, and
/// pays every account's rent (refunded by `close_match`), plus the ephemeral permission rent
/// Secrets and Peek pay for themselves on the TEE.
pub fn handle_create_match(
    ctx: Context<CreateMatch>,
    id: u64,
    pick: u64,
    burner: Pubkey,
    name: [u8; 16],
) -> Result<()> {
    require!(STAKE_TIERS.contains(&pick), GameError::BadStake);
    require!(burner != Pubkey::default(), GameError::BadBurner);
    let a = &ctx.accounts;
    let sys = a.system_program.to_account_info();
    let player = a.player.to_account_info();
    let rent0 = er_rent(EphemeralPermission::size_of(0) as u32);
    let rent1 = er_rent(EphemeralPermission::size_of(1) as u32);
    pay(&player, &a.secrets.to_account_info(), rent0, &sys)?;
    pay(&player, &a.peek0.to_account_info(), rent1, &sys)?;
    pay(&player, &a.peek1.to_account_info(), rent1, &sys)?;
    pay(&player, &a.vault.to_account_info(), pick, &sys)?;

    let b = &ctx.bumps;
    let mut g = ctx.accounts.game.load_init()?;
    g.id = id;
    g.picks = [pick, 0];
    g.created_at = Clock::get()?.unix_timestamp;
    g.players[0] = ctx.accounts.player.key();
    g.burners[0] = burner;
    g.treasury = TREASURY;
    g.names[0] = name;
    g.status = status::OPEN;
    g.rules_version = u8::try_from(lil_dudes_sim::RULES_VERSION).unwrap_or(u8::MAX);
    g.vault_bump = b.vault;
    g.bumps = [b.game, b.secrets, b.peek0, b.peek1];
    g.history = [NONE; HISTORY_LEN];
    encode_public(&pre_match_public(0), &mut g.state);

    ctx.accounts.secrets.load_init()?.id = id;
    for (peek, side) in [(&ctx.accounts.peek0, 0u8), (&ctx.accounts.peek1, 1u8)] {
        let mut p = peek.load_init()?;
        p.id = id;
        p.side = side;
        p.owner = if side == 0 { burner } else { Pubkey::default() };
        p.stage = NONE;
        p._reserved = [NONE; 2];
        p.peek_stage = NONE;
        p.peek_slot = NONE;
    }
    Ok(())
}

// ---------------------------------------------------------------------- join_match

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct JoinMatch<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [MATCH_SEED, &id.to_le_bytes()], bump)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes(), &[1]], bump)]
    pub peek1: AccountLoader<'info, Peek>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must be the creator (checked in the handler); gets back the excess of their pick.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Player B joins. The matched stake S is the lower of the two picks (MVP §3.4): B escrows S and
/// A's excess goes back to A now.
pub fn handle_join_match(
    ctx: Context<JoinMatch>,
    _id: u64,
    pick: u64,
    burner: Pubkey,
    name: [u8; 16],
) -> Result<()> {
    require!(STAKE_TIERS.contains(&pick), GameError::BadStake);
    let a = &ctx.accounts;
    let sys = a.system_program.to_account_info();
    let mut g = a.game.load_mut()?;
    require!(g.status == status::OPEN, GameError::WrongStatus);
    require!(
        burner != Pubkey::default() && burner != g.burners[0],
        GameError::BadBurner
    );
    require_keys_eq!(a.creator.key(), g.players[0], GameError::WrongRecipient);
    let stake = g.picks[0].min(pick);
    pay(
        &a.player.to_account_info(),
        &a.vault.to_account_info(),
        stake,
        &sys,
    )?;
    let id = g.id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id, &[g.vault_bump]];
    let excess = g.picks[0].saturating_sub(stake);
    vault_send(
        &a.vault.to_account_info(),
        &a.creator.to_account_info(),
        excess,
        seeds,
        &sys,
    )?;
    g.stake = stake;
    g.picks[1] = pick;
    g.joined_at = Clock::get()?.unix_timestamp;
    g.players[1] = a.player.key();
    g.burners[1] = burner;
    g.names[1] = name;
    g.status = status::JOINED;
    encode_public(&pre_match_public(stake), &mut g.state);
    a.peek1.load_mut()?.owner = burner;
    Ok(())
}

// ---------------------------------------------------------------------- delegate_match

#[delegate]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct DelegateMatch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: the ER validator to delegate to; must be the TEE (checked in the handler).
    pub validator: UncheckedAccount<'info>,
    /// CHECK: this match's Match PDA (seeds); status checked raw in the handler.
    #[account(mut, del, seeds = [MATCH_SEED, &id.to_le_bytes()], bump)]
    pub game: UncheckedAccount<'info>,
    /// CHECK: this match's Secrets PDA (seeds).
    #[account(mut, del, seeds = [SECRETS_SEED, &id.to_le_bytes()], bump)]
    pub secrets: UncheckedAccount<'info>,
    /// CHECK: this match's Peek[0] PDA (seeds).
    #[account(mut, del, seeds = [PEEK_SEED, &id.to_le_bytes(), &[0]], bump)]
    pub peek0: UncheckedAccount<'info>,
    /// CHECK: this match's Peek[1] PDA (seeds).
    #[account(mut, del, seeds = [PEEK_SEED, &id.to_le_bytes(), &[1]], bump)]
    pub peek1: UncheckedAccount<'info>,
}

/// Moves Match, Secrets and both Peeks to the TEE in one tx, once both players are in.
pub fn handle_delegate_match(ctx: Context<DelegateMatch>, id: u64) -> Result<()> {
    #[cfg(not(feature = "magicsvm"))]
    require_keys_eq!(
        ctx.accounts.validator.key(),
        TEE_VALIDATOR,
        GameError::WrongValidator
    );
    {
        let data = ctx.accounts.game.try_borrow_data()?;
        require!(
            data.get(..8) == Some(Match::DISCRIMINATOR),
            GameError::BadData
        );
        let at = 8 + core::mem::offset_of!(Match, status);
        require!(
            data.get(at) == Some(&status::JOINED),
            GameError::WrongStatus
        );
    }
    let a = &ctx.accounts;
    let id_bytes = id.to_le_bytes();
    let config = || DelegateConfig {
        // Never commit on a timer: Secrets must not reach the base layer before `finish`.
        commit_frequency_ms: u32::MAX,
        validator: Some(a.validator.key()),
    };
    a.delegate_game(&a.payer, &[MATCH_SEED, &id_bytes], config())?;
    a.delegate_secrets(&a.payer, &[SECRETS_SEED, &id_bytes], config())?;
    a.delegate_peek0(&a.payer, &[PEEK_SEED, &id_bytes, &[0]], config())?;
    a.delegate_peek1(&a.payer, &[PEEK_SEED, &id_bytes, &[1]], config())?;
    Ok(())
}

// ---------------------------------------------------------------------- cancel_match

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CancelMatch<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [MATCH_SEED, &id.to_le_bytes()], bump, close = creator)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut, seeds = [SECRETS_SEED, &id.to_le_bytes()], bump, close = creator)]
    pub secrets: AccountLoader<'info, Secrets>,
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes(), &[0]], bump, close = creator)]
    pub peek0: AccountLoader<'info, Peek>,
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes(), &[1]], bump, close = creator)]
    pub peek1: AccountLoader<'info, Peek>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: players[0] (checked); gets its stake back and every account's rent.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: players[1] once joined (checked), else pass the creator again.
    #[account(mut)]
    pub opponent: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Refunds and closes a match that never reached the TEE (MVP §4): the creator any time while
/// nobody joined (anyone after OPEN_ANYONE_SECS); either player JOIN_TIMEOUT_SECS after a join
/// that was never delegated (anyone after JOIN_ANYONE_SECS). The payees are fixed by the Match.
pub fn handle_cancel_match(ctx: Context<CancelMatch>, _id: u64) -> Result<()> {
    let a = &ctx.accounts;
    let g = *a.game.load()?;
    let signer = a.signer.key();
    require_keys_eq!(a.creator.key(), g.players[0], GameError::WrongRecipient);
    let now = Clock::get()?.unix_timestamp;
    let refunds = match g.status {
        status::OPEN => {
            let abandoned = now >= g.created_at.saturating_add(OPEN_ANYONE_SECS);
            require!(signer == g.players[0] || abandoned, GameError::NotAPlayer);
            [g.picks[0], 0]
        }
        status::JOINED => {
            require_keys_eq!(a.opponent.key(), g.players[1], GameError::WrongRecipient);
            let wait = if g.players.contains(&signer) {
                JOIN_TIMEOUT_SECS
            } else {
                JOIN_ANYONE_SECS
            };
            require!(now >= g.joined_at.saturating_add(wait), GameError::TooEarly);
            [g.stake, g.stake]
        }
        _ => return err!(GameError::WrongStatus),
    };
    let id = g.id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id, &[g.vault_bump]];
    let sys = a.system_program.to_account_info();
    let vault = a.vault.to_account_info();
    vault_send(
        &vault,
        &a.creator.to_account_info(),
        refunds[0],
        seeds,
        &sys,
    )?;
    vault_send(
        &vault,
        &a.opponent.to_account_info(),
        refunds[1],
        seeds,
        &sys,
    )?;
    Ok(())
}

// ---------------------------------------------------------------------- settlement

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Settle<'info> {
    /// Owner check: only an undelegated (final, committed) Match loads.
    #[account(mut, seeds = [MATCH_SEED, &id.to_le_bytes()], bump)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: players[0] (checked in pay_out).
    #[account(mut)]
    pub player0: UncheckedAccount<'info>,
    /// CHECK: players[1] (checked in pay_out).
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    /// CHECK: the treasury recorded in the Match (checked in pay_out).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Fallback settlement (TECH §4): anyone, once the Match is back on the base layer, if the Magic
/// Action did not pay. Refused when already paid. Pays the result the sim stored in the final
/// state (SPEC §8 v3: a death moves the loser's whole stake, otherwise the pot splits by gold;
/// the fee comes out of the money moved; a draw or an abort refunds both).
pub fn handle_settle(ctx: Context<Settle>, _id: u64) -> Result<()> {
    let a = &ctx.accounts;
    let g = *a.game.load()?;
    require!(g.status == status::FINISHED, GameError::AlreadySettled);
    pay_out(
        &g,
        &a.vault.to_account_info(),
        &a.player0.to_account_info(),
        &a.player1.to_account_info(),
        &a.treasury.to_account_info(),
        &a.system_program.to_account_info(),
    )?;
    a.game.load_mut()?.status = status::SETTLED;
    Ok(())
}

#[action]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct SettleAction<'info> {
    /// CHECK: owned by the delegation program or this program depending on undelegation
    /// progress; pinned by seeds, read raw (discriminator checked), never written.
    #[account(seeds = [MATCH_SEED, &id.to_le_bytes()], bump)]
    pub game: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: players[0] (checked in pay_out).
    #[account(mut)]
    pub player0: UncheckedAccount<'info>,
    /// CHECK: players[1] (checked in pay_out).
    #[account(mut)]
    pub player1: UncheckedAccount<'info>,
    /// CHECK: the treasury recorded in the Match (checked in pay_out).
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the program that scheduled the action (passed by the delegation program).
    #[account(address = crate::ID)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: the escrow authority the action was scheduled with (the finisher).
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: only the delegation program can sign for this PDA, so `signer` proves the call came
    /// through the real post-commit path.
    #[account(signer, address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(
        &escrow_auth.key(), ACTION_ESCROW_INDEX))]
    pub escrow: UncheckedAccount<'info>,
}

/// Post-commit Magic Action scheduled by `finish`: pays out from the committed Match (the same
/// split as `settle`).
pub fn handle_settle_action(ctx: Context<SettleAction>, _id: u64) -> Result<()> {
    let a = &ctx.accounts;
    let g = read_match(&a.game.try_borrow_data()?)?;
    require!(g.status == status::FINISHED, GameError::WrongStatus);
    pay_out(
        &g,
        &a.vault.to_account_info(),
        &a.player0.to_account_info(),
        &a.player1.to_account_info(),
        &a.treasury.to_account_info(),
        &a.system_program.to_account_info(),
    )
}

/// A copy of the Match from raw account data (discriminator checked).
pub fn read_match(data: &[u8]) -> Result<Match> {
    require!(
        data.get(..8) == Some(Match::DISCRIMINATOR),
        GameError::BadData
    );
    let body = data
        .get(8..8 + core::mem::size_of::<Match>())
        .ok_or(GameError::BadData)?;
    Ok(*bytemuck::try_from_bytes::<Match>(body).map_err(|_| GameError::BadData)?)
}

// ---------------------------------------------------------------------- close_match

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CloseMatch<'info> {
    #[account(mut, seeds = [MATCH_SEED, &id.to_le_bytes()], bump, close = creator)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut, seeds = [SECRETS_SEED, &id.to_le_bytes()], bump, close = creator)]
    pub secrets: AccountLoader<'info, Secrets>,
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes(), &[0]], bump, close = creator)]
    pub peek0: AccountLoader<'info, Peek>,
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes(), &[1]], bump, close = creator)]
    pub peek1: AccountLoader<'info, Peek>,
    #[account(seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: players[0] (checked): paid every account's rent, gets it back.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,
}

/// Anyone may close a paid-out match; the rent goes back to the creator.
pub fn handle_close_match(ctx: Context<CloseMatch>, _id: u64) -> Result<()> {
    let a = &ctx.accounts;
    let g = *a.game.load()?;
    require_keys_eq!(a.creator.key(), g.players[0], GameError::WrongRecipient);
    let paid = g.status == status::SETTLED
        || (g.status == status::FINISHED && (g.stake == 0 || a.vault.lamports() == 0));
    require!(paid, GameError::WrongStatus);
    Ok(())
}
