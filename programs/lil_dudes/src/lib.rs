//! Lil Dudes Go Brr: on-chain program.
//!
//! Scaffold only. The real instructions (create/join/delegate/start/advance/set_aim/plant_rig/
//! peek/finish/settle) arrive in M3–M5; see docs/TECH.md §4 and docs/MVP.md §7.
// Anchor 1.0.2's `#[program]` codegen trips this lint (Cargo.lock pins the macro crates to 1.0.2;
// see docs/TECH.md §6).
#![allow(clippy::diverging_sub_expression)]
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

declare_id!("4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa");

#[ephemeral]
#[program]
pub mod lil_dudes {
    use super::*;

    /// Placeholder so the program builds and deploys. Returns the sim's rules version.
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        msg!("lil_dudes sim rules v{}", lil_dudes_sim::RULES_VERSION);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub signer: Signer<'info>,
}
