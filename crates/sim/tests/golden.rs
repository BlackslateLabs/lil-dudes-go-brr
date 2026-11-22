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
        2198,
        [1480, 1200],
        [false, false],
        r(Some(0), false, 10_447_761, 522_388),
        [393, 850, 17, 2, 0, 38, 106, 219, 70],
        5_807_173_862_025_457_315,
    ),
    // Conveyor
    (
        1358,
        [1604, 868],
        [false, false],
        r(Some(0), false, 29_773_462, 1_488_673),
        [234, 374, 14, 2, 8, 22, 61, 83, 68],
        8_019_700_821_613_895_712,
    ),
    // Long Shot
    (
        1198,
        [1910, 1910],
        [false, false],
        r(None, false, 0, 0),
        [229, 594, 12, 0, 0, 20, 30, 119, 70],
        13_459_835_750_173_242_470,
    ),
    // Funnel
    (
        1662,
        [1586, 1672],
        [false, false],
        r(Some(1), false, 2_639_656, 131_982),
        [328, 571, 10, 2, 0, 29, 112, 127, 62],
        9_293_770_470_760_012_750,
    ),
    // Zigzag
    (
        1478,
        [1850, 1850],
        [false, false],
        r(None, false, 0, 0),
        [254, 382, 9, 2, 0, 19, 57, 111, 70],
        4_416_701_717_651_907_583,
    ),
    // Stairway
    (
        1198,
        [1220, 1220],
        [false, false],
        r(None, false, 0, 0),
        [205, 412, 12, 1, 0, 16, 28, 93, 70],
        987_426_215_107_121_983,
    ),
];
