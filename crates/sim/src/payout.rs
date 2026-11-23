//! Match result and the money moved (SPEC §8, SPEC_V5 §7). Integer only; every floor favours
//! the loser.
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

/// SPEC_V5 §7. `stake` = the matched stake S each player escrowed; `gold` = the scores.
/// - one player died: the survivor wins, `moved = S`;
/// - both died (same tick), or both alive with equal scores: draw, nothing moves;
/// - both alive, `w > l`: the winner keeps their stake and takes `2 × margin` of the loser's:
///   `slice_bps = min(10_000, floor(20_000 · (w − l) / (w + l)))`,
///   `moved = floor(S · slice_bps / 10_000)` (all of it once `w ≥ 3·l`);
/// - `fee = floor(moved · FEE_BPS / 10_000)`; the winner nets `S + moved − fee`, the loser
///   `S − moved`.
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
            (w, mul_div(stake, slice_bps(gw, gl), 10_000))
        }
    };
    MatchResult {
        winner: Some(winner),
        ko,
        moved,
        fee: mul_div(moved, FEE_BPS, 10_000),
    }
}

/// SPEC_V5 §7: the winner's slice of the loser's stake in basis points, `2 × margin` capped at
/// all of it. `w > l` (else 0).
pub fn slice_bps(w: u32, l: u32) -> u64 {
    let lead = u64::from(w.saturating_sub(l));
    let total = u64::from(w).saturating_add(u64::from(l));
    mul_div(20_000, lead, total).min(10_000)
}

/// floor(a · b / d) without overflow (a·b fits in u128); 0 when d = 0.
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

    #[test]
    fn spec_table() {
        // SPEC_V5 §7 table, at S = 0.1 SOL.
        const S: u64 = 100_000_000;
        let nets = |r: MatchResult| (S + r.moved - r.fee, S - r.moved, r.fee);
        let death = payout(S, [false, true], [300, 900]);
        assert_eq!((death.winner, death.ko), (Some(0), true));
        assert_eq!(nets(death), (195_000_000, 0, 5_000_000));
        for (w, l, want) in [
            (401, 399, (100_475_000, 99_500_000, 25_000)),
            (520, 480, (107_600_000, 92_000_000, 400_000)),
            (600, 400, (138_000_000, 60_000_000, 2_000_000)),
            (700, 300, (176_000_000, 20_000_000, 4_000_000)),
            (750, 250, (195_000_000, 0, 5_000_000)),
            (900, 100, (195_000_000, 0, 5_000_000)),
        ] {
            let r = payout(S, [false, false], [l, w]);
            assert_eq!((r.winner, r.ko), (Some(1), false));
            assert_eq!(nets(r), want, "{w}-{l}");
        }
        assert_eq!(slice_bps(401, 399), 50);
        assert_eq!(slice_bps(3, 1), 10_000);
        assert_eq!(slice_bps(1, 0), 10_000);
        assert_eq!(slice_bps(0, 1), 0);
        let draw = payout(S, [false, false], [500, 500]);
        assert_eq!((draw.winner, draw.moved, draw.fee), (None, 0, 0));
    }

    #[test]
    fn double_death_and_no_gold_are_draws() {
        const S: u64 = 1_000_000_000;
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
                // The exact rational slice (2 × margin, capped) is never rounded up.
                let (gw, gl) = (u128::from(a.max(b)), u128::from(a.min(b)));
                let exact = (u128::from(stake) * 2 * (gw - gl)).min(u128::from(stake) * (gw + gl));
                assert!(u128::from(r.moved) * (gw + gl) <= exact);
                // winner + loser + fee = 2S.
                let st = u128::from(stake);
                let (mv, fee) = (u128::from(r.moved), u128::from(r.fee));
                assert_eq!(st + mv - fee + (st - mv) + fee, 2 * st);
            }
        }
        assert_eq!(payout(100, [false, false], [1, 0]).moved, 100);
        assert_eq!(payout(u64::MAX, [true, false], [0, 0]).moved, u64::MAX);
    }
}
