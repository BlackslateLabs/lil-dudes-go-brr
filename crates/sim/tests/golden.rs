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
        2121,
        [1850, 1850],
        [false, false],
        r(None, false, 0, 0),
        [391, 811, 19, 2, 0, 33, 104, 212, 40],
        17_689_280_500_242_658_991,
    ),
    // Conveyor
    (
        1689,
        [930, 930],
        [false, false],
        r(None, false, 0, 0),
        [274, 391, 18, 3, 0, 25, 84, 104, 40],
        11_490_465_135_122_355_967,
    ),
    // Long Shot
    (
        2169,
        [1780, 1780],
        [false, false],
        r(None, false, 0, 0),
        [396, 767, 18, 3, 0, 35, 94, 206, 40],
        17_860_717_802_675_018_820,
    ),
    // Funnel
    (
        1729,
        [928, 928],
        [false, false],
        r(None, false, 0, 0),
        [311, 508, 16, 2, 0, 27, 104, 117, 40],
        11_354_436_387_193_670_048,
    ),
    // Zigzag
    (
        2097,
        [1190, 1190],
        [false, false],
        r(None, false, 0, 0),
        [329, 570, 16, 3, 0, 28, 58, 181, 40],
        3_622_871_488_003_885_445,
    ),
    // Stairway
    (
        1185,
        [790, 702],
        [false, false],
        r(Some(0), false, 5_898_123, 294_906),
        [202, 282, 12, 1, 0, 16, 24, 92, 40],
        1_649_218_047_269_630_774,
    ),
];
