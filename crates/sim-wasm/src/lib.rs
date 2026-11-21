//! Browser bindings for the match rules: one `SimMatch` handle per match, with the Warlord bot
//! built in. Cheap at 20 Hz: the view and events cross into JS as flat `Float64Array`s, decoded by
//! packages/client/src/offline.ts. Rebuild with `packages/sim-wasm/build.sh`.
//!
//! VIEW LAYOUT (`view()`), all numbers:
//!   header: layout version, tick, status (0 plant, 1 playing, 2 ended), phase, surge (0/1),
//!           stake, has result (0/1), winner (0, 1, -1 = draw or none), ko (0/1), moved, fee
//!   then per side (0, 1):
//!           hp, cannon x, aim, rig used, peek used, is bot,
//!           9 gates × [hint (0 none, 1 good, 2 bad, 3 gold), gold, revealed (0/1), kind, value],
//!           n cohorts, n × [id, count, x, y, age]
//!   op kind: 0 mul, 1 add, 2 sub, 3 div.
//!
//! EVENT LAYOUT (`events()`), EVENT_STRIDE numbers per event: type, then up to 5 fields:
//!   0 volley [side, id, x, count]          1 reveal [side, cell, kind, value, gold]
//!   2 gate [side, cell, id, before, after] 3 gotcha [side, cell, rigged by]
//!   4 clash [x, y, killed0, killed1]       5 hit [side, damage, hp]
//!   6 plant [phase]  7 redeal [phase]  8 surge  9 end [winner (-1 draw), ko, moved, fee]
//!
//! PRIVATE LAYOUT (`private_view(side)`): rig cell (-1 none), peek cell (-1 none), peek kind,
//!   peek value, peek gold.

use lil_dudes_sim::*;
use wasm_bindgen::prelude::*;

/// Bump when any layout above changes (offline.ts refuses a mismatch).
pub const LAYOUT_VERSION: u32 = 1;
pub const EVENT_STRIDE: usize = 6;

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
    /// Later calls before the step win.
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
        let mut v = Vec::with_capacity(16 + 2 * (6 + 9 * 5 + 1 + COHORT_CAP * 5));
        let status = match p.status() {
            Status::Plant => 0.0,
            Status::Playing => 1.0,
            Status::Ended => 2.0,
        };
        let r = p.result;
        v.extend([
            f64::from(LAYOUT_VERSION),
            f64::from(p.tick),
            status,
            f64::from(p.phase()),
            flag(p.surge()),
            p.options.stake as f64,
            flag(r.is_some()),
            r.and_then(|r| r.winner).map_or(-1.0, f64::from),
            flag(r.is_some_and(|r| r.ko)),
            r.map_or(0.0, |r| r.moved as f64),
            r.map_or(0.0, |r| r.fee as f64),
        ]);
        for (side, is_bot) in p.sides.iter().zip(p.options.bot) {
            v.extend([
                f64::from(side.hp),
                f64::from(side.cannon_x),
                f64::from(side.aim),
                flag(side.rig_used),
                flag(side.peek_used),
                flag(is_bot),
            ]);
            for g in &side.gates {
                let (kind, value) = g.revealed.map_or((0, 0), GateOp::code);
                v.extend([
                    f64::from(g.hint.code()),
                    flag(g.gold),
                    flag(g.revealed.is_some()),
                    f64::from(kind),
                    f64::from(value),
                ]);
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
        let (kind, value) = pv.peek.map_or((0, 0), |p| p.op.code());
        vec![
            pv.rig.map_or(-1.0, f64::from),
            pv.peek.map_or(-1.0, |p| f64::from(p.cell)),
            f64::from(kind),
            f64::from(value),
            flag(pv.peek.is_some_and(|p| p.gold)),
        ]
    }

    /// Digest of the full state (public + secret), for parity checks and Verify.
    pub fn digest(&self) -> u64 {
        self.state.digest()
    }
}

fn flag(b: bool) -> f64 {
    if b {
        1.0
    } else {
        0.0
    }
}

fn side(s: u8) -> f64 {
    f64::from(s)
}

fn encode_event(e: &Event) -> [f64; EVENT_STRIDE] {
    let op = |op: GateOp| {
        let (k, v) = op.code();
        (f64::from(k), f64::from(v))
    };
    match *e {
        Event::Volley {
            side: s,
            cohort_id,
            x,
            count,
        } => [
            0.0,
            side(s),
            f64::from(cohort_id),
            f64::from(x),
            f64::from(count),
            0.0,
        ],
        Event::Reveal {
            side: s,
            cell,
            op: o,
            gold,
        } => {
            let (k, v) = op(o);
            [1.0, side(s), f64::from(cell), k, v, flag(gold)]
        }
        Event::Gate {
            side: s,
            cell,
            cohort_id,
            before,
            after,
        } => [
            2.0,
            side(s),
            f64::from(cell),
            f64::from(cohort_id),
            f64::from(before),
            f64::from(after),
        ],
        Event::Gotcha {
            side: s,
            cell,
            rigged_by,
        } => [3.0, side(s), f64::from(cell), side(rigged_by), 0.0, 0.0],
        Event::Clash { x, y, killed } => [
            4.0,
            f64::from(x),
            f64::from(y),
            f64::from(killed[0]),
            f64::from(killed[1]),
            0.0,
        ],
        Event::Hit {
            side: s,
            damage,
            hp,
        } => [5.0, side(s), f64::from(damage), f64::from(hp), 0.0, 0.0],
        Event::Plant { phase } => [6.0, f64::from(phase), 0.0, 0.0, 0.0, 0.0],
        Event::Redeal { phase } => [7.0, f64::from(phase), 0.0, 0.0, 0.0, 0.0],
        Event::Surge => [8.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        Event::End { result } => [
            9.0,
            result.winner.map_or(-1.0, f64::from),
            flag(result.ko),
            result.moved as f64,
            result.fee as f64,
            0.0,
        ],
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

/// Every constant packages/client mirrors, as JSON (the TS parity test compares them).
#[wasm_bindgen]
pub fn constants_json() -> String {
    let list = |xs: &[i64]| {
        let items: Vec<String> = xs.iter().map(i64::to_string).collect();
        format!("[{}]", items.join(","))
    };
    let pairs: [(&str, String); 27] = [
        ("TICKS_PER_SEC", TICKS_PER_SEC.to_string()),
        ("MATCH_TICKS", MATCH_TICKS.to_string()),
        ("PHASES", PHASES.to_string()),
        ("PLANT_STARTS", list(&PLANT_STARTS.map(i64::from))),
        ("PLANT_TICKS", PLANT_TICKS.to_string()),
        ("SURGE_TICK", SURGE_TICK.to_string()),
        ("FIRE_TICKS", FIRE_TICKS.to_string()),
        ("FIRE_TICKS_SURGE", FIRE_TICKS_SURGE.to_string()),
        ("VOLLEY_SIZE", VOLLEY_SIZE.to_string()),
        ("COHORT_CAP", COHORT_CAP.to_string()),
        ("COLS", COLS.to_string()),
        ("ROWS", ROWS.to_string()),
        ("CELLS", CELLS.to_string()),
        ("COL_WIDTH", COL_WIDTH.to_string()),
        ("LANE_WIDTH", LANE_WIDTH.to_string()),
        ("LANE_LENGTH", LANE_LENGTH.to_string()),
        ("GATE_WIDTH", GATE_WIDTH.to_string()),
        ("ROW_Y", list(&ROW_Y.map(i64::from))),
        ("CLASH_START_Y", CLASH_START_Y.to_string()),
        ("CLASH_END_Y", CLASH_END_Y.to_string()),
        ("CLASH_REACH", CLASH_REACH.to_string()),
        ("CRUISE_SPEED", CRUISE_SPEED.to_string()),
        ("LAUNCH_TICKS", LAUNCH_TICKS.to_string()),
        ("LAUNCH_SPEED", LAUNCH_SPEED.to_string()),
        ("CANNON_STEP", CANNON_STEP.to_string()),
        ("HP_MAX", HP_MAX.to_string()),
        ("HINT_PCT", HINT_PCT.to_string()),
    ];
    let body: Vec<String> = pairs.iter().map(|(k, v)| format!("\"{k}\":{v}")).collect();
    format!("{{{}}}", body.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_layout_has_the_documented_length() {
        let mut m = SimMatch::new(1, 2, 0, 0b10, false);
        for _ in 0..200 {
            m.step();
        }
        let v = m.view();
        assert_eq!(v[0], f64::from(LAYOUT_VERSION));
        assert_eq!(v[1], 200.0);
        let mut i = 11;
        for _ in 0..2 {
            i += 6 + 9 * 5;
            let n = v[i] as usize;
            i += 1 + n * 5;
        }
        assert_eq!(i, v.len());
        assert_eq!(m.events().len() % EVENT_STRIDE, 0);
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
        h.set_input(0, Some(0), Some(3), None);
        h.set_input(1, Some(2999), None, None); // bot side: ignored
        h.step();
        assert_eq!(h.state.public.sides[0].aim, 0);
        assert_eq!(h.private_view(0)[0], 3.0);
        assert_ne!(h.state.public.sides[1].aim, 2999);
    }

    #[test]
    fn constants_json_is_valid_looking() {
        let j = constants_json();
        assert!(j.starts_with('{') && j.ends_with('}'));
        assert!(j.contains("\"PLANT_STARTS\":[0,800,1600]"));
        assert!(j.contains("\"HP_MAX\":2200"));
    }
}
