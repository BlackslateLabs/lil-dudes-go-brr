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
        2038,
        [1480, 1480],
        [false, false],
        r(None, false, 0, 0),
        [384, 791, 17, 2, 0, 33, 105, 206, 70],
        3_704_765_655_228_807_051,
    ),
    // Conveyor
    (
        1094,
        [1588, 1588],
        [false, false],
        r(None, false, 0, 0),
        [204, 359, 12, 2, 0, 16, 39, 75, 70],
        5_869_628_917_824_124_219,
    ),
    // Long Shot
    (
        1814,
        [2072, 2036],
        [false, false],
        r(Some(0), false, 876_338, 43_816),
        [355, 757, 12, 2, 0, 30, 77, 165, 70],
        15_981_106_916_906_394_393,
    ),
    // Funnel
    (
        1502,
        [2332, 1764],
        [false, false],
        r(Some(0), false, 13_867_187, 693_359),
        [288, 516, 10, 2, 0, 24, 95, 102, 68],
        18_041_267_367_231_762_226,
    ),
    // Zigzag
    (
        1974,
        [1850, 800],
        [false, false],
        r(Some(0), false, 39_622_641, 1_981_132),
        [317, 565, 10, 3, 0, 28, 57, 171, 70],
        5_535_571_679_890_039_228,
    ),
    // Stairway
    (
        1054,
        [1230, 1380],
        [false, false],
        r(Some(1), false, 5_747_126, 287_356),
        [184, 321, 14, 3, 1, 13, 13, 78, 70],
        11_497_750_506_708_729_756,
    ),
];
