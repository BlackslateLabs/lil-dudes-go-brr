//! Shared helpers for the integration tests.
#![allow(dead_code)]

use lil_dudes_sim::rng::{mix64, SplitMix64};
use lil_dudes_sim::*;

/// Both bots' inputs for the tick `view.tick` is about to process.
pub fn bot_inputs(bots: &mut [Warlord; 2], view: &PublicState) -> Inputs {
    let [a, b] = bots;
    Inputs {
        sides: [a.decide(view), b.decide(view)],
    }
}

/// Bot seeds for tests: fixed, and not the match seed.
pub fn bots_for(seed: u64) -> [Warlord; 2] {
    [
        Warlord::new(0, mix64(seed ^ 0xB0B0)),
        Warlord::new(1, mix64(seed ^ 0xB1B1)),
    ]
}

/// Bot vs bot to the end, collecting every event.
pub fn play_bots(seed: u64, stake: u64) -> (MatchState, Vec<Event>) {
    let opts = MatchOptions {
        stake,
        bot: [true, true],
        tutorial: false,
    };
    let mut m = MatchState::new(seed, opts);
    let mut bots = bots_for(seed);
    let mut all = Vec::new();
    let mut ev = Events::<EVENT_CAP>::new();
    while m.public.result.is_none() {
        let inputs = bot_inputs(&mut bots, &m.public);
        ev.clear();
        step(&mut m, &inputs, &mut ev);
        all.extend_from_slice(ev.as_slice());
    }
    (m, all)
}

/// A player mashing everything: random aims (some off the lane), peeks (some invalid) and
/// Champion taps (most refused).
pub fn random_input(r: &mut SplitMix64) -> SideInput {
    let mut i = SideInput::default();
    if r.below(100) < 30 {
        i.aim = Some(r.below(8_000) as i32 - 2_000);
    }
    if r.below(100) < 5 {
        i.peek = Some(r.below(12) as u8);
    }
    i.champion = r.below(100) < 5;
    i
}
