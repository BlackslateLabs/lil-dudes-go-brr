//! ≥ 1,000 seeds with random (often invalid) inputs: no panic, the cap holds, counts stay sane,
//! the state stays consistent, and every match ends.

mod common;

use common::random_input;
use lil_dudes_sim::rng::SplitMix64;
use lil_dudes_sim::state::in_plant;
use lil_dudes_sim::*;

const SEEDS: u64 = 1_200;
/// The biggest cohort any deal allows: (4 + 10) × 3 × 3 up the best possible column.
const MAX_COUNT: u32 = (VOLLEY_SIZE + 10) * 3 * 3;

fn check(m: &MatchState, prev_hp: &mut [u32; 2]) {
    let p = &m.public;
    assert!(p.tick <= MATCH_TICKS);
    for (s, side) in p.sides.iter().enumerate() {
        // HP never grows and never exceeds the max.
        assert!(side.hp <= prev_hp[s]);
        prev_hp[s] = side.hp;
        // Cannon and aim on the lane.
        assert!((0..LANE_WIDTH).contains(&i32::from(side.cannon_x)));
        assert!((0..LANE_WIDTH).contains(&i32::from(side.aim)));
        // The cap, live cohorts sane, free slots zeroed.
        assert!(usize::from(side.cohort_len) <= COHORT_CAP);
        let (mut prev_y, mut prev_id) = (i16::MAX, 0u32);
        for c in side.cohorts() {
            assert!(c.count > 0 && c.count <= MAX_COUNT, "count {}", c.count);
            assert!((0..LANE_WIDTH).contains(&i32::from(c.x)));
            assert!((0..LANE_LENGTH).contains(&i32::from(c.y)));
            assert!(usize::from(c.last_row) <= ROWS);
            // Stored front-most (oldest) first, with unique ids that grow with age order.
            assert!(c.y < prev_y, "front-most first");
            assert!(c.id > prev_id && c.id < p.next_cohort_id);
            (prev_y, prev_id) = (c.y, c.id);
        }
        assert!(side.cohorts[usize::from(side.cohort_len)..]
            .iter()
            .all(|c| *c == Cohort::default()));
        // Rig / peek flags match the secret state.
        assert_eq!(side.rig_used, m.secret.rigs[s].is_some());
        assert_eq!(side.peek_used, m.secret.peeks[s].is_some());
        for (cell, g) in side.gates.iter().enumerate() {
            let cell = cell as u8;
            assert_eq!(g.gold, m.secret.deal.is_gold(cell));
            if let Some(op) = g.revealed {
                assert_eq!(op, m.secret.true_op(s as u8, cell));
            }
            // A rig can never be read off the public hints.
            if p.result.is_none() && in_plant(p.tick) && !g.gold {
                assert_eq!(g.hint, Hint::None);
            }
        }
    }
    for (s, rig) in m.secret.rigs.iter().enumerate() {
        if let Some(cell) = rig {
            assert!(usize::from(*cell) < CELLS && !m.secret.deal.is_gold(*cell));
            assert_eq!(m.secret.rigged_by(1 - s as u8, *cell), Some(s as u8));
        }
    }
}

fn fuzz_one(seed: u64) -> (u32, u32) {
    let mut r = SplitMix64::new(seed ^ 0xF00D);
    let opts = MatchOptions {
        stake: r.below(1_000_000_000),
        bot: [false, r.below(2) == 1],
        tutorial: r.below(4) == 0,
    };
    let mut m = MatchState::new(seed, opts);
    let mut bot = Warlord::new(1, r.next_u64());
    let mut ev = Events::<EVENT_CAP>::new();
    let mut prev_hp = [HP_MAX; 2];
    let (mut max_len, mut max_count) = (0u32, 0u32);
    for _ in 0..MATCH_TICKS {
        let mut inputs = Inputs {
            sides: [random_input(&mut r), random_input(&mut r)],
        };
        if opts.bot[1] {
            inputs.sides[1] = bot.decide(&m.public);
        }
        ev.clear();
        let before = m.public.tick;
        step(&mut m, &inputs, &mut ev);
        assert_eq!(m.public.tick, before + 1);
        assert_eq!(ev.dropped(), 0, "EVENT_CAP too small");
        check(&m, &mut prev_hp);
        for side in &m.public.sides {
            max_len = max_len.max(u32::from(side.cohort_len));
            max_count = max_count.max(side.cohorts().iter().map(|c| c.count).max().unwrap_or(0));
        }
        if m.public.result.is_some() {
            break;
        }
    }
    // Every match ends: by KO before the timer, or at the timer.
    let res = m.public.result.expect("match did not end");
    let hp = [m.public.sides[0].hp, m.public.sides[1].hp];
    assert_eq!(res, payout(opts.stake, hp));
    assert_eq!(m.public.tick < MATCH_TICKS, hp.contains(&0));
    assert!(res.moved <= opts.stake && res.fee <= res.moved);
    // Ended matches are frozen.
    let frozen = m;
    step(&mut m, &Inputs::default(), &mut ev);
    assert_eq!(m, frozen);
    (max_len, max_count)
}

#[test]
fn fuzz_seeds_with_random_inputs() {
    let extremes = [u64::MAX, u64::MAX - 1, 1 << 63, 0x5555_5555_5555_5555];
    let (mut max_len, mut max_count) = (0, 0);
    for seed in (0..SEEDS).chain(extremes) {
        let (l, c) = fuzz_one(seed);
        max_len = max_len.max(l);
        max_count = max_count.max(c);
    }
    println!("max live cohorts per side {max_len}, max cohort {max_count}");
}
