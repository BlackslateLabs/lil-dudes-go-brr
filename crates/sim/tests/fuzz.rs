//! ≥ 1,000 seeds with random (often invalid) inputs: no panic, the caps hold, counts stay sane,
//! the state stays consistent with the secrets, and every match ends by the time cap.

mod common;

use common::random_input;
use lil_dudes_sim::layouts::stage;
use lil_dudes_sim::rng::SplitMix64;
use lil_dudes_sim::*;

const SEEDS: u64 = 1_200;
/// The biggest cohort any layout allows: ×10 per row at most.
const MAX_COUNT: u32 = VOLLEY_SIZE * 10u32.pow(ROWS_MAX as u32);

fn check(m: &MatchState, prev_gold: &mut [u32; 2]) {
    let p = &m.public;
    assert!(p.tick <= MATCH_TICKS);
    assert!(usize::from(p.layout) < LAYOUTS.len());
    for (s, side) in p.sides.iter().enumerate() {
        let st = stage(p.layout, side.stage);
        // Gold never goes down; stage and phase timers stay in range.
        assert!(side.gold >= prev_gold[s]);
        prev_gold[s] = side.gold;
        assert!(usize::from(side.stage) < STAGES);
        assert!(u32::from(side.phase_ticks) < MATCH_TICKS);
        // The raid and Done only come after the final stage's fight; the raid clock only runs
        // in the raid (and stays put once done).
        if side.stage < FINAL_STAGE {
            assert!(!matches!(side.phase, Phase::Raid | Phase::Done));
        }
        if !matches!(side.phase, Phase::Raid | Phase::Done) {
            assert_eq!(side.raid_ticks, 0);
        }
        // Cannon and aim on the lane.
        assert!((0..LANE_WIDTH).contains(&i32::from(side.cannon_x)));
        assert!((0..LANE_WIDTH).contains(&i32::from(side.aim)));
        // Towers / crates never above the layout's numbers; unused slots stay 0.
        for (hp, def) in side.towers.iter().zip(st.towers.iter()) {
            assert!(*hp <= def.hp);
        }
        assert!(side.towers[st.towers.len()..].iter().all(|&h| h == 0));
        for (hp, def) in side.crates.iter().zip(st.crates.iter()) {
            assert!(*hp <= def.hp);
        }
        assert!(side.crates[st.crates.len()..].iter().all(|&h| h == 0));
        // The caps, live units sane, free slots zeroed.
        assert!(usize::from(side.cohort_len) <= COHORT_CAP);
        assert!(usize::from(side.enemy_len) <= ENEMY_CAP);
        if !side.phase.active() {
            assert!(side.cohorts().is_empty() && side.enemies().is_empty());
        }
        let mut prev_id = 0u32;
        for c in side.cohorts() {
            assert!(c.count > 0 && c.count <= MAX_COUNT, "count {}", c.count);
            assert!((0..LANE_WIDTH).contains(&i32::from(c.x)));
            assert!((0..LANE_LENGTH).contains(&i32::from(c.y)));
            assert!(usize::from(c.last_row) <= st.rows.len());
            assert!(c.id > prev_id && c.id < p.next_cohort_id, "oldest first");
            prev_id = c.id;
        }
        for e in side.enemies() {
            assert!(e.count > 0);
            assert!((0..LANE_WIDTH).contains(&i32::from(e.x)));
            assert!(e.y > 0 || side.dead, "an enemy at the line means death");
            assert!(i32::from(e.y) <= TOWER_Y && usize::from(e.tower) < st.towers.len());
        }
        assert!(side.cohorts[usize::from(side.cohort_len)..]
            .iter()
            .all(|c| *c == Cohort::default()));
        assert!(side.enemies[usize::from(side.enemy_len)..]
            .iter()
            .all(|e| *e == Enemy::default()));
        // Rig / peek flags match the secret history of the current stage.
        let log = &m.secret.history[usize::from(side.stage)];
        assert_eq!(side.rig_used, log.rigs[s].is_some());
        assert_eq!(side.peek_used, log.peeks[s].is_some());
        // Gates: unused slots stay blank; revealed = the true value (deal or trap).
        for (slot, g) in side.gates.iter().enumerate() {
            let slot = slot as u8;
            match st.gates.get(usize::from(slot)) {
                None => assert_eq!(*g, PublicGate::default()),
                Some(def) => {
                    assert!(def.x_min.min(def.x) <= g.x && g.x <= def.x_max.max(def.x));
                    if let Some(op) = g.revealed {
                        assert_eq!(op, m.secret.true_op(s as u8, side.stage, slot));
                    }
                }
            }
        }
    }
    // Every rig names a real gate, at most one per victim stage; the secrets are the deal.
    let deal = deals_for(m.secret.seed);
    assert_eq!(deal.layout, p.layout);
    assert_eq!(deal.values, m.secret.values);
    for s in 0..2usize {
        let mut per_stage = [0; STAGES];
        for (k, log) in m.secret.history.iter().enumerate() {
            if let Some(r) = log.rigs[s] {
                // v4: a rig names the rigger's own stage (in the other copy).
                assert_eq!(usize::from(r.stage), k);
                assert!(usize::from(r.slot) < stage(p.layout, r.stage).gates.len());
                per_stage[usize::from(r.stage)] += 1;
            }
        }
        assert!(per_stage.iter().all(|&n| n <= 1));
    }
}

fn fuzz_one(seed: u64) -> (u32, u32, u32) {
    let mut r = SplitMix64::new(seed ^ 0xF00D);
    // Half the seeds: bots with random overrides (full-length matches); else random mashing.
    let bots = r.below(2) == 1;
    let opts = MatchOptions {
        stake: r.below(1_000_000_000),
        bot: [bots, bots || r.below(2) == 1],
        tutorial: r.below(4) == 0,
    };
    let mut m = MatchState::new(seed, opts);
    let mut bot0 = Warlord::new(0, r.next_u64());
    let mut bot = Warlord::new(1, r.next_u64());
    let mut ev = Events::<EVENT_CAP>::new();
    let mut prev_gold = [0; 2];
    let (mut max_len, mut max_count, mut max_events) = (0u32, 0u32, 0u32);
    for _ in 0..MATCH_TICKS {
        let mut inputs = Inputs {
            sides: [random_input(&mut r), random_input(&mut r)],
        };
        if opts.bot[0] && r.below(10) != 0 {
            inputs.sides[0] = bot0.decide(&m.public);
        }
        if opts.bot[1] {
            inputs.sides[1] = bot.decide(&m.public);
        }
        if r.below(50) == 0 {
            // Inputs can also arrive between ticks (player instructions on-chain).
            apply_input(&mut m, 0, &random_input(&mut r));
        }
        ev.clear();
        let before = m.public.tick;
        step(&mut m, &inputs, &mut ev);
        assert_eq!(m.public.tick, before + 1);
        assert_eq!(ev.dropped(), 0, "EVENT_CAP too small");
        max_events = max_events.max(ev.as_slice().len() as u32);
        check(&m, &mut prev_gold);
        for side in &m.public.sides {
            max_len = max_len.max(u32::from(side.cohort_len));
            max_count = max_count.max(side.cohorts().iter().map(|c| c.count).max().unwrap_or(0));
        }
        if m.public.result.is_some() {
            break;
        }
    }
    // Every match ends: by a death, both done, or the cap.
    let res = m.public.result.expect("match did not end");
    let [a, b] = &m.public.sides;
    assert_eq!(res, payout(opts.stake, [a.dead, b.dead], [a.gold, b.gold]));
    let finished = a.dead || b.dead || (a.phase == Phase::Done && b.phase == Phase::Done);
    assert!(finished || m.public.tick == MATCH_TICKS);
    assert!(res.moved <= opts.stake && res.fee <= res.moved);
    assert!(matches!(ev.as_slice().last(), Some(Event::End { .. })));
    // Ended matches are frozen.
    let frozen = m;
    step(&mut m, &Inputs::default(), &mut ev);
    apply_input(&mut m, 0, &random_input(&mut r));
    assert_eq!(m, frozen);
    (max_len, max_count, max_events)
}

#[test]
fn fuzz_seeds_with_random_inputs() {
    let extremes = [u64::MAX, u64::MAX - 1, 1 << 63, 0x5555_5555_5555_5555];
    let (mut max_len, mut max_count, mut max_events) = (0, 0, 0);
    for seed in (0..SEEDS).chain(extremes) {
        let (l, c, e) = fuzz_one(seed);
        max_len = max_len.max(l);
        max_count = max_count.max(c);
        max_events = max_events.max(e);
    }
    println!(
        "max live cohorts per side {max_len}, max cohort {max_count}, max events/tick {max_events}"
    );
}

#[test]
fn bot_vs_bot_matches_rarely_reach_the_cap() {
    // Sanity of the tuned numbers: bots finish (a death, or both done) well before 3:00.
    let mut capped = 0;
    for seed in 0..120u64 {
        let (m, _) = common::play_bots(seed, 0);
        let p = &m.public;
        let finished =
            p.sides.iter().any(|s| s.dead) || p.sides.iter().all(|s| s.phase == Phase::Done);
        capped += u32::from(!finished);
    }
    assert!(capped <= 12, "{capped} of 120 hit the cap");
}
