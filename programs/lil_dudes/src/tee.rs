//! Instructions that run on the Private Ephemeral Rollup (TEE), TECH §4.
//!
//! Privacy rule (Stage 0 check 2): every tx that carries secret input lists Secrets or a Peek,
//! so the TEE redacts it for everyone who is not a member. `set_aim` is public on purpose (the
//! aim is public state). Nothing secret is ever logged.
use crate::errors::GameError;
use crate::game::{catch_up, load, store, write_peek};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::{Discriminator, InstructionData};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member, ACCOUNT_SIGNATURES_FLAG, TX_BALANCES_FLAG, TX_LOGS_FLAG,
    TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::consts::{program_identity_pubkey, DEFAULT_EPHEMERAL_QUEUE};
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_randomness_ix_const, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use lil_dudes_sim::codec::history_bytes;
use lil_dudes_sim::{apply_input, MatchOptions, MatchState, PublicSide, SideInput};
use solana_sha256_hasher::hashv;

const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);

/// Scoped VRF identity PDA, derived at COMPILE time (Stage 0 check 4: the SDK 0.18.0 macro
/// derives it at runtime for ~250k CU and every callback ran out of compute).
const VRF_IDENTITY: Pubkey = Pubkey::new_from_array(
    ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity_const(&crate::ID).0,
);

/// What a Peek member may see: logs, messages, balances and signatures of txs touching it.
const MEMBER_FLAGS: u8 =
    TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG | ACCOUNT_SIGNATURES_FLAG;

fn side_of(game: &Match, signer: &Pubkey) -> Result<u8> {
    game.side_of_burner(signer)
        .ok_or(error!(GameError::NotAPlayer))
}

fn check_secrets(game: &Match, secrets: &Secrets) -> Result<()> {
    require!(secrets.id == game.id, GameError::WrongAccount);
    Ok(())
}

// ---------------------------------------------------------------------- init_permissions

#[derive(Accounts)]
pub struct InitPermissions<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
    /// CHECK: this match's Secrets PDA (checked against the stored bump); signs its permission.
    #[account(mut)]
    pub secrets: UncheckedAccount<'info>,
    /// CHECK: this match's Peek[0] PDA (checked against the stored bump).
    #[account(mut)]
    pub peek0: UncheckedAccount<'info>,
    /// CHECK: this match's Peek[1] PDA (checked against the stored bump).
    #[account(mut)]
    pub peek1: UncheckedAccount<'info>,
    /// CHECK: permission PDA of Secrets (checked by the permission program).
    #[account(mut)]
    pub secrets_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of Peek[0].
    #[account(mut)]
    pub peek0_permission: UncheckedAccount<'info>,
    /// CHECK: permission PDA of Peek[1].
    #[account(mut)]
    pub peek1_permission: UncheckedAccount<'info>,
    /// CHECK: permission program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: checked by the magic program.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: magic program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

/// Makes Secrets private to nobody and Peek[s] private to side s's burner (TECH §4, Stage 0
/// check 1). Must run before anything secret is written: an account with no permission is
/// public. Anyone may send it once the match is on the TEE; members come from the Match only.
pub fn handle_init_permissions(ctx: Context<InitPermissions>) -> Result<()> {
    let a = &ctx.accounts;
    let (id, bumps, burners) = {
        let g = a.game.load()?;
        require!(g.status == status::JOINED, GameError::WrongStatus);
        (g.id, g.bumps, g.burners)
    };
    let id_bytes = id.to_le_bytes();
    let targets = [
        (&a.secrets, &a.secrets_permission, None, bumps[1]),
        (
            &a.peek0,
            &a.peek0_permission,
            Some((0u8, burners[0])),
            bumps[2],
        ),
        (
            &a.peek1,
            &a.peek1_permission,
            Some((1u8, burners[1])),
            bumps[3],
        ),
    ];
    for (account, permission, member, bump) in targets {
        let members = match member {
            None => vec![],
            Some((_, pubkey)) => vec![Member {
                flags: MEMBER_FLAGS,
                pubkey,
            }],
        };
        let side = member.map(|(s, _)| [s]);
        let seeds: Vec<&[u8]> = match &side {
            None => vec![SECRETS_SEED, &id_bytes, core::slice::from_ref(&bump)],
            Some(s) => vec![PEEK_SEED, &id_bytes, s, core::slice::from_ref(&bump)],
        };
        let pda = Pubkey::create_program_address(&seeds, &crate::ID)
            .map_err(|_| error!(GameError::WrongAccount))?;
        require_keys_eq!(pda, account.key(), GameError::WrongAccount);
        CreateEphemeralPermissionCpi {
            payer: account.to_account_info(),
            permissioned_account: account.to_account_info(),
            permission: permission.to_account_info(),
            vault: a.ephemeral_vault.to_account_info(),
            magic_program: a.magic_program.to_account_info(),
            permission_program: a.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members,
            },
        }
        .invoke_signed(&[&seeds])?;
    }
    let mut g = a.game.load_mut()?;
    g.status = status::READY;
    g.ready_slot = Clock::get()?.slot;
    Ok(())
}

// ---------------------------------------------------------------------- seed

#[vrf]
#[derive(Accounts)]
pub struct RequestSeed<'info> {
    /// A player's burner (needs no SOL: the ER queue is free).
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut)]
    pub secrets: AccountLoader<'info, Secrets>,
    /// CHECK: the ER VRF queue.
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Each player sends a private salt (this tx touches Secrets, so it is redacted); once both are
/// in, the match seed is requested from the ER VRF. The seed is H(vrf ‖ salt0 ‖ salt1), so a
/// leaked VRF output alone never reveals the deals (Stage 0 check 2). Re-requests are allowed
/// if no callback came within SEED_RETRY_SLOTS.
pub fn handle_request_seed(ctx: Context<RequestSeed>, salt: [u8; 32]) -> Result<()> {
    let slot = Clock::get()?.slot;
    let request = {
        let mut g = ctx.accounts.game.load_mut()?;
        let mut s = ctx.accounts.secrets.load_mut()?;
        check_secrets(&g, &s)?;
        require!(g.status == status::READY, GameError::WrongStatus);
        let side = side_of(&g, &ctx.accounts.payer.key())?;
        let flag = if side == 0 {
            flags::SALT0
        } else {
            flags::SALT1
        };
        if !g.has(flag) {
            if let Some(slot) = s.salts.get_mut(usize::from(side)) {
                *slot = salt;
            }
            g.flags |= flag;
        }
        let both = g.has(flags::SALT0) && g.has(flags::SALT1);
        let retry = slot >= g.seed_req_slot.saturating_add(SEED_RETRY_SLOTS);
        let go = both && (!g.has(flags::SEED_REQUESTED) || retry);
        if go {
            g.flags |= flags::SEED_REQUESTED;
            g.seed_req_slot = slot;
        }
        go.then(|| hashv(&[&s.salts[0], &s.salts[1], &slot.to_le_bytes()]).to_bytes())
    };
    let Some(caller_seed) = request else {
        return Ok(());
    };
    let meta = |pubkey: Pubkey| SerializableAccountMeta {
        pubkey,
        is_signer: false,
        is_writable: true,
    };
    let ix = create_request_randomness_ix_const(
        RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: crate::instruction::CallbackSeed::DISCRIMINATOR.to_vec(),
            caller_seed,
            accounts_metas: Some(vec![
                meta(ctx.accounts.secrets.key()),
                meta(ctx.accounts.game.key()),
            ]),
            callback_args: None,
        },
        PROGRAM_IDENTITY,
    );
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackSeed<'info> {
    #[account(address = VRF_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub secrets: AccountLoader<'info, Secrets>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
}

/// VRF callback. Infallible by design (a failed callback is public and retried with the same
/// bytes, Stage 0 check 2): fixed accounts, no checks that can fail, small compute. Writes the
/// seed and the initial match into Secrets / Match: the seed's layout, both players in the Plant
/// of Fight 1 with face-down gates, every stage's true values in Secrets only.
pub fn handle_callback_seed(ctx: Context<CallbackSeed>, randomness: [u8; 32]) -> Result<()> {
    let mut g = ctx.accounts.game.load_mut()?;
    let mut s = ctx.accounts.secrets.load_mut()?;
    if g.status != status::READY || s.id != g.id {
        return Ok(());
    }
    let h = hashv(&[&randomness, &s.salts[0], &s.salts[1]]).to_bytes();
    let mut seed_bytes = [0u8; 8];
    seed_bytes.copy_from_slice(h.get(..8).unwrap_or(&[0; 8]));
    let seed = u64::from_le_bytes(seed_bytes);
    s.vrf = randomness;
    // Built in place (`reset`): `MatchState::new` would need a frame over SBF's 4 KB.
    let mut m = MatchState::zeroed();
    m.reset(
        seed,
        MatchOptions {
            stake: g.stake,
            bot: [false; 2],
            tutorial: false,
        },
    );
    store(&m, &mut g, &mut s);
    g.status = status::SEEDED;
    Ok(())
}

// ---------------------------------------------------------------------- start / advance

#[derive(Accounts)]
pub struct Start<'info> {
    /// CHECK: magic program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    /// A player's burner: the crank's authority.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: this match (discriminator + status checked raw); passed on to the crank, so not
    /// typed (Anchor would write it back after the CPI).
    #[account(mut)]
    pub game: UncheckedAccount<'info>,
    /// CHECK: this match's Secrets (id checked raw); passed on to the crank.
    #[account(mut)]
    pub secrets: UncheckedAccount<'info>,
}

/// Starts the clock (tick 0 = now) and schedules the crank: `advance` every 50 ms, exactly the
/// runs a match needs (cancelling is not used, TECH §4).
pub fn handle_start<'info>(ctx: Context<'info, Start<'info>>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let id = {
        let game_ai = ctx.accounts.game.to_account_info();
        let mut data = game_ai.try_borrow_mut_data()?;
        require!(
            data.get(..8) == Some(Match::DISCRIMINATOR) && *game_ai.owner == crate::ID,
            GameError::BadData
        );
        let body = data
            .get_mut(8..8 + core::mem::size_of::<Match>())
            .ok_or(GameError::BadData)?;
        let g = bytemuck::try_from_bytes_mut::<Match>(body).map_err(|_| GameError::BadData)?;
        require!(g.status == status::SEEDED, GameError::WrongStatus);
        side_of(g, &ctx.accounts.payer.key())?;
        let secrets_ai = ctx.accounts.secrets.to_account_info();
        let sdata = secrets_ai.try_borrow_data()?;
        require!(
            sdata.get(..8) == Some(Secrets::DISCRIMINATOR) && *secrets_ai.owner == crate::ID,
            GameError::BadData
        );
        let sid = sdata
            .get(8..16)
            .and_then(|b| <[u8; 8]>::try_from(b).ok())
            .map(u64::from_le_bytes);
        require!(sid == Some(g.id), GameError::WrongAccount);
        g.start_slot = slot;
        g.status = status::PLAYING;
        g.id
    };
    let ix = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.game.key(), false),
            AccountMeta::new(ctx.accounts.secrets.key(), false),
        ],
        data: crate::instruction::Advance {}.data(),
    };
    let accounts: &'info Start<'info> = ctx.accounts;
    ScheduleCrankCpi {
        payer: &accounts.payer,
        magic_program: &accounts.magic_program,
        instruction_accounts: &[
            accounts.payer.to_account_info(),
            accounts.game.to_account_info(),
            accounts.secrets.to_account_info(),
        ],
        args: ScheduleTaskArgs {
            task_id: task_id(id),
            execution_interval_millis: CRANK_INTERVAL_MS,
            iterations: CRANK_ITERATIONS,
            instructions: vec![ix],
        },
    }
    .invoke()?;
    Ok(())
}

#[derive(Accounts)]
pub struct Advance<'info> {
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut)]
    pub secrets: AccountLoader<'info, Secrets>,
}

/// Idempotent catch-up to the slot clock (TECH §4). The crank calls it every 50 ms; anyone may.
pub fn handle_advance(ctx: Context<Advance>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let mut g = ctx.accounts.game.load_mut()?;
    if g.status != status::PLAYING
        || has_result(&g)
        || crate::game::target_tick(&g, slot) <= current_tick(&g)
    {
        return Ok(());
    }
    let mut s = ctx.accounts.secrets.load_mut()?;
    check_secrets(&g, &s)?;
    let mut m = load(&g, &s);
    if catch_up(&mut m, &g, slot, CRANK_CATCH_UP) > 0 {
        store(&m, &mut g, &mut s);
    }
    Ok(())
}

/// Codec header flag 8: the public state holds a result.
fn has_result(g: &Match) -> bool {
    g.state.get(1).is_some_and(|f| f & 8 != 0)
}

/// The tick in the encoded public state (codec header bytes 4..8), without decoding it all.
fn current_tick(g: &Match) -> u32 {
    g.state
        .get(4..8)
        .and_then(|b| <[u8; 4]>::try_from(b).ok())
        .map_or(0, u32::from_le_bytes)
}

// ---------------------------------------------------------------------- player inputs

#[derive(Accounts)]
pub struct SetAim<'info> {
    pub player: Signer<'info>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
}

/// SPEC §2: the cannon chases the aim. Public and cheap: writes the aim straight into the
/// encoded state (equal to `apply_input` with only `aim`; the crank keeps the sim current).
pub fn handle_set_aim(ctx: Context<SetAim>, x: i16) -> Result<()> {
    use lil_dudes_sim::codec::{HEADER_LEN, SIDE_AIM, SIDE_LEN};
    let mut g = ctx.accounts.game.load_mut()?;
    require!(g.status == status::PLAYING, GameError::WrongStatus);
    let side = side_of(&g, &ctx.accounts.player.key())?;
    require!(!has_result(&g), GameError::WrongStatus);
    let aim = x.clamp(0, (lil_dudes_sim::LANE_WIDTH - 1) as i16);
    let at = HEADER_LEN + usize::from(side) * SIDE_LEN + SIDE_AIM;
    if let Some(dst) = g.state.get_mut(at..at + 2) {
        dst.copy_from_slice(&aim.to_le_bytes());
    }
    Ok(())
}

#[derive(Accounts)]
pub struct PlayerSecret<'info> {
    pub player: Signer<'info>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut)]
    pub secrets: AccountLoader<'info, Secrets>,
    /// The signer's own Peek (private to them).
    #[account(mut)]
    pub peek: AccountLoader<'info, Peek>,
}

/// peek_cell: catch up (≤ PLAYER_CATCH_UP ticks), apply the input with
/// the sim's own rules (`apply_input`), store, and rewrite my Peek from the sim's private view.
/// The sim ignores an input it refuses and leaves it unspent; `used` reads the per-stage flag it
/// sets when it takes one, so "not set by this input" = refused = an error (nothing is written).
fn with_input(
    ctx: Context<PlayerSecret>,
    input: SideInput,
    used: fn(&PublicSide) -> bool,
    refused: GameError,
) -> Result<()> {
    let slot = Clock::get()?.slot;
    let a = &ctx.accounts;
    let mut g = a.game.load_mut()?;
    let mut s = a.secrets.load_mut()?;
    let mut p = a.peek.load_mut()?;
    check_secrets(&g, &s)?;
    require!(g.status == status::PLAYING, GameError::WrongStatus);
    let side = side_of(&g, &a.player.key())?;
    require!(p.id == g.id && p.side == side, GameError::WrongAccount);
    let mut m = load(&g, &s);
    catch_up(&mut m, &g, slot, PLAYER_CATCH_UP);
    let spent = |m: &MatchState| m.public.side(side).is_some_and(used);
    let before = spent(&m);
    apply_input(&mut m, side, &input);
    if before || !spent(&m) {
        return Err(refused.into());
    }
    write_peek(&m, side, &mut p);
    store(&m, &mut g, &mut s);
    Ok(())
}

/// SPEC §6 Peek (SPEC_V5 §4 Scout): during my own Fight or Rush, once per stage, see the true
/// value of gate `cell` (a gate SLOT) of my current stage. The result lands in my Peek only.
/// Refused (error, nothing spent): not my Fight/Rush, already scouted this stage, I am dead, the
/// gate is revealed, the timing gate, or not in this stage.
pub fn handle_peek_cell(ctx: Context<PlayerSecret>, cell: u8) -> Result<()> {
    with_input(
        ctx,
        SideInput {
            peek: Some(cell),
            ..SideInput::default()
        },
        |s| s.peek_used,
        GameError::PeekRefused,
    )
}

#[derive(Accounts)]
pub struct PlayerInput<'info> {
    pub player: Signer<'info>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
    /// Needed to step the sim during the catch-up (nothing secret is written to the Match).
    #[account(mut)]
    pub secrets: AccountLoader<'info, Secrets>,
}

/// SPEC_V5 §4 Champion: during my Fight with a full meter, my next volley is a Champion. Public
/// (the meter and the pending flag are in the Match). Catch up (≤ PLAYER_CATCH_UP ticks), apply
/// the input with the sim's own rule, store. Refused (error, nothing spent): not my Fight, the
/// meter is not full, one is already pending, or I am dead.
pub fn handle_champion(ctx: Context<PlayerInput>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let a = &ctx.accounts;
    let mut g = a.game.load_mut()?;
    let mut s = a.secrets.load_mut()?;
    check_secrets(&g, &s)?;
    require!(g.status == status::PLAYING, GameError::WrongStatus);
    let side = side_of(&g, &a.player.key())?;
    let mut m = load(&g, &s);
    catch_up(&mut m, &g, slot, PLAYER_CATCH_UP);
    let pending = |m: &MatchState| m.public.side(side).is_some_and(|s| s.champ_pending);
    let before = pending(&m);
    apply_input(
        &mut m,
        side,
        &SideInput {
            champion: true,
            ..SideInput::default()
        },
    );
    require!(!before && pending(&m), GameError::ChampionRefused);
    store(&m, &mut g, &mut s);
    Ok(())
}

/// Rules v6 trigger: the cannon fires only while it is held. Catch up (≤ PLAYER_CATCH_UP
/// ticks), apply the input with the sim's own rule, store. Never refused while playing: letting
/// go with a full meter in my Fight also calls the Champion (the sim decides; public state).
pub fn handle_set_fire(ctx: Context<PlayerInput>, on: bool) -> Result<()> {
    let slot = Clock::get()?.slot;
    let a = &ctx.accounts;
    let mut g = a.game.load_mut()?;
    let mut s = a.secrets.load_mut()?;
    check_secrets(&g, &s)?;
    require!(g.status == status::PLAYING, GameError::WrongStatus);
    let side = side_of(&g, &a.player.key())?;
    let mut m = load(&g, &s);
    catch_up(&mut m, &g, slot, PLAYER_CATCH_UP);
    apply_input(
        &mut m,
        side,
        &SideInput {
            fire: Some(on),
            ..SideInput::default()
        },
    );
    store(&m, &mut g, &mut s);
    Ok(())
}

// ---------------------------------------------------------------------- finish

#[commit]
#[derive(Accounts)]
pub struct Finish<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub game: AccountLoader<'info, Match>,
    #[account(mut)]
    pub secrets: AccountLoader<'info, Secrets>,
    /// CHECK: this match's Peek[0] (checked against the stored bump); refreshed, then committed.
    #[account(mut)]
    pub peek0: UncheckedAccount<'info>,
    /// CHECK: this match's Peek[1] (checked against the stored bump); refreshed, then committed.
    #[account(mut)]
    pub peek1: UncheckedAccount<'info>,
}

/// Rewrites a Peek passed as a raw account (discriminator checked) from the final state.
fn refresh_peek(peek: &AccountInfo, m: &MatchState, side: u8) -> Result<()> {
    let mut data = peek.try_borrow_mut_data()?;
    require!(
        data.get(..8) == Some(Peek::DISCRIMINATOR) && *peek.owner == crate::ID,
        GameError::BadData
    );
    let body = data
        .get_mut(8..8 + core::mem::size_of::<Peek>())
        .ok_or(GameError::BadData)?;
    let p = bytemuck::try_from_bytes_mut::<Peek>(body).map_err(|_| GameError::BadData)?;
    write_peek(m, side, p);
    Ok(())
}

/// Ends the match on the TEE: publishes the seed and every stage's Scouts in the Match
/// (Verify and the result screen), refreshes both Peeks to each side's final stage, then
/// commits + undelegates all four accounts with the
/// `settle_action` Magic Action. Anyone may finish a match with a result; a player may abort one
/// that never started (after ABORT_SLOTS, or at once if its permissions were never made), and
/// anyone may after ABORT_ANYONE_SLOTS (everyone refunded either way).
pub fn handle_finish(ctx: Context<Finish>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let a = &ctx.accounts;
    let (vault, players, treasury, id) = {
        let mut g = a.game.load_mut()?;
        let s = a.secrets.load()?;
        check_secrets(&g, &s)?;
        let id_bytes = g.id.to_le_bytes();
        for (peek, side, bump) in [(&a.peek0, 0u8, g.bumps[2]), (&a.peek1, 1u8, g.bumps[3])] {
            let pda = Pubkey::create_program_address(
                &[PEEK_SEED, &id_bytes, &[side], &[bump]],
                &crate::ID,
            )
            .map_err(|_| error!(GameError::WrongAccount))?;
            require_keys_eq!(pda, peek.key(), GameError::WrongAccount);
        }
        let has_result = has_result(&g);
        match g.status {
            status::PLAYING => require!(has_result, GameError::NotOver),
            status::JOINED | status::READY | status::SEEDED => {
                // A player: at once before the permissions, else after ABORT_SLOTS. Anyone
                // else (the sweeper): only once READY, after ABORT_ANYONE_SLOTS.
                let player = g.side_of_burner(&a.payer.key()).is_some();
                require!(player || g.status != status::JOINED, GameError::NotAPlayer);
                let wait = if player {
                    ABORT_SLOTS
                } else {
                    ABORT_ANYONE_SLOTS
                };
                let waited = slot >= g.ready_slot.saturating_add(wait);
                require!(
                    (player && g.status == status::JOINED) || waited,
                    GameError::TooEarly
                );
                g.flags |= flags::ABORTED;
            }
            _ => return err!(GameError::WrongStatus),
        }
        if !g.has(flags::ABORTED) {
            // Codec: the secret part starts with the seed (u64 LE) and ends with the history
            // (HISTORY_LEN bytes from S_HISTORY, the same layout in the Match).
            g.seed = s
                .state
                .get(..8)
                .and_then(|b| <[u8; 8]>::try_from(b).ok())
                .map_or(0, u64::from_le_bytes);
            let history = history_bytes(&s.state);
            if let Some(dst) = g.history.get_mut(..history.len()) {
                dst.copy_from_slice(history);
            }
            let m = load(&g, &s);
            refresh_peek(&a.peek0, &m, 0)?;
            refresh_peek(&a.peek1, &m, 1)?;
        }
        g.status = status::FINISHED;
        let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, &id_bytes], &crate::ID);
        (vault, g.players, g.treasury, g.id)
    };
    let accounts = [
        a.game.to_account_info(),
        a.secrets.to_account_info(),
        a.peek0.to_account_info(),
        a.peek1.to_account_info(),
    ];
    let meta = |pubkey: Pubkey, is_writable: bool| ShortAccountMeta {
        pubkey: pubkey.to_bytes().into(),
        is_writable,
    };
    let action = CallHandler {
        destination_program: crate::ID,
        accounts: vec![
            meta(a.game.key(), false),
            meta(vault, true),
            meta(players[0], true),
            meta(players[1], true),
            meta(treasury, true),
            meta(anchor_lang::system_program::ID, false),
        ],
        args: ActionArgs::new(crate::instruction::SettleAction { id }.data()),
        escrow_authority: a.payer.to_account_info(),
        compute_units: 200_000,
    };
    MagicIntentBundleBuilder::new(
        a.payer.to_account_info(),
        a.magic_context.to_account_info(),
        a.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&accounts)
    .add_post_commit_actions([action])
    .build_and_invoke()?;
    Ok(())
}
