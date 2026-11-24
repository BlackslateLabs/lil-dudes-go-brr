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
    assert_eq!(RULES_VERSION, 7);
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
        1735,
        [2866, 2866],
        [false, false],
        r(None, false, 0, 0),
        [414, 1264, 20, 0, 50, 54, 332, 18],
        3643231261687311306,
    ),
    // Three Ways
    (
        1288,
        [2442, 2442],
        [false, false],
        r(None, false, 0, 0),
        [296, 714, 20, 0, 42, 51, 210, 16],
        12746502540841813532,
    ),
    // Long Shot
    (
        1928,
        [3067, 3067],
        [false, false],
        r(None, false, 0, 0),
        [464, 1636, 22, 0, 52, 66, 378, 16],
        12753941482395539916,
    ),
    // Funnel
    (
        1247,
        [4039, 4039],
        [false, false],
        r(None, false, 0, 0),
        [286, 814, 20, 8, 34, 50, 188, 18],
        3228373999286563861,
    ),
    // Zigzag
    (
        848,
        [1684, 1686],
        [true, false],
        r(Some(1), true, 100000000, 5000000),
        [182, 593, 24, 3, 14, 22, 113, 0],
        8621635406033375657,
    ),
    // Pillars
    (
        1288,
        [3050, 3050],
        [false, false],
        r(None, false, 0, 0),
        [296, 638, 18, 0, 28, 34, 210, 16],
        11728872140495645885,
    ),
];
