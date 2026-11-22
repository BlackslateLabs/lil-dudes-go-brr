//! Browser bindings for the match rules (docs/SPEC.md v3): one `SimMatch` handle per match, with
//! the Warlord bot built in. Cheap at 20 Hz: the view and events cross into JS as flat
//! `Float64Array`s, decoded by packages/client/src/offline.ts. Rebuild with
//! `packages/sim-wasm/build.sh`.
//!
//! VIEW LAYOUT (`view()`), all numbers:
//!   header (10): layout version, tick, ended (0/1), layout id, stake, has result (0/1),
//!           winner (0, 1, -1 = draw or none), ko (0/1), moved, fee
//!   then per side (0, 1):
//!           stage (0 fight 1, 1 fight 2, 2 raid), phase (0 plant, 1 fight, 2 transit, 3 raid,
//!           4 done), phase ticks, dead, cannon x, aim, gold, rig used, peek used, is bot,
//!           2 tower hp, 2 crate hp,
//!           8 gates × [x, op] (op 0 = face-down, +k = ×k, -k = ÷k; slots past the stage's
//!           gate count are [0, 0]),
//!           n cohorts, n × [id, count, x, y, age],
//!           n enemies, n × [id, count, x, y, tower]
//!   Tower, crate and gate slots index the current stage's lists in `constants_json().LAYOUTS`.
//!
//! EVENT LAYOUT (`events()`), EVENT_STRIDE numbers per event: type, then up to 7 fields:
//!    0 volley [side, id, x, count]
//!    1 gate [side, slot, cohort id, op (+k / -k), before, after, reveal (0/1)]
//!    2 gotcha [side, slot, rigged by]
//!    3 crate hit [side, crate, cohort id, absorbed, hp left]
//!    4 crate broken [side, crate]
//!    5 wave [side, tower, enemy id, x, count, merged (0/1)]
//!    6 clash [side, x, y, killed]
//!    7 tower hit [side, tower, damage, hp left, gold]
//!    8 tower destroyed [side, tower, gold]
//!    9 loot [side, cohort id, units, gold]
//!   10 phase [side, stage, phase]
//!   11 death [side]
//!   12 end [winner (-1 draw), ko, moved, fee]
//!
//! PRIVATE LAYOUT (`private_view(side)`), for that side's current stage:
//!   stage, rig victim stage (-1 none), rig slot (-1 none), peek slot (-1 none), peek op (+k / -k)

use lil_dudes_sim::layouts::{GateDef, Slot, StageDef};
use lil_dudes_sim::*;
use wasm_bindgen::prelude::*;

/// Bump when any layout above changes (offline.ts refuses a mismatch).
pub const LAYOUT_VERSION: u32 = 2;
pub const EVENT_STRIDE: usize = 8;
pub const HEADER_LEN: usize = 10;
pub const SIDE_FIXED: usize = 10 + TOWERS_MAX + CRATES_MAX + 2 * GATES_MAX;

#[wasm_bindgen]
pub struct SimMatch {
    state: MatchState,
    bots: [Option<Warlord>; 2],
    pending: Inputs,
    events: Events<EVENT_CAP>,
}

#[wasm_bindgen]
impl SimMatch {
    /// `bots`: bit 0 = side 0 is the Warlord bot, bit 1 = side 1. `bot_seed` must be independent
    /// of the match `seed` (the bot never gets the match seed). `stake` in lamports.
    #[wasm_bindgen(constructor)]
    pub fn new(seed: u64, bot_seed: u64, stake: u64, bots: u8, tutorial: bool) -> SimMatch {
        let is_bot = [bots & 1 != 0, bots & 2 != 0];
        let options = MatchOptions {
            stake,
            bot: is_bot,
            tutorial,
        };
        let bot = |side: u8| {
            is_bot[usize::from(side)].then(|| Warlord::new(side, bot_seed ^ u64::from(side)))
        };
        SimMatch {
            state: MatchState::new(seed, options),
            bots: [bot(0), bot(1)],
            pending: Inputs::default(),
            events: Events::new(),
        }
    }

    /// Queue `side`'s inputs for the next step (ignored for bot sides). `undefined` = unchanged.
    /// `rig` / `peek` are gate slots (rig: of the opponent's current stage). Later calls before
    /// the step win.
    pub fn set_input(&mut self, side: u8, aim: Option<i32>, rig: Option<u8>, peek: Option<u8>) {
        let Some(p) = self.pending.sides.get_mut(usize::from(side)) else {
            return;
        };
        p.aim = aim.or(p.aim);
        p.rig = rig.or(p.rig);
        p.peek = peek.or(p.peek);
    }

    /// Advance one tick: bots decide on the public state, then the rules run. Returns `false`
    /// (and does nothing) once the match has ended.
    pub fn step(&mut self) -> bool {
        if self.state.public.result.is_some() {
            self.events.clear();
            return false;
        }
        let mut inputs = std::mem::take(&mut self.pending);
        for (slot, bot) in inputs.sides.iter_mut().zip(self.bots.iter_mut()) {
            if let Some(bot) = bot {
                *slot = bot.decide(&self.state.public);
            }
        }
        self.events.clear();
        step(&mut self.state, &inputs, &mut self.events);
        true
    }

    pub fn tick(&self) -> u32 {
        self.state.public.tick
    }

    pub fn ended(&self) -> bool {
        self.state.public.result.is_some()
    }

    /// The public state (VIEW LAYOUT).
    pub fn view(&self) -> Vec<f64> {
        let p = &self.state.public;
        let mut v =
            Vec::with_capacity(HEADER_LEN + 2 * (SIDE_FIXED + 2 + COHORT_CAP * 5 + ENEMY_CAP * 5));
        let r = p.result;
        v.extend([
            f64::from(LAYOUT_VERSION),
            f64::from(p.tick),
            flag(p.ended()),
            f64::from(p.layout),
            p.options.stake as f64,
            flag(r.is_some()),
            r.and_then(|r| r.winner).map_or(-1.0, f64::from),
            flag(r.is_some_and(|r| r.ko)),
            r.map_or(0.0, |r| r.moved as f64),
            r.map_or(0.0, |r| r.fee as f64),
        ]);
        for (side, is_bot) in p.sides.iter().zip(p.options.bot) {
            v.extend([
                f64::from(side.stage),
                f64::from(side.phase.code()),
                f64::from(side.phase_ticks),
                flag(side.dead),
                f64::from(side.cannon_x),
                f64::from(side.aim),
                f64::from(side.gold),
                flag(side.rig_used),
                flag(side.peek_used),
                flag(is_bot),
            ]);
            v.extend(side.towers.iter().map(|&hp| f64::from(hp)));
            v.extend(side.crates.iter().map(|&hp| f64::from(hp)));
            for g in &side.gates {
                v.extend([f64::from(g.x), op_num(g.revealed)]);
            }
            v.push(f64::from(side.cohort_len));
            for c in side.cohorts() {
                v.extend([
                    f64::from(c.id),
                    f64::from(c.count),
                    f64::from(c.x),
                    f64::from(c.y),
                    f64::from(c.age),
                ]);
            }
            v.push(f64::from(side.enemy_len));
            for e in side.enemies() {
                v.extend([
                    f64::from(e.id),
                    f64::from(e.count),
                    f64::from(e.x),
                    f64::from(e.y),
                    f64::from(e.tower),
                ]);
            }
        }
        v
    }

    /// The last step's events (EVENT LAYOUT).
    pub fn events(&self) -> Vec<f64> {
        let mut v = Vec::with_capacity(self.events.as_slice().len() * EVENT_STRIDE);
        for e in self.events.as_slice() {
            v.extend(encode_event(e));
        }
        v
    }

    /// What only `side` may see (PRIVATE LAYOUT). Offline only: the whole sim is local anyway.
    pub fn private_view(&self, side: u8) -> Vec<f64> {
        let pv = self.state.private_view(side);
        vec![
            f64::from(pv.stage),
            pv.rig.map_or(-1.0, |r| f64::from(r.stage)),
            pv.rig.map_or(-1.0, |r| f64::from(r.slot)),
            pv.peek.map_or(-1.0, |p| f64::from(p.slot)),
            op_num(pv.peek.map(|p| p.op)),
        ]
    }

    /// Digest of the full state (public + secret), for parity checks and Verify.
    pub fn digest(&self) -> u64 {
        self.state.digest()
    }

    /// Every stage's rigs and peeks so far (codec history layout: 3 stages × 2 sides ×
    /// [rig victim stage, rig slot, peek slot, peek op byte], 255 = none; the stage index is
    /// the actor's own stage). The live result screen reads the same bytes from the Match.
    pub fn history(&self) -> Vec<u8> {
        let mut out = [0u8; SECRET_LEN];
        codec::encode_secret(&self.state.secret, &mut out);
        codec::history_bytes(&out).to_vec()
    }

    /// The public state in the on-chain codec layout (crates/sim/src/codec.rs), exactly the
    /// bytes the Match account holds; packages/client/src/codec.ts decodes it.
    pub fn public_bytes(&self) -> Vec<u8> {
        let mut out = [0u8; PUBLIC_LEN];
        codec::encode_public(&self.state.public, &mut out);
        out.to_vec()
    }
}

/// The Warlord bot on its own, deciding from the on-chain public state (codec bytes). Used by
/// headless live matches (packages/client/scripts); the UI never needs it.
#[wasm_bindgen]
pub struct Bot {
    inner: Warlord,
    view: PublicState,
}

#[wasm_bindgen]
impl Bot {
    /// `seed` must be independent of the match seed (it only drives tie-breaks and rig/peek slots).
    #[wasm_bindgen(constructor)]
    pub fn new(side: u8, seed: u64) -> Bot {
        Bot {
            inner: Warlord::new(side, seed),
            view: MatchState::zeroed().public,
        }
    }

    /// The bot's input for the tick the given public state is about to process:
    /// `[aim, rig slot, peek slot]`, each -1 for none. Garbage or short input gives `[-1, -1, -1]`.
    pub fn decide(&mut self, public_bytes: &[u8]) -> Vec<i32> {
        let Ok(bytes) = <&[u8; PUBLIC_LEN]>::try_from(public_bytes) else {
            return vec![-1, -1, -1];
        };
        codec::decode_public(bytes, &mut self.view);
        let i = self.inner.decide(&self.view);
        vec![
            i.aim.unwrap_or(-1),
            i.rig.map_or(-1, i32::from),
            i.peek.map_or(-1, i32::from),
        ]
    }
}

fn flag(b: bool) -> f64 {
    if b {
        1.0
    } else {
        0.0
    }
}

/// +k for ×k, -k for ÷k, 0 for none.
fn op_num(op: Option<GateOp>) -> f64 {
    op.map_or(0.0, |o| f64::from(o.signed()))
}

fn encode_event(e: &Event) -> [f64; EVENT_STRIDE] {
    let f = |xs: &[f64]| {
        let mut out = [0.0; EVENT_STRIDE];
        for (o, x) in out.iter_mut().zip(xs) {
            *o = *x;
        }
        out
    };
    let n = |x: u32| f64::from(x);
    let b = |x: u8| f64::from(x);
    let i = |x: i16| f64::from(x);
    match *e {
        Event::Volley {
            side,
            cohort_id,
            x,
            count,
        } => f(&[0.0, b(side), n(cohort_id), i(x), n(count)]),
        Event::Gate {
            side,
            slot,
            cohort_id,
            op,
            before,
            after,
            reveal,
        } => f(&[
            1.0,
            b(side),
            b(slot),
            n(cohort_id),
            op_num(Some(op)),
            n(before),
            n(after),
            flag(reveal),
        ]),
        Event::Gotcha {
            side,
            slot,
            rigged_by,
        } => f(&[2.0, b(side), b(slot), b(rigged_by)]),
        Event::CrateHit {
            side,
            crate_ix,
            cohort_id,
            absorbed,
            hp,
        } => f(&[3.0, b(side), b(crate_ix), n(cohort_id), n(absorbed), n(hp)]),
        Event::CrateBroken { side, crate_ix } => f(&[4.0, b(side), b(crate_ix)]),
        Event::Wave {
            side,
            tower,
            enemy_id,
            x,
            count,
            merged,
        } => f(&[
            5.0,
            b(side),
            b(tower),
            n(enemy_id),
            i(x),
            n(count),
            flag(merged),
        ]),
        Event::Clash { side, x, y, killed } => f(&[6.0, b(side), i(x), i(y), n(killed)]),
        Event::TowerHit {
            side,
            tower,
            damage,
            hp,
            gold,
        } => f(&[7.0, b(side), b(tower), n(damage), n(hp), n(gold)]),
        Event::TowerDestroyed { side, tower, gold } => f(&[8.0, b(side), b(tower), n(gold)]),
        Event::Loot {
            side,
            cohort_id,
            units,
            gold,
        } => f(&[9.0, b(side), n(cohort_id), n(units), n(gold)]),
        Event::Phase { side, stage, phase } => f(&[10.0, b(side), b(stage), b(phase.code())]),
        Event::Death { side } => f(&[11.0, b(side)]),
        Event::End { result } => f(&[
            12.0,
            result.winner.map_or(-1.0, f64::from),
            flag(result.ko),
            result.moved as f64,
            result.fee as f64,
        ]),
    }
}

#[wasm_bindgen]
pub fn rules_version() -> u16 {
    RULES_VERSION
}

#[wasm_bindgen]
pub fn layout_version() -> u32 {
    LAYOUT_VERSION
}

/// DEALS LAYOUT (`deals_for(seed)`): [layout id, then 3 stages × 8 slots × value k (×k)];
/// slots past a stage's gate count hold 1. Every stage's true values of a finished match, from
/// its published seed (Verify and the result screen); rigs come from `history()`.
#[wasm_bindgen]
pub fn deals_for(seed: u64) -> Vec<u8> {
    let d = lil_dudes_sim::deals_for(seed);
    let mut out = Vec::with_capacity(1 + STAGES * GATES_MAX);
    out.push(d.layout);
    out.extend(d.values.iter().flatten().map(|op| op.to_byte()));
    out
}

/// Centre x of gate `slot` in `stage` of `layout`, `t` ticks into that player's Fight/Raid
/// (for smooth drawing of sliding gates between ticks). 0 for a missing gate.
#[wasm_bindgen]
pub fn gate_x_at(layout: u8, stage: u8, slot: u8, t: u32) -> i32 {
    layouts::stage(layout, stage)
        .gates
        .get(usize::from(slot))
        .map_or(0, |g| i32::from(g.x_at(t)))
}

/// crates/sim CODEC_VERSION (byte 0 of the on-chain public state).
#[wasm_bindgen]
pub fn codec_version() -> u8 {
    codec::CODEC_VERSION
}

/// Every constant packages/client mirrors, plus the level pool, as JSON (the TS parity test
/// compares them). `LAYOUTS[id].stages[s]` = `{towers: [{x, hp, wave_base}], rows: [y],
/// gates: [{row, x, width, big, x_min, x_max, speed}], crates: [{x, width, y, hp}]}`; gate,
/// tower and crate indices are the slots used everywhere else.
#[wasm_bindgen]
pub fn constants_json() -> String {
    let list = |xs: &[i64]| {
        let items: Vec<String> = xs.iter().map(i64::to_string).collect();
        format!("[{}]", items.join(","))
    };
    let odds = |xs: &[(u8, u64)]| {
        let items: Vec<String> = xs.iter().map(|(k, p)| format!("[{k},{p}]")).collect();
        format!("[{}]", items.join(","))
    };
    let pairs: [(&str, String); 43] = [
        ("RULES_VERSION", RULES_VERSION.to_string()),
        ("TICKS_PER_SEC", TICKS_PER_SEC.to_string()),
        ("MATCH_TICKS", MATCH_TICKS.to_string()),
        ("STAGES", STAGES.to_string()),
        ("FINAL_STAGE", FINAL_STAGE.to_string()),
        ("PLANT_TICKS", PLANT_TICKS.to_string()),
        ("TRANSIT_TICKS", TRANSIT_TICKS.to_string()),
        ("RAID_TICKS", RAID_TICKS.to_string()),
        ("FIRE_TICKS", FIRE_TICKS.to_string()),
        ("VOLLEY_SIZE", VOLLEY_SIZE.to_string()),
        ("CRUISE_SPEED", CRUISE_SPEED.to_string()),
        ("LAUNCH_TICKS", LAUNCH_TICKS.to_string()),
        ("LAUNCH_SPEED", LAUNCH_SPEED.to_string()),
        ("LANE_WIDTH", LANE_WIDTH.to_string()),
        ("LANE_LENGTH", LANE_LENGTH.to_string()),
        ("TOWER_Y", TOWER_Y.to_string()),
        ("VAULT_Y", VAULT_Y.to_string()),
        ("TOWER_HALF_W", TOWER_HALF_W.to_string()),
        ("CLASH_REACH", CLASH_REACH.to_string()),
        ("CLASH_BAND", CLASH_BAND.to_string()),
        ("STEER_STEP", STEER_STEP.to_string()),
        ("DETECT_Y", DETECT_Y.to_string()),
        ("CANNON_STEP", CANNON_STEP.to_string()),
        ("COHORT_CAP", COHORT_CAP.to_string()),
        ("ENEMY_CAP", ENEMY_CAP.to_string()),
        ("FIRST_WAVE_TICKS", FIRST_WAVE_TICKS.to_string()),
        ("WAVE_GAPS", list(&WAVE_GAPS.map(i64::from))),
        ("WAVE_PCT", list(&WAVE_PCT.map(i64::from))),
        ("FATIGUE_START", FATIGUE_START.to_string()),
        ("FATIGUE_END", FATIGUE_END.to_string()),
        ("FATIGUE_MIN_PM", FATIGUE_MIN_PM.to_string()),
        ("TUTORIAL_WAVE_PCT", TUTORIAL_WAVE_PCT.to_string()),
        ("TOWER_BONUS", TOWER_BONUS.to_string()),
        ("LOOT_PER_UNIT", LOOT_PER_UNIT.to_string()),
        ("DEFEND_Y", DEFEND_Y.to_string()),
        ("FEE_BPS", FEE_BPS.to_string()),
        ("ROWS_MAX", ROWS_MAX.to_string()),
        ("GATES_MAX", GATES_MAX.to_string()),
        ("TOWERS_MAX", TOWERS_MAX.to_string()),
        ("CRATES_MAX", CRATES_MAX.to_string()),
        ("NORMAL_ODDS", odds(&deal::NORMAL_ODDS)),
        ("BIG_ODDS", odds(&deal::BIG_ODDS)),
        ("LAYOUTS", layouts_json()),
    ];
    let body: Vec<String> = pairs.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect();
    format!("{{{}}}", body.join(","))
}

fn layouts_json() -> String {
    let gate = |g: &GateDef| {
        format!(
            "{{\"row\":{},\"x\":{},\"width\":{},\"big\":{},\"x_min\":{},\"x_max\":{},\"speed\":{}}}",
            g.row,
            g.x,
            g.width,
            g.slot == Slot::Big,
            g.x_min,
            g.x_max,
            g.speed
        )
    };
    let stage = |s: &StageDef| {
        let towers: Vec<String> = s
            .towers
            .iter()
            .map(|t| {
                format!(
                    "{{\"x\":{},\"hp\":{},\"wave_base\":{}}}",
                    t.x, t.hp, t.wave_base
                )
            })
            .collect();
        let rows: Vec<String> = s.rows.iter().map(i16::to_string).collect();
        let gates: Vec<String> = s.gates.iter().map(gate).collect();
        let crates: Vec<String> = s
            .crates
            .iter()
            .map(|c| {
                format!(
                    "{{\"x\":{},\"width\":{},\"y\":{},\"hp\":{}}}",
                    c.x, c.width, c.y, c.hp
                )
            })
            .collect();
        format!(
            "{{\"towers\":[{}],\"rows\":[{}],\"gates\":[{}],\"crates\":[{}]}}",
            towers.join(","),
            rows.join(","),
            gates.join(","),
            crates.join(",")
        )
    };
    let all: Vec<String> = LAYOUTS
        .iter()
        .map(|l| {
            let stages: Vec<String> = l.stages.iter().map(stage).collect();
            format!(
                "{{\"name\":\"{}\",\"stages\":[{}]}}",
                l.name,
                stages.join(",")
            )
        })
        .collect();
    format!("[{}]", all.join(","))
}

/// Final digest of the parity match (seed 42, bot seed 7, 0.1 SOL, bot on side 1, idle side 0).
#[cfg(test)]
const PARITY_DIGEST: u64 = 18_369_198_370_544_550_614;

#[cfg(test)]
mod tests {
    use super::*;

    /// Walks a view and returns its length, checking the documented structure.
    fn walk(v: &[f64]) -> usize {
        let mut i = HEADER_LEN;
        for _ in 0..2 {
            i += SIDE_FIXED;
            let n = v[i] as usize;
            i += 1 + n * 5;
            let n = v[i] as usize;
            i += 1 + n * 5;
        }
        i
    }

    #[test]
    fn view_layout_has_the_documented_length() {
        // Bots on both sides, so the match runs long enough to see every kind of unit.
        let mut m = SimMatch::new(1, 2, 0, 0b11, false);
        let mut saw_enemies = false;
        for _ in 0..400 {
            assert!(m.step());
            let v = m.view();
            assert_eq!(walk(&v), v.len());
            saw_enemies |= m.state.public.sides.iter().any(|s| s.enemy_len > 0);
            assert_eq!(m.events().len() % EVENT_STRIDE, 0);
        }
        assert!(saw_enemies);
        let v = m.view();
        assert_eq!(v[0], f64::from(LAYOUT_VERSION));
        assert_eq!(v[1], 400.0);
        assert_eq!(v[3], f64::from(m.state.public.layout));
        // Side 0's first gate: x and face-down / revealed op.
        let g = m.state.public.sides[0].gates[0];
        let at = HEADER_LEN + 10 + TOWERS_MAX + CRATES_MAX;
        assert_eq!(v[at], f64::from(g.x));
        assert_eq!(v[at + 1], op_num(g.revealed));
    }

    #[test]
    fn handle_matches_the_sim_and_runs_to_the_end() {
        // Driving the handle == driving the sim with the same bots by hand.
        let mut h = SimMatch::new(7, 99, 1_000, 0b11, false);
        let mut m = MatchState::new(
            7,
            MatchOptions {
                stake: 1_000,
                bot: [true, true],
                tutorial: false,
            },
        );
        let mut bots = [Warlord::new(0, 99), Warlord::new(1, 98)];
        while h.step() {
            let [a, b] = &mut bots;
            let inputs = Inputs {
                sides: [a.decide(&m.public), b.decide(&m.public)],
            };
            step(&mut m, &inputs, &mut NoEvents);
            assert_eq!(h.digest(), m.digest());
        }
        assert!(h.ended() && h.tick() <= MATCH_TICKS);
        assert!(!h.step());
        assert!(h.events().is_empty());
    }

    #[test]
    fn inputs_reach_the_sim_and_bots_override() {
        let mut h = SimMatch::new(1, 2, 0, 0b10, false);
        h.set_input(0, Some(0), Some(1), None);
        h.set_input(1, Some(2999), None, None); // bot side: ignored
        h.step();
        assert_eq!(h.state.public.sides[0].aim, 0);
        let pv = h.private_view(0);
        assert_eq!(&pv[..3], &[0.0, 0.0, 1.0]);
        assert_eq!(pv[3], -1.0);
        assert_ne!(h.state.public.sides[1].aim, 2999);
    }

    /// packages/client/test/offline.test.ts plays the same match through the bundled WASM and
    /// expects this digest, so a stale packages/sim-wasm/pkg fails the TS tests.
    #[test]
    fn parity_match_digest() {
        let mut h = SimMatch::new(42, 7, 100_000_000, 0b10, false);
        while h.step() {}
        assert_eq!(h.digest(), PARITY_DIGEST);
    }

    #[test]
    fn public_bytes_round_trip() {
        let mut h = SimMatch::new(3, 4, 0, 0b11, false);
        for _ in 0..300 {
            h.step();
        }
        let bytes = h.public_bytes();
        assert_eq!(bytes.len(), PUBLIC_LEN);
        let mut p = MatchState::zeroed().public;
        codec::decode_public(bytes.as_slice().try_into().unwrap(), &mut p);
        assert_eq!(p, h.state.public);
    }

    #[test]
    fn bot_handle_decides_like_the_sim_bot() {
        let m = MatchState::new(4, MatchOptions::default());
        let mut bytes = [0u8; PUBLIC_LEN];
        codec::encode_public(&m.public, &mut bytes);
        let mut handle = Bot::new(1, 77);
        let mut direct = Warlord::new(1, 77);
        let i = direct.decide(&m.public);
        assert_eq!(
            handle.decide(&bytes),
            vec![
                i.aim.unwrap_or(-1),
                i.rig.map_or(-1, i32::from),
                i.peek.map_or(-1, i32::from)
            ]
        );
        assert_eq!(handle.decide(&bytes[..10]), vec![-1, -1, -1]);
    }

    #[test]
    fn deals_for_matches_the_sim() {
        let v = deals_for(99);
        assert_eq!(v.len(), 1 + STAGES * GATES_MAX);
        let m = MatchState::new(99, MatchOptions::default());
        assert_eq!(v[0], m.public.layout);
        for s in 0..STAGES {
            for slot in 0..GATES_MAX {
                let op = m.secret.values[s][slot];
                assert_eq!(v[1 + s * GATES_MAX + slot], op.to_byte());
            }
        }
        // History of a played match: the bots rig in their first plant.
        let mut h = SimMatch::new(5, 6, 0, 0b11, false);
        while h.step() {}
        let hist = h.history();
        assert_eq!(hist.len(), codec::HISTORY_LEN);
        assert_ne!(hist[0], 255);
    }

    #[test]
    fn gate_x_at_matches_the_layouts() {
        let g = LAYOUTS[0].stages[0].gates[4];
        assert_eq!(gate_x_at(0, 0, 4, 37), i32::from(g.x_at(37)));
        assert_eq!(gate_x_at(0, 0, 200, 37), 0);
    }

    #[test]
    fn constants_json_is_valid_looking() {
        let j = constants_json();
        assert!(j.starts_with('{') && j.ends_with('}'));
        assert!(j.contains("\"WAVE_GAPS\":[130,130,80]"));
        assert!(j.contains("\"MATCH_TICKS\":3600"));
        assert!(j.contains("\"name\":\"Twin Lanes\""));
        assert!(j.contains("\"NORMAL_ODDS\":[[2,47],[3,34],[4,12],[5,4],[6,3]]"));
        // Balanced braces and brackets (no JSON parser in this crate).
        let depth = j.chars().fold(0i32, |d, c| match c {
            '{' | '[' => d + 1,
            '}' | ']' => d - 1,
            _ => d,
        });
        assert_eq!(depth, 0);
        assert_eq!(j.matches("\"stages\"").count(), LAYOUTS.len());
    }
}
