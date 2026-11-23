//! Gate values (SPEC §6): dealt per stage from the match seed, identical in both copies. A pure
//! function of the seed, so Verify can re-derive every stage after the match.

use crate::constants::{GATES_MAX, STAGES};
use crate::layouts::{layout_for, stage, Slot};
use crate::rng::{deal_rng, SplitMix64};
use crate::types::GateOp;

/// SPEC_V5 §3: what a normal `?` slot holds, with its odds in percent. `Add(0)` / `Sub(0)` stand
/// for ±N, with N set by the gate's row (`PM_BY_ROW`).
pub const NORMAL_ODDS: [(GateOp, u64); 8] = [
    (GateOp::Mul(2), 30),
    (GateOp::Mul(3), 20),
    (GateOp::Mul(4), 8),
    (GateOp::Mul(5), 2),
    (GateOp::Add(0), 12),
    (GateOp::Div(2), 14),
    (GateOp::Sub(0), 12),
    (GateOp::Div(3), 2),
];
/// SPEC_V5 §3: N of a ±N gate by row index (row 1 = index 0 has none: there a ±N draw is
/// re-drawn as × or ÷ from `NORMAL_ODDS` without the ± entries; rows past the table use its
/// last N).
pub const PM_BY_ROW: [u8; 6] = [0, 5, 15, 30, 30, 30];
/// The odds mass of the × and ÷ entries (what a row-1 re-draw rolls over).
pub const MUL_DIV_PCT: u64 = 76;
/// SPEC_V5 §3: big slot multipliers with their odds in percent.
pub const BIG_ODDS: [(u8, u64); 3] = [(6, 30), (8, 40), (10, 30)];
/// The value of a slot the stage does not use.
pub const NO_GATE: GateOp = GateOp::Mul(1);

/// Every stage's gate values of a match, and its layout (all public once the seed is).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Deal {
    pub layout: u8,
    /// `values[stage][slot]`; unused slots hold `NO_GATE`.
    pub values: [[GateOp; GATES_MAX]; STAGES],
}

impl Deal {
    pub fn new(seed: u64) -> Self {
        let layout = layout_for(seed);
        let mut values = [[NO_GATE; GATES_MAX]; STAGES];
        for (s, v) in (0u8..).zip(values.iter_mut()) {
            *v = deal_stage(seed, layout, s);
        }
        Self { layout, values }
    }

    pub fn op(&self, stage: u8, slot: u8) -> GateOp {
        self.values
            .get(usize::from(stage))
            .and_then(|v| v.get(usize::from(slot)))
            .copied()
            .unwrap_or(NO_GATE)
    }
}

/// One stage's values, in slot order, from that stage's RNG: one draw per hidden gate slot (two
/// for a ±N drawn on row 1); the timing gate draws nothing and holds NO_GATE.
pub fn deal_stage(seed: u64, layout: u8, stage_ix: u8) -> [GateOp; GATES_MAX] {
    let mut rng = deal_rng(seed, stage_ix);
    let mut out = [NO_GATE; GATES_MAX];
    for (v, g) in out.iter_mut().zip(stage(layout, stage_ix).gates.iter()) {
        // Public slots (timing gate, hazards, turbo pads): nothing to deal (they keep NO_GATE).
        if g.slot.hidden() {
            *v = draw(&mut rng, g.slot, g.row);
        }
    }
    out
}

fn is_pm(op: GateOp) -> bool {
    matches!(op, GateOp::Add(_) | GateOp::Sub(_))
}

/// The entry of `odds` that `roll` (0..sum of the odds) lands on, skipping ±N when `pm` is false.
fn pick(roll: u64, pm: bool) -> GateOp {
    let mut roll = roll;
    for &(op, pct) in NORMAL_ODDS.iter().filter(|(op, _)| pm || !is_pm(*op)) {
        if roll < pct {
            return op;
        }
        roll = roll.saturating_sub(pct);
    }
    // Unreachable while the odds sum to 100 / MUL_DIV_PCT (tested): the safe fallback.
    GateOp::Mul(2)
}

fn draw(rng: &mut SplitMix64, slot: Slot, row: u8) -> GateOp {
    if slot == Slot::Big {
        let mut roll = rng.below(100);
        for &(k, pct) in &BIG_ODDS {
            if roll < pct {
                return GateOp::Mul(k);
            }
            roll = roll.saturating_sub(pct);
        }
        return GateOp::Mul(BIG_ODDS.last().map_or(8, |&(k, _)| k));
    }
    let n = PM_BY_ROW
        .get(usize::from(row))
        .or(PM_BY_ROW.last())
        .copied()
        .unwrap_or(0);
    match pick(rng.below(100), true) {
        GateOp::Add(_) if n > 0 => GateOp::Add(n),
        GateOp::Sub(_) if n > 0 => GateOp::Sub(n),
        op if is_pm(op) => pick(rng.below(MUL_DIV_PCT), false),
        op => op,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layouts::LAYOUTS;

    #[test]
    fn odds_sum_to_100() {
        assert_eq!(NORMAL_ODDS.iter().map(|o| o.1).sum::<u64>(), 100);
        let mul_div: u64 = NORMAL_ODDS
            .iter()
            .filter(|o| !is_pm(o.0))
            .map(|o| o.1)
            .sum();
        assert_eq!(mul_div, MUL_DIV_PCT);
        assert_eq!(BIG_ODDS.iter().map(|o| o.1).sum::<u64>(), 100);
        assert_eq!(pick(99, true), GateOp::Div(3));
        assert_eq!(pick(MUL_DIV_PCT - 1, false), GateOp::Div(3));
    }

    #[test]
    fn values_follow_the_slot_distributions() {
        // SPEC_V5 §3: rows 2+ follow NORMAL_ODDS with N by row; row 1 has no ±N (re-drawn as ×
        // or ÷, so its × and ÷ odds scale by 100 / 76); big slots ×6 / ×8 / ×10.
        let mut first = std::collections::HashMap::<GateOp, u32>::new();
        let mut later = std::collections::HashMap::<GateOp, u32>::new();
        let mut bigs = std::collections::HashMap::<GateOp, u32>::new();
        for seed in 0..12_000u64 {
            let d = Deal::new(seed);
            assert_eq!(usize::from(d.layout), seed as usize % LAYOUTS.len());
            for (s, st) in LAYOUTS[usize::from(d.layout)].stages.iter().enumerate() {
                for (slot, &v) in d.values[s].iter().enumerate() {
                    let Some(g) = st.gates.get(slot) else {
                        assert_eq!(v, NO_GATE);
                        continue;
                    };
                    let map = match (g.slot, g.row) {
                        (Slot::Timing | Slot::Hazard | Slot::Turbo, _) => {
                            assert_eq!(v, NO_GATE);
                            continue;
                        }
                        (Slot::Big, _) => &mut bigs,
                        (_, 0) => &mut first,
                        _ => {
                            // ±N is sized to the row; count it as ±0 below.
                            let n = PM_BY_ROW[usize::from(g.row)];
                            assert!(!matches!(v, GateOp::Add(k) | GateOp::Sub(k) if k != n));
                            &mut later
                        }
                    };
                    let key = match v {
                        GateOp::Add(_) => GateOp::Add(0),
                        GateOp::Sub(_) => GateOp::Sub(0),
                        op => op,
                    };
                    *map.entry(key).or_default() += 1;
                }
            }
        }
        let check =
            |map: &std::collections::HashMap<GateOp, u32>, want: &[(GateOp, u64)], of: u64| {
                let n: u32 = map.values().sum();
                assert!(n > 2_000, "{n}");
                assert_eq!(map.len(), want.len(), "{map:?}");
                for &(op, pct) in want {
                    let got = u64::from(map[&op]) * 10_000 / u64::from(n);
                    let want = pct * 10_000 / of;
                    assert!(got.abs_diff(want) <= 150, "{op:?}: {got} vs {want}");
                }
            };
        check(&later, &NORMAL_ODDS, 100);
        let no_pm: Vec<_> = NORMAL_ODDS
            .iter()
            .copied()
            .filter(|o| !is_pm(o.0))
            .collect();
        check(&first, &no_pm, MUL_DIV_PCT);
        let big: Vec<_> = BIG_ODDS.iter().map(|&(k, p)| (GateOp::Mul(k), p)).collect();
        check(&bigs, &big, 100);
    }

    #[test]
    fn deal_is_deterministic_and_stages_differ() {
        assert_eq!(Deal::new(99), Deal::new(99));
        let differ = (0..60u64)
            .filter(|&s| {
                let d = Deal::new(s);
                d.values[0][..2] != d.values[1][..2]
            })
            .count();
        assert!(differ > 30, "{differ}");
        assert_eq!(Deal::new(5).op(9, 0), NO_GATE);
        assert_eq!(Deal::new(5).op(0, 200), NO_GATE);
    }
}
