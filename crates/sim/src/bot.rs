//! The Warlord bot (SPEC §10).
//!
//! It is handed `&PublicState` only. Hidden gate values, peeks and the match seed live in
//! `SecretState`, which it never receives, so it cannot read secrets by construction. Its own
//! randomness comes from its own seed, which the caller must supply independently of the match
//! seed. It also ignores its own peek results (they are private state it is not given).

use crate::constants::{
    CRUISE_SPEED, DEFEND_Y, GATES_MAX, LANE_WIDTH, LAUNCH_SPEED, LAUNCH_TICKS, VOLLEY_SIZE,
};
use crate::layouts::{covers, Slot, StageDef};
use crate::rng::SplitMix64;
use crate::state::{PublicSide, PublicState, SideInput};
use crate::types::GateOp;

/// SPEC §10: pick a target every 2 ticks.
pub const THINK_TICKS: u32 = 2;
/// SPEC §10: alternate between equal options every 20–60 ticks.
pub const SWITCH_MIN: u32 = 20;
pub const SWITCH_MAX: u32 = 60;
/// Candidate aim points: every AIM_STEP across the lane.
pub const AIM_STEP: i32 = 100;
const CANDIDATES: usize = (LANE_WIDTH / AIM_STEP) as usize - 1;
/// (impl) Expected value of an unrevealed gate, in per mille: normal ≈ ×2 (SPEC §10), big ×8.
pub const GUESS_NORMAL_PM: u64 = 2_000;
pub const GUESS_BIG_PM: u64 = 8_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Warlord {
    side: u8,
    rng: SplitMix64,
    /// The x it is going for.
    target: i32,
    /// When it may switch to another equally good spot.
    switch_at: u32,
}

impl Warlord {
    /// `seed` must not be derived from the match seed by anything the opponent can't see either;
    /// it only drives tie-breaks and the random Scout (peek) slot.
    pub fn new(side: u8, seed: u64) -> Self {
        Self {
            side,
            rng: SplitMix64::new(seed),
            target: LANE_WIDTH / 2,
            switch_at: 0,
        }
    }

    pub fn side(&self) -> u8 {
        self.side
    }

    /// The bot's input for the tick `view.tick` is about to process.
    pub fn decide(&mut self, view: &PublicState) -> SideInput {
        let mut input = SideInput::default();
        let Some(me) = view.side(self.side) else {
            return input;
        };
        if view.ended() || me.finished() {
            return input;
        }
        // SPEC §10: a random own `?` at the start of each fight.
        if me.phase.active() && !me.peek_used {
            let n = view.stage_def(self.side).gates.len();
            input.peek = self.random_hidden(me, n);
        }
        if view.tick.checked_rem(THINK_TICKS) != Some(0) {
            return input;
        }
        input.aim = Some(match threat(me) {
            // SPEC §10.1: defend.
            Some(x) => x,
            // SPEC §10.2–3: the best expected product; alternate between ties.
            None => self.pick(view.tick, me, view.stage_def(self.side)),
        });
        input
    }

    fn random_hidden(&mut self, side: &PublicSide, n: usize) -> Option<u8> {
        let mut slots = [0u8; GATES_MAX];
        let mut k = 0usize;
        for (slot, g) in (0u8..).zip(side.gates.iter().take(n)) {
            if let (None, Some(dst)) = (g.revealed, slots.get_mut(k)) {
                *dst = slot;
                k = k.saturating_add(1);
            }
        }
        let pick = self.rng.below(k as u64) as usize;
        (k > 0).then(|| slots.get(pick).copied()).flatten()
    }

    fn pick(&mut self, tick: u32, me: &PublicSide, st: &StageDef) -> i32 {
        let mut scores = [0u64; CANDIDATES];
        for (i, score) in scores.iter_mut().enumerate() {
            *score = path_score(me, st, candidate(i));
        }
        let best = scores.iter().copied().max().unwrap_or(0);
        // Runs of equally good candidates: aim somewhere inside one.
        let mut runs = [(0i32, 0i32); CANDIDATES];
        let mut n = 0usize;
        let mut i = 0usize;
        while i < CANDIDATES {
            if scores.get(i) != Some(&best) {
                i = i.saturating_add(1);
                continue;
            }
            let start = i;
            while scores.get(i) == Some(&best) {
                i = i.saturating_add(1);
            }
            if let Some(r) = runs.get_mut(n) {
                *r = (candidate(start), candidate(i.saturating_sub(1)));
                n = n.saturating_add(1);
            }
        }
        let mids = runs.get(..n).unwrap_or(&[]);
        let current = mids.iter().position(|r| (r.0..=r.1).contains(&self.target));
        let switch = match current {
            None => true,
            Some(_) => tick >= self.switch_at && n > 1,
        };
        if switch {
            let next = match current {
                // Round robin to the next tied run.
                Some(c) => c.saturating_add(1).checked_rem(n).unwrap_or(0),
                None => self.rng.below(n as u64) as usize,
            };
            if let Some(&(lo, hi)) = mids.get(next) {
                // Any point of the run: the same choice, played a little differently each time.
                let steps = hi.saturating_sub(lo).checked_div(AIM_STEP).unwrap_or(0);
                let pick = self
                    .rng
                    .below(u64::from(steps.unsigned_abs()).saturating_add(1));
                self.target = lo.saturating_add((pick as i32).saturating_mul(AIM_STEP));
            }
            self.switch_at = tick.saturating_add(self.rng.range_inclusive(SWITCH_MIN, SWITCH_MAX));
        }
        self.target
    }
}

fn candidate(i: usize) -> i32 {
    (i as i32).saturating_add(1).saturating_mul(AIM_STEP)
}

/// SPEC §10.1: the lowest enemy cohort within DEFEND_Y of the cannon line. Returns its x.
fn threat(me: &PublicSide) -> Option<i32> {
    me.enemies()
        .iter()
        .filter(|e| i32::from(e.y) <= DEFEND_Y)
        .min_by_key(|e| e.y)
        .map(|e| i32::from(e.x))
}

/// Ticks a fresh volley needs to reach `y` (launch boost, then cruise).
pub fn travel_ticks(y: i32) -> u32 {
    let boost = LAUNCH_SPEED.saturating_mul(LAUNCH_TICKS as i32);
    if y <= boost {
        (y.saturating_add(LAUNCH_SPEED - 1) / LAUNCH_SPEED) as u32
    } else {
        let rest = y.saturating_sub(boost);
        LAUNCH_TICKS.saturating_add((rest.saturating_add(CRUISE_SPEED - 1) / CRUISE_SPEED) as u32)
    }
}

/// SPEC §10.2: the expected size (in thousandths of a dude) of a volley fired now at `x` once
/// it has passed every row: revealed values, else the slot's guess; moving gates predicted at
/// arrival, edges counted as in the rules (`covers`, nearest centre). An unbroken crate in the way absorbs its HP first, so a locked gate only pays once
/// its crate is broken.
pub fn path_score(me: &PublicSide, st: &StageDef, x: i32) -> u64 {
    let now = if me.phase.active() {
        u32::from(me.phase_ticks)
    } else {
        0
    };
    let mut score: u64 = u64::from(VOLLEY_SIZE).saturating_mul(1_000);
    let mut below = i32::MIN;
    for (row, &row_y) in (0u8..).zip(st.rows) {
        let row_y = i32::from(row_y);
        for (c, &hp) in st.crates.iter().zip(me.crates.iter()) {
            let cy = i32::from(c.y);
            if hp > 0 && below < cy && cy < row_y && covers(x, i32::from(c.x), c.width) {
                score = score.saturating_sub(u64::from(hp).saturating_mul(1_000));
            }
        }
        below = row_y;
        let at = now.saturating_add(travel_ticks(row_y));
        let hit = st.gate_at(row, x, |_, g| i32::from(g.x_at(at)));
        let Some((slot, def)) =
            hit.and_then(|s| Some((usize::from(s), st.gates.get(usize::from(s))?)))
        else {
            continue;
        };
        score = match me.gates.get(slot).and_then(|g| g.revealed) {
            Some(GateOp::Mul(k)) => score.saturating_mul(u64::from(k)),
            Some(GateOp::Div(k)) => score.checked_div(u64::from(k)).unwrap_or(0),
            None => {
                let guess = match def.slot {
                    Slot::Normal => GUESS_NORMAL_PM,
                    Slot::Big => GUESS_BIG_PM,
                };
                score.saturating_mul(guess) / 1_000
            }
        };
    }
    score
}

#[cfg(test)]
mod tests;
