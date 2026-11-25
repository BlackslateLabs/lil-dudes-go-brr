//! Bot-vs-bot balance run on the real rules, per layout.
//!
//!     cargo run -p lil-dudes-sim --example balance --release [-- MATCHES_PER_LAYOUT [MODE]]
//!
//! MODE (rules v10, SPEC_V5 §15):
//! - `human` (default): the human bot on both sides, what players face. `TUNE` is balanced on
//!   this (tools/balance/tune_layouts.py).
//! - `perfect`: the full-strength bot on both sides (the v9 runs).
//! - `calibrate`: the human bot against the perfect one, sides swapped every match; `A win%` is
//!   the human bot's share of the decisive matches (target ~30–40%).
//!
//! Prints, per layout: death rate (target ~5–10%) and where deaths happen (Fight 1 / Fight 2 /
//! the Rush), how matches end, match length, Fight and Raid times, gold per side, the raid's
//! share of gold, the payout as a share of S, and bot A's share of the decisive matches (A = the
//! human bot in `calibrate`, else side 0).

use lil_dudes_sim::rng::mix64;
use lil_dudes_sim::*;

#[derive(Default)]
struct Stats {
    n: u64,
    deaths: u64,
    /// Deaths in Fight 1, Fight 2 and the raid.
    deaths_by_stage: [u64; 3],
    draws: u64,
    capped: u64,
    ticks: u64,
    gold: u64,
    raid_gold: u64,
    moved: u64,
    /// Sum and count of Fight 1, Fight 2 and Raid durations (ticks), over sides that finished them.
    stage_ticks: [u64; 3],
    stage_n: [u64; 3],
    peak_cohorts: u64,
    peak_enemies: u64,
    max_count: u64,
    /// Matches with a winner, and how many bot A won.
    decisive: u64,
    a_wins: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Human,
    Perfect,
    Calibrate,
}

fn play(seed: u64, i: u64, mode: Mode, stake: u64, st: &mut Stats, ev: &mut Events<EVENT_CAP>) {
    let opts = MatchOptions {
        stake,
        bot: [true, true],
        tutorial: false,
    };
    let mut m = MatchState::new(seed, opts);
    // Bot A (the human one in `calibrate`) plays side `a`.
    let a = if mode == Mode::Calibrate {
        (i % 2) as u8
    } else {
        0
    };
    let skill = |side: u8| match mode {
        Mode::Human => Skill::Human,
        Mode::Perfect => Skill::Perfect,
        Mode::Calibrate if side == a => Skill::Human,
        Mode::Calibrate => Skill::Perfect,
    };
    let mut bots = [
        Warlord::with_skill(0, mix64(seed ^ 0xA), skill(0)),
        Warlord::with_skill(1, mix64(seed ^ 0xB), skill(1)),
    ];
    // Per side: the tick Fight 1, Fight 2 and the raid started.
    let mut started = [[0u32; 3]; 2];
    while m.public.result.is_none() {
        let [a, b] = &mut bots;
        let inputs = Inputs {
            sides: [a.decide(&m.public), b.decide(&m.public)],
        };
        ev.clear();
        let t = m.public.tick;
        step(&mut m, &inputs, ev);
        for e in ev.as_slice() {
            match *e {
                Event::Loot { gold, .. } => st.raid_gold += u64::from(gold),
                Event::Phase { side, stage, phase } => {
                    let s = usize::from(side);
                    let ended = |k: usize, st: &mut Stats| {
                        st.stage_ticks[k] += u64::from(t + 1 - started[s][k]);
                        st.stage_n[k] += 1;
                    };
                    match phase {
                        Phase::Fight => started[s][usize::from(stage)] = t + 1,
                        // Fight 1's towers fell.
                        Phase::Transit => ended(0, st),
                        // Fight 2's towers fell: the raid starts on this very tick.
                        Phase::Rush => {
                            ended(1, st);
                            started[s][2] = t;
                        }
                        Phase::Done => ended(2, st),
                        Phase::Plant => {}
                    }
                }
                _ => {}
            }
        }
        for s in &m.public.sides {
            st.peak_cohorts = st.peak_cohorts.max(u64::from(s.cohort_len));
            st.peak_enemies = st.peak_enemies.max(u64::from(s.enemy_len));
            for c in s.cohorts() {
                st.max_count = st.max_count.max(u64::from(c.count));
            }
        }
    }
    let r = m.public.result.unwrap();
    let p = &m.public;
    st.n += 1;
    st.ticks += u64::from(p.tick);
    st.gold += u64::from(p.sides[0].gold + p.sides[1].gold);
    st.moved += r.moved;
    match r.winner {
        None => st.draws += 1,
        Some(w) => {
            st.decisive += 1;
            st.a_wins += u64::from(w == a);
        }
    }
    if r.ko {
        st.deaths += 1;
        for s in &p.sides {
            if s.dead {
                let k = if s.phase == Phase::Rush {
                    2
                } else {
                    usize::from(s.stage)
                };
                st.deaths_by_stage[k] += 1;
            }
        }
    } else if p.tick >= MATCH_TICKS && !p.sides.iter().all(|s| s.phase == Phase::Done) {
        st.capped += 1;
    }
}

fn main() {
    let n: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(2_000);
    let mode = match std::env::args().nth(2).as_deref() {
        None | Some("human") => Mode::Human,
        Some("perfect") => Mode::Perfect,
        Some("calibrate") => Mode::Calibrate,
        Some(other) => panic!("unknown mode {other} (human | perfect | calibrate)"),
    };
    let who = match mode {
        Mode::Human => "human-vs-human",
        Mode::Perfect => "perfect-vs-perfect",
        Mode::Calibrate => "human (A) vs perfect",
    };
    let stake = 1_000_000u64;
    let mut ev = Events::<EVENT_CAP>::new();
    let secs = |ticks: f64| ticks / f64::from(TICKS_PER_SEC);
    println!(
        "Lil Dudes Go Brr balance (rules v{RULES_VERSION}): {n} {who} Warlord matches per layout"
    );
    println!(
        "{:<12} {:>6} {:>13} {:>5} {:>6} {:>6} {:>7} {:>7} {:>7} {:>6} {:>6} {:>6} {:>6}",
        "layout",
        "death",
        "by stage",
        "cap",
        "draw",
        "len s",
        "F1 s",
        "F2 s",
        "rush s",
        "gold",
        "rush%",
        "pay%S",
        "A win%",
    );
    let mut all = Stats::default();
    for (id, layout) in LAYOUTS.iter().enumerate() {
        let mut st = Stats::default();
        for i in 0..n {
            play(
                id as u64 + LAYOUTS.len() as u64 * i,
                i,
                mode,
                stake,
                &mut st,
                &mut ev,
            );
        }
        report(layout.name, &st, secs);
        all.n += st.n;
        all.deaths += st.deaths;
        for k in 0..3 {
            all.deaths_by_stage[k] += st.deaths_by_stage[k];
            all.stage_ticks[k] += st.stage_ticks[k];
            all.stage_n[k] += st.stage_n[k];
        }
        all.draws += st.draws;
        all.capped += st.capped;
        all.ticks += st.ticks;
        all.gold += st.gold;
        all.raid_gold += st.raid_gold;
        all.moved += st.moved;
        all.peak_cohorts = all.peak_cohorts.max(st.peak_cohorts);
        all.peak_enemies = all.peak_enemies.max(st.peak_enemies);
        all.max_count = all.max_count.max(st.max_count);
        all.decisive += st.decisive;
        all.a_wins += st.a_wins;
    }
    report("ALL", &all, secs);
    println!(
        "peak live cohorts/side {} (cap {COHORT_CAP}), enemies {} (cap {ENEMY_CAP}), biggest cohort {}",
        all.peak_cohorts, all.peak_enemies, all.max_count
    );

    fn report(name: &str, st: &Stats, secs: impl Fn(f64) -> f64) {
        let n = st.n.max(1) as f64;
        let pct = |x: u64| 100.0 * x as f64 / n;
        let avg = |k: usize| secs(st.stage_ticks[k] as f64 / st.stage_n[k].max(1) as f64);
        println!(
            "{:<12} {:>5.1}% {:>4}/{:>3}/{:>3} {:>4.1}% {:>5.1}% {:>6.1} {:>7.1} {:>7.1} {:>7.1} {:>6.0} {:>5.1}% {:>5.1}% {:>5.1}%",
            name,
            pct(st.deaths),
            st.deaths_by_stage[0],
            st.deaths_by_stage[1],
            st.deaths_by_stage[2],
            pct(st.capped),
            pct(st.draws),
            secs(st.ticks as f64 / n),
            avg(0),
            avg(1),
            avg(2),
            st.gold as f64 / n / 2.0,
            100.0 * st.raid_gold as f64 / st.gold.max(1) as f64,
            100.0 * st.moved as f64 / (n * 1_000_000.0),
            100.0 * st.a_wins as f64 / st.decisive.max(1) as f64,
        );
    }
}
