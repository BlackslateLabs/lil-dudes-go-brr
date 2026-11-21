//! Match result and the money moved (SPEC §7). Integer only; every floor favours the loser.
//! Parity with tools/balance/settle_fuzz.py is tested in tests/settle_parity.rs.

use crate::constants::{FEE_BPS, FLOOR_PM, HP_MAX};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchResult {
    /// `None` = draw (equal HP at the timer, or both cannons KO'd on the same tick).
    pub winner: Option<u8>,
    /// Some cannon reached 0 HP.
    pub ko: bool,
    /// Lamports moved loser → winner (before the fee), at the given stake level.
    pub moved: u64,
    /// Fee to the treasury, taken out of `moved` (the winner nets `moved - fee`).
    pub fee: u64,
}

/// SPEC §7. `level` = the matched stake S (×2 if doubled, stretch). `hp` = final HP per side.
/// - draw: nothing moves;
/// - KO: `level` moves;
/// - timer: `lead_pm = floor((hp_w − hp_l)·1000 / HP_MAX)`,
///   `moved = floor(level · (500·1000 + 500·lead_pm) / 1_000_000)`;
/// - `fee = floor(moved · 500 / 10_000)`.
pub fn payout(level: u64, hp: [u32; 2]) -> MatchResult {
    let [a, b] = hp;
    let ko = a == 0 || b == 0;
    if a == b {
        return MatchResult {
            winner: None,
            ko,
            moved: 0,
            fee: 0,
        };
    }
    let (winner, hw, hl) = if a > b { (0, a, b) } else { (1, b, a) };
    let moved = if hl == 0 {
        level
    } else {
        let lead_pm = u64::from(hw.saturating_sub(hl))
            .saturating_mul(1000)
            .checked_div(u64::from(HP_MAX))
            .unwrap_or(0)
            .min(1000);
        let rate_ppm = FLOOR_PM
            .saturating_mul(1000)
            .saturating_add(1000u64.saturating_sub(FLOOR_PM).saturating_mul(lead_pm));
        mul_div(level, rate_ppm, 1_000_000)
    };
    let fee = mul_div(moved, FEE_BPS, 10_000);
    MatchResult {
        winner: Some(winner),
        ko,
        moved,
        fee,
    }
}

/// floor(a · b / d) without overflow (a·b fits in u128); the result never exceeds `a` here.
fn mul_div(a: u64, b: u64, d: u64) -> u64 {
    let q = u128::from(a)
        .saturating_mul(u128::from(b))
        .checked_div(u128::from(d))
        .unwrap_or(0);
    u64::try_from(q).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: u64 = 10_000_000; // "$10" in micro-units, as in the SPEC §7 table

    #[test]
    fn spec_table() {
        // SPEC §7 table (HP_MAX = 2200).
        let ko = payout(S, [880, 0]);
        assert_eq!(
            (ko.winner, ko.ko, ko.moved, ko.fee),
            (Some(0), true, 10_000_000, 500_000)
        );
        let clear = payout(S, [1320, 880]);
        assert_eq!(
            (clear.winner, clear.moved, clear.fee),
            (Some(0), 6_000_000, 300_000)
        );
        let close = payout(S, [1078, 1122]);
        assert_eq!((close.winner, close.ko), (Some(1), false));
        assert_eq!(close.moved, 5_100_000);
        let draw = payout(S, [1320, 1320]);
        assert_eq!((draw.winner, draw.moved, draw.fee), (None, 0, 0));
    }

    #[test]
    fn double_ko_is_a_draw() {
        let r = payout(S, [0, 0]);
        assert_eq!((r.winner, r.ko, r.moved), (None, true, 0));
    }

    #[test]
    fn floors_favour_the_loser_and_never_exceed_the_level() {
        for hw in 1..=HP_MAX {
            let r = payout(1_000_003, [hw, 0]);
            assert_eq!(r.moved, 1_000_003);
            let r = payout(1_000_003, [hw, hw.saturating_sub(1)]);
            assert!(r.moved >= 500_001 && r.moved <= 1_000_003);
            assert!(r.fee <= r.moved);
        }
        // No overflow at the extremes.
        let big = payout(u64::MAX, [HP_MAX, 1]);
        assert!(big.moved > u64::MAX / 2 && big.fee < big.moved);
        assert_eq!(payout(0, [5, 3]).moved, 0);
    }
}
