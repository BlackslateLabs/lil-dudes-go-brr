//! Warlord bot (SPEC §10).

use super::*;
use crate::constants::{ENEMY_CAP, GATES_MAX, GATE_GRACE, PLANT_TICKS, STAGES};
use crate::deal::NO_GATE;
use crate::events::NoEvents;
use crate::layouts::{self, LAYOUTS};
use crate::state::{Inputs, MatchOptions, MatchState, PublicState, Rig};
use crate::step::{can_rig, step};
use crate::types::{Enemy, Phase};

/// Layout `layout`, both players at the start of Fight 1.
fn fighting(layout: u8) -> MatchState {
    let mut m = MatchState::new(u64::from(layout), MatchOptions::default());
    while m.public.tick < PLANT_TICKS {
        step(&mut m, &Inputs::default(), &mut NoEvents);
    }
    m
}

/// Ask a fresh bot (side 1) for its aim on a thinking tick, skipping rig/peek.
fn aim_of(m: &MatchState) -> i32 {
    let mut view = m.public;
    view.tick = 1_000;
    view.sides[1].peek_used = true;
    view.sides[1].rig_used = true;
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
    other_secrets.secret.history[0].rigs = [Some(Rig { stage: 0, slot: 1 }); 2];
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
    };
    me.enemies[1] = Enemy {
        id: 2,
        count: 3,
        x: 444,
        y: 1_000,
        tower: 0,
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
    // Layout 0, Fight 1: gates 0/2 at x 700 (rows 0/1), 1/3 at x 2,300 (rows 0/1).
    let g = &mut m.public.sides[1].gates;
    g[0].revealed = Some(GateOp::Mul(2));
    g[2].revealed = Some(GateOp::Mul(3));
    g[1].revealed = Some(GateOp::Mul(6));
    g[3].revealed = Some(GateOp::Mul(2));
    let x = aim_of(&m);
    assert!((2_000..=2_600).contains(&x), "{x}");
    assert!(path_score(&m.public.sides[1], st, x) >= 12_000);
    // A revealed trap up that path makes the other side better.
    m.public.sides[1].gates[3].revealed = Some(GateOp::Div(2));
    let x = aim_of(&m);
    assert!((400..=1_000).contains(&x), "{x}");
}

#[test]
fn unrevealed_gates_count_as_their_slot_guess() {
    // SPEC §10.2 (impl): ×2 for a normal `?`, ×8 for a big one.
    let m = fighting(0);
    let me = &m.public.sides[1];
    let st = layouts::stage(0, 0);
    assert_eq!(path_score(me, st, 700), 4_000);
    assert_eq!(path_score(me, st, 100), 1_000);
}

#[test]
fn an_unbroken_crate_absorbs_the_path_and_a_broken_one_opens_the_big_gate() {
    // SPEC §10.2: locked gates count only once the crate is broken.
    let mut m = fighting(0);
    let layout = m.public.layout;
    let me = &mut m.public.sides[1];
    me.load_stage(layout, 1);
    me.phase = Phase::Fight;
    let st = layouts::stage(layout, 1);
    let lock = st.crates[0];
    assert_eq!(path_score(me, st, i32::from(lock.x)), 0);
    me.crates[0] = 0;
    assert_eq!(path_score(me, st, i32::from(lock.x)), 8_000);
}

#[test]
fn predicts_where_a_sliding_gate_will_be() {
    // SPEC §10.2: moving gates are predicted at the volley's arrival time.
    let m = fighting(0);
    let st = layouts::stage(0, 0);
    let def = st.gates[4];
    let row_y = i32::from(st.rows[usize::from(def.row)]);
    let mut me = m.public.sides[1];
    me.phase_ticks = 50;
    let arrive = i32::from(def.x_at(50 + travel_ticks(row_y)));
    let now = i32::from(def.x_at(50));
    assert_ne!(arrive, now);
    assert_eq!(path_score(&me, st, arrive), 2_000);
    if (arrive - now).abs() > i32::from(def.width) / 2 + GATE_GRACE {
        assert_eq!(path_score(&me, st, now), 1_000);
    }
}

#[test]
fn travel_time_matches_the_movement_rules() {
    // SPEC §7: 6 ticks at LAUNCH_SPEED, then cruise.
    assert_eq!(travel_ticks(240), 1);
    assert_eq!(travel_ticks(1_440), 6);
    assert_eq!(travel_ticks(1_441), 7);
    assert_eq!(travel_ticks(1_520), 7);
}

#[test]
fn alternates_between_equal_options() {
    // SPEC §10.3: with ties it moves between them every 20–60 ticks.
    let m = fighting(0);
    let mut bot = Warlord::new(1, 3);
    let mut view = m.public;
    view.sides[1].peek_used = true;
    // The slider is predicted in the middle (a full period after the fight start), so the left
    // and right lanes (two `?` each) tie.
    let st = layouts::stage(0, 0);
    let arrive = travel_ticks(i32::from(st.rows[2]));
    view.sides[1].phase_ticks = (96 - arrive) as u16;
    assert_eq!(st.gates[4].x_at(96), st.gates[4].x);
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
    assert!(i.rig.is_none() && i.peek.is_none());
    let f = fighting(0);
    let i = bot.decide(&f.public);
    assert!(i.peek.is_some_and(|s| s < n) && i.rig.is_none());
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

/// The fight tick at which a fresh bot (side 1) first rigs, and the slot.
fn first_rig(view: &PublicState, seed: u64) -> Option<(u16, u8)> {
    let mut bot = Warlord::new(1, seed);
    let mut v = *view;
    v.sides[1].peek_used = true;
    for t in 0..200u16 {
        v.sides[1].phase_ticks = t;
        if let Some(slot) = bot.decide(&v).rig {
            return Some((t, slot));
        }
    }
    None
}

#[test]
fn rigs_once_per_stage_one_to_three_seconds_into_its_fight() {
    // SPEC §10: at a random moment 1–3 s into its fight, a random gate of its own stage that
    // is still face-down and that the rig rule accepts.
    let f = fighting(0);
    let n = LAYOUTS[0].stages[0].gates.len() as u8;
    let mut moments = std::collections::BTreeSet::new();
    for seed in 0..40 {
        let (t, slot) = first_rig(&f.public, seed).expect("rigs");
        assert!(
            (RIG_AFTER_MIN..=RIG_AFTER_MAX).contains(&u32::from(t)),
            "{t}"
        );
        assert!(slot < n && can_rig(&f.public, 1, slot));
        moments.insert(t);
    }
    assert!(moments.len() > 5, "{moments:?}");
    // Not a gate the opponent already revealed, nor one face-down only for the opponent.
    let mut g = f;
    for gate in g.public.sides[0].gates.iter_mut().take(usize::from(n)) {
        gate.revealed = Some(GateOp::Mul(2));
    }
    g.public.sides[0].gates[2].revealed = None;
    g.public.sides[0].gates[4].revealed = None;
    g.public.sides[1].gates[4].revealed = Some(GateOp::Mul(3));
    for seed in 0..20 {
        assert_eq!(first_rig(&g.public, seed).map(|r| r.1), Some(2));
    }
    // Nothing the rule would accept: no rig (the opponent is past this stage, or done).
    let mut h = f;
    let layout = h.public.layout;
    h.public.sides[0].load_stage(layout, 1);
    h.public.sides[0].phase = Phase::Fight;
    assert_eq!(first_rig(&h.public, 1), None);
    let mut d = f;
    d.public.sides[0].phase = Phase::Done;
    assert_eq!(first_rig(&d.public, 1), None);
    // Spent → nothing.
    let mut u = f;
    u.public.sides[1].rig_used = true;
    assert_eq!(first_rig(&u.public, 1), None);
}

#[test]
fn rigs_again_in_its_next_stage() {
    // SPEC §10: a fresh plan per stage; a rig on a stage the opponent hasn't reached is fine.
    let mut m = fighting(0);
    let layout = m.public.layout;
    let mut bot = Warlord::new(1, 4);
    let mut v = m.public;
    v.sides[1].peek_used = true;
    v.sides[1].phase_ticks = 100;
    assert!(bot.decide(&v).rig.is_some());
    m.public.sides[1].load_stage(layout, 1);
    m.public.sides[1].phase = Phase::Fight;
    let mut v = m.public;
    v.sides[1].peek_used = true;
    v.sides[1].phase_ticks = 0;
    assert!(bot.decide(&v).rig.is_none());
    v.sides[1].phase_ticks = RIG_AFTER_MAX as u16;
    let slot = bot.decide(&v).rig.expect("rigs in Fight 2");
    assert!(usize::from(slot) < LAYOUTS[0].stages[1].gates.len());
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
