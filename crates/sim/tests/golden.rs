//! One full bot-vs-bot match per layout with a fixed seed must play out exactly the same
//! forever. If this fails after an intended rule change, bump RULES_VERSION and update the
//! numbers below (and rebuild packages/sim-wasm).

mod common;

use lil_dudes_sim::*;

const STAKE: u64 = 100_000_000; // 0.1 SOL

/// [volleys, gate passes, reveals, gotchas, crate hits, waves, clashes, tower hits, loots]
fn summary(events: &[Event]) -> [usize; 9] {
    let count = |f: fn(&Event) -> bool| events.iter().filter(|e| f(e)).count();
    [
        count(|e| matches!(e, Event::Volley { .. })),
        count(|e| matches!(e, Event::Gate { .. })),
        count(|e| matches!(e, Event::Gate { reveal: true, .. })),
        count(|e| matches!(e, Event::Gotcha { .. })),
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
    [usize; 9],
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
    assert_eq!(RULES_VERSION, 4);
    let got: Vec<Golden> = (0..LAYOUTS.len() as u64).map(play).collect();
    for (seed, g) in got.iter().enumerate() {
        println!("    // {} (seed {seed})\n    {g:?},", LAYOUTS[seed].name);
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
const GOLDEN: [Golden; LAYOUT_COUNT] = [
    // Twin Lanes
    (
        2166,
        [1480, 1200],
        [false, false],
        r(Some(0), false, 10_447_761, 522_388),
        [387, 840, 17, 2, 1, 37, 98, 218, 70],
        7_106_933_334_178_100_052,
    ),
    // Conveyor
    (
        1334,
        [1604, 862],
        [false, false],
        r(Some(0), false, 30_089_213, 1_504_460),
        [230, 370, 14, 2, 8, 21, 52, 83, 68],
        16_562_098_528_692_609_389,
    ),
    // Long Shot
    (
        1374,
        [1928, 1964],
        [false, false],
        r(Some(1), false, 924_974, 46_248),
        [272, 711, 12, 0, 0, 26, 82, 116, 70],
        7_450_491_836_997_345_070,
    ),
    // Funnel
    (
        1614,
        [1586, 1672],
        [false, false],
        r(Some(1), false, 2_639_656, 131_982),
        [317, 559, 10, 2, 0, 29, 101, 127, 62],
        5_836_746_022_108_656_878,
    ),
    // Zigzag
    (
        1510,
        [1850, 1850],
        [false, false],
        r(None, false, 0, 0),
        [262, 391, 9, 2, 0, 19, 65, 113, 70],
        9_134_737_228_476_272_519,
    ),
    // Stairway
    (
        1638,
        [1220, 1220],
        [false, false],
        r(None, false, 0, 0),
        [285, 574, 12, 1, 0, 24, 114, 92, 70],
        18_049_810_760_015_613_189,
    ),
];
