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
    assert_eq!(RULES_VERSION, 8);
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
        1608,
        [1499, 1469],
        [false, false],
        r(Some(0), false, 2020000, 101000),
        [380, 702, 16, 17, 46, 68, 266, 14],
        15330196425122058139,
    ),
    // Funnel
    (
        1133,
        [1586, 1608],
        [false, false],
        r(Some(1), false, 1370000, 68500),
        [254, 463, 11, 0, 28, 47, 156, 16],
        15944030447864001651,
    ),
    // Speed Comb
    (
        1264,
        [1963, 1963],
        [false, false],
        r(None, false, 0, 0),
        [290, 596, 16, 22, 38, 82, 148, 18],
        511635045740646376,
    ),
    // Pipes
    (
        983,
        [1361, 1361],
        [false, false],
        r(None, false, 0, 0),
        [216, 598, 8, 0, 32, 54, 118, 16],
        1477646319563765616,
    ),
    // Pillars
    (
        1251,
        [4159, 4159],
        [false, false],
        r(None, false, 0, 0),
        [286, 530, 14, 0, 30, 40, 202, 18],
        12057722080886598616,
    ),
    // Island
    (
        1123,
        [1430, 1514],
        [false, false],
        r(Some(1), false, 5700000, 285000),
        [251, 479, 11, 0, 30, 54, 160, 13],
        11510597065182157991,
    ),
];
