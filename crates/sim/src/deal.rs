//! Gate values (SPEC §6): dealt per stage from the match seed, identical in both copies. A pure
//! function of the seed, so Verify can re-derive every stage after the match.

use crate::constants::{GATES_MAX, STAGES};
use crate::layouts::{layout_for, stage, Slot};
use crate::rng::{deal_rng, SplitMix64};
use crate::types::GateOp;

/// SPEC §6: normal slot multipliers with their odds in percent.
pub const NORMAL_ODDS: [(u8, u64); 5] = [(2, 47), (3, 34), (4, 12), (5, 4), (6, 3)];
/// SPEC §6: big slot multipliers with their odds in percent.
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

/// One stage's values: one draw per gate slot, in slot order, from that stage's RNG.
pub fn deal_stage(seed: u64, layout: u8, stage_ix: u8) -> [GateOp; GATES_MAX] {
    let mut rng = deal_rng(seed, stage_ix);
    let mut out = [NO_GATE; GATES_MAX];
    for (v, g) in out.iter_mut().zip(stage(layout, stage_ix).gates.iter()) {
        *v = draw(&mut rng, g.slot);
    }
    out
}

fn draw(rng: &mut SplitMix64, slot: Slot) -> GateOp {
    let odds: &[(u8, u64)] = match slot {
        Slot::Normal => &NORMAL_ODDS,
        Slot::Big => &BIG_ODDS,
    };
    let mut roll = rng.below(100);
    for &(k, pct) in odds {
        if roll < pct {
            return GateOp::Mul(k);
        }
        roll = roll.saturating_sub(pct);
    }
    // Unreachable while the odds sum to 100 (tested); the last value is the safe fallback.
    GateOp::Mul(odds.last().map_or(2, |&(k, _)| k))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layouts::LAYOUTS;

    #[test]
    fn odds_sum_to_100() {
        assert_eq!(NORMAL_ODDS.iter().map(|o| o.1).sum::<u64>(), 100);
        assert_eq!(BIG_ODDS.iter().map(|o| o.1).sum::<u64>(), 100);
    }

    #[test]
    fn values_follow_the_slot_distributions() {
        let mut normal = [0u32; 11];
        let mut bigs = [0u32; 11];
        let (mut n_normal, mut n_big) = (0u32, 0u32);
        for seed in 0..6_000u64 {
            let d = Deal::new(seed);
            assert_eq!(usize::from(d.layout), seed as usize % LAYOUTS.len());
            for (s, st) in LAYOUTS[usize::from(d.layout)].stages.iter().enumerate() {
                for (slot, v) in d.values[s].iter().enumerate() {
                    let Some(g) = st.gates.get(slot) else {
                        assert_eq!(*v, NO_GATE);
                        continue;
                    };
                    let GateOp::Mul(k) = *v else {
                        panic!("v4 deal holds only ×k")
                    };
                    match g.slot {
                        Slot::Normal => {
                            normal[usize::from(k)] += 1;
                            n_normal += 1;
                        }
                        Slot::Big => {
                            bigs[usize::from(k)] += 1;
                            n_big += 1;
                        }
                    }
                }
            }
        }
        let pct = |n: u32, of: u32| n * 1000 / of;
        for (k, want) in NORMAL_ODDS {
            let got = pct(normal[usize::from(k)], n_normal);
            assert!(got.abs_diff(want as u32 * 10) <= 15, "×{k}: {got}‰");
        }
        for (k, want) in BIG_ODDS {
            let got = pct(bigs[usize::from(k)], n_big);
            assert!(got.abs_diff(want as u32 * 10) <= 30, "big ×{k}: {got}‰");
        }
        assert_eq!(normal.iter().sum::<u32>(), n_normal);
        assert_eq!(bigs.iter().sum::<u32>(), n_big);
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
