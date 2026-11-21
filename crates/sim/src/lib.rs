//! Lil Dudes Go Brr: match rules (docs/SPEC.md v2.1).
//!
//! Rules for this crate:
//! - Integer-only and deterministic: no floats, no `HashMap`, no clock, no external RNG. Time
//!   (the tick) and randomness (the seed) are inputs.
//! - `no_std`, no allocation: fixed-size arrays, so the state maps onto the Match account.
//! - Never panics: checked/saturating arithmetic, no unwrap/expect/indexing that can fail
//!   (enforced by the clippy lints below).
//! - Secrets (true gate values, rigs, peeks, seed) live in `SecretState`, apart from
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

pub mod constants;
pub mod deal;
pub mod events;
pub mod payout;
pub mod rng;
pub mod state;
pub mod types;

pub use constants::*;
pub use deal::Deal;
pub use events::{Event, EventSink, Events, NoEvents, EVENT_CAP};
pub use payout::{payout, MatchResult};
pub use state::{
    Inputs, MatchOptions, MatchState, Peek, PrivateView, PublicGate, PublicSide, PublicState,
    SecretState, SideInput,
};
pub use types::*;

/// Bump when rules change in a way that changes outcomes (Verify must use the same version).
pub const RULES_VERSION: u16 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_is_consistent() {
        assert_eq!(MATCH_TICKS, 2_400);
        assert!(PLANT_STARTS.iter().all(|&t| t + PLANT_TICKS <= MATCH_TICKS));
        assert!(SURGE_TICK > PLANT_STARTS[2] + PLANT_TICKS);
        assert_eq!(FIRE_TICKS_SURGE * 2, FIRE_TICKS);
        // Surge keeps the volley cadence: phase 3 play start → Surge is a whole number of volleys.
        assert_eq!((SURGE_TICK - PLANT_STARTS[2] - PLANT_TICKS) % FIRE_TICKS, 0);
    }

    #[test]
    fn rows_sit_before_the_clash_zone() {
        assert!(ROW_Y[2] < CLASH_START_Y);
        assert!(CLASH_END_Y < LANE_LENGTH);
        assert!(GATE_WIDTH <= COL_WIDTH);
        // A cohort crosses at most one row per tick (rows apply in order).
        assert!(LAUNCH_SPEED < ROW_Y[1] - ROW_Y[0] && LAUNCH_SPEED < ROW_Y[2] - ROW_Y[1]);
        // Positions fit the i16 cohort fields.
        assert!(LANE_LENGTH + LAUNCH_SPEED < i16::MAX as i32 && LANE_WIDTH < i16::MAX as i32);
    }
}
