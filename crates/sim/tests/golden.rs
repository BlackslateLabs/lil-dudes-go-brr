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
        13_178_603_594_634_358_187,
    ),
    // Conveyor
    (
        652,
        [170, 170],
        [false, true],
        r(Some(0), true, 100_000_000, 5_000_000),
        [124, 183, 14, 2, 3, 14, 42, 34, 0],
        472_221_517_134_445_346,
    ),
    // Long Shot
    (
        2238,
        [1910, 1910],
        [false, false],
        r(None, false, 0, 0),
        [420, 797, 12, 2, 0, 35, 97, 176, 70],
        10_621_035_014_396_632_351,
    ),
    // Funnel
    (
        1502,
        [2332, 1664],
        [false, false],
        r(Some(0), false, 16_716_716, 835_835),
        [289, 517, 10, 2, 0, 24, 93, 102, 61],
        1_104_299_307_946_693_815,
    ),
    // Zigzag
    (
        1974,
        [1850, 800],
        [false, false],
        r(Some(0), false, 39_622_641, 1_981_132),
        [317, 565, 10, 3, 0, 28, 57, 171, 70],
        16_996_592_566_353_149_688,
    ),
    // Stairway
    (
        1006,
        [1220, 1220],
        [false, false],
        r(None, false, 0, 0),
        [182, 363, 12, 2, 0, 14, 16, 78, 70],
        3_760_539_227_311_300_030,
    ),
];
