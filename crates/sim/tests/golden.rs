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
    assert_eq!(RULES_VERSION, 5);
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
        1443,
        [1754, 1720],
        [false, false],
        r(Some(0), false, 1950000, 97500),
        [315, 704, 16, 2, 41, 52, 210, 16],
        17288639818947961328,
    ),
    // Conveyor
    (
        971,
        [5539, 5539],
        [false, false],
        r(None, false, 0, 0),
        [204, 528, 14, 0, 22, 52, 78, 16],
        11800486111704161906,
    ),
    // Long Shot
    (
        843,
        [2819, 2819],
        [false, false],
        r(None, false, 0, 0),
        [172, 478, 14, 14, 22, 24, 84, 16],
        8899086096025946973,
    ),
    // Funnel
    (
        2715,
        [2222, 2294],
        [false, false],
        r(Some(1), false, 3180000, 159000),
        [634, 1217, 15, 3, 110, 149, 493, 16],
        5888151537272896329,
    ),
    // Zigzag
    (
        1835,
        [3921, 3007],
        [false, false],
        r(Some(0), false, 26380000, 1319000),
        [374, 378, 13, 19, 64, 155, 78, 16],
        9487727611631195026,
    ),
    // Stairway
    (
        1076,
        [461, 461],
        [true, false],
        r(Some(1), true, 100000000, 5000000),
        [230, 397, 14, 0, 26, 46, 124, 0],
        3023198860960999536,
    ),
];
