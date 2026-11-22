//! Match state, split into what anyone may see (`PublicState`, the public Match account) and what
//! only the program may see (`SecretState`, the private Secrets/Peek accounts, TECH §4).
//! The Warlord bot is handed `&PublicState` only, so it cannot read secrets by construction.

use crate::constants::{
    COHORT_CAP, CRATES_MAX, ENEMY_CAP, GATES_MAX, LANE_WIDTH, STAGES, TOWERS_MAX,
};
use crate::deal::{Deal, NO_GATE, RIG_OP};
use crate::layouts::{self, layout_for, StageDef};
use crate::payout::MatchResult;
use crate::types::{Cohort, Enemy, GateOp, Phase};

/// Fixed for the whole match (public).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MatchOptions {
    /// Matched stake S in lamports (0 = free), SPEC §8.
    pub stake: u64,
    /// Which sides the Warlord bot drives (SPEC §10). The rules ignore it; it is for the UI/program.
    pub bot: [bool; 2],
    /// Guided first match: side 0's Fight 1 waves are at TUTORIAL_WAVE_PCT (SPEC §10).
    pub tutorial: bool,
}

/// One gate of the current stage as everyone sees it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PublicGate {
    /// Centre x right now (moving gates slide, SPEC §6).
    pub x: i16,
    /// Set when the first cohort passes (SPEC §6): the op that cohort got.
    pub revealed: Option<GateOp>,
}

/// One player's copy of the level as everyone sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublicSide {
    /// 0 = Fight 1, 1 = Fight 2, 2 = Raid. In Transit it already names the next stage.
    pub stage: u8,
    pub phase: Phase,
    /// Ticks of `phase` already played (moving gates and waves are timed from 0 = fight start).
    pub phase_ticks: u16,
    /// An enemy reached the cannon line (SPEC §4).
    pub dead: bool,
    /// Where the cannon is (volleys spawn here, SPEC §2).
    pub cannon_x: i16,
    /// Where the player aims (the cannon moves toward it).
    pub aim: i16,
    /// SPEC §5.
    pub gold: u32,
    /// Rig / peek spent in the current stage (SPEC §6).
    pub rig_used: bool,
    pub peek_used: bool,
    /// Tower HP of the current stage (0 = down or no tower in that slot).
    pub towers: [u16; TOWERS_MAX],
    /// Crate HP of the current stage (0 = broken or no crate in that slot).
    pub crates: [u16; CRATES_MAX],
    /// The current stage's gates, by slot (slots past the layout's gate count stay default).
    pub gates: [PublicGate; GATES_MAX],
    /// Live cohorts are `cohorts[..cohort_len]`, oldest (front-most) first; the rest are zeroed.
    pub cohorts: [Cohort; COHORT_CAP],
    pub cohort_len: u8,
    /// Live enemy cohorts are `enemies[..enemy_len]`, oldest first; the rest are zeroed.
    pub enemies: [Enemy; ENEMY_CAP],
    pub enemy_len: u8,
}

impl PublicSide {
    pub const EMPTY: Self = Self {
        stage: 0,
        phase: Phase::Plant,
        phase_ticks: 0,
        dead: false,
        cannon_x: 0,
        aim: 0,
        gold: 0,
        rig_used: false,
        peek_used: false,
        towers: [0; TOWERS_MAX],
        crates: [0; CRATES_MAX],
        gates: [PublicGate {
            x: 0,
            revealed: None,
        }; GATES_MAX],
        cohorts: [Cohort {
            id: 0,
            count: 0,
            x: 0,
            y: 0,
            age: 0,
            last_row: 0,
        }; COHORT_CAP],
        cohort_len: 0,
        enemies: [Enemy {
            id: 0,
            count: 0,
            x: 0,
            y: 0,
            tower: 0,
        }; ENEMY_CAP],
        enemy_len: 0,
    };

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

    pub fn enemies(&self) -> &[Enemy] {
        self.enemies
            .get(..usize::from(self.enemy_len))
            .unwrap_or(&[])
    }

    pub fn gate(&self, slot: u8) -> Option<&PublicGate> {
        self.gates.get(usize::from(slot))
    }

    /// The match is over for this player: dead, or the raid is finished.
    pub fn finished(&self) -> bool {
        self.dead || self.phase == Phase::Done
    }

    /// Sets up `stage` of `layout`: towers, crates, face-down gates at their start x, an empty
    /// field and a fresh rig and peek.
    pub fn load_stage(&mut self, layout: u8, stage: u8) {
        let st = layouts::stage(layout, stage);
        self.stage = stage;
        self.phase_ticks = 0;
        self.rig_used = false;
        self.peek_used = false;
        self.towers = [0; TOWERS_MAX];
        for (hp, t) in self.towers.iter_mut().zip(st.towers) {
            *hp = t.hp;
        }
        self.crates = [0; CRATES_MAX];
        for (hp, c) in self.crates.iter_mut().zip(st.crates) {
            *hp = c.hp;
        }
        self.gates = [PublicGate::default(); GATES_MAX];
        for (g, def) in self.gates.iter_mut().zip(st.gates) {
            g.x = def.x;
        }
        self.cohorts = [Cohort::default(); COHORT_CAP];
        self.cohort_len = 0;
        self.enemies = [Enemy::default(); ENEMY_CAP];
        self.enemy_len = 0;
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PublicState {
    /// The next tick to be processed (= ticks done so far). 0..=MATCH_TICKS.
    pub tick: u32,
    pub options: MatchOptions,
    /// The level both players race on (SPEC §9), public from the start.
    pub layout: u8,
    pub sides: [PublicSide; 2],
    /// Ids for cohorts and enemy cohorts, shared by both lanes.
    pub next_cohort_id: u32,
    /// Set when the match ends (SPEC §8).
    pub result: Option<MatchResult>,
}

impl PublicState {
    pub fn side(&self, side: u8) -> Option<&PublicSide> {
        self.sides.get(usize::from(side))
    }

    pub fn ended(&self) -> bool {
        self.result.is_some()
    }

    /// The layout data of `side`'s current stage.
    pub fn stage_def(&self, side: u8) -> &'static StageDef {
        let stage = self.side(side).map_or(0, |s| s.stage);
        layouts::stage(self.layout, stage)
    }
}

pub const fn other(side: u8) -> u8 {
    if side == 0 {
        1
    } else {
        0
    }
}

/// A rig (SPEC §6): the victim's stage and gate slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rig {
    pub stage: u8,
    pub slot: u8,
}

/// A peek result (SPEC §6): the true value of one of my own gates when I peeked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Peek {
    pub slot: u8,
    pub op: GateOp,
}

/// What both players did in one of their own stages (index = the actor's stage, not the
/// victim's). Published with the seed at the end (SPEC §11 Verify).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct StageLog {
    /// `rigs[s]` = the opponent gate side `s` rigged during its plant of this stage.
    pub rigs: [Option<Rig>; 2],
    /// `peeks[s]` = side `s`'s peek during this stage.
    pub peeks: [Option<Peek>; 2],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SecretState {
    /// The VRF seed. Public only after the match (Verify, SPEC §11).
    pub seed: u64,
    /// True gate values per stage and slot, identical in both copies (rigs apply on top).
    pub values: [[GateOp; GATES_MAX]; STAGES],
    /// Every rig and peek so far, written as they happen.
    pub history: [StageLog; STAGES],
}

impl SecretState {
    /// Who rigged `side`'s gate `slot` of its stage `stage` (always the opponent), if anyone.
    pub fn rigged_by(&self, side: u8, stage: u8, slot: u8) -> Option<u8> {
        let opponent = other(side);
        let target = Some(Rig { stage, slot });
        self.history
            .iter()
            .any(|log| log.rigs.get(usize::from(opponent)).copied().flatten() == target)
            .then_some(opponent)
    }

    /// Whether `side`'s stage `stage` already holds a rig (at most one per stage, SPEC §6).
    pub fn stage_rigged(&self, side: u8, stage: u8) -> bool {
        let opponent = usize::from(other(side));
        self.history.iter().any(|log| {
            log.rigs
                .get(opponent)
                .copied()
                .flatten()
                .is_some_and(|r| r.stage == stage)
        })
    }

    /// What `side`'s gate `slot` in `stage` does right now: the dealt value, or the trap.
    pub fn true_op(&self, side: u8, stage: u8, slot: u8) -> GateOp {
        if self.rigged_by(side, stage, slot).is_some() {
            RIG_OP
        } else {
            self.values
                .get(usize::from(stage))
                .and_then(|v| v.get(usize::from(slot)))
                .copied()
                .unwrap_or(NO_GATE)
        }
    }

    pub fn log(&self, stage: u8) -> Option<&StageLog> {
        self.history.get(usize::from(stage))
    }
}

/// What only one player may see, for their current stage.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PrivateView {
    pub stage: u8,
    /// The opponent gate I rigged during this stage's plant.
    pub rig: Option<Rig>,
    /// My peek this stage.
    pub peek: Option<Peek>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchState {
    pub public: PublicState,
    pub secret: SecretState,
}

impl MatchState {
    /// A fresh match at tick 0: both players in the Plant of Fight 1 on the seed's layout.
    pub fn new(seed: u64, options: MatchOptions) -> Self {
        let deal = Deal::new(seed);
        let layout = layout_for(seed);
        let mid = (LANE_WIDTH / 2) as i16;
        let mut side = PublicSide::EMPTY;
        side.cannon_x = mid;
        side.aim = mid;
        side.load_stage(layout, 0);
        Self {
            public: PublicState {
                tick: 0,
                options,
                layout,
                sides: [side; 2],
                next_cohort_id: 1,
                result: None,
            },
            secret: SecretState {
                seed,
                values: deal.values,
                history: [StageLog::default(); STAGES],
            },
        }
    }

    /// An all-zero state to decode into (`codec::decode_*` overwrite every field). Unlike `new`,
    /// it deals nothing, so it is nearly free on-chain.
    pub const fn zeroed() -> Self {
        const LOG: StageLog = StageLog {
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
                layout: 0,
                sides: [PublicSide::EMPTY; 2],
                next_cohort_id: 0,
                result: None,
            },
            secret: SecretState {
                seed: 0,
                values: [[NO_GATE; GATES_MAX]; STAGES],
                history: [LOG; STAGES],
            },
        }
    }

    pub fn private_view(&self, side: u8) -> PrivateView {
        let stage = self.public.side(side).map_or(0, |s| s.stage);
        let s = usize::from(side);
        let log = self.secret.log(stage);
        PrivateView {
            stage,
            rig: log.and_then(|l| l.rigs.get(s).copied().flatten()),
            peek: log.and_then(|l| l.peeks.get(s).copied().flatten()),
        }
    }

    /// FNV-1a over every field, public and secret, in a fixed order. Equal digests ⇔ equal state
    /// (up to hash collisions); used by the determinism and golden tests.
    pub fn digest(&self) -> u64 {
        let mut h = Fnv::new();
        let p = &self.public;
        h.u32(p.tick);
        h.u64(p.options.stake);
        p.options.bot.iter().for_each(|&b| h.bool(b));
        h.bool(p.options.tutorial);
        h.u8(p.layout);
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
            h.u8(s.stage);
            h.u8(s.phase.code());
            h.u32(u32::from(s.phase_ticks));
            h.bool(s.dead);
            h.i16(s.cannon_x);
            h.i16(s.aim);
            h.u32(s.gold);
            h.bool(s.rig_used);
            h.bool(s.peek_used);
            s.towers.iter().for_each(|&t| h.u32(u32::from(t)));
            s.crates.iter().for_each(|&c| h.u32(u32::from(c)));
            for g in &s.gates {
                h.i16(g.x);
                h.u8(g.revealed.map_or(0, GateOp::to_byte));
            }
            h.u8(s.cohort_len);
            for c in &s.cohorts {
                h.u32(c.id);
                h.u32(c.count);
                h.i16(c.x);
                h.i16(c.y);
                h.u8(c.age);
                h.u8(c.last_row);
            }
            h.u8(s.enemy_len);
            for e in &s.enemies {
                h.u32(e.id);
                h.u32(e.count);
                h.i16(e.x);
                h.i16(e.y);
                h.u8(e.tower);
            }
        }
        let x = &self.secret;
        h.u64(x.seed);
        x.values.iter().flatten().for_each(|op| h.u8(op.to_byte()));
        for log in &x.history {
            for r in &log.rigs {
                match r {
                    None => h.u8(255),
                    Some(r) => {
                        h.u8(r.stage);
                        h.u8(r.slot);
                    }
                }
            }
            for pk in &log.peeks {
                match pk {
                    None => h.u8(255),
                    Some(pk) => {
                        h.u8(pk.slot);
                        h.u8(pk.op.to_byte());
                    }
                }
            }
        }
        h.0
    }
}

/// Inputs from one player (or the bot) for one tick. `None` = no change / no action.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SideInput {
    /// Target cannon x; clamped to the lane.
    pub aim: Option<i32>,
    /// Rig this gate slot of the opponent's current (or, in Transit, next) stage. During my
    /// Plant only, once per stage (SPEC §6).
    pub rig: Option<u8>,
    /// Peek this gate slot of my current stage. During my Fight/Raid only, once per stage.
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layouts::LAYOUTS;

    #[test]
    fn new_match_is_face_down_in_plant() {
        for seed in 0..12u64 {
            let m = MatchState::new(seed, MatchOptions::default());
            let p = &m.public;
            assert_eq!(usize::from(p.layout), seed as usize % LAYOUTS.len());
            let st = &LAYOUTS[usize::from(p.layout)].stages[0];
            for s in &p.sides {
                assert_eq!((s.stage, s.phase, s.phase_ticks), (0, Phase::Plant, 0));
                assert!(!s.dead && s.gold == 0 && !s.rig_used && !s.peek_used);
                assert!(s.cohorts().is_empty() && s.enemies().is_empty());
                assert_eq!(s.towers[0], st.towers[0].hp);
                for (slot, g) in s.gates.iter().enumerate() {
                    assert_eq!(g.revealed, None);
                    assert_eq!(g.x, st.gates.get(slot).map_or(0, |d| d.x));
                }
            }
            assert_eq!(m.secret.values, Deal::new(seed).values);
        }
    }

    #[test]
    fn rig_targets_the_opponents_copy() {
        let mut m = MatchState::new(5, MatchOptions::default());
        // Side 0, during its stage 0, rigged side 1's stage 1 slot 2.
        m.secret.history[0].rigs[0] = Some(Rig { stage: 1, slot: 2 });
        assert_eq!(m.secret.rigged_by(1, 1, 2), Some(0));
        assert_eq!(m.secret.rigged_by(1, 0, 2), None);
        assert_eq!(m.secret.rigged_by(0, 1, 2), None);
        assert!(m.secret.stage_rigged(1, 1) && !m.secret.stage_rigged(1, 0));
        assert_eq!(m.secret.true_op(1, 1, 2), RIG_OP);
        assert_eq!(m.secret.true_op(0, 1, 2), m.secret.values[1][2]);
        assert_eq!(m.secret.true_op(0, 7, 200), NO_GATE);
    }

    #[test]
    fn private_view_is_the_current_stage() {
        let mut m = MatchState::new(5, MatchOptions::default());
        let peek = Peek {
            slot: 1,
            op: GateOp::Mul(3),
        };
        m.secret.history[1].peeks[0] = Some(peek);
        assert_eq!(m.private_view(0).peek, None);
        m.public.sides[0].stage = 1;
        assert_eq!(m.private_view(0).peek, Some(peek));
        assert_eq!(m.private_view(1).peek, None);
    }

    #[test]
    fn digest_sees_every_change() {
        let a = MatchState::new(1, MatchOptions::default());
        let mut b = a;
        assert_eq!(a.digest(), b.digest());
        b.secret.history[2].peeks[1] = Some(Peek {
            slot: 0,
            op: GateOp::Mul(2),
        });
        assert_ne!(a.digest(), b.digest());
        let mut c = a;
        c.public.sides[1].enemies[15].tower = 1;
        assert_ne!(a.digest(), c.digest());
        let mut d = a;
        d.public.sides[0].gates[7].x = 1;
        assert_ne!(a.digest(), d.digest());
        assert_ne!(
            a.digest(),
            MatchState::new(2, MatchOptions::default()).digest()
        );
    }
}
