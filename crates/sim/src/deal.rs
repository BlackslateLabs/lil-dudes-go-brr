//! One mirrored deal of gates (SPEC §2, §4). Both sides get the same values in the same cells.

use crate::constants::{CELLS, HINT_PCT};
use crate::rng::deal_rng;
use crate::types::{GateOp, Hint};

/// SPEC §4: the deck per deal, `×2, ×2, ×2, ×3, +6, +6, +10, −6, ÷2`.
pub const DECK: [GateOp; CELLS] = [
    GateOp::Mul(2),
    GateOp::Mul(2),
    GateOp::Mul(2),
    GateOp::Mul(3),
    GateOp::Add(6),
    GateOp::Add(6),
    GateOp::Add(10),
    GateOp::Sub(6),
    GateOp::Div(2),
];
/// SPEC §4: the gold gate is ×3 or ÷3, 50/50, the same value on both sides.
pub const GOLD_GOOD: GateOp = GateOp::Mul(3);
pub const GOLD_BAD: GateOp = GateOp::Div(3);
/// SPEC §5: the MVP trap.
pub const RIG_OP: GateOp = GateOp::Div(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Deal {
    /// True value of each cell, identical on both sides (mirrored, SPEC §2). Rigs are applied on
    /// top of this (see `SecretState::true_op`).
    pub ops: [GateOp; CELLS],
    /// The cell holding the gold gate (same on both sides).
    pub gold_cell: u8,
    /// The hint each side's gate will show once play starts, before rigs. Flipped independently
    /// per side (SPEC §4: "each unrevealed gate").
    pub hints: [[Hint; CELLS]; 2],
}

impl Deal {
    /// The deal of `phase` is a pure function of the match seed (TECH §4).
    pub fn new(seed: u64, phase: u8) -> Self {
        let mut rng = deal_rng(seed, phase);

        // SPEC §4: shuffle the deck (Fisher–Yates).
        let mut ops = DECK;
        let mut i = CELLS;
        while i > 1 {
            let j = rng.below(i as u64) as usize;
            i = i.saturating_sub(1);
            ops.swap(i, j.min(i));
        }

        // SPEC §4: one random cell is replaced by the gold gate, ×3 or ÷3 at 50/50.
        let gold_cell = rng.below(CELLS as u64) as u8;
        let gold_op = if rng.below(2) == 0 {
            GOLD_GOOD
        } else {
            GOLD_BAD
        };
        if let Some(op) = ops.get_mut(usize::from(gold_cell)) {
            *op = gold_op;
        }

        // SPEC §4: each gate shows its true colour with HINT_PCT %, otherwise grey; gold shows gold.
        let mut hints = [[Hint::None; CELLS]; 2];
        for side in hints.iter_mut() {
            for (cell, (hint, op)) in side.iter_mut().zip(ops.iter()).enumerate() {
                *hint = if cell == usize::from(gold_cell) {
                    Hint::Gold
                } else if rng.below(100) < HINT_PCT {
                    if op.is_good() {
                        Hint::Good
                    } else {
                        Hint::Bad
                    }
                } else {
                    Hint::None
                };
            }
        }

        Self {
            ops,
            gold_cell,
            hints,
        }
    }

    pub fn op(&self, cell: u8) -> GateOp {
        self.ops
            .get(usize::from(cell))
            .copied()
            .unwrap_or(GateOp::Mul(1))
    }

    pub fn is_gold(&self, cell: u8) -> bool {
        cell == self.gold_cell
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(op: GateOp) -> (u8, u8) {
        match op {
            GateOp::Mul(k) => (0, k),
            GateOp::Add(n) => (1, n),
            GateOp::Sub(n) => (2, n),
            GateOp::Div(k) => (3, k),
        }
    }

    #[test]
    fn deal_is_the_deck_plus_one_gold() {
        for seed in 0..500u64 {
            for phase in 0..3u8 {
                let d = Deal::new(seed, phase);
                let g = usize::from(d.gold_cell);
                assert!(g < CELLS);
                let gold = d.ops[g];
                assert!(gold == GOLD_GOOD || gold == GOLD_BAD);
                // The 8 non-gold cells are the deck minus one card.
                let mut rest: Vec<_> = (0..CELLS)
                    .filter(|&c| c != g)
                    .map(|c| key(d.ops[c]))
                    .collect();
                rest.sort();
                let deck: Vec<_> = DECK.iter().map(|&o| key(o)).collect();
                let mut matched = false;
                for skip in 0..CELLS {
                    let mut d2: Vec<_> = deck
                        .iter()
                        .enumerate()
                        .filter(|&(i, _)| i != skip)
                        .map(|(_, &k)| k)
                        .collect();
                    d2.sort();
                    matched |= d2 == rest;
                }
                assert!(matched, "seed {seed} phase {phase}: {:?}", d.ops);
            }
        }
    }

    #[test]
    fn hints_are_true_or_grey_and_gold_is_gold() {
        let (mut shown, mut total) = (0u32, 0u32);
        for seed in 0..2000u64 {
            let d = Deal::new(seed, 1);
            for side in 0..2 {
                for c in 0..CELLS {
                    let h = d.hints[side][c];
                    if c == usize::from(d.gold_cell) {
                        assert_eq!(h, Hint::Gold);
                        continue;
                    }
                    total += 1;
                    match h {
                        Hint::Good => assert!(d.ops[c].is_good()),
                        Hint::Bad => assert!(!d.ops[c].is_good()),
                        Hint::None => continue,
                        Hint::Gold => panic!("gold hint on a normal gate"),
                    }
                    shown += 1;
                }
            }
        }
        let pct = shown * 100 / total;
        assert!((57..=63).contains(&pct), "hint rate {pct}%");
    }

    #[test]
    fn gold_is_fifty_fifty_and_spread_over_cells() {
        let mut good = 0;
        let mut cells = [0u32; CELLS];
        for seed in 0..4000u64 {
            let d = Deal::new(seed, 0);
            good += u32::from(d.ops[usize::from(d.gold_cell)] == GOLD_GOOD);
            cells[usize::from(d.gold_cell)] += 1;
        }
        assert!((1850..=2150).contains(&good), "gold ×3 in {good}/4000");
        assert!(cells.iter().all(|&n| (340..=560).contains(&n)), "{cells:?}");
    }

    #[test]
    fn deal_is_deterministic_and_phases_differ() {
        assert_eq!(Deal::new(99, 2), Deal::new(99, 2));
        let differ = (0..50u64)
            .filter(|&s| Deal::new(s, 0).ops != Deal::new(s, 1).ops)
            .count();
        assert!(differ > 40);
    }
}
