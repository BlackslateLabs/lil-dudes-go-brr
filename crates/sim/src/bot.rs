//! The Warlord bot (SPEC §10, SPEC_V5 §1: no rig; Scouts at the start of a fight; calls the
//! Champion when charged).
//!
//! It is handed `&PublicState` only. Hidden gate values, peeks and the match seed live in
//! `SecretState`, which it never receives, so it cannot read secrets by construction. Its own
//! randomness comes from its own seed, which the caller must supply independently of the match
//! seed. It also ignores its own peek results (they are private state it is not given).

use crate::constants::{
    CHAMP_TICKS, CRATES_MAX, CRUISE_SPEED, DEFEND_Y, GATES_MAX, LANE_WIDTH, LAUNCH_SPEED,
    LAUNCH_TICKS, VOLLEY_SIZE,
};
use crate::layouts::{covers, timing_value, GateDef, Slot, StageDef};
use crate::rng::SplitMix64;
use crate::state::{PublicSide, PublicState, SideInput};
use crate::types::{GateOp, Phase};

/// SPEC §10: pick a target every 2 ticks.
pub const THINK_TICKS: u32 = 2;
/// SPEC §10: alternate between equal options every 20–60 ticks.
pub const SWITCH_MIN: u32 = 20;
pub const SWITCH_MAX: u32 = 60;
/// Candidate aim points (SPEC_V5 §12): the stage's column centres (where its static gates
/// sit), or every AIM_STEP across the lane when a gate slides (to catch it on the move).
pub const AIM_STEP: i32 = 100;
const CANDIDATES: usize = (LANE_WIDTH / AIM_STEP) as usize - 1;
const _: () = assert!(GATES_MAX <= CANDIDATES);
/// (impl) Expected value of an unrevealed gate, in per mille: normal ≈ ×2 (SPEC §10; the v5
/// table's mean factor, counting ±N as ×1, is ~×1.94), big ×8.
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
            input.peek = self.random_hidden(me, view.stage_def(self.side), n);
        }
        // SPEC_V5 §2, §4: hold the trigger; let go for one tick to release the Champion as
        // soon as it is charged.
        let charged = me.phase == Phase::Fight
            && !me.champ_pending
            && u32::from(me.champ_meter) >= CHAMP_TICKS;
        input.fire = Some(!(charged && me.firing));
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

    fn random_hidden(&mut self, side: &PublicSide, st: &StageDef, n: usize) -> Option<u8> {
        let mut slots = [0u8; GATES_MAX];
        let mut k = 0usize;
        for ((slot, g), def) in (0u8..).zip(side.gates.iter().take(n)).zip(st.gates) {
            // The timing gate is public: nothing to scout.
            if def.slot == Slot::Timing {
                continue;
            }
            if let (None, Some(dst)) = (g.revealed, slots.get_mut(k)) {
                *dst = slot;
                k = k.saturating_add(1);
            }
        }
        let pick = self.rng.below(k as u64) as usize;
        (k > 0).then(|| slots.get(pick).copied()).flatten()
    }

    fn pick(&mut self, tick: u32, me: &PublicSide, st: &StageDef) -> i32 {
        let (xs, len) = candidates(st);
        let xs = xs.get(..len).unwrap_or(&[]);
        let mut scores = [0u64; CANDIDATES];
        for (score, &x) in scores.iter_mut().zip(xs) {
            *score = path_score(me, st, x);
        }
        let scores = scores.get(..xs.len()).unwrap_or(&[]);
        let best = scores.iter().copied().max().unwrap_or(0);
        // Runs of equally good candidates AIM_STEP apart (a lone column centre is a run of
        // one): aim somewhere inside one.
        let mut runs = [(0i32, 0i32); CANDIDATES];
        let mut n = 0usize;
        let mut i = 0usize;
        while i < xs.len() {
            if scores.get(i) != Some(&best) {
                i = i.saturating_add(1);
                continue;
            }
            let start = i;
            i = i.saturating_add(1);
            while scores.get(i) == Some(&best)
                && xs.get(i).copied()
                    == xs
                        .get(i.saturating_sub(1))
                        .map(|x| x.saturating_add(AIM_STEP))
            {
                i = i.saturating_add(1);
            }
            let (lo, hi) = (xs.get(start), xs.get(i.saturating_sub(1)));
            if let (Some(r), Some(&lo), Some(&hi)) = (runs.get_mut(n), lo, hi) {
                *r = (lo, hi);
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

/// The aim points the bot weighs, ascending, and how many: the distinct centres of the stage's
/// static gates (its columns), or every AIM_STEP across the lane if any gate slides.
fn candidates(st: &StageDef) -> ([i32; CANDIDATES], usize) {
    let mut xs = [0i32; CANDIDATES];
    if st.gates.iter().any(GateDef::moving) {
        for (i, x) in (1i32..).zip(xs.iter_mut()) {
            *x = i.saturating_mul(AIM_STEP);
        }
        return (xs, CANDIDATES);
    }
    let mut n = 0usize;
    for g in st.gates {
        let x = i32::from(g.x);
        let seen = xs.get(..n).unwrap_or(&[]).contains(&x);
        if let (false, Some(dst)) = (seen, xs.get_mut(n)) {
            *dst = x;
            n = n.saturating_add(1);
        }
    }
    if let Some(found) = xs.get_mut(..n) {
        found.sort_unstable();
    }
    if n == 0 {
        // No gates at all: the middle of the lane.
        if let Some(x) = xs.first_mut() {
            *x = LANE_WIDTH / 2;
        }
        n = 1;
    }
    (xs, n)
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
/// arrival, edges counted as in the rules (`covers`, nearest centre). An unbroken crate in the
/// way is an investment (rules v7: a full row can't be dodged, so the bot must be willing to
/// break crates): the path past it counts scaled by `d / (d + hp)`, `d` being the dudes that
/// reach the crate, so a crate that takes many volleys to break weighs its jackpot down. A divider
/// wall's span pushes an `x` inside its thickness to the nearer side, as the rules do (SPEC_V5
/// §12), so the column the volley will be in is the one scored.
pub fn path_score(me: &PublicSide, st: &StageDef, x: i32) -> u64 {
    let now = if me.phase.active() {
        u32::from(me.phase_ticks)
    } else {
        0
    };
    let mut score: u64 = u64::from(VOLLEY_SIZE).saturating_mul(1_000);
    let mut below = i32::MIN;
    let mut x = x;
    // (dudes reaching the crate, its HP), both in thousandths.
    let mut locks = [(0u64, 0u64); CRATES_MAX];
    let mut n_locks = 0usize;
    for (row, &row_y) in (0u8..).zip(st.rows) {
        let row_y = i32::from(row_y);
        x = st.wall_push(x, row_y);
        for (c, &hp) in st.crates.iter().zip(me.crates.iter()) {
            let cy = i32::from(c.y);
            if hp > 0 && below < cy && cy < row_y && covers(x, i32::from(c.x), c.width) {
                if let Some(l) = locks.get_mut(n_locks) {
                    *l = (score, u64::from(hp).saturating_mul(1_000));
                    n_locks = n_locks.saturating_add(1);
                }
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
            // Whole dudes: floor(c / k) wipes a lone dude (`÷2` on 1 is 0).
            Some(GateOp::Div(k)) => {
                let dudes = score.checked_div(1_000).unwrap_or(0);
                dudes
                    .checked_div(u64::from(k))
                    .unwrap_or(0)
                    .saturating_mul(1_000)
            }
            Some(GateOp::Add(n)) => score.saturating_add(u64::from(n).saturating_mul(1_000)),
            Some(GateOp::Sub(n)) => score.saturating_sub(u64::from(n).saturating_mul(1_000)),
            None => {
                let guess = match def.slot {
                    Slot::Normal => GUESS_NORMAL_PM,
                    Slot::Big => GUESS_BIG_PM,
                    // SPEC_V5 §3: public, so the bot knows its value on arrival.
                    Slot::Timing => u64::from(timing_value(at)).saturating_mul(1_000),
                };
                score.saturating_mul(guess) / 1_000
            }
        };
    }
    for &(d, hp) in locks.get(..n_locks).unwrap_or(&[]) {
        score = score
            .saturating_mul(d)
            .checked_div(d.saturating_add(hp))
            .unwrap_or(0);
    }
    score
}

#[cfg(test)]
mod tests;
