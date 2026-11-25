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
    assert_eq!(RULES_VERSION, 10);
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
    // Three Lanes
    (
        1827,
        [1145, 1373],
        [false, false],
        r(Some(1), false, 18100000, 905000),
        [369, 669, 18, 33, 56, 64, 239, 6],
        16038039414129216144,
    ),
    // Funnel
    (
        1116,
        [1152, 1784],
        [false, false],
        r(Some(1), false, 43050000, 2152500),
        [224, 402, 12, 0, 31, 42, 129, 17],
        18071819591622350814,
    ),
    // Speed Comb
    (
        1341,
        [1038, 1174],
        [false, false],
        r(Some(1), false, 12290000, 614500),
        [275, 547, 16, 31, 35, 55, 145, 13],
        17690798153187068327,
    ),
    // Pipes
    (
        1115,
        [1402, 1558],
        [false, false],
        r(Some(1), false, 10540000, 527000),
        [222, 474, 12, 13, 34, 40, 131, 14],
        922427846740140564,
    ),
    // Pillars
    (
        1227,
        [2372, 3100],
        [false, false],
        r(Some(1), false, 26600000, 1330000),
        [247, 441, 16, 0, 29, 34, 154, 17],
        1018062953860159918,
    ),
    // Island
    (
        1110,
        [1212, 1104],
        [false, false],
        r(Some(0), false, 9320000, 466000),
        [205, 362, 14, 14, 23, 34, 109, 15],
        2203709285293380848,
    ),
];
