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
    assert_eq!(RULES_VERSION, 9);
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
        [1685, 1469],
        [false, false],
        r(Some(0), false, 13690000, 684500),
        [379, 700, 16, 17, 45, 67, 266, 15],
        8688808982627369762,
    ),
    // Funnel
    (
        1133,
        [1586, 1608],
        [false, false],
        r(Some(1), false, 1370000, 68500),
        [254, 463, 11, 0, 28, 47, 158, 16],
        15944030447864001651,
    ),
    // Speed Comb
    (
        1248,
        [2011, 2011],
        [false, false],
        r(None, false, 0, 0),
        [286, 580, 16, 20, 36, 82, 146, 18],
        3426270361734483406,
    ),
    // Pipes
    (
        968,
        [1385, 1385],
        [false, false],
        r(None, false, 0, 0),
        [212, 586, 8, 0, 26, 44, 118, 16],
        339902075074153785,
    ),
    // Pillars
    (
        1243,
        [4195, 4195],
        [false, false],
        r(None, false, 0, 0),
        [284, 526, 14, 0, 30, 40, 200, 18],
        16725230544253666042,
    ),
    // Island
    (
        1123,
        [1430, 1470],
        [false, false],
        r(Some(1), false, 2750000, 137500),
        [242, 462, 11, 0, 28, 51, 150, 15],
        12128956120630524678,
    ),
];
