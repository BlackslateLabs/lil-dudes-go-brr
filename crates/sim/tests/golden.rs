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
    assert_eq!(RULES_VERSION, 3);
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
        2137,
        [1910, 1910],
        [false, false],
        r(None, false, 0, 0),
        [384, 809, 23, 2, 0, 33, 105, 206, 40],
        7_644_049_769_958_657_944,
    ),
    // Conveyor
    (
        1193,
        [686, 678],
        [false, false],
        r(Some(0), false, 586_510, 29_325),
        [204, 340, 18, 4, 0, 16, 39, 75, 40],
        9_697_152_742_998_772_048,
    ),
    // Long Shot
    (
        1913,
        [1910, 1900],
        [false, false],
        r(Some(0), false, 262_467, 13_123),
        [355, 743, 18, 2, 0, 30, 77, 165, 40],
        8_525_256_880_840_541_999,
    ),
    // Funnel
    (
        1617,
        [928, 928],
        [false, false],
        r(None, false, 0, 0),
        [288, 475, 16, 2, 0, 24, 95, 102, 40],
        1_557_421_891_716_772_165,
    ),
    // Zigzag
    (
        2073,
        [1262, 1262],
        [false, false],
        r(None, false, 0, 0),
        [317, 573, 16, 3, 0, 28, 57, 171, 40],
        15_747_778_845_708_189_154,
    ),
    // Stairway
    (
        1153,
        [702, 810],
        [false, false],
        r(Some(1), false, 7_142_857, 357_142),
        [184, 298, 18, 4, 1, 13, 13, 78, 40],
        16_640_088_282_808_015_176,
    ),
];
