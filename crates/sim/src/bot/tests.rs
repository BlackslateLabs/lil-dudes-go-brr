//! Warlord bot (SPEC §10). Most tests pin the full-strength rules (`Warlord::perfect`); the
//! human imperfections (rules v10, SPEC_V5 §15) have their own tests at the end.

use super::*;
use crate::constants::{
    CHAMP_TICKS, CRUISE_SPEED, ENEMY_CAP, GATES_MAX, LAUNCH_SPEED, PLANT_TICKS, STAGES,
};
use crate::deal::NO_GATE;
use crate::events::NoEvents;
use crate::layouts::{self, GateDef, ObstacleDef, Shape, StageDef, LAYOUTS};
use crate::state::{Inputs, MatchOptions, MatchState, Peek, PublicState};
use crate::step::step;
use crate::types::{Enemy, Phase};

/// Layout `layout`, both players at the start of Fight 1.
fn fighting(layout: u8) -> MatchState {
    let mut m = MatchState::new(u64::from(layout), MatchOptions::default());
    while m.public.tick < PLANT_TICKS {
        step(&mut m, &Inputs::default(), &mut NoEvents);
    }
    m
}

/// Ask a fresh bot (side 1) for its aim on a thinking tick, skipping the peek.
fn aim_of(m: &MatchState) -> i32 {
    let mut view = m.public;
    view.tick = 1_000;
    view.sides[1].peek_used = true;
    Warlord::perfect(1, 5).decide(&view).aim.unwrap()
}

#[test]
fn decisions_depend_on_the_public_state_only() {
    // SPEC §10: it never reads secrets. `decide` takes `&PublicState`; changing every secret
    // leaves its decisions unchanged.
    let m = fighting(0);
    let mut other_secrets = m;
    other_secrets.secret.seed ^= 0xFFFF;
    other_secrets.secret.values = [[GateOp::Div(2); GATES_MAX]; STAGES];
    other_secrets.secret.history[0].peeks = [Some(Peek {
        slot: 1,
        op: GateOp::Mul(5),
    }); 2];
    for skill in [Skill::Perfect, Skill::Human] {
        let mut a = Warlord::with_skill(1, 9, skill);
        let mut b = Warlord::with_skill(1, 9, skill);
        for t in 0..400 {
            let mut pa = m.public;
            pa.tick = PLANT_TICKS + t;
            let mut pb = other_secrets.public;
            pb.tick = pa.tick;
            assert_eq!(a.decide(&pa), b.decide(&pb), "{skill:?}");
        }
    }
}

#[test]
fn thinks_every_two_ticks() {
    let mut m = fighting(0);
    m.public.sides[1].peek_used = true;
    let mut bot = Warlord::perfect(1, 1);
    for t in 100..140 {
        m.public.tick = t;
        assert_eq!(bot.decide(&m.public).aim.is_some(), t % THINK_TICKS == 0);
    }
}

#[test]
fn defends_against_the_lowest_enemy_near_its_cannon() {
    // SPEC §10.1: an enemy within DEFEND_Y → aim at it (the lowest first).
    let mut m = fighting(0);
    let me = &mut m.public.sides[1];
    me.enemies[0] = Enemy {
        id: 1,
        count: 3,
        x: 2_222,
        y: 2_900,
        tower: 0,
        giant: false,
    };
    me.enemies[1] = Enemy {
        id: 2,
        count: 3,
        x: 444,
        y: 1_000,
        tower: 0,
        giant: false,
    };
    me.enemy_len = 2;
    assert_eq!(aim_of(&m), 444);
    m.public.sides[1].enemies[1].y = 3_100;
    m.public.sides[1].enemies[0].y = 3_200;
    m.public.sides[1].enemies = [Enemy::default(); ENEMY_CAP];
    m.public.sides[1].enemy_len = 0;
    assert_ne!(aim_of(&m), 444);
}

/// The tick of its flight a volley fired at `x` crosses row `row` (its traced path).
fn row_tick(st: &StageDef, x: i32, row: u8) -> u32 {
    let path = trace(st, x);
    let c = path
        .crossings()
        .iter()
        .find(|c| !c.is_crate && c.index == row)
        .unwrap();
    u32::from(c.tick)
}

/// A phase tick from which a volley at `x` meets row `row`'s timing gate showing `v`.
fn timing_at(st: &StageDef, x: i32, row: u8, v: u32) -> u16 {
    let want = (v - 1) * 20;
    ((want + 1_000 - row_tick(st, x, row) % 100) % 100) as u16
}

#[test]
fn goes_for_the_best_revealed_path() {
    // SPEC §10.2: the product of the gates it would pass, revealed values first. Layout 0,
    // Fight 1: the left lane (x 500) has gates 0 / 3, the middle one gate 1 then a crate, the
    // right one gate 2 / the timing gate 4 (here ×1 on arrival).
    let mut m = fighting(0);
    let st = layouts::stage(0, 0);
    m.public.sides[1].phase_ticks = timing_at(st, 2_500, 1, 1);
    let g = &mut m.public.sides[1].gates;
    for (slot, k) in [(0, 3), (3, 3), (1, 2), (2, 2)] {
        g[slot].revealed = Some(GateOp::Mul(k));
    }
    assert_eq!(path_score(&m.public.sides[1], st, 500), 9_000);
    assert_eq!(path_score(&m.public.sides[1], st, 2_500), 2_000);
    assert_eq!(aim_of(&m), 500);
    // A revealed trap up that path makes another lane better (1 → 3 → ÷3 = 1).
    m.public.sides[1].gates[3].revealed = Some(GateOp::Div(3));
    assert_eq!(path_score(&m.public.sides[1], st, 500), 1_000);
    assert_eq!(aim_of(&m), 2_500);
}

#[test]
fn unrevealed_gates_count_as_their_slot_guess() {
    // SPEC §10.2 (impl): ×2 for a normal `?`, ×8 for a big one.
    let m = fighting(5);
    let st = layouts::stage(5, 0);
    // Island, Fight 1, x 750: two `?` up the left path.
    assert_eq!(path_score(&m.public.sides[1], st, 750), 4_000);
    // Pillars, Fight 2: the exposed big gate (row 0, x 500), then the pillars, then the timing
    // gate.
    let mut c = fighting(4);
    let layout = c.public.layout;
    let me = &mut c.public.sides[1];
    me.load_stage(layout, 1);
    me.phase = Phase::Fight;
    let st = layouts::stage(4, 1);
    assert_eq!(st.gates[0].slot, Slot::Big);
    me.phase_ticks = timing_at(st, 500, 1, 3);
    assert_eq!(path_score(me, st, 500), 24_000);
}

#[test]
fn an_unbroken_crate_weighs_its_jackpot_down_and_a_broken_one_opens_it() {
    // SPEC §10.2 (rules v7): the path past an unbroken crate counts × d / (d + hp), d = the
    // dudes reaching it; once broken, the big gate pays in full.
    let mut m = fighting(0);
    let layout = m.public.layout;
    let me = &mut m.public.sides[1];
    me.load_stage(layout, 1);
    me.phase = Phase::Fight;
    let st = layouts::stage(layout, 1);
    let lock = st.crates[0];
    // The middle lane of Three Lanes' Fight 2: a `?` (×2), the crate, the big gate's ×8.
    let open = 2 * 8 * 1_000;
    let hp = u64::from(lock.hp) * 1_000;
    assert_eq!(
        path_score(me, st, i32::from(lock.x)),
        open * 2_000 / (2_000 + hp)
    );
    // A sturdier crate weighs more.
    me.crates[0] = 300;
    assert_eq!(
        path_score(me, st, i32::from(lock.x)),
        open * 2_000 / (2_000 + 300_000)
    );
    me.crates[0] = 0;
    assert_eq!(path_score(me, st, i32::from(lock.x)), open);
}

#[test]
fn predicts_where_a_sliding_gate_will_be() {
    // SPEC §10.2: moving gates are predicted at the volley's arrival time. (No layout has a
    // slider today: a gate that fills its column has no room to slide in it; the rule stays.)
    const GATES: [GateDef; 1] = [GateDef {
        row: 0,
        x: 1_500,
        width: 600,
        slot: Slot::Normal,
        x_min: 500,
        x_max: 2_500,
        speed: 30,
    }];
    let st = &StageDef {
        towers: &[],
        rows: &[1_800],
        gates: &GATES,
        crates: &[],
        walls: &[],
        obstacles: &[],
        pads: &[],
        pipes: &[],
    };
    let m = fighting(0);
    let def = st.gates[0];
    assert!(def.moving());
    let row_y = i32::from(st.rows[usize::from(def.row)]);
    let mut me = m.public.sides[1];
    me.phase_ticks = 10;
    let arrive = i32::from(def.x_at(10 + travel_ticks(row_y)));
    let now = i32::from(def.x_at(10));
    assert_ne!(arrive, now);
    // At the arrival x the slider counts (its ×2 guess); revealing it as ×1 halves the score.
    let mut one = me;
    one.gates[0].revealed = Some(GateOp::Mul(1));
    assert_eq!(
        path_score(&me, st, arrive),
        2 * path_score(&one, st, arrive)
    );
}

#[test]
fn timing_gates_count_their_value_on_arrival_and_are_never_scouted() {
    // SPEC_V5 §3: public, so the bot uses the value the volley will meet.
    let m = fighting(0);
    let st = layouts::stage(0, 0);
    let t = &st.gates[4];
    assert_eq!(t.slot, Slot::Timing);
    let arrive = row_tick(st, 2_500, t.row);
    for now in [0u16, 13, 40, 77] {
        let mut me = m.public.sides[1];
        me.phase_ticks = now;
        let v = u64::from(timing_value(u32::from(now) + arrive));
        // The right lane: `?`, then the timing gate.
        assert_eq!(path_score(&me, st, 2_500), 2_000 * v, "now {now}");
    }
    // Scout never picks it.
    for seed in 0..50 {
        let mut bot = Warlord::perfect(1, seed);
        let pick = bot.decide(&m.public).peek.unwrap();
        assert_ne!(pick, 4);
    }
}

#[test]
fn holds_the_trigger_and_lets_go_to_release_the_champion() {
    let mut m = fighting(0);
    let mut bot = Warlord::perfect(1, 3);
    m.public.sides[1].firing = true;
    m.public.sides[1].champ_meter = (CHAMP_TICKS - 1) as u8;
    assert_eq!(bot.decide(&m.public).fire, Some(true), "keeps holding");
    m.public.sides[1].champ_meter = CHAMP_TICKS as u8;
    assert_eq!(
        bot.decide(&m.public).fire,
        Some(false),
        "lets go when charged"
    );
    m.public.sides[1].champ_pending = true;
    assert_eq!(bot.decide(&m.public).fire, Some(true));
    // Not held yet (e.g. the first tick): press first.
    m.public.sides[1].champ_pending = false;
    m.public.sides[1].firing = false;
    assert_eq!(bot.decide(&m.public).fire, Some(true));
}

#[test]
fn travel_time_matches_the_movement_rules() {
    // SPEC §7: 6 ticks at LAUNCH_SPEED, then cruise.
    let (l, c) = (LAUNCH_SPEED, CRUISE_SPEED);
    assert_eq!(travel_ticks(l), 1);
    assert_eq!(travel_ticks(6 * l), 6);
    assert_eq!(travel_ticks(6 * l + 1), 7);
    assert_eq!(travel_ticks(6 * l + c), 7);
    assert_eq!(travel_ticks(6 * l + c + 1), 8);
}

#[test]
fn alternates_between_equal_options() {
    // SPEC §10.3: with ties it moves between them every 20–60 ticks.
    let m = fighting(0);
    let mut bot = Warlord::perfect(1, 3);
    let mut view = m.public;
    view.sides[1].peek_used = true;
    // The left lane (two `?`) and the right one (a `?` and the timing gate, ×2 on arrival) tie.
    let st = layouts::stage(0, 0);
    view.sides[1].phase_ticks = timing_at(st, 2_500, 1, 2);
    let mut aims = std::collections::BTreeSet::new();
    for t in (0..600).step_by(2) {
        view.tick = 10_000 + t;
        aims.insert(bot.decide(&view).aim.unwrap());
    }
    assert_eq!(aims.into_iter().collect::<Vec<_>>(), [500, 2_500]);
}

#[test]
fn peeks_at_the_fight_start() {
    // SPEC §10: a random own `?` each fight; never in the plant, never a revealed gate.
    let m = MatchState::new(0, MatchOptions::default());
    let n = LAYOUTS[0].stages[0].gates.len() as u8;
    let mut bot = Warlord::perfect(1, 8);
    let i = bot.decide(&m.public);
    assert!(i.peek.is_none());
    let f = fighting(0);
    let i = bot.decide(&f.public);
    assert!(i.peek.is_some_and(|s| s < n));
    let mut f2 = f;
    for g in f2.public.sides[1].gates.iter_mut().take(usize::from(n)) {
        g.revealed = Some(GateOp::Mul(2));
    }
    f2.public.sides[1].gates[3].revealed = None;
    for _ in 0..20 {
        assert_eq!(bot.decide(&f2.public).peek, Some(3));
    }
    // Spent → nothing.
    f2.public.sides[1].peek_used = true;
    assert_eq!(bot.decide(&f2.public).peek, None);
    assert_eq!(NO_GATE, GateOp::Mul(1));
}

#[test]
fn does_nothing_once_finished() {
    let mut m = fighting(0);
    m.public.sides[1].phase = Phase::Done;
    assert_eq!(
        Warlord::perfect(1, 1).decide(&m.public),
        crate::state::SideInput::default()
    );
}

#[test]
fn aims_at_the_first_rows_gates_in_every_stage() {
    // Rules v8: the aim points are row 1's gate centres; whatever it picks is one of them.
    for layout in 0..LAYOUTS.len() as u8 {
        let m = fighting(layout);
        let st = layouts::stage(layout, 0);
        let (xs, n) = candidates(st);
        let firsts: Vec<i32> = st
            .gates
            .iter()
            .filter(|g| g.row == 0)
            .map(|g| g.x.into())
            .collect();
        assert_eq!(&xs[..n], &firsts[..]);
        let mut view = m.public;
        view.sides[1].peek_used = true;
        let mut bot = Warlord::perfect(1, u64::from(layout));
        for t in (0..200).step_by(2) {
            view.tick = 1_000 + t;
            let x = bot.decide(&view).aim.unwrap();
            assert!(firsts.contains(&x), "layout {layout}: aim {x}");
        }
    }
}

#[test]
fn traces_follow_slides_pads_and_pipes_and_a_sealed_pocket_scores_nothing() {
    // Pipes, Fight 1, left lane: row 1, the block, row 2 (no gate there), then the pipe skips
    // row 3 (the corridor's timing gate).
    let st = layouts::stage(3, 0);
    let path = trace(st, 500);
    assert!(path.open);
    let seen: Vec<(bool, u8)> = path
        .crossings()
        .iter()
        .map(|c| (c.is_crate, c.index))
        .collect();
    assert_eq!(seen, [(false, 0), (true, 0), (false, 1)]);
    // The corridor goes through all three rows.
    assert_eq!(trace(st, 1_500).len, 3);
    // Speed Comb, Fight 1: the comb half zigzags; its pads still bring it to the top row in
    // about the time the open half takes.
    let st = layouts::stage(2, 0);
    let (comb, open) = (row_tick(st, 750, 2), row_tick(st, 2_250, 2));
    assert!(comb < open + 30, "comb {comb} open {open}");
    // A wall of rock across the whole lane: nowhere to go, so 0.
    const ROCK: [ObstacleDef; 1] = [ObstacleDef {
        x0: 0,
        y0: 2_000,
        x1: 3_000,
        y1: 2_200,
        shape: Shape::Rect,
    }];
    const GATES: [GateDef; 1] = [GateDef {
        row: 0,
        x: 1_500,
        width: 3_000,
        slot: Slot::Normal,
        x_min: 1_500,
        x_max: 1_500,
        speed: 0,
    }];
    let sealed = StageDef {
        towers: &[],
        rows: &[3_000],
        gates: &GATES,
        crates: &[],
        walls: &[],
        obstacles: &ROCK,
        pads: &[],
        pipes: &[],
    };
    assert!(!trace(&sealed, 1_500).open);
    let m = fighting(0);
    assert_eq!(path_score(&m.public.sides[1], &sealed, 1_500), 0);
}

// --- rules v10: the human bot (SPEC_V5 §15) ----------------------------------------------------

/// Layout 0's Fight 1 with side 1's Scout spent and its trigger held, at a late tick.
fn human_view() -> PublicState {
    let m = fighting(0);
    let mut view = m.public;
    view.sides[1].peek_used = true;
    view.sides[1].firing = true;
    view
}

#[test]
fn the_default_bot_is_the_human_one() {
    assert_eq!(Warlord::new(1, 1).skill(), Skill::Human);
    assert_eq!(Warlord::perfect(1, 1).skill(), Skill::Perfect);
}

#[test]
fn human_reacts_every_six_to_eight_ticks_and_aims_a_little_off() {
    let mut view = human_view();
    let st = layouts::stage(0, 0);
    let (xs, n) = candidates(st);
    let mut bot = Warlord::new(1, 4);
    let mut last: Option<u32> = None;
    let mut offs = std::collections::BTreeSet::new();
    for t in 0..2_000 {
        view.tick = 1_000 + t;
        let Some(aim) = bot.decide(&view).aim else {
            continue;
        };
        if let Some(l) = last {
            let gap = view.tick - l;
            assert!(
                (HUMAN_THINK_MIN..=HUMAN_THINK_MAX).contains(&gap),
                "gap {gap}"
            );
        }
        last = Some(view.tick);
        // Within AIM_ERROR of one of row 1's gate centres.
        let off = xs[..n]
            .iter()
            .map(|&x| aim - x)
            .min_by_key(|d| d.abs())
            .unwrap();
        assert!(off.abs() <= AIM_ERROR, "aim {aim}");
        offs.insert(off);
    }
    assert!(offs.len() > 50, "the error varies: {} values", offs.len());
    // Defending is slower and off too, but still goes for the enemy.
    view.sides[1].enemies[0] = crate::types::Enemy {
        id: 1,
        count: 3,
        x: 444,
        y: 1_000,
        tower: 0,
        giant: false,
    };
    view.sides[1].enemy_len = 1;
    let aim = (0..HUMAN_THINK_MAX)
        .find_map(|t| {
            view.tick = 5_000 + t;
            bot.decide(&view).aim
        })
        .unwrap();
    assert!((aim - 444).abs() <= AIM_ERROR, "defends at {aim}");
}

#[test]
fn human_sometimes_takes_the_second_best_path() {
    // Layout 0, Fight 1, revealed ×3 / ×3 on the left lane, ×2 / ×1 on the right, the middle
    // lane behind a crate: the left lane is clearly best, the right lane second.
    let m = fighting(0);
    let st = layouts::stage(0, 0);
    let mut view = m.public;
    view.sides[1].peek_used = true;
    view.sides[1].phase_ticks = timing_at(st, 2_500, 1, 1);
    for (slot, k) in [(0, 3), (3, 3), (1, 1), (2, 2)] {
        view.sides[1].gates[slot].revealed = Some(GateOp::Mul(k));
    }
    let best = path_score(&view.sides[1], st, 500);
    let second = path_score(&view.sides[1], st, 2_500);
    assert!(second > 0 && second * 100 < best * NEAR_PCT);
    let (mut on_best, mut on_second) = (0u32, 0u32);
    for seed in 0..40 {
        let mut bot = Warlord::new(1, seed);
        // The phase clock stays put (the timing gate's value is fixed); only the tick moves.
        for t in 0..1_200 {
            view.tick = 2_000 + t;
            if let Some(aim) = bot.decide(&view).aim {
                if (aim - 500).abs() <= AIM_ERROR {
                    on_best += 1;
                } else if (aim - 2_500).abs() <= AIM_ERROR {
                    on_second += 1;
                } else {
                    panic!("aim {aim}");
                }
            }
        }
        // The perfect bot never does.
        let mut perfect = Warlord::perfect(1, seed);
        view.tick = 2_000;
        assert_eq!(perfect.decide(&view).aim, Some(500));
    }
    let share = 100 * on_second / (on_best + on_second);
    assert!(
        (5..=35).contains(&share),
        "{share}% on the second-best path"
    );
}

#[test]
fn human_releases_a_full_champion_meter_late() {
    let mut view = human_view();
    view.sides[1].champ_meter = CHAMP_TICKS as u8;
    for seed in 0..30 {
        let mut bot = Warlord::new(1, seed);
        let mut waited = None;
        for t in 0..60 {
            view.tick = 3_000 + t;
            if bot.decide(&view).fire == Some(false) {
                waited = Some(t);
                break;
            }
        }
        let waited = waited.expect("released");
        assert!(
            (HUMAN_CHAMP_MIN..=HUMAN_CHAMP_MAX).contains(&waited),
            "seed {seed}: {waited} ticks"
        );
    }
}

#[test]
fn human_lifts_its_finger_now_and_then() {
    let mut view = human_view();
    let mut bot = Warlord::new(1, 12);
    let mut runs = Vec::new();
    let mut run = 0u32;
    let mut held = 0u32;
    for t in 0..4_000 {
        view.tick = 1_000 + t;
        if bot.decide(&view).fire == Some(false) {
            run += 1;
        } else {
            held += 1;
            if run > 0 {
                runs.push(run);
                run = 0;
            }
        }
    }
    // A pause every 4-8 s (plus its own length): 4,000 ticks hold ~24-46 of them.
    assert!((20..=50).contains(&runs.len()), "{} pauses", runs.len());
    assert!(
        runs.iter().all(|r| (PAUSE_MIN..=PAUSE_MAX).contains(r)),
        "{runs:?}"
    );
    assert!(held > 3_000, "fires most of the time: {held}");
    // Never with a full meter: it waits for the release instead.
    view.sides[1].champ_meter = CHAMP_TICKS as u8;
    let mut bot = Warlord::new(1, 12);
    let mut lets_go = 0;
    for t in 0..HUMAN_CHAMP_MIN {
        view.tick = 1_000 + t;
        lets_go += u32::from(bot.decide(&view).fire == Some(false));
    }
    assert_eq!(lets_go, 0);
}

#[test]
fn human_plays_whole_matches_from_its_own_seed() {
    // Same seeds, same match; another bot seed, another match (same deal).
    let play = |bot_seed: u64| {
        let mut m = MatchState::new(7, MatchOptions::default());
        let mut bots = [Warlord::new(0, bot_seed), Warlord::new(1, bot_seed ^ 1)];
        while m.public.result.is_none() {
            let inputs = Inputs {
                sides: [bots[0].decide(&m.public), bots[1].decide(&m.public)],
            };
            step(&mut m, &inputs, &mut NoEvents);
        }
        (m.public.tick, m.public.sides.map(|s| s.gold))
    };
    assert_eq!(play(3), play(3));
    assert_ne!(play(3), play(4));
}
