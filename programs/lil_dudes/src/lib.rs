//! Lil Dudes Go Brr: the on-chain 1v1 match (docs/TECH.md §4), rules v5 (docs/SPEC_V5.md on
//! docs/SPEC.md: both players race identical copies of one two-stage level, the Rush in place
//! after the breach of stage 1; Champion and Scout for both, no rig).
//!
//! Base layer: `create_match` → `join_match` → `delegate_match` (Match, Secrets, Peek×2 → the
//! TEE); `cancel_match` refunds a match that never got there.
//! TEE: `init_permissions` → `request_seed` ×2 (private salts; the second requests the ER VRF)
//! → `callback_seed` → `start` (schedules the 50 ms crank) → `advance` (crank) with `set_aim`,
//! `champion`, `peek_cell` from the players' burners → `finish` (publish seed + history, commit +
//! undelegate, Magic Action `settle_action`). Fallback: anyone calls `settle` on the base layer.
// Anchor 1.0.2's `#[program]` codegen trips this lint (Cargo.lock pins the macro crates to 1.0.2;
// see docs/TECH.md §6).
#![allow(clippy::diverging_sub_expression)]
// ScheduleCrankCpi: the TEE runs validator 1.1.1 (legacy ScheduleTask).
#![allow(deprecated)]
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod base;
pub mod errors;
pub mod game;
pub mod state;
pub mod tee;

#[cfg(feature = "bench")]
mod bench;

pub use base::*;
#[cfg(feature = "bench")]
use bench::*;
pub use tee::*;

declare_id!("4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa");

#[ephemeral]
#[program]
pub mod lil_dudes {
    use super::*;

    // ------------------------------------------------------------ base layer

    pub fn create_match(
        ctx: Context<CreateMatch>,
        id: u64,
        pick: u64,
        burner: Pubkey,
        name: [u8; 16],
    ) -> Result<()> {
        base::handle_create_match(ctx, id, pick, burner, name)
    }

    pub fn join_match(
        ctx: Context<JoinMatch>,
        id: u64,
        pick: u64,
        burner: Pubkey,
        name: [u8; 16],
    ) -> Result<()> {
        base::handle_join_match(ctx, id, pick, burner, name)
    }

    pub fn delegate_match(ctx: Context<DelegateMatch>, id: u64) -> Result<()> {
        base::handle_delegate_match(ctx, id)
    }

    pub fn cancel_match(ctx: Context<CancelMatch>, id: u64) -> Result<()> {
        base::handle_cancel_match(ctx, id)
    }

    pub fn settle(ctx: Context<Settle>, id: u64) -> Result<()> {
        base::handle_settle(ctx, id)
    }

    pub fn settle_action(ctx: Context<SettleAction>, id: u64) -> Result<()> {
        base::handle_settle_action(ctx, id)
    }

    pub fn close_match(ctx: Context<CloseMatch>, id: u64) -> Result<()> {
        base::handle_close_match(ctx, id)
    }

    // ------------------------------------------------------------ TEE

    pub fn init_permissions(ctx: Context<InitPermissions>) -> Result<()> {
        tee::handle_init_permissions(ctx)
    }

    pub fn request_seed(ctx: Context<RequestSeed>, salt: [u8; 32]) -> Result<()> {
        tee::handle_request_seed(ctx, salt)
    }

    pub fn callback_seed(ctx: Context<CallbackSeed>, randomness: [u8; 32]) -> Result<()> {
        tee::handle_callback_seed(ctx, randomness)
    }

    pub fn start<'info>(ctx: Context<'info, Start<'info>>) -> Result<()> {
        tee::handle_start(ctx)
    }

    pub fn advance(ctx: Context<Advance>) -> Result<()> {
        tee::handle_advance(ctx)
    }

    pub fn set_aim(ctx: Context<SetAim>, x: i16) -> Result<()> {
        tee::handle_set_aim(ctx, x)
    }

    pub fn champion(ctx: Context<PlayerInput>) -> Result<()> {
        tee::handle_champion(ctx)
    }

    // `cell` is a gate slot since rules v3 (name kept so the IDL does not change).
    pub fn peek_cell(ctx: Context<PlayerSecret>, cell: u8) -> Result<()> {
        tee::handle_peek_cell(ctx, cell)
    }

    pub fn finish(ctx: Context<Finish>) -> Result<()> {
        tee::handle_finish(ctx)
    }

    /// Compute measurement only (feature "bench"), see bench.rs.
    #[cfg(feature = "bench")]
    pub fn bench(ctx: Context<Bench>, n: u16, with_bot: bool) -> Result<()> {
        bench::handler(ctx, n, with_bot)
    }
}
