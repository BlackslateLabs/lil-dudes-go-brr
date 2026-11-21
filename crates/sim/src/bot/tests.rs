//! Warlord bot (SPEC §9).

use super::*;
use crate::constants::{HP_MAX, LANE_WIDTH, PLANT_STARTS, PLANT_TICKS};
use crate::events::NoEvents;
use crate::state::{Inputs, MatchOptions, MatchState};
use crate::step::step;
use crate::types::Cohort;

fn playing_match() -> MatchState {
    let mut m = MatchState::new(3, MatchOptions::default());
    while m.public.tick < PLANT_TICKS {
        step(&mut m, &Inputs::default(), &mut NoEvents);
    }
    m
}

fn reveal(m: &mut MatchState, side: usize, cell: usize, op: GateOp) {
    m.public.sides[side].gates[cell].revealed = Some(op);
}

fn set_hints(m: &mut MatchState, side: usize, hint: Hint) {
    for g in m.public.sides[side].gates.iter_mut() {
        g.gold = false;
        g.hint = hint;
        g.revealed = None;
    }
}

#[test]
fn decisions_depend_on_the_public_state_only() {
    // SPEC §9: it never reads secrets. `decide` takes `&PublicState`; changing every secret
    // leaves its decisions unchanged.
    let m = playing_match();
    let mut other_secrets = m;
    other_secrets.secret.seed ^= 0xFFFF;
    other_secrets.secret.deal.ops = [GateOp::Div(2); CELLS];
    other_secrets.secret.rigs = [Some(1), Some(2)];
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
    let mut m = playing_match();
    m.public.sides[1].peek_used = true;
    let mut bot = Warlord::new(1, 1);
    for t in 100..140 {
        m.public.tick = t;
        assert_eq!(bot.decide(&m.public).aim.is_some(), t % THINK_TICKS == 0);
    }
}

#[test]
fn goes_for_the_best_revealed_column() {
    // SPEC §9.2: the best revealed gate.
    let mut m = playing_match();
    set_hints(&mut m, 1, Hint::None);
    reveal(&mut m, 1, 2, GateOp::Mul(3)); // row 0, column 2
    reveal(&mut m, 1, 0, GateOp::Mul(2)); // row 0, column 0
    m.public.tick = 100;
    let mut bot = Warlord::new(1, 5);
    assert_eq!(bot.decide(&m.public).aim, Some(2500));
    // A revealed ÷2 further up column 2 makes column 0 better.
    reveal(&mut m, 1, 5, GateOp::Div(2));
    m.public.tick = 102;
    assert_eq!(bot.decide(&m.public).aim, Some(500));
}

#[test]
fn prefers_blue_hints_over_grey_over_red() {
    // SPEC §9.2: else the best hint colour.
    let mut m = playing_match();
    set_hints(&mut m, 1, Hint::Bad);
    m.public.sides[1].gates[4].hint = Hint::None; // column 1: red, grey, red
    m.public.sides[1].gates[3].hint = Hint::Good; // column 0: red, blue, red
    m.public.tick = 100;
    assert_eq!(Warlord::new(1, 5).decide(&m.public).aim, Some(500));
    assert!(column_score(&m.public.sides[1], 0) > column_score(&m.public.sides[1], 1));
    assert!(column_score(&m.public.sides[1], 1) > column_score(&m.public.sides[1], 2));
}

#[test]
fn alternates_between_equal_options_every_20_to_60_ticks() {
    // SPEC §9.3.
    let mut m = playing_match();
    set_hints(&mut m, 1, Hint::Bad);
    m.public.sides[1].gates[0].hint = Hint::Good; // column 0
    m.public.sides[1].gates[2].hint = Hint::Good; // column 2, equal
    let mut bot = Warlord::new(1, 11);
    let mut picks = Vec::new();
    for t in (100..1100).step_by(2) {
        m.public.tick = t;
        picks.push((t, bot.decide(&m.public).aim.unwrap()));
    }
    assert!(picks.iter().all(|&(_, x)| x == 500 || x == 2500));
    let switches: Vec<u32> = picks
        .windows(2)
        .filter(|w| w[0].1 != w[1].1)
        .map(|w| w[1].0)
        .collect();
    assert!(switches.len() >= 15, "{} switches", switches.len());
    for w in switches.windows(2) {
        let gap = w[1] - w[0];
        assert!(
            (SWITCH_MIN..=SWITCH_MAX + THINK_TICKS).contains(&gap),
            "gap {gap}"
        );
    }
}

#[test]
fn defends_against_a_grown_cohort_near_its_cannon() {
    // SPEC §9.1: defend if an enemy cohort is close to its cannon.
    let mut m = playing_match();
    m.public.tick = 100;
    let side0 = &mut m.public.sides[0];
    let threat = Cohort {
        id: 7,
        count: 30,
        x: 2400,
        y: 9500,
        age: 80,
        last_row: 3,
    };
    let far = Cohort {
        id: 8,
        count: 90,
        x: 600,
        y: 4000,
        age: 40,
        last_row: 3,
    };
    let raw = Cohort {
        id: 9,
        count: VOLLEY_SIZE,
        x: 1400,
        y: 11_000,
        age: 90,
        last_row: 3,
    };
    side0.cohorts[0] = raw;
    side0.cohorts[1] = threat;
    side0.cohorts[2] = far;
    side0.cohort_len = 3;
    assert_eq!(Warlord::new(1, 1).decide(&m.public).aim, Some(2400));
    // Without the threat it ignores the raw volley and the far cohort.
    m.public.sides[0].cohorts[1].count = 0;
    let aim = Warlord::new(1, 1).decide(&m.public).aim.unwrap();
    assert_ne!(aim, 1400);
    assert_ne!(aim, 600);
}

#[test]
fn rigs_once_in_the_plant_and_peeks_once_in_play() {
    // SPEC §9: it rigs and peeks at random cells (never the gold gate for a rig).
    for seed in 0..50u64 {
        let mut m = MatchState::new(seed, MatchOptions::default());
        let mut bot = Warlord::new(1, seed);
        let gold = m.secret.deal.gold_cell;
        let (mut rigs, mut peeks) = (0, 0);
        while m.public.tick < 200 {
            let mut inputs = Inputs::default();
            inputs.sides[1] = bot.decide(&m.public);
            if let Some(cell) = inputs.sides[1].rig {
                assert_ne!(cell, gold);
                assert!(usize::from(cell) < CELLS);
                rigs += 1;
            }
            if inputs.sides[1].peek.is_some() {
                assert_eq!(m.public.status(), Status::Playing);
                peeks += 1;
            }
            step(&mut m, &inputs, &mut NoEvents);
        }
        assert_eq!((rigs, peeks), (1, 1));
        assert!(m.private_view(1).rig.is_some() && m.private_view(1).peek.is_some());
    }
}

#[test]
fn tutorial_bot_holds_back_in_phase_one() {
    // SPEC §9 tutorial: in phase 1 the bot holds back, so a newcomer can't be knocked out.
    for seed in 0..30u64 {
        let opts = MatchOptions {
            tutorial: true,
            bot: [false, true],
            ..MatchOptions::default()
        };
        let mut m = MatchState::new(seed, opts);
        let mut bot = Warlord::new(1, seed);
        // The newcomer does the worst thing: sits in a gap (no growth) right in the bot's lane.
        let newcomer = crate::state::SideInput {
            aim: Some(LANE_WIDTH - COL_WIDTH),
            ..Default::default()
        };
        while m.public.tick < PLANT_STARTS[1] {
            let inputs = Inputs {
                sides: [newcomer, bot.decide(&m.public)],
            };
            assert_eq!(inputs.sides[1].rig, None);
            assert_eq!(inputs.sides[1].peek, None);
            if let Some(x) = inputs.sides[1].aim {
                assert_eq!(x, HOLD_BACK_X);
            }
            step(&mut m, &inputs, &mut NoEvents);
        }
        // At most 93 raw volleys of 4 could land.
        assert!(
            m.public.sides[0].hp >= HP_MAX - 93 * VOLLEY_SIZE,
            "seed {seed}"
        );
        assert!(m.public.result.is_none());
        // Phase 2: back to normal.
        let mut rigged = false;
        while m.public.tick < PLANT_STARTS[1] + PLANT_TICKS {
            let inputs = Inputs {
                sides: [newcomer, bot.decide(&m.public)],
            };
            rigged |= inputs.sides[1].rig.is_some();
            step(&mut m, &inputs, &mut NoEvents);
        }
        assert!(rigged);
    }
}

#[test]
fn bot_vs_bot_matches_end_and_differ() {
    let mut winners = [0u32; 3];
    for seed in 0..40u64 {
        let mut m = MatchState::new(
            seed,
            MatchOptions {
                bot: [true, true],
                ..Default::default()
            },
        );
        let mut bots = [Warlord::new(0, seed ^ 1), Warlord::new(1, seed ^ 2)];
        for _ in 0..crate::MATCH_TICKS {
            let [b0, b1] = &mut bots;
            let inputs = Inputs {
                sides: [b0.decide(&m.public), b1.decide(&m.public)],
            };
            step(&mut m, &inputs, &mut NoEvents);
        }
        let r = m.public.result.expect("match ended");
        winners[r.winner.map_or(2, usize::from)] += 1;
    }
    assert!(winners[0] > 0 && winners[1] > 0, "{winners:?}");
}
