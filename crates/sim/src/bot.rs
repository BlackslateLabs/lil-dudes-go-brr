//! The Warlord bot (SPEC §9).
//!
//! It is handed `&PublicState` only. Hidden gate values, rigs, peeks and the match seed live in
//! `SecretState`, which it never receives, so it cannot read secrets by construction. Its own
//! randomness comes from its own seed, which the caller must supply independently of the match seed.
//! It also ignores its own peek results (they are private state it is not given).

use crate::constants::{CELLS, COLS, COL_WIDTH, LANE_LENGTH, ROWS, VOLLEY_SIZE};
use crate::rng::SplitMix64;
use crate::state::{other, PublicGate, PublicSide, PublicState, SideInput};
use crate::types::{GateOp, Hint, Status};

/// SPEC §9: pick a target every 2 ticks.
pub const THINK_TICKS: u32 = 2;
/// SPEC §9: an enemy cohort this close to the bot's cannon is a threat (~1.5 s at cruise).
pub const DEFEND_DIST: i32 = 3_000;
/// SPEC §9: alternate between equal options every 20–60 ticks.
pub const SWITCH_MIN: u32 = 20;
pub const SWITCH_MAX: u32 = 60;
/// SPEC §9 tutorial: holding back = aiming into the gap between columns 0 and 1, so the bot's
/// volleys pass no gates and stay at VOLLEY_SIZE (it cannot KO anyone in phase 1).
pub const HOLD_BACK_X: i32 = COL_WIDTH;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Warlord {
    side: u8,
    rng: SplitMix64,
    /// The column it is going for.
    col: u8,
    /// When it may switch to another equally good column.
    switch_at: u32,
}

impl Warlord {
    /// `seed` must not be derived from the match seed by anything the opponent can't see either;
    /// it only drives tie-breaks and the random rig/peek cells.
    pub fn new(side: u8, seed: u64) -> Self {
        Self {
            side,
            rng: SplitMix64::new(seed),
            col: 1,
            switch_at: 0,
        }
    }

    pub fn side(&self) -> u8 {
        self.side
    }

    /// The bot's input for the tick `view.tick` is about to process.
    pub fn decide(&mut self, view: &PublicState) -> SideInput {
        let mut input = SideInput::default();
        let (Some(me), Some(enemy)) = (view.side(self.side), view.side(other(self.side))) else {
            return input;
        };
        let status = view.status();
        // SPEC §9 tutorial: in phase 1 the bot holds back (no rig, no peek, no gates).
        let hold_back = view.options.tutorial && view.phase() == 0;

        // SPEC §9: it rigs and peeks at random cells.
        if status == Status::Plant && !me.rig_used && !hold_back {
            input.rig = self.random_cell(&enemy.gates, |g| !g.gold && g.revealed.is_none());
        }
        if status == Status::Playing && !me.peek_used && !hold_back {
            input.peek = self.random_cell(&me.gates, |g| g.revealed.is_none());
        }

        if status == Status::Ended || view.tick.checked_rem(THINK_TICKS) != Some(0) {
            return input;
        }
        input.aim = Some(if hold_back {
            HOLD_BACK_X
        } else if let Some(x) = threat(enemy) {
            // SPEC §9.1: defend if an enemy cohort is close to its cannon.
            x
        } else {
            // SPEC §9.2–4: best known column; alternate between ties; with nothing known all
            // columns tie, so it drifts between them.
            col_centre(self.pick_column(view.tick, me))
        });
        input
    }

    fn random_cell(
        &mut self,
        gates: &[PublicGate; CELLS],
        ok: impl Fn(&PublicGate) -> bool,
    ) -> Option<u8> {
        let mut cells = [0u8; CELLS];
        let mut n = 0usize;
        for (cell, g) in (0u8..).zip(gates.iter()) {
            if let (true, Some(slot)) = (ok(g), cells.get_mut(n)) {
                *slot = cell;
                n = n.saturating_add(1);
            }
        }
        let pick = self.rng.below(n as u64) as usize;
        (n > 0).then(|| cells.get(pick).copied()).flatten()
    }

    fn pick_column(&mut self, tick: u32, me: &PublicSide) -> u8 {
        let mut scores = [0u32; COLS];
        for (col, score) in (0u8..).zip(scores.iter_mut()) {
            *score = column_score(me, col);
        }
        let best = scores.iter().copied().max().unwrap_or(0);
        let is_best = |c: u8| scores.get(usize::from(c)) == Some(&best);
        let n_best = scores.iter().filter(|&&s| s == best).count();

        let switch = if !is_best(self.col) {
            true
        } else {
            tick >= self.switch_at && n_best > 1
        };
        if switch {
            // Next best column after the current one (round robin), or a random best one if the
            // current column is no longer among the best.
            let start = if is_best(self.col) {
                self.col
            } else {
                self.rng.below(COLS as u64) as u8
            };
            for k in 1..=COLS as u8 {
                let c = start.saturating_add(k).checked_rem(COLS as u8).unwrap_or(0);
                if is_best(c) {
                    self.col = c;
                    break;
                }
            }
            self.switch_at = tick.saturating_add(self.rng.range_inclusive(SWITCH_MIN, SWITCH_MAX));
        }
        self.col
    }
}

/// The biggest enemy cohort (grown past a raw volley) within DEFEND_DIST of my cannon; the
/// front-most wins ties. Returns its x.
fn threat(enemy: &PublicSide) -> Option<i32> {
    let mut best: Option<(u32, i32)> = None;
    for c in enemy.cohorts() {
        let dist = LANE_LENGTH.saturating_sub(i32::from(c.y));
        let bigger = best.is_none_or(|(n, _)| c.count > n);
        if dist <= DEFEND_DIST && c.count > VOLLEY_SIZE && bigger {
            best = Some((c.count, i32::from(c.x)));
        }
    }
    best.map(|(_, x)| x)
}

/// SPEC §9.2: what a fresh volley would become going straight up column `col`, using revealed
/// values where known and the hint colour otherwise (blue/gold ≈ ×2, grey ≈ ×1, red ≈ ÷2).
pub fn column_score(me: &PublicSide, col: u8) -> u32 {
    let mut count = VOLLEY_SIZE;
    for row in 0..ROWS as u8 {
        let cell = row.saturating_mul(COLS as u8).saturating_add(col);
        let op = match me.gate(cell) {
            Some(PublicGate {
                revealed: Some(op), ..
            }) => *op,
            Some(PublicGate { hint, .. }) => match hint {
                Hint::Good | Hint::Gold => GateOp::Mul(2),
                Hint::None => GateOp::Mul(1),
                Hint::Bad => GateOp::Div(2),
            },
            None => GateOp::Mul(1),
        };
        count = op.apply(count);
    }
    count
}

fn col_centre(col: u8) -> i32 {
    i32::from(col)
        .saturating_mul(COL_WIDTH)
        .saturating_add(COL_WIDTH / 2)
}

#[cfg(test)]
mod tests;
