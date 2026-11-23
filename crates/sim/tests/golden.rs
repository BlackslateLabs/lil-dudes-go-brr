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
    assert_eq!(RULES_VERSION, 6);
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
        1403,
        [1766, 1720],
        [false, false],
        r(Some(0), false, 2630000, 131500),
        [321, 720, 16, 2, 40, 52, 210, 17],
        17702114105741362414,
    ),
    // Conveyor
    (
        1123,
        [5759, 5859],
        [false, false],
        r(Some(1), false, 1720000, 86000),
        [252, 663, 14, 0, 30, 58, 126, 18],
        8664106602444036093,
    ),
    // Long Shot
    (
        828,
        [2807, 2807],
        [false, false],
        r(None, false, 0, 0),
        [174, 488, 14, 14, 20, 22, 84, 16],
        6838554425863865540,
    ),
    // Funnel
    (
        2635,
        [2194, 2294],
        [false, false],
        r(Some(1), false, 4450000, 222500),
        [645, 1249, 15, 3, 108, 152, 494, 16],
        14347463494442514150,
    ),
    // Zigzag
    (
        832,
        [1863, 1861],
        [false, true],
        r(Some(0), true, 100000000, 5000000),
        [177, 199, 10, 10, 32, 84, 18, 0],
        17511237822351891261,
    ),
    // Stairway
    (
        2315,
        [1225, 1175],
        [false, false],
        r(Some(0), false, 4160000, 208000),
        [563, 734, 14, 5, 76, 132, 381, 16],
        2650925351619489186,
    ),
];
