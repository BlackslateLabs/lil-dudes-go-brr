//! Lil Dudes Go Brr: match rules (docs/SPEC.md v4 + docs/SPEC_V5.md, a 1v1 race on identical
//! copies of a level).
//!
//! Rules for this crate:
//! - Integer-only and deterministic: no floats, no `HashMap`, no clock, no external RNG. Time
//!   (the tick) and randomness (the seed) are inputs.
//! - `no_std`, no allocation: fixed-size arrays, so the state maps onto the Match account.
//! - Never panics: checked/saturating arithmetic, no unwrap/expect/indexing that can fail
//!   (enforced by the clippy lints below).
//! - Secrets (true gate values, Scout peeks, seed) live in `SecretState`, apart from
//!   `PublicState`. The Warlord bot only ever gets `&PublicState`.
//! - No Solana dependencies. The same code runs in the program, in WASM and natively.
#![cfg_attr(not(test), no_std)]
#![cfg_attr(
    not(test),
    deny(
        clippy::indexing_slicing,
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::arithmetic_side_effects
    )
)]

pub mod bot;
pub mod codec;
pub mod constants;
pub mod deal;
pub mod events;
pub mod layouts;
pub mod payout;
pub mod rng;
pub mod state;
pub mod step;
pub mod types;

pub use bot::{Skill, Warlord};
pub use codec::{PUBLIC_LEN, SECRET_LEN};
pub use constants::*;
pub use deal::Deal;
pub use events::{Event, EventSink, Events, NoEvents, EVENT_CAP};
pub use layouts::{layout_for, Layout, Slot, LAYOUTS};
pub use payout::{payout, MatchResult};
pub use state::{
    Inputs, MatchOptions, MatchState, Peek, PrivateView, PublicGate, PublicSide, PublicState,
    SecretState, SideInput, StageLog,
};
pub use step::{apply_input, step};
pub use types::*;

/// Bump when rules change in a way that changes outcomes (Verify must use the same version).
pub const RULES_VERSION: u16 = 9;

/// Every stage's gate values and the layout of a match with this seed: what Verify re-derives
/// once the seed is published (SPEC §11).
pub fn deals_for(seed: u64) -> Deal {
    Deal::new(seed)
}
