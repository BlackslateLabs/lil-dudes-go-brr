//! Same seed + same inputs → byte-identical state, tick by tick, over a full match.

mod common;

use common::{bots_for, random_input};
use lil_dudes_sim::rng::SplitMix64;
use lil_dudes_sim::*;

/// One full match: random inputs on side 0, the bot on side 1. Returns the final state, the
/// digest after every tick and every event.
fn run(seed: u64) -> (MatchState, Vec<u64>, Vec<Event>) {
    let mut m = MatchState::new(
        seed,
        MatchOptions {
            stake: 50_000_000,
            bot: [false, true],
            tutorial: false,
        },
    );
    let mut r = SplitMix64::new(seed ^ 0x1234);
    let [_, mut bot] = bots_for(seed);
    let (mut digests, mut events) = (Vec::new(), Vec::new());
    let mut ev = Events::<EVENT_CAP>::new();
    while m.public.result.is_none() {
        let inputs = Inputs {
            sides: [random_input(&mut r), bot.decide(&m.public)],
        };
        ev.clear();
        step(&mut m, &inputs, &mut ev);
        digests.push(m.digest());
        events.extend_from_slice(ev.as_slice());
    }
    (m, digests, events)
}

#[test]
fn same_seed_and_inputs_give_identical_state_every_tick() {
    for seed in [0, 1, 2, 3, 4, 5, 42, 0xDEAD_BEEF, u64::MAX] {
        let (m1, d1, e1) = run(seed);
        let (m2, d2, e2) = run(seed);
        // Structural equality over every field (all plain integers / enums, no padding semantics).
        assert_eq!(m1, m2, "seed {seed}");
        assert_eq!(
            d1,
            d2,
            "seed {seed}: digests diverged at tick {:?}",
            d1.iter().zip(&d2).position(|(a, b)| a != b)
        );
        assert_eq!(e1, e2, "seed {seed}");
        assert!(m1.public.result.is_some());
    }
}

#[test]
fn different_seeds_give_different_matches() {
    let digests: Vec<u64> = (0..20).map(|s| run(s).0.digest()).collect();
    for (i, a) in digests.iter().enumerate() {
        for b in &digests[i + 1..] {
            assert_ne!(a, b);
        }
    }
}

#[test]
fn replaying_a_recorded_input_log_reproduces_the_match() {
    // What Verify will do: replay the inputs that were applied, from the revealed seed.
    let seed = 777;
    let mut m = MatchState::new(seed, MatchOptions::default());
    let mut r = SplitMix64::new(9);
    let mut log = Vec::new();
    while m.public.result.is_none() {
        let inputs = Inputs {
            sides: [random_input(&mut r), random_input(&mut r)],
        };
        log.push(inputs);
        step(&mut m, &inputs, &mut NoEvents);
    }
    let mut replay = MatchState::new(seed, MatchOptions::default());
    for inputs in &log {
        step(&mut replay, inputs, &mut NoEvents);
    }
    assert_eq!(replay, m);
}
