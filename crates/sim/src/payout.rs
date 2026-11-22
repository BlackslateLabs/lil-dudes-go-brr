//! Match result and the money moved (SPEC §8). Integer only; every floor favours the loser.
//! Parity with tools/balance/settle_fuzz.py is tested in tests/settle_parity.rs.

use crate::constants::FEE_BPS;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchResult {
    /// `None` = draw (equal gold, or both players died on the same tick).
    pub winner: Option<u8>,
    /// The match ended by a death (an enemy reached a cannon line).
    pub ko: bool,
    /// Lamports moved loser → winner (before the fee).
    pub moved: u64,
    /// Fee to the treasury, taken out of `moved` (the winner nets `moved - fee`).
    pub fee: u64,
}

/// SPEC §8. `stake` = the matched stake S each player escrowed.
/// - one player died: the survivor wins, `moved = S`;
/// - both died (same tick), or both alive with equal gold: draw, nothing moves;
/// - both alive: the pot 2S splits in the ratio of gold, so the winner (more gold) gains
///   `moved = floor(S · (g_w − g_l) / (g_w + g_l))` (= `share_w − S`, floored for the loser);
/// - `fee = floor(moved · FEE_BPS / 10_000)`.
pub fn payout(stake: u64, dead: [bool; 2], gold: [u32; 2]) -> MatchResult {
    let ko = dead[0] || dead[1];
    let draw = MatchResult {
        winner: None,
        ko,
        moved: 0,
        fee: 0,
    };
    let (winner, moved) = match dead {
        [true, true] => return draw,
        [true, false] => (1, stake),
        [false, true] => (0, stake),
        [false, false] => {
            let [a, b] = gold;
            if a == b {
                return draw;
            }
            let (w, gw, gl) = if a > b { (0, a, b) } else { (1, b, a) };
            let lead = u64::from(gw.saturating_sub(gl));
            let total = u64::from(gw).saturating_add(u64::from(gl));
            (w, mul_div(stake, lead, total))
        }
    };
    MatchResult {
        winner: Some(winner),
        ko,
        moved,
        fee: mul_div(moved, FEE_BPS, 10_000),
    }
}

/// floor(a · b / d) without overflow (a·b fits in u128); here b ≤ d, so the result ≤ a.
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

    const S: u64 = 1_000_000_000; // 1 SOL, as in the SPEC §8 table

    #[test]
    fn spec_table() {
        let death = payout(S, [false, true], [300, 900]);
        assert_eq!(
            (death.winner, death.ko, death.moved, death.fee),
            (Some(0), true, S, S / 20)
        );
        let clear = payout(S, [false, false], [900, 600]);
        assert_eq!(
            (clear.winner, clear.ko, clear.moved, clear.fee),
            (Some(0), false, 200_000_000, 10_000_000)
        );
        let close = payout(S, [false, false], [650, 700]);
        assert_eq!(close.winner, Some(1));
        assert_eq!(close.moved, 37_037_037); // 0.037… floored
        assert_eq!(close.fee, 1_851_851);
        let draw = payout(S, [false, false], [500, 500]);
        assert_eq!((draw.winner, draw.moved, draw.fee), (None, 0, 0));
    }

    #[test]
    fn double_death_and_no_gold_are_draws() {
        let r = payout(S, [true, true], [900, 0]);
        assert_eq!((r.winner, r.ko, r.moved), (None, true, 0));
        let r = payout(S, [false, false], [0, 0]);
        assert_eq!((r.winner, r.ko, r.moved), (None, false, 0));
    }

    #[test]
    fn floors_favour_the_loser_and_never_exceed_the_stake() {
        for (a, b) in [
            (1, 0),
            (0, 1),
            (7, 3),
            (3, 7),
            (1_000_000, 999_999),
            (u32::MAX, 1),
        ] {
            for stake in [0, 1, 3, 1_000_003, u64::MAX] {
                let r = payout(stake, [false, false], [a, b]);
                assert!(r.moved <= stake && r.fee <= r.moved);
                // The exact rational share is never rounded up for the winner.
                let (gw, gl) = (u128::from(a.max(b)), u128::from(a.min(b)));
                assert!(u128::from(r.moved) * (gw + gl) <= u128::from(stake) * (gw - gl));
            }
        }
        assert_eq!(payout(100, [false, false], [1, 0]).moved, 100);
        assert_eq!(payout(u64::MAX, [true, false], [0, 0]).moved, u64::MAX);
    }
}
