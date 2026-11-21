//! Match state, split into what anyone may see (`PublicState`, the public Match account) and what
//! only the program may see (`SecretState`, the private Secrets/Peek accounts, TECH §4).
//! The Warlord bot is handed `&PublicState` only, so it cannot read secrets by construction.

use crate::constants::{
    CELLS, COHORT_CAP, HP_MAX, LANE_WIDTH, MATCH_TICKS, PHASES, PLANT_STARTS, PLANT_TICKS,
    SURGE_TICK,
};
use crate::deal::{Deal, RIG_OP};
use crate::payout::MatchResult;
use crate::types::{Cohort, GateOp, Hint, Status};

/// Fixed for the whole match (public).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MatchOptions {
    /// Matched stake S in lamports (0 = free); the payout level (SPEC §7).
    pub stake: u64,
    /// Which sides the Warlord bot drives (SPEC §9). The rules ignore it; it is for the UI/program.
    pub bot: [bool; 2],
    /// Guided first match: the bot holds back in phase 1 (SPEC §9).
    pub tutorial: bool,
}

/// One gate as everyone sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublicGate {
    /// Shown while unrevealed. `Hint::None` for every non-gold gate during a plant window.
    pub hint: Hint,
    pub gold: bool,
    /// Set when the first cohort passes (SPEC §4); the op that cohort got.
    pub revealed: Option<GateOp>,
}

/// One side as everyone sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublicSide {
    pub hp: u32,
    /// Where the cannon is (volleys spawn here, SPEC §2).
    pub cannon_x: i16,
    /// Where the player aims (the cannon moves toward it).
    pub aim: i16,
    /// Live cohorts are `cohorts[..cohort_len]`, oldest (front-most) first; the rest are zeroed.
    pub cohorts: [Cohort; COHORT_CAP],
    pub cohort_len: u8,
    /// This side's own grid: the gates its cohorts pass.
    pub gates: [PublicGate; CELLS],
    pub rig_used: bool,
    pub peek_used: bool,
}

impl PublicSide {
    pub fn cohorts(&self) -> &[Cohort] {
        self.cohorts
            .get(..usize::from(self.cohort_len))
            .unwrap_or(&[])
    }

    pub fn cohorts_mut(&mut self) -> &mut [Cohort] {
        self.cohorts
            .get_mut(..usize::from(self.cohort_len))
            .unwrap_or(&mut [])
    }

    pub fn gate(&self, cell: u8) -> Option<&PublicGate> {
        self.gates.get(usize::from(cell))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublicState {
    /// The next tick to be processed (= ticks done so far). 0..=MATCH_TICKS.
    pub tick: u32,
    pub options: MatchOptions,
    pub sides: [PublicSide; 2],
    pub next_cohort_id: u32,
    /// Set when the match ends (SPEC §7).
    pub result: Option<MatchResult>,
}

impl PublicState {
    pub fn phase(&self) -> u8 {
        phase_at(self.tick)
    }

    pub fn status(&self) -> Status {
        if self.result.is_some() {
            Status::Ended
        } else if in_plant(self.tick) {
            Status::Plant
        } else {
            Status::Playing
        }
    }

    /// SPEC §3: Surge from 1:45.
    pub fn surge(&self) -> bool {
        self.tick >= SURGE_TICK
    }

    pub fn side(&self, side: u8) -> Option<&PublicSide> {
        self.sides.get(usize::from(side))
    }
}

/// SPEC §3: phase 0, 1, 2 start at 0:00, 0:40, 1:20.
pub fn phase_at(tick: u32) -> u8 {
    let mut phase = 0u8;
    for (p, &start) in PLANT_STARTS.iter().enumerate() {
        if tick >= start {
            phase = p as u8;
        }
    }
    phase
}

pub fn phase_start(phase: u8) -> u32 {
    PLANT_STARTS
        .get(usize::from(phase))
        .copied()
        .unwrap_or(MATCH_TICKS)
}

/// First tick of play (fire, hints, peek) in `phase`.
pub fn play_start(phase: u8) -> u32 {
    phase_start(phase).saturating_add(PLANT_TICKS)
}

/// SPEC §3: the first PLANT_TICKS of every phase are a plant window.
pub fn in_plant(tick: u32) -> bool {
    tick < play_start(phase_at(tick))
}

pub const fn other(side: u8) -> u8 {
    if side == 0 {
        1
    } else {
        0
    }
}

/// A peek result (SPEC §5): the true value of one of my own unrevealed cells.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Peek {
    pub cell: u8,
    pub op: GateOp,
    pub gold: bool,
}

/// What both sides did in one phase: published with the seed at the end (SPEC §10, the result
/// screen's full reveal). Derived from the rest of the state over time, so `digest` skips it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PhaseLog {
    /// `rigs[s]` = the opponent cell side `s` rigged in that phase.
    pub rigs: [Option<u8>; 2],
    /// `peeks[s]` = side `s`'s peek in that phase.
    pub peeks: [Option<Peek>; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecretState {
    /// The VRF seed. Public only after the match (Verify, SPEC §10).
    pub seed: u64,
    /// The current phase's deal (true values and pre-rig hints).
    pub deal: Deal,
    /// `rigs[s]` = the cell of side `1 − s`'s grid that side `s` rigged this phase (SPEC §5).
    pub rigs: [Option<u8>; 2],
    /// `peeks[s]` = side `s`'s peek this phase (SPEC §5).
    pub peeks: [Option<Peek>; 2],
    /// Every finished phase's rigs and peeks, written at each re-deal and at the end.
    pub history: [PhaseLog; PHASES],
}

impl SecretState {
    /// Who rigged `side`'s gate `cell` (always the opponent), if anyone.
    pub fn rigged_by(&self, side: u8, cell: u8) -> Option<u8> {
        let opponent = other(side);
        let rig = self.rigs.get(usize::from(opponent)).copied().flatten()?;
        (rig == cell).then_some(opponent)
    }

    /// What `side`'s gate `cell` does right now: the deal value, or the trap if rigged (SPEC §5).
    pub fn true_op(&self, side: u8, cell: u8) -> GateOp {
        if self.rigged_by(side, cell).is_some() {
            RIG_OP
        } else {
            self.deal.op(cell)
        }
    }
}

/// What only one player may see.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PrivateView {
    /// The opponent cell I rigged this phase.
    pub rig: Option<u8>,
    /// My peek this phase.
    pub peek: Option<Peek>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchState {
    pub public: PublicState,
    pub secret: SecretState,
}

impl MatchState {
    /// A fresh match at tick 0: phase 0's deal is face-down and the plant window is open.
    pub fn new(seed: u64, options: MatchOptions) -> Self {
        let deal = Deal::new(seed, 0);
        let mid = (LANE_WIDTH / 2) as i16;
        let side = PublicSide {
            hp: HP_MAX,
            cannon_x: mid,
            aim: mid,
            cohorts: [Cohort::default(); COHORT_CAP],
            cohort_len: 0,
            gates: face_down(&deal),
            rig_used: false,
            peek_used: false,
        };
        Self {
            public: PublicState {
                tick: 0,
                options,
                sides: [side; 2],
                next_cohort_id: 1,
                result: None,
            },
            secret: SecretState {
                seed,
                deal,
                rigs: [None; 2],
                peeks: [None; 2],
                history: [PhaseLog::default(); PHASES],
            },
        }
    }

    /// An all-zero state to decode into (`codec::decode_*` overwrite every field). Unlike `new`,
    /// it builds no deal, so it is nearly free on-chain.
    pub const fn zeroed() -> Self {
        const COHORT: Cohort = Cohort {
            id: 0,
            count: 0,
            x: 0,
            y: 0,
            age: 0,
            last_row: 0,
        };
        const GATE: PublicGate = PublicGate {
            hint: Hint::None,
            gold: false,
            revealed: None,
        };
        const SIDE: PublicSide = PublicSide {
            hp: 0,
            cannon_x: 0,
            aim: 0,
            cohorts: [COHORT; COHORT_CAP],
            cohort_len: 0,
            gates: [GATE; CELLS],
            rig_used: false,
            peek_used: false,
        };
        const LOG: PhaseLog = PhaseLog {
            rigs: [None; 2],
            peeks: [None; 2],
        };
        Self {
            public: PublicState {
                tick: 0,
                options: MatchOptions {
                    stake: 0,
                    bot: [false; 2],
                    tutorial: false,
                },
                sides: [SIDE; 2],
                next_cohort_id: 0,
                result: None,
            },
            secret: SecretState {
                seed: 0,
                deal: Deal {
                    ops: [GateOp::Mul(1); CELLS],
                    gold_cell: 0,
                    hints: [[Hint::None; CELLS]; 2],
                },
                rigs: [None; 2],
                peeks: [None; 2],
                history: [LOG; PHASES],
            },
        }
    }

    pub fn private_view(&self, side: u8) -> PrivateView {
        let s = usize::from(side);
        PrivateView {
            rig: self.secret.rigs.get(s).copied().flatten(),
            peek: self.secret.peeks.get(s).copied().flatten(),
        }
    }

    /// FNV-1a over every field, public and secret, in a fixed order. Equal digests ⇔ equal state
    /// (up to hash collisions); used by the determinism and golden tests. `secret.history` is
    /// left out: it only records rigs/peeks that were already hashed while they were live.
    pub fn digest(&self) -> u64 {
        let mut h = Fnv::new();
        let p = &self.public;
        h.u32(p.tick);
        h.u64(p.options.stake);
        p.options.bot.iter().for_each(|&b| h.bool(b));
        h.bool(p.options.tutorial);
        h.u32(p.next_cohort_id);
        match p.result {
            None => h.u8(0),
            Some(r) => {
                h.u8(1);
                h.u8(r.winner.unwrap_or(2));
                h.bool(r.ko);
                h.u64(r.moved);
                h.u64(r.fee);
            }
        }
        for s in &p.sides {
            h.u32(s.hp);
            h.i16(s.cannon_x);
            h.i16(s.aim);
            h.u8(s.cohort_len);
            for c in &s.cohorts {
                h.u32(c.id);
                h.u32(c.count);
                h.i16(c.x);
                h.i16(c.y);
                h.u8(c.age);
                h.u8(c.last_row);
            }
            for g in &s.gates {
                h.u8(g.hint.code());
                h.bool(g.gold);
                h.opt_op(g.revealed);
            }
            h.bool(s.rig_used);
            h.bool(s.peek_used);
        }
        let x = &self.secret;
        h.u64(x.seed);
        x.deal.ops.iter().for_each(|&op| h.op(op));
        h.u8(x.deal.gold_cell);
        x.deal
            .hints
            .iter()
            .flatten()
            .for_each(|&hint| h.u8(hint.code()));
        x.rigs.iter().for_each(|&r| h.u8(r.unwrap_or(255)));
        for peek in &x.peeks {
            match peek {
                None => h.u8(255),
                Some(pk) => {
                    h.u8(pk.cell);
                    h.op(pk.op);
                    h.bool(pk.gold);
                }
            }
        }
        h.0
    }
}

/// SPEC §3/§4: a fresh deal shows only the gold gate until play starts (see SPEC §4 "Plant").
pub(crate) fn face_down(deal: &Deal) -> [PublicGate; CELLS] {
    let mut gates = [PublicGate {
        hint: Hint::None,
        gold: false,
        revealed: None,
    }; CELLS];
    if let Some(g) = gates.get_mut(usize::from(deal.gold_cell)) {
        g.gold = true;
        g.hint = Hint::Gold;
    }
    gates
}

/// Inputs from one player (or the bot) for one tick. `None` = no change / no action.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SideInput {
    /// Target cannon x (absolute lane coordinate); clamped to the lane.
    pub aim: Option<i32>,
    /// Rig this opponent cell (plant window only, once per phase).
    pub rig: Option<u8>,
    /// Peek this own cell (play only, once per phase).
    pub peek: Option<u8>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Inputs {
    pub sides: [SideInput; 2],
}

struct Fnv(u64);

impl Fnv {
    const fn new() -> Self {
        Self(0xCBF2_9CE4_8422_2325)
    }
    fn u8(&mut self, b: u8) {
        self.0 = (self.0 ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01B3);
    }
    fn bytes(&mut self, bs: &[u8]) {
        bs.iter().for_each(|&b| self.u8(b));
    }
    fn bool(&mut self, b: bool) {
        self.u8(u8::from(b));
    }
    fn i16(&mut self, v: i16) {
        self.bytes(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.bytes(&v.to_le_bytes());
    }
    fn u64(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
    fn op(&mut self, op: GateOp) {
        let (kind, value) = op.code();
        self.u8(kind);
        self.u8(value);
    }
    fn opt_op(&mut self, op: Option<GateOp>) {
        match op {
            None => self.u8(255),
            Some(op) => self.op(op),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_helpers() {
        // SPEC §3 / MVP §6: plants at ticks 0–60, 800–860, 1600–1660.
        assert_eq!(phase_at(0), 0);
        assert_eq!(phase_at(799), 0);
        assert_eq!(phase_at(800), 1);
        assert_eq!(phase_at(1600), 2);
        assert_eq!(phase_at(2399), 2);
        assert!(in_plant(0) && in_plant(59) && !in_plant(60));
        assert!(in_plant(800) && in_plant(859) && !in_plant(860));
        assert!(in_plant(1659) && !in_plant(1660) && !in_plant(2399));
        assert_eq!(other(0), 1);
        assert_eq!(other(1), 0);
    }

    #[test]
    fn new_match_is_face_down_in_plant() {
        let m = MatchState::new(5, MatchOptions::default());
        assert_eq!(m.public.status(), Status::Plant);
        assert_eq!(m.public.tick, 0);
        for s in &m.public.sides {
            assert_eq!(s.hp, HP_MAX);
            assert!(s.cohorts().is_empty());
            for (cell, g) in s.gates.iter().enumerate() {
                let gold = cell == usize::from(m.secret.deal.gold_cell);
                assert_eq!(g.gold, gold);
                assert_eq!(g.hint, if gold { Hint::Gold } else { Hint::None });
                assert_eq!(g.revealed, None);
            }
        }
    }

    #[test]
    fn rig_targets_the_opponents_grid() {
        let mut m = MatchState::new(5, MatchOptions::default());
        m.secret.rigs = [Some(4), None]; // side 0 rigged side 1's cell 4
        assert_eq!(m.secret.rigged_by(1, 4), Some(0));
        assert_eq!(m.secret.rigged_by(0, 4), None);
        assert_eq!(m.secret.true_op(1, 4), RIG_OP);
        assert_eq!(m.secret.true_op(0, 4), m.secret.deal.op(4));
    }

    #[test]
    fn digest_sees_every_change() {
        let a = MatchState::new(1, MatchOptions::default());
        let mut b = a;
        assert_eq!(a.digest(), b.digest());
        b.secret.rigs[1] = Some(0);
        assert_ne!(a.digest(), b.digest());
        let mut c = a;
        c.public.sides[1].cohorts[39].age = 1;
        assert_ne!(a.digest(), c.digest());
        assert_ne!(
            a.digest(),
            MatchState::new(2, MatchOptions::default()).digest()
        );
    }
}
