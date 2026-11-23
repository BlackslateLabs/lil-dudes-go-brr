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
        1494,
        [1480, 1480],
        [false, false],
        r(None, false, 0, 0),
        [304, 696, 18, 1, 28, 66, 162, 70],
        17930947127521612911,
    ),
    // Conveyor
    (
        990,
        [6334, 6462],
        [false, false],
        r(Some(1), false, 1000312, 50015),
        [178, 350, 16, 16, 14, 30, 53, 62],
        6603301176911352425,
    ),
    // Long Shot
    (
        1374,
        [1928, 1910],
        [false, false],
        r(Some(0), false, 468994, 23449),
        [273, 709, 12, 0, 26, 83, 116, 70],
        12843197056635317161,
    ),
    // Funnel
    (
        1286,
        [2640, 2660],
        [false, false],
        r(Some(1), false, 377358, 18867),
        [251, 487, 10, 0, 21, 73, 93, 70],
        16207400371818021064,
    ),
    // Zigzag
    (
        1022,
        [1850, 1850],
        [false, false],
        r(None, false, 0, 0),
        [186, 354, 10, 0, 14, 26, 74, 70],
        15534472362045567508,
    ),
    // Stairway
    (
        1198,
        [1220, 1220],
        [false, false],
        r(None, false, 0, 0),
        [230, 466, 12, 0, 20, 74, 74, 70],
        15162964318882902951,
    ),
];
