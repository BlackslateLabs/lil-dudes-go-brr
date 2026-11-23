//! One full bot-vs-bot match per layout with a fixed seed must play out exactly the same
//! forever. If this fails after an intended rule change, bump RULES_VERSION and update the
//! numbers below (and rebuild packages/sim-wasm).

mod common;

use lil_dudes_sim::*;

const STAKE: u64 = 100_000_000; // 0.1 SOL

/// [volleys, gate passes, reveals, crate hits, waves, clashes, tower hits, loots]
fn summary(events: &[Event]) -> [usize; 8] {
    let count = |f: fn(&Event) -> bool| events.iter().filter(|e| f(e)).count();
    [
        count(|e| matches!(e, Event::Volley { .. })),
        count(|e| matches!(e, Event::Gate { .. })),
        count(|e| matches!(e, Event::Gate { reveal: true, .. })),
        count(|e| matches!(e, Event::CrateHit { .. })),
        count(|e| matches!(e, Event::Wave { .. })),
        count(|e| matches!(e, Event::Clash { .. })),
        count(|e| matches!(e, Event::TowerHit { .. })),
        count(|e| matches!(e, Event::Loot { .. })),
    ]
}

type Golden = (
    u32,
    [u32; 2],
    [bool; 2],
    Option<MatchResult>,
    [usize; 8],
    u64,
);

fn play(seed: u64) -> Golden {
    let (m, events) = common::play_bots(seed, STAKE);
    let p = &m.public;
    (
        p.tick,
        [p.sides[0].gold, p.sides[1].gold],
        [p.sides[0].dead, p.sides[1].dead],
        p.result,
        summary(&events),
        m.digest(),
    )
}

#[test]
fn golden_bot_vs_bot_match_per_layout() {
    assert_eq!(RULES_VERSION, 5);
    let got: Vec<Golden> = (0..LAYOUTS.len() as u64).map(play).collect();
    // Paste-ready for GOLDEN (tools/balance/regen_golden.py does it).
    for (seed, (tick, gold, dead, res, sum, digest)) in got.iter().enumerate() {
        let res = res.map_or("None".to_string(), |r| {
            format!("r({:?}, {}, {}, {})", r.winner, r.ko, r.moved, r.fee)
        });
        println!(
            "GOLDEN    // {}\nGOLDEN    ({tick}, {gold:?}, {dead:?}, {res}, {sum:?}, {digest}),",
            LAYOUTS[seed].name
        );
    }
    assert_eq!(got, GOLDEN);
}

const fn r(winner: Option<u8>, ko: bool, moved: u64, fee: u64) -> Option<MatchResult> {
    Some(MatchResult {
        winner,
        ko,
        moved,
        fee,
    })
}

/// (final tick, gold, dead, result, summary, state digest), seed = layout id.
const GOLDEN: &[Golden] = &[
    // Twin Lanes
    (
        1590,
        [1340, 1340],
        [false, false],
        r(None, false, 0, 0),
        [327, 719, 18, 1, 32, 62, 186, 70],
        1869837704068553681,
    ),
    // Conveyor
    (
        209,
        [0, 0],
        [true, true],
        r(None, true, 0, 0),
        [38, 49, 6, 0, 4, 27, 0, 0],
        6869685751373434106,
    ),
    // Long Shot
    (
        1918,
        [1588, 1440],
        [false, false],
        r(Some(0), false, 4887714, 244385),
        [398, 642, 13, 4, 47, 138, 148, 64],
        1408026571816712357,
    ),
    // Funnel
    (
        2070,
        [1160, 1170],
        [false, false],
        r(Some(1), false, 429184, 21459),
        [444, 742, 11, 0, 50, 161, 209, 70],
        13784772838398883731,
    ),
    // Zigzag
    (
        1502,
        [870, 870],
        [false, false],
        r(None, false, 0, 0),
        [306, 598, 10, 0, 30, 48, 180, 70],
        10892620298080187919,
    ),
    // Stairway
    (
        209,
        [0, 0],
        [true, true],
        r(None, true, 0, 0),
        [38, 47, 8, 0, 4, 30, 0, 0],
        18256894760113559903,
    ),
];
