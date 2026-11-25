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
    assert_eq!(RULES_VERSION, 11);
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
        1571,
        [1261, 1125],
        [false, false],
        r(Some(0), false, 11390000, 569500),
        [336, 615, 16, 20, 47, 53, 217, 15],
        12571948924490603073,
    ),
    // Funnel
    (
        1126,
        [1136, 1784],
        [false, false],
        r(Some(1), false, 44380000, 2219000),
        [223, 401, 12, 0, 33, 48, 125, 18],
        13876475604871569490,
    ),
    // Speed Comb
    (
        1341,
        [1038, 1174],
        [false, false],
        r(Some(1), false, 12290000, 614500),
        [275, 547, 16, 31, 37, 59, 141, 13],
        10018619915238521049,
    ),
    // Pipes
    (
        1115,
        [1402, 1558],
        [false, false],
        r(Some(1), false, 10540000, 527000),
        [222, 474, 12, 13, 36, 42, 131, 14],
        11788794155643490018,
    ),
    // Pillars
    (
        1244,
        [2372, 2960],
        [false, false],
        r(Some(1), false, 22050000, 1102500),
        [247, 443, 16, 0, 31, 39, 153, 15],
        7240481197600676602,
    ),
    // Island
    (
        1091,
        [1300, 1064],
        [false, false],
        r(Some(0), false, 19960000, 998000),
        [207, 374, 14, 14, 26, 35, 112, 14],
        3015610644539910217,
    ),
];
