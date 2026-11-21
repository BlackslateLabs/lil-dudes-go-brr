//! Stage 0 spike (M2, throwaway): proves or disproves the risky MagicBlock assumptions in
//! docs/TECH.md §7 on devnet + devnet-tee. Not shipped. See spikes/stage0/RESULTS.md.
//!
//! Accounts per run `id`:
//! - `Board`  public, delegated to the TEE. Holds the REAL `lil_dudes_sim::MatchState`
//!   (codec.rs layout) plus counters the checks read (crank calls, VRF slots, echo).
//! - `Secret` private (ephemeral permission, is_private, no members). Rig + VRF seed.
//! - `Peek`   private (member = one player). Proves per-player visibility.
//! - `CrankLog` public, slot deltas between crank calls (ground truth for check 3).
//! - `Vault`  system-owned SOL PDA on the base layer, never delegated (check 6).
//! - `Bench`  worst-case sim state for the compute budget (extra b).
#![allow(deprecated)] // ScheduleCrankCpi: the TEE runs validator 1.1.1 (legacy ScheduleTask).
#![allow(unexpected_cfgs)]

mod codec;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::system_program::{transfer, Transfer};
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, EphemeralPermission, Member,
};
use ephemeral_rollups_sdk::anchor::{action, commit, delegate, ephemeral, vrf, vrf_callback};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::crank::{ScheduleCrankCpi, ScheduleTaskArgs};
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::vrf::consts::{program_identity_pubkey, DEFAULT_EPHEMERAL_QUEUE};
use ephemeral_rollups_sdk::vrf::instructions::{
    create_request_randomness_ix_const, RequestRandomnessParams,
};
use ephemeral_rollups_sdk::vrf::types::SerializableAccountMeta;
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};
use lil_dudes_sim::rng::mix64;
use lil_dudes_sim::{step, Inputs, MatchOptions, MatchState, NoEvents, Warlord, MATCH_TICKS};

declare_id!("7BE2WwiCdz8SHMagZ3YSGWrhJhYwh3HZ9MQSWT277HGM");

pub const BOARD_SEED: &[u8] = b"board";
pub const SECRET_SEED: &[u8] = b"secret";
pub const PEEK_SEED: &[u8] = b"peek";
pub const LOG_SEED: &[u8] = b"log";
pub const BENCH_SEED: &[u8] = b"bench";
pub const VAULT_SEED: &[u8] = b"vault";

/// TECH §4: 1 tick = 5 ER slots (~50 ms at ~10 ms slots).
pub const SLOTS_PER_TICK: u64 = 5;
/// Catch-up cap per `advance` (TECH §4); the bench decides the real number.
pub const MAX_STEPS: u32 = 40;
/// `ActionArgs::new` default escrow index.
pub const ACTION_ESCROW_INDEX: u8 = 255;
/// codec::STATE_LEN rounded up to 8 (Pod, no padding).
pub const STATE_CAP: usize = 1_312;
pub const LOG_CAP: usize = 4_096;

const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);
const _: () = assert!(codec::STATE_LEN <= STATE_CAP);

#[ephemeral]
#[program]
pub mod stage0 {
    use super::*;

    // ------------------------------------------------------------------ base layer

    /// Creates every account of one run and funds the vault. Pre-funds Board/Secret/Peek with
    /// the rent their ephemeral permissions will need on the ER (they pay it themselves there).
    pub fn init(
        ctx: Context<Init>,
        id: u64,
        vault_lamports: u64,
        peeker: Pubkey,
        recipient: Pubkey,
    ) -> Result<()> {
        let rent0 = ephemeral_rollups_sdk::ephemeral_accounts::rent(
            EphemeralPermission::size_of(0) as u32,
        );
        let rent1 = ephemeral_rollups_sdk::ephemeral_accounts::rent(
            EphemeralPermission::size_of(1) as u32,
        );
        let a = &ctx.accounts;
        fund(&a.payer, a.board.to_account_info(), rent0, &a.system_program)?;
        fund(&a.payer, a.secret.to_account_info(), rent0, &a.system_program)?;
        fund(&a.payer, a.peek.to_account_info(), rent1, &a.system_program)?;
        fund(&a.payer, a.vault.to_account_info(), vault_lamports, &a.system_program)?;

        let mut board = ctx.accounts.board.load_init()?;
        board.id = id;
        board.authority = ctx.accounts.payer.key();
        board.recipient = recipient;
        let m = new_match(id);
        codec::encode(&m, &mut board.state);

        let secret = &mut ctx.accounts.secret;
        secret.id = id;
        secret.rig_cell = u8::MAX;
        let peek = &mut ctx.accounts.peek;
        peek.id = id;
        peek.owner = peeker;
        ctx.accounts.log.load_init()?.first_slot = 0;
        Ok(())
    }

    /// Worst-case sim state for the compute bench (extra b).
    pub fn init_bench(ctx: Context<InitBench>, id: u64) -> Result<()> {
        let mut bench = ctx.accounts.bench.load_init()?;
        bench.id = id;
        let m = codec::worst_case(id);
        codec::encode(&m, &mut bench.state);
        Ok(())
    }

    /// Delegates one PDA (kind: 0 board, 1 secret, 2 peek, 3 log, 4 bench) to the validator in
    /// remaining_accounts[0] (the TEE).
    pub fn delegate(ctx: Context<DelegatePda>, kind: u8, id: u64) -> Result<()> {
        let prefix = seed_prefix(kind)?;
        let id_bytes = id.to_le_bytes();
        let validator = ctx.remaining_accounts.first().map(|a| a.key());
        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[prefix, &id_bytes],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Fallback settlement (TECH §4): anyone, after undelegation, if the Magic Action was skipped
    /// or failed. Only pays the recipient recorded in the committed Board; idempotent.
    pub fn settle(ctx: Context<Settle>, id: u64) -> Result<()> {
        let recipient = {
            let board = ctx.accounts.board.load()?;
            require!(board.finished == 1, SpikeError::NotFinished);
            require!(board.settled == 0, SpikeError::AlreadySettled);
            board.recipient
        };
        pay_out(
            id,
            ctx.bumps.vault,
            &ctx.accounts.vault,
            &ctx.accounts.recipient,
            recipient,
            &ctx.accounts.system_program,
        )?;
        ctx.accounts.board.load_mut()?.settled = 1;
        msg!("settled by fallback");
        Ok(())
    }

    /// Post-commit Magic Action target. The Board may still be owned by the delegation program
    /// here, so it is read raw and not written; the drained vault is the idempotency guard.
    pub fn settle_action(ctx: Context<SettleAction>, id: u64) -> Result<()> {
        let recipient = {
            let data = ctx.accounts.board.try_borrow_data()?;
            let (finished, recipient) = board_head(&data)?;
            require!(finished == 1, SpikeError::NotFinished);
            recipient
        };
        pay_out(
            id,
            ctx.bumps.vault,
            &ctx.accounts.vault,
            &ctx.accounts.recipient,
            recipient,
            &ctx.accounts.system_program,
        )?;
        msg!("settled by magic action");
        Ok(())
    }

    /// Reclaims the rent of every undelegated account of a run (and any vault leftovers).
    pub fn close_all(ctx: Context<CloseAll>, id: u64) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.board.load()?.authority,
            ctx.accounts.authority.key(),
            SpikeError::NotAuthority
        );
        let left = ctx.accounts.vault.lamports();
        if left > 0 {
            let id_bytes = id.to_le_bytes();
            let seeds: &[&[u8]] = &[VAULT_SEED, &id_bytes, &[ctx.bumps.vault]];
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.key(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.authority.to_account_info(),
                    },
                    &[seeds],
                ),
                left,
            )?;
        }
        Ok(())
    }

    pub fn close_bench(_ctx: Context<CloseBench>, _id: u64) -> Result<()> {
        Ok(())
    }

    // ------------------------------------------------------------------ ER (TEE)

    /// Creates the ephemeral permission of one delegated PDA (kind as in `delegate`). The PDA
    /// pays its own rent and signs. `members = None` → public; `Some(vec![])` → private, nobody.
    pub fn init_permission(
        ctx: Context<InitPermission>,
        kind: u8,
        id: u64,
        members: Option<Vec<Member>>,
    ) -> Result<()> {
        if ctx.accounts.permission.lamports() > 0 {
            return Ok(());
        }
        let prefix = seed_prefix(kind)?;
        let id_bytes = id.to_le_bytes();
        let (pda, bump) = Pubkey::find_program_address(&[prefix, &id_bytes], &crate::ID);
        require_keys_eq!(
            pda,
            ctx.accounts.permissioned_account.key(),
            SpikeError::BadKind
        );
        let (is_private, members) = match members {
            Some(m) => (true, m),
            None => (false, vec![]),
        };
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.permissioned_account.to_account_info(),
            permissioned_account: ctx.accounts.permissioned_account.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private,
                members,
            },
        }
        .invoke_signed(&[&[prefix, &id_bytes, &[bump]]])?;
        Ok(())
    }

    /// Starts the clock: from now on `advance` catches the sim up to (slot − start) / 5.
    pub fn start(ctx: Context<OnBoard>, id: u64) -> Result<()> {
        let now = Clock::get()?.slot;
        let mut board = ctx.accounts.board.load_mut()?;
        board.start_slot = now;
        board.last_slot = now;
        let m = new_match(id);
        codec::encode(&m, &mut board.state);
        Ok(())
    }

    /// Idempotent catch-up (TECH §4). `source` 1 = crank, anything else = client heartbeat.
    pub fn advance(ctx: Context<Advance>, _id: u64, source: u8) -> Result<()> {
        let now = Clock::get()?.slot;
        let mut board = ctx.accounts.board.load_mut()?;
        if source == 1 {
            let mut log = ctx.accounts.log.load_mut()?;
            if log.first_slot == 0 {
                log.first_slot = now;
            } else {
                let n = log.n as usize;
                let delta = u16::try_from(now.saturating_sub(board.last_slot)).unwrap_or(u16::MAX);
                if let Some(slot) = log.deltas.get_mut(n) {
                    *slot = delta;
                    log.n = log.n.saturating_add(1);
                }
            }
            board.crank_calls = board.crank_calls.saturating_add(1);
        } else {
            board.other_calls = board.other_calls.saturating_add(1);
        }
        board.last_slot = now;
        if board.start_slot == 0 || board.finished != 0 {
            return Ok(());
        }
        let target = now
            .saturating_sub(board.start_slot)
            .checked_div(SLOTS_PER_TICK)
            .unwrap_or(0)
            .min(u64::from(MATCH_TICKS));
        let mut m = codec::blank();
        codec::decode_into(&board.state, &mut m);
        let mut steps = 0u32;
        while u64::from(m.public.tick) < target && steps < MAX_STEPS && m.public.result.is_none()
        {
            let inputs = bot_inputs(&m, board.id);
            step(&mut m, &inputs, &mut NoEvents);
            steps = steps.saturating_add(1);
        }
        if steps > 0 {
            codec::encode(&m, &mut board.state);
        }
        board.steps_total = board.steps_total.saturating_add(u64::from(steps));
        board.max_steps = board.max_steps.max(u64::from(steps));
        Ok(())
    }

    /// Schedules `advance(id, 1)` every `interval_ms` for `iterations` runs (check 3).
    pub fn schedule_crank<'info>(
        ctx: Context<'info, ScheduleCrank<'info>>,
        id: u64,
        task_id: i64,
        interval_ms: i64,
        iterations: i64,
    ) -> Result<()> {
        let ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.board.key(), false),
                AccountMeta::new(ctx.accounts.log.key(), false),
            ],
            data: anchor_lang::InstructionData::data(&crate::instruction::Advance { _id: id, source: 1 }),
        };
        let accounts: &'info ScheduleCrank<'info> = ctx.accounts;
        ScheduleCrankCpi {
            payer: &accounts.payer,
            magic_program: &accounts.magic_program,
            instruction_accounts: &[
                accounts.payer.to_account_info(),
                accounts.board.to_account_info(),
                accounts.log.to_account_info(),
            ],
            args: ScheduleTaskArgs {
                task_id,
                execution_interval_millis: interval_ms,
                iterations,
                instructions: vec![ix],
            },
        }
        .invoke()?;
        Ok(())
    }

    /// Check 2: the rig lands in the private Secret only. No `msg!` of the secret.
    pub fn plant_rig(ctx: Context<PlantRig>, _id: u64, cell: u8, salt: [u8; 16]) -> Result<()> {
        write_rig(&mut ctx.accounts.secret, ctx.accounts.player.key(), cell, salt);
        Ok(())
    }

    /// Check 2, realistic variant: the same tx also writes the public Board (in the real game
    /// every player instruction runs `advance` first).
    pub fn plant_rig_board(
        ctx: Context<PlantRigBoard>,
        _id: u64,
        cell: u8,
        salt: [u8; 16],
    ) -> Result<()> {
        write_rig(&mut ctx.accounts.secret, ctx.accounts.player.key(), cell, salt);
        let mut board = ctx.accounts.board.load_mut()?;
        board.plants = board.plants.saturating_add(1);
        Ok(())
    }

    /// Check 1: the program reads the private Secret and publishes a value derived from it.
    pub fn prove_read(ctx: Context<ProveRead>, _id: u64) -> Result<()> {
        let echo = ctx.accounts.secret.value ^ 0x5A5A_5A5A_5A5A_5A5A;
        ctx.accounts.board.load_mut()?.secret_echo = echo;
        Ok(())
    }

    /// Check 1b: per-player private account (member = the peeker).
    pub fn write_peek(ctx: Context<WritePeek>, _id: u64, value: u64) -> Result<()> {
        ctx.accounts.peek.value = value;
        Ok(())
    }

    /// Check 4: request the match seed from the ER VRF queue.
    pub fn request_seed(ctx: Context<RequestSeed>, _id: u64, client_seed: u8) -> Result<()> {
        ctx.accounts.board.load_mut()?.vrf_req_slot = Clock::get()?.slot;
        let ix = create_request_randomness_ix_const(
            RequestRandomnessParams {
                payer: ctx.accounts.payer.key(),
                oracle_queue: ctx.accounts.oracle_queue.key(),
                callback_program_id: crate::ID,
                callback_discriminator: crate::instruction::CallbackSeed::DISCRIMINATOR.to_vec(),
                caller_seed: [client_seed; 32],
                accounts_metas: Some(vec![
                    SerializableAccountMeta {
                        pubkey: ctx.accounts.secret.key(),
                        is_signer: false,
                        is_writable: true,
                    },
                    SerializableAccountMeta {
                        pubkey: ctx.accounts.board.key(),
                        is_signer: false,
                        is_writable: true,
                    },
                ]),
                callback_args: None,
            },
            PROGRAM_IDENTITY,
        );
        ctx.accounts
            .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
        Ok(())
    }

    /// VRF callback: the seed goes to the private Secret; only the slot is public.
    pub fn callback_seed(ctx: Context<CallbackSeed>, randomness: [u8; 32]) -> Result<()> {
        let secret = &mut ctx.accounts.secret;
        secret.seed = randomness;
        secret.seed_count = secret.seed_count.saturating_add(1);
        let mut board = ctx.accounts.board.load_mut()?;
        board.vrf_cb_slot = Clock::get()?.slot;
        board.vrf_cb_count = board.vrf_cb_count.saturating_add(1);
        Ok(())
    }

    /// Extra b: decode → `n` ticks of the real sim at worst case → encode, logging CU between
    /// phases. Run by simulation (nothing persists).
    pub fn bench(ctx: Context<BenchRun>, _id: u64, n: u16, with_bot: bool) -> Result<()> {
        let mut bench = ctx.accounts.bench.load_mut()?;
        log_cu();
        let mut m = codec::blank();
        codec::decode_into(&bench.state, &mut m);
        log_cu();
        for _ in 0..n {
            let inputs = if with_bot {
                bot_inputs(&m, bench.id)
            } else {
                Inputs::default()
            };
            step(&mut m, &inputs, &mut NoEvents);
        }
        log_cu();
        codec::encode(&m, &mut bench.state);
        log_cu();
        msg!(
            "bench n={} bot={} tick={} live={}/{}",
            n,
            with_bot,
            m.public.tick,
            m.public.sides[0].cohort_len,
            m.public.sides[1].cohort_len
        );
        Ok(())
    }

    /// Check 6: mark finished, then commit + undelegate every delegated account of the run,
    /// with the `settle_action` post-commit Magic Action unless `with_action` is false.
    pub fn finish(ctx: Context<Finish>, id: u64, with_action: bool) -> Result<()> {
        let recipient = {
            let mut board = ctx.accounts.board.load_mut()?;
            board.finished = 1;
            board.recipient
        };
        let accounts = [
            ctx.accounts.board.to_account_info(),
            ctx.accounts.secret.to_account_info(),
            ctx.accounts.peek.to_account_info(),
            ctx.accounts.log.to_account_info(),
        ];
        let builder = MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&accounts);
        if with_action {
            let id_bytes = id.to_le_bytes();
            let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, &id_bytes], &crate::ID);
            let meta = |pubkey: Pubkey, is_writable: bool| ShortAccountMeta {
                pubkey: pubkey.to_bytes().into(),
                is_writable,
            };
            let action = CallHandler {
                destination_program: crate::ID,
                accounts: vec![
                    meta(ctx.accounts.board.key(), false),
                    meta(vault, true),
                    meta(recipient, true),
                    meta(anchor_lang::system_program::ID, false),
                ],
                args: ActionArgs::new(anchor_lang::InstructionData::data(
                    &crate::instruction::SettleAction { id },
                )),
                escrow_authority: ctx.accounts.payer.to_account_info(),
                compute_units: 200_000,
            };
            builder.add_post_commit_actions([action]).build_and_invoke()?;
        } else {
            builder.build_and_invoke()?;
        }
        Ok(())
    }

    pub fn undelegate_bench(ctx: Context<UndelegateBench>, _id: u64) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.bench.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

// ---------------------------------------------------------------------- helpers

fn seed_prefix(kind: u8) -> Result<&'static [u8]> {
    Ok(match kind {
        0 => BOARD_SEED,
        1 => SECRET_SEED,
        2 => PEEK_SEED,
        3 => LOG_SEED,
        4 => BENCH_SEED,
        _ => return err!(SpikeError::BadKind),
    })
}

/// Logs "Program consumption: N units remaining" (the bench script diffs these).
fn log_cu() {
    #[cfg(target_os = "solana")]
    // SAFETY: a plain syscall with no arguments.
    unsafe {
        solana_define_syscall::definitions::sol_log_compute_units_()
    }
}

fn fund<'info>(
    payer: &Signer<'info>,
    to: AccountInfo<'info>,
    lamports: u64,
    system_program: &Program<'info, System>,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }
    transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: payer.to_account_info(),
                to,
            },
        ),
        lamports,
    )
}

fn new_match(id: u64) -> MatchState {
    MatchState::new(
        mix64(id),
        MatchOptions {
            stake: 1_000_000,
            bot: [true, true],
            tutorial: false,
        },
    )
}

/// Both sides driven by the Warlord bot (fresh per tick; good enough for the spike).
fn bot_inputs(m: &MatchState, id: u64) -> Inputs {
    let t = u64::from(m.public.tick);
    let mut a = Warlord::new(0, mix64(id ^ t ^ 0xB0B0));
    let mut b = Warlord::new(1, mix64(id ^ t ^ 0xB1B1));
    Inputs {
        sides: [a.decide(&m.public), b.decide(&m.public)],
    }
}

fn write_rig(secret: &mut Secret, player: Pubkey, cell: u8, salt: [u8; 16]) {
    secret.rig_cell = cell;
    secret.salt = salt;
    let mut v = [0u8; 8];
    v.copy_from_slice(&salt[..8]);
    secret.value = u64::from_le_bytes(v);
    secret.planted_by = player;
}

/// `(finished, recipient)` from raw Board account data (discriminator checked).
fn board_head(data: &[u8]) -> Result<(u8, Pubkey)> {
    require!(
        data.get(..8) == Some(Board::DISCRIMINATOR),
        SpikeError::BadBoard
    );
    let r0 = 8 + core::mem::offset_of!(Board, recipient);
    let f0 = 8 + core::mem::offset_of!(Board, finished);
    let recipient = data
        .get(r0..r0 + 32)
        .and_then(|b| <[u8; 32]>::try_from(b).ok())
        .ok_or(SpikeError::BadBoard)?;
    let finished = *data.get(f0).ok_or(SpikeError::BadBoard)?;
    Ok((finished, Pubkey::new_from_array(recipient)))
}

fn pay_out<'info>(
    id: u64,
    vault_bump: u8,
    vault: &SystemAccount<'info>,
    recipient_ai: &UncheckedAccount<'info>,
    recipient: Pubkey,
    system_program: &Program<'info, System>,
) -> Result<()> {
    require_keys_eq!(recipient_ai.key(), recipient, SpikeError::WrongRecipient);
    let amount = vault.lamports();
    require!(amount > 0, SpikeError::AlreadySettled);
    let id_bytes = id.to_le_bytes();
    let seeds: &[&[u8]] = &[VAULT_SEED, &id_bytes, &[vault_bump]];
    transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            Transfer {
                from: vault.to_account_info(),
                to: recipient_ai.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )
}

// ---------------------------------------------------------------------- accounts

#[account(zero_copy)]
pub struct Board {
    pub id: u64,
    pub authority: Pubkey,
    pub recipient: Pubkey,
    pub finished: u8,
    pub settled: u8,
    pub _pad: [u8; 6],
    pub start_slot: u64,
    pub last_slot: u64,
    pub crank_calls: u64,
    pub other_calls: u64,
    pub steps_total: u64,
    pub max_steps: u64,
    pub plants: u64,
    pub vrf_req_slot: u64,
    pub vrf_cb_slot: u64,
    pub vrf_cb_count: u64,
    pub secret_echo: u64,
    pub state: [u8; STATE_CAP],
}

#[account(zero_copy)]
pub struct CrankLog {
    pub n: u32,
    pub _pad: u32,
    pub first_slot: u64,
    pub deltas: [u16; LOG_CAP],
}

#[account(zero_copy)]
pub struct Bench {
    pub id: u64,
    pub state: [u8; STATE_CAP],
}

#[account]
pub struct Secret {
    pub id: u64,
    pub rig_cell: u8,
    pub salt: [u8; 16],
    pub value: u64,
    pub seed: [u8; 32],
    pub seed_count: u32,
    pub planted_by: Pubkey,
}

impl Secret {
    pub const LEN: usize = 8 + 1 + 16 + 8 + 32 + 4 + 32;
}

#[account]
pub struct Peek {
    pub id: u64,
    pub owner: Pubkey,
    pub value: u64,
}

impl Peek {
    pub const LEN: usize = 8 + 32 + 8;
}

// ---------------------------------------------------------------------- contexts

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Init<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Board>(),
        seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(init, payer = payer, space = 8 + Secret::LEN,
        seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: Account<'info, Secret>,
    #[account(init, payer = payer, space = 8 + Peek::LEN,
        seeds = [PEEK_SEED, &id.to_le_bytes()], bump)]
    pub peek: Account<'info, Peek>,
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<CrankLog>(),
        seeds = [LOG_SEED, &id.to_le_bytes()], bump)]
    pub log: AccountLoader<'info, CrankLog>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct InitBench<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + core::mem::size_of::<Bench>(),
        seeds = [BENCH_SEED, &id.to_le_bytes()], bump)]
    pub bench: AccountLoader<'info, Bench>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegatePda<'info> {
    /// CHECK: one of this program's PDAs; the seeds passed to `delegate_pda` must derive it.
    #[account(mut, del)]
    pub pda: UncheckedAccount<'info>,
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Settle<'info> {
    /// Owner check: only an undelegated (final, committed) Board loads.
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal board.recipient (checked in pay_out).
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[action]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct SettleAction<'info> {
    /// CHECK: owned by the delegation program or this program depending on undelegation
    /// progress; pinned by seeds and read raw (discriminator checked in board_head).
    #[account(seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    /// CHECK: must equal the committed board.recipient (checked in pay_out).
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: the program that scheduled the action (passed by the delegation program).
    #[account(address = crate::ID)]
    pub source_program: UncheckedAccount<'info>,
    /// CHECK: the escrow authority the action was scheduled with (the finisher).
    pub escrow_auth: UncheckedAccount<'info>,
    /// CHECK: only the delegation program can sign for this PDA, so `signer` proves the call
    /// came through the real post-commit path.
    #[account(signer, address = ephemeral_rollups_sdk::pda::ephemeral_balance_pda_from_payer(
        &escrow_auth.key(), ACTION_ESCROW_INDEX))]
    pub escrow: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CloseAll<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, close = authority, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut, close = authority, seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: Account<'info, Secret>,
    #[account(mut, close = authority, seeds = [PEEK_SEED, &id.to_le_bytes()], bump)]
    pub peek: Account<'info, Peek>,
    #[account(mut, close = authority, seeds = [LOG_SEED, &id.to_le_bytes()], bump)]
    pub log: AccountLoader<'info, CrankLog>,
    #[account(mut, seeds = [VAULT_SEED, &id.to_le_bytes()], bump)]
    pub vault: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CloseBench<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, close = authority, seeds = [BENCH_SEED, &id.to_le_bytes()], bump)]
    pub bench: AccountLoader<'info, Bench>,
}

#[derive(Accounts)]
pub struct InitPermission<'info> {
    /// CHECK: one of this program's PDAs (checked against the kind's seeds in the handler).
    #[account(mut)]
    pub permissioned_account: UncheckedAccount<'info>,
    /// CHECK: checked by the permission program.
    #[account(mut)]
    pub permission: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
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

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct OnBoard<'info> {
    pub payer: Signer<'info>,
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Advance<'info> {
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
    #[account(mut, seeds = [LOG_SEED, &id.to_le_bytes()], bump)]
    pub log: AccountLoader<'info, CrankLog>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct ScheduleCrank<'info> {
    /// CHECK: magic program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: passed to the CPI; unchecked so Anchor does not write stale data after it.
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: UncheckedAccount<'info>,
    /// CHECK: as above.
    #[account(mut, seeds = [LOG_SEED, &id.to_le_bytes()], bump)]
    pub log: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct PlantRig<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: Account<'info, Secret>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct PlantRigBoard<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: Account<'info, Secret>,
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct ProveRead<'info> {
    #[account(seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: Account<'info, Secret>,
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct WritePeek<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes()], bump,
        constraint = peek.owner == player.key() @ SpikeError::NotAuthority)]
    pub peek: Account<'info, Peek>,
}

#[vrf]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct RequestSeed<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only its key goes into the callback metas.
    #[account(seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: UncheckedAccount<'info>,
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
    /// CHECK: the ER VRF queue.
    #[account(mut, address = DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

/// Scoped VRF identity PDA, derived at COMPILE time. SDK 0.18.0's `#[vrf_callback]` puts
/// `scoped_vrf_identity_const(&crate::ID)` inline in the account constraint, so it runs at
/// RUNTIME as software SHA-256 + ed25519 (~250k CU): every callback hit the oracle's ~300k CU
/// budget and failed (v1 of this spike). Declaring the field ourselves (the macro then skips its
/// own) with a `const` address keeps the same check for ~0 CU.
const VRF_IDENTITY: Pubkey = Pubkey::new_from_array(
    ephemeral_rollups_sdk::vrf::consts::scoped_vrf_identity_const(&crate::ID).0,
);

#[vrf_callback]
#[derive(Accounts)]
pub struct CallbackSeed<'info> {
    #[account(address = VRF_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub secret: Account<'info, Secret>,
    #[account(mut)]
    pub board: AccountLoader<'info, Board>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct BenchRun<'info> {
    #[account(mut, seeds = [BENCH_SEED, &id.to_le_bytes()], bump)]
    pub bench: AccountLoader<'info, Bench>,
}

#[commit]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Finish<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [BOARD_SEED, &id.to_le_bytes()], bump)]
    pub board: AccountLoader<'info, Board>,
    /// CHECK: committed as-is; unchecked so Anchor writes nothing after the commit CPI.
    #[account(mut, seeds = [SECRET_SEED, &id.to_le_bytes()], bump)]
    pub secret: UncheckedAccount<'info>,
    /// CHECK: as above.
    #[account(mut, seeds = [PEEK_SEED, &id.to_le_bytes()], bump)]
    pub peek: UncheckedAccount<'info>,
    /// CHECK: as above.
    #[account(mut, seeds = [LOG_SEED, &id.to_le_bytes()], bump)]
    pub log: UncheckedAccount<'info>,
}

#[commit]
#[derive(Accounts)]
#[instruction(id: u64)]
pub struct UndelegateBench<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: committed as-is.
    #[account(mut, seeds = [BENCH_SEED, &id.to_le_bytes()], bump)]
    pub bench: UncheckedAccount<'info>,
}

#[error_code]
pub enum SpikeError {
    #[msg("unknown account kind")]
    BadKind,
    #[msg("not the authority")]
    NotAuthority,
    #[msg("run not finished")]
    NotFinished,
    #[msg("already settled")]
    AlreadySettled,
    #[msg("wrong recipient")]
    WrongRecipient,
    #[msg("bad board data")]
    BadBoard,
}
