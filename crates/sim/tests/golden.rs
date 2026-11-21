//! A full bot-vs-bot match with a fixed seed must play out exactly the same forever. If this
//! fails after an intended rule change, bump RULES_VERSION and update the numbers below
//! (and rebuild packages/sim-wasm).

mod common;

use lil_dudes_sim::*;

const SEED: u64 = 42;
const STAKE: u64 = 100_000_000; // 0.1 SOL

fn summary(events: &[Event]) -> [usize; 6] {
    let count = |f: fn(&Event) -> bool| events.iter().filter(|e| f(e)).count();
    [
        count(|e| matches!(e, Event::Volley { .. })),
        count(|e| matches!(e, Event::Reveal { .. })),
        count(|e| matches!(e, Event::Gate { .. })),
        count(|e| matches!(e, Event::Gotcha { .. })),
        count(|e| matches!(e, Event::Clash { .. })),
        count(|e| matches!(e, Event::Hit { .. })),
    ]
}

#[test]
fn golden_bot_vs_bot_match() {
    let (m, events) = common::play_bots(SEED, STAKE);
    let p = &m.public;
    let got = (
        p.tick,
        [p.sides[0].hp, p.sides[1].hp],
        p.result,
        summary(&events),
        m.digest(),
    );
    assert_eq!(RULES_VERSION, 1);
    assert_eq!(got, GOLDEN);
}

/// (final tick, HP, result, [volleys, reveals, gates, gotchas, clashes, hits], state digest)
const GOLDEN: (u32, [u32; 2], Option<MatchResult>, [usize; 6], u64) = (
    2365,
    [1591, 0],
    Some(MatchResult {
        winner: Some(0),
        ko: true,
        moved: STAKE,
        fee: STAKE / 20,
    }),
    [614, 24, 1254, 2, 420, 146],
    10_221_970_705_156_382_022,
);
