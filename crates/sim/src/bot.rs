//! The Warlord bot (SPEC §10, SPEC_V5 §1: no rig; Scouts at the start of a fight; calls the
//! Champion when charged; rules v8: aims at the first row's gates and weighs each by tracing a
//! volley's flight through the stage's walls, obstacles, speed pads and pipes).
//!
//! It is handed `&PublicState` only. Hidden gate values, peeks and the match seed live in
//! `SecretState`, which it never receives, so it cannot read secrets by construction. Its own
//! randomness comes from its own seed, which the caller must supply independently of the match
//! seed. It also ignores its own peek results (they are private state it is not given).

use crate::constants::{
    CHAMP_TICKS, CRATES_MAX, CRUISE_SPEED, DEFEND_Y, GATES_MAX, LANE_WIDTH, LAUNCH_SPEED,
    LAUNCH_TICKS, ROWS_MAX, VOLLEY_SIZE,
};
use crate::layouts::{covers, timing_value, Slot, StageDef};
use crate::rng::SplitMix64;
use crate::state::{PublicSide, PublicState, SideInput};
use crate::types::{GateOp, Phase};

/// SPEC §10: pick a target every 2 ticks.
pub const THINK_TICKS: u32 = 2;
/// SPEC §10: alternate between equal options every 20–60 ticks.
pub const SWITCH_MIN: u32 = 20;
pub const SWITCH_MAX: u32 = 60;
/// (impl) Expected value of an unrevealed gate, in per mille: normal ≈ ×2 (SPEC §10; the v5
/// table's mean factor, counting ±N as ×1, is ~×1.94), big ×8.
pub const GUESS_NORMAL_PM: u64 = 2_000;
pub const GUESS_BIG_PM: u64 = 8_000;
/// (impl, rules v8) A traced volley that has not passed the stage's last gate row and crate
/// after this many ticks is stuck in a sealed pocket: that aim scores 0.
pub const TRACE_TICKS: u32 = 400;
/// Gate rows and crates a traced volley can cross.
const STEPS: usize = ROWS_MAX + CRATES_MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Warlord {
    side: u8,
    rng: SplitMix64,
    /// The x it is going for.
    target: i32,
    /// When it may switch to another equally good spot.
    switch_at: u32,
    /// The traced paths of its aim points in the stage it last thought about.
    paths: Paths,
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
            paths: Paths::EMPTY,
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
            None => {
                let st = view.stage_def(self.side);
                self.paths.load(view.layout, me.stage, st);
                self.pick(view.tick, me, st)
            }
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
        let paths = &self.paths;
        let n = usize::from(paths.n);
        let mut scores = [0u64; GATES_MAX];
        for (score, path) in scores.iter_mut().zip(paths.paths.iter().take(n)) {
            *score = score_path(me, st, path);
        }
        let scores = scores.get(..n).unwrap_or(&[]);
        let best = scores.iter().copied().max().unwrap_or(0);
        // The aim points that tie for the best score.
        let mut tied = [0i32; GATES_MAX];
        let mut k = 0usize;
        for (&score, &x) in scores.iter().zip(paths.xs.iter()) {
            if let (true, Some(dst)) = (score == best, tied.get_mut(k)) {
                *dst = x;
                k = k.saturating_add(1);
            }
        }
        let tied = tied.get(..k).unwrap_or(&[]);
        let current = tied.iter().position(|&x| x == self.target);
        let switch = match current {
            None => true,
            Some(_) => tick >= self.switch_at && k > 1,
        };
        if switch {
            let next = match current {
                // Round robin to the next tied aim point.
                Some(c) => c.saturating_add(1).checked_rem(k).unwrap_or(0),
                None => self.rng.below(k as u64) as usize,
            };
            if let Some(&x) = tied.get(next) {
                self.target = x;
            }
            self.switch_at = tick.saturating_add(self.rng.range_inclusive(SWITCH_MIN, SWITCH_MAX));
        }
        self.target
    }
}

/// The aim points the bot weighs, ascending, and how many: the centres of the stage's first
/// row of gates (SPEC_V5 §13: row 1 spans the lane, so each of its gates starts a path), or the
/// middle of the lane if it has none.
pub fn candidates(st: &StageDef) -> ([i32; GATES_MAX], usize) {
    let mut xs = [0i32; GATES_MAX];
    let mut n = 0usize;
    for g in st.gates.iter().filter(|g| g.row == 0) {
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

/// Ticks a fresh volley needs to reach `y` on an open lane (launch boost, then cruise).
pub fn travel_ticks(y: i32) -> u32 {
    let boost = LAUNCH_SPEED.saturating_mul(LAUNCH_TICKS as i32);
    if y <= boost {
        (y.saturating_add(LAUNCH_SPEED - 1) / LAUNCH_SPEED) as u32
    } else {
        let rest = y.saturating_sub(boost);
        LAUNCH_TICKS.saturating_add((rest.saturating_add(CRUISE_SPEED - 1) / CRUISE_SPEED) as u32)
    }
}

/// One line a traced volley crosses: a gate row or a crate, the tick of its flight it crosses
/// it on (1 = its first move) and its x then.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Crossing {
    /// A crate (else a gate row).
    pub is_crate: bool,
    /// The row or crate index.
    pub index: u8,
    pub tick: u16,
    pub x: i16,
}

/// Where a volley fired at some x goes in a stage, from the layout alone (SPEC_V5 §12–§13):
/// the gate rows and crates it crosses, in order, and whether it gets past them all.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Path {
    pub crossings: [Crossing; STEPS],
    pub len: u8,
    /// It passes the stage's last gate row and crate within TRACE_TICKS (false: a sealed
    /// pocket).
    pub open: bool,
}

impl Path {
    pub fn crossings(&self) -> &[Crossing] {
        self.crossings.get(..usize::from(self.len)).unwrap_or(&[])
    }

    fn push(&mut self, c: Crossing) {
        if let Some(slot) = self.crossings.get_mut(usize::from(self.len)) {
            *slot = c;
            self.len = self.len.saturating_add(1);
        }
    }
}

/// The volley's flight by the movement rules (SPEC §7, SPEC_V5 §12–§13: launch boost, obstacle
/// slides, wall pushes, speed pads, pipes; homing only starts past the last row, where the
/// trace ends). Pure, so the bot can weigh a path without the hidden values.
pub fn trace(st: &StageDef, x: i32) -> Path {
    let mut path = Path::default();
    let last_row = st.rows.last().map_or(0, |&r| i32::from(r));
    let end = st
        .crates
        .iter()
        .fold(last_row, |e, c| e.max(i32::from(c.y)));
    let (mut x, mut y, mut age, mut row) = (x, 0i32, 0u32, 0u8);
    for tick in 1..=TRACE_TICKS {
        let speed = if age < LAUNCH_TICKS {
            LAUNCH_SPEED
        } else {
            CRUISE_SPEED
        };
        let prev_y = y;
        (x, y) = st.advance(x, y, speed);
        age = age.saturating_add(1);
        x = st.wall_push(x, y);
        if st.on_pad(x, y) {
            age = 0;
        }
        let at = |is_crate: bool, index: u8| Crossing {
            is_crate,
            index,
            tick: u16::try_from(tick).unwrap_or(u16::MAX),
            x: x as i16,
        };
        for (i, c) in (0u8..).zip(st.crates) {
            let cy = i32::from(c.y);
            if prev_y < cy && cy <= y && covers(x, i32::from(c.x), c.width) {
                path.push(at(true, i));
            }
        }
        while let Some(&row_y) = st.rows.get(usize::from(row)) {
            if y < i32::from(row_y) {
                break;
            }
            path.push(at(false, row));
            row = row.saturating_add(1);
        }
        if let Some((_, p)) = st.pipe_at(x, y) {
            (x, y, age) = (i32::from(p.out_x), i32::from(p.out_y), 0);
            row = row.max(st.rows_through(y));
        }
        if y >= end && usize::from(row) >= st.rows.len() {
            path.open = true;
            return path;
        }
    }
    path
}

/// The traced paths of a stage's aim points (`candidates`), for one (layout, stage).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Paths {
    /// (layout, stage) they were traced for.
    key: Option<(u8, u8)>,
    xs: [i32; GATES_MAX],
    paths: [Path; GATES_MAX],
    n: u8,
}

impl Paths {
    const EMPTY: Self = Self {
        key: None,
        xs: [0; GATES_MAX],
        paths: [Path {
            crossings: [Crossing {
                is_crate: false,
                index: 0,
                tick: 0,
                x: 0,
            }; STEPS],
            len: 0,
            open: false,
        }; GATES_MAX],
        n: 0,
    };

    fn load(&mut self, layout: u8, stage: u8, st: &StageDef) {
        if self.key == Some((layout, stage)) {
            return;
        }
        let (xs, n) = candidates(st);
        self.key = Some((layout, stage));
        self.xs = xs;
        self.n = u8::try_from(n).unwrap_or(0);
        for (path, &x) in self.paths.iter_mut().zip(xs.iter().take(n)) {
            *path = trace(st, x);
        }
    }
}

/// SPEC §10.2: the expected size (in thousandths of a dude) of a volley fired now at `x` once
/// it has passed every row, along its traced path (`trace`): revealed values, else the slot's
/// guess; moving gates predicted at arrival, edges counted as in the rules (`covers`, nearest
/// centre). An unbroken crate in the way is an investment (rules v7: a full row can't be
/// dodged, so the bot must be willing to break crates): the path past it counts scaled by
/// `d / (d + hp)`, `d` being the dudes that reach the crate, so a crate that takes many volleys
/// to break weighs its jackpot down. A sealed pocket scores 0 (rules v8).
pub fn path_score(me: &PublicSide, st: &StageDef, x: i32) -> u64 {
    score_path(me, st, &trace(st, x))
}

/// `path_score` on an already traced path.
pub fn score_path(me: &PublicSide, st: &StageDef, path: &Path) -> u64 {
    if !path.open {
        return 0;
    }
    let now = if me.phase.active() {
        u32::from(me.phase_ticks)
    } else {
        0
    };
    let mut score: u64 = u64::from(VOLLEY_SIZE).saturating_mul(1_000);
    // (dudes reaching the crate, its HP), both in thousandths.
    let mut locks = [(0u64, 0u64); CRATES_MAX];
    let mut n_locks = 0usize;
    for c in path.crossings() {
        if c.is_crate {
            let hp = me.crates.get(usize::from(c.index)).copied().unwrap_or(0);
            if let (true, Some(l)) = (hp > 0, locks.get_mut(n_locks)) {
                *l = (score, u64::from(hp).saturating_mul(1_000));
                n_locks = n_locks.saturating_add(1);
            }
            continue;
        }
        let at = now.saturating_add(u32::from(c.tick));
        let hit = st.gate_at(c.index, i32::from(c.x), |_, g| i32::from(g.x_at(at)));
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
