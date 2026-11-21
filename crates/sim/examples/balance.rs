//! Bot-vs-bot balance run on the real rules.
//!
//!     cargo run -p lil-dudes-sim --example balance --release [-- MATCHES]
//!
//! Prints the KO rate (SPEC §7 target ≈ 25%), match length and payout as a share of the stake.

use lil_dudes_sim::rng::mix64;
use lil_dudes_sim::*;

fn main() {
    let n: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(5_000);
    let stake = 1_000_000u64; // payout reported as a share of S
    let (mut ko, mut wins, mut draws) = (0u64, [0u64; 2], 0u64);
    let (mut ticks, mut moved, mut moved_timer, mut timer_n) = (0u64, 0u64, 0u64, 0u64);
    let (mut hp_w, mut hp_l, mut gotchas, mut peak) = (0u64, 0u64, 0u64, 0u64);
    let mut ko_by_phase = [0u64; 3];

    let mut ev = Events::<EVENT_CAP>::new();
    for seed in 0..n {
        let opts = MatchOptions {
            stake,
            bot: [true, true],
            tutorial: false,
        };
        let mut m = MatchState::new(seed, opts);
        let mut bots = [
            Warlord::new(0, mix64(seed ^ 0xA)),
            Warlord::new(1, mix64(seed ^ 0xB)),
        ];
        while m.public.result.is_none() {
            let [a, b] = &mut bots;
            let inputs = Inputs {
                sides: [a.decide(&m.public), b.decide(&m.public)],
            };
            ev.clear();
            step(&mut m, &inputs, &mut ev);
            gotchas += ev
                .as_slice()
                .iter()
                .filter(|e| matches!(e, Event::Gotcha { .. }))
                .count() as u64;
            for s in &m.public.sides {
                peak = peak.max(u64::from(s.cohort_len));
            }
        }
        let r = m.public.result.unwrap();
        let hp = [m.public.sides[0].hp, m.public.sides[1].hp];
        ticks += u64::from(m.public.tick);
        moved += r.moved;
        match r.winner {
            Some(w) => {
                wins[usize::from(w)] += 1;
                hp_w += u64::from(hp[usize::from(w)]);
                hp_l += u64::from(hp[1 - usize::from(w)]);
            }
            None => draws += 1,
        }
        if r.ko {
            ko += 1;
            ko_by_phase[usize::from(state::phase_at(m.public.tick.saturating_sub(1)))] += 1;
        } else {
            moved_timer += r.moved;
            timer_n += 1;
        }
    }

    let pct = |x: u64| 100.0 * x as f64 / n as f64;
    let decided = (n - draws).max(1) as f64;
    println!("Lil Dudes Go Brr balance: {n} Warlord-vs-Warlord matches (rules v{RULES_VERSION}, HP {HP_MAX})");
    println!(
        "  KO:            {:5.1}%   (by phase: {} / {} / {})",
        pct(ko),
        ko_by_phase[0],
        ko_by_phase[1],
        ko_by_phase[2]
    );
    println!(
        "  side 0 / 1 / draw: {:.1}% / {:.1}% / {:.1}%",
        pct(wins[0]),
        pct(wins[1]),
        pct(draws)
    );
    println!(
        "  avg length:    {:5.1} s",
        ticks as f64 / n as f64 / TICKS_PER_SEC as f64
    );
    println!(
        "  avg payout:    {:5.1}% of S (all matches)",
        100.0 * moved as f64 / (n * stake) as f64
    );
    println!(
        "  avg payout:    {:5.1}% of S (timer endings, {timer_n})",
        100.0 * moved_timer as f64 / (timer_n.max(1) * stake) as f64
    );
    println!(
        "  avg final HP:  winner {:.0}, loser {:.0} (of {HP_MAX})",
        hp_w as f64 / decided,
        hp_l as f64 / decided
    );
    println!(
        "  GOTCHAs/match: {:.2}   peak live cohorts/side: {peak} (cap {COHORT_CAP})",
        gotchas as f64 / n as f64
    );
}
