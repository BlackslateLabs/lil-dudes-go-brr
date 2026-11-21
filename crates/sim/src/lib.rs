//! Lil Dudes Go Brr: match rules (docs/SPEC.md v2.1).
//!
//! Rules for this crate:
//! - Integer-only and deterministic: no floats, no `HashMap` iteration order, no clock, no RNG.
//!   Time (tick) and randomness (seed-derived deals) are inputs.
//! - No Solana dependencies. The same code runs in the program, in WASM and natively.
//!
//! Scaffold: constants and core types. The step function lands in M1.
#![cfg_attr(not(test), no_std)]

pub mod constants;
pub mod types;

pub use constants::*;
pub use types::*;

/// Bump when rules change in a way that changes outcomes (Verify must use the same version).
pub const RULES_VERSION: u16 = 0;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_is_consistent() {
        assert_eq!(MATCH_TICKS, 2_400);
        assert!(PLANT_STARTS.iter().all(|&t| t + PLANT_TICKS <= MATCH_TICKS));
        assert!(SURGE_TICK > PLANT_STARTS[2] + PLANT_TICKS);
        assert_eq!(FIRE_TICKS_SURGE * 2, FIRE_TICKS);
    }

    #[test]
    fn rows_sit_before_the_clash_zone() {
        assert!(ROW_Y[2] < CLASH_START_Y);
        assert!(CLASH_END_Y < LANE_LENGTH);
        assert!(GATE_WIDTH <= COL_WIDTH);
    }
}
