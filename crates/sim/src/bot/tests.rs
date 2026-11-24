//! Warlord bot (SPEC §10).

use super::*;
use crate::constants::{CHAMP_TICKS, ENEMY_CAP, GATES_MAX, PLANT_TICKS, STAGES};
use crate::deal::NO_GATE;
use crate::events::NoEvents;
use crate::layouts::{self, GateDef, StageDef, LAYOUTS};
use crate::state::{Inputs, MatchOptions, MatchState, Peek};
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
    Warlord::new(1, 5).decide(&view).aim.unwrap()
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
    let (mut a, mut b) = (Warlord::new(1, 9), Warlord::new(1, 9));
    for t in 0..200 {
        let mut pa = m.public;
        pa.tick = PLANT_TICKS + t;
        let mut pb = other_secrets.public;
        pb.tick = pa.tick;
        assert_eq!(a.decide(&pa), b.decide(&pb));
    }
}

#[test]
fn thinks_every_two_ticks() {
    let mut m = fighting(0);
    m.public.sides[1].peek_used = true;
    let mut bot = Warlord::new(1, 1);
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

#[test]
fn goes_for_the_best_revealed_path() {
    // SPEC §10.2: the product of the gates it would pass, revealed values first.
    let mut m = fighting(0);
    let st = layouts::stage(0, 0);
    // Layout 0, Fight 1: the left column (x 750) has gates 0 / 2 / 4 / 6, the right one
    // (x 2,250) 1 / the timing gate 3 / 5 / 7. The timing gate shows ×1 on this volley's arrival
    // (fight tick 0 + 18).
    let g = &mut m.public.sides[1].gates;
    for (slot, k) in [(0, 2), (2, 3), (4, 2), (6, 2), (1, 2), (5, 2), (7, 2)] {
        g[slot].revealed = Some(GateOp::Mul(k));
    }
    assert_eq!(aim_of(&m), 750);
    assert_eq!(path_score(&m.public.sides[1], st, 750), 24_000);
    assert_eq!(path_score(&m.public.sides[1], st, 2_250), 8_000);
    // A revealed trap up that path makes the other column better (1 → 2 → 6 → ÷3 = 2 → 4).
    m.public.sides[1].gates[4].revealed = Some(GateOp::Div(3));
    assert_eq!(path_score(&m.public.sides[1], st, 750), 4_000);
    assert_eq!(aim_of(&m), 2_250);
}

#[test]
fn unrevealed_gates_count_as_their_slot_guess() {
    // SPEC §10.2 (impl): ×2 for a normal `?`, ×8 for a big one.
    let m = fighting(0);
    let me = &m.public.sides[1];
    let st = layouts::stage(0, 0);
    // x 700: the four `?` of the left column.
    assert_eq!(path_score(me, st, 700), 16_000);
    // Three Ways, Fight 1: the exposed big gate (row 0, x 500), then two `?`.
    let c = fighting(1);
    let st = layouts::stage(1, 0);
    assert_eq!(st.gates[0].slot, Slot::Big);
    assert_eq!(path_score(&c.public.sides[1], st, 500), 32_000);
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
    // The middle column: a `?` (×2), the crate, the big gate's ×8, then the timing gate at its
    // value on arrival.
    let v = u64::from(timing_value(travel_ticks(i32::from(st.rows[2]))));
    let open = 2 * 8 * v * 1_000;
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
    let t = &st.gates[3];
    assert_eq!(t.slot, Slot::Timing);
    let row_y = i32::from(st.rows[usize::from(t.row)]);
    for now in [0u16, 13, 40, 77] {
        let mut me = m.public.sides[1];
        me.phase_ticks = now;
        let v = u64::from(timing_value(u32::from(now) + travel_ticks(row_y)));
        // The right column: `?`, the timing gate, `?`, `?`.
        let score = path_score(&me, st, 2_250);
        assert_eq!(score % (v * 1_000), 0, "now {now}: {score} vs ×{v}");
    }
    // Scout never picks it.
    for seed in 0..50 {
        let mut bot = Warlord::new(1, seed);
        let pick = bot.decide(&m.public).peek.unwrap();
        assert_ne!(pick, 3);
    }
}

#[test]
fn holds_the_trigger_and_lets_go_to_release_the_champion() {
    let mut m = fighting(0);
    let mut bot = Warlord::new(1, 3);
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
    assert_eq!(travel_ticks(180), 1);
    assert_eq!(travel_ticks(1_080), 6);
    assert_eq!(travel_ticks(1_081), 7);
    assert_eq!(travel_ticks(1_140), 7);
    assert_eq!(travel_ticks(1_141), 8);
}

#[test]
fn alternates_between_equal_options() {
    // SPEC §10.3: with ties it moves between them every 20–60 ticks.
    let m = fighting(0);
    let mut bot = Warlord::new(1, 3);
    let mut view = m.public;
    view.sides[1].peek_used = true;
    // The left column (four `?`) and the right one (three `?` and the timing gate, ×2 on
    // arrival at fight tick 10 + 18) tie.
    view.sides[1].phase_ticks = 10;
    let st = layouts::stage(0, 0);
    assert_eq!(timing_value(10 + travel_ticks(i32::from(st.rows[1]))), 2);
    let mut aims = std::collections::BTreeSet::new();
    for t in (0..600).step_by(2) {
        view.tick = 10_000 + t;
        aims.insert(bot.decide(&view).aim.unwrap() < 1_500);
    }
    assert_eq!(aims.len(), 2, "both sides of the lane");
}

#[test]
fn peeks_at_the_fight_start() {
    // SPEC §10: a random own `?` each fight; never in the plant, never a revealed gate.
    let m = MatchState::new(0, MatchOptions::default());
    let n = LAYOUTS[0].stages[0].gates.len() as u8;
    let mut bot = Warlord::new(1, 8);
    let i = bot.decide(&m.public);
    assert!(i.peek.is_none());
    let f = fighting(0);
    let i = bot.decide(&f.public);
    assert!(i.peek.is_some_and(|s| s < n));
    let mut f2 = f;
    for g in f2.public.sides[1].gates.iter_mut().take(usize::from(n)) {
        g.revealed = Some(GateOp::Mul(2));
    }
    f2.public.sides[1].gates[4].revealed = None;
    for _ in 0..20 {
        assert_eq!(bot.decide(&f2.public).peek, Some(4));
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
        Warlord::new(1, 1).decide(&m.public),
        crate::state::SideInput::default()
    );
}

#[test]
fn aims_at_column_centres_and_scores_the_column_a_wall_pushes_it_into() {
    // SPEC_V5 §12: without sliders the bot picks a column (its centre), so its volleys are in a
    // column before they reach the walls; an x on a wall's line scores the column it is pushed
    // into (ties left).
    let m = fighting(2);
    let st = layouts::stage(2, 0);
    assert!(!st.walls.is_empty());
    for seed in 0..20 {
        let mut view = m.public;
        view.sides[1].peek_used = true;
        let mut bot = Warlord::new(1, seed);
        for t in (0..200).step_by(2) {
            view.tick = 1_000 + t;
            let x = bot.decide(&view).aim.unwrap();
            assert!(layouts::COL3.contains(&(x as i16)), "aim {x}");
        }
    }
    let me = &m.public.sides[1];
    assert_eq!(path_score(me, st, 1_000), path_score(me, st, 500));
    assert_eq!(path_score(me, st, 1_001), path_score(me, st, 1_500));
    // The middle column: two `?`, then open lane.
    assert_eq!(path_score(me, st, 1_500), 4_000);
}
