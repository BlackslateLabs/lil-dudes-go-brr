//! One or more tests per rule (SPEC v3 section in each test's comment). Most use layout 0
//! (Twin Lanes): Fight 1 has one tower at x 1,500, rows at 1,400 / 2,400 / 3,400, gates
//! 0 (row 0, x 700), 1 (row 0, x 2,300), 2 (row 1, x 700), 3 (row 1, x 2,300) and the sliding
//! gate 4 (row 2); Fight 2 locks its big gate 2 (x 1,500) behind a crate at y 2,100.

use super::*;
use crate::deal::RIG_OP;
use crate::events::Events;
use crate::layouts::LAYOUTS;
use crate::state::{MatchOptions, SideInput};
use crate::types::GateOp;

fn new_match(layout: u8) -> MatchState {
    MatchState::new(u64::from(layout), MatchOptions::default())
}

fn tick(m: &mut MatchState, inputs: Inputs) -> Vec<Event> {
    let mut ev = Events::<1024>::new();
    step(m, &inputs, &mut ev);
    assert_eq!(ev.dropped(), 0);
    ev.as_slice().to_vec()
}

fn idle(m: &mut MatchState) -> Vec<Event> {
    tick(m, Inputs::default())
}

/// Step with no inputs until `m.public.tick == t`; returns (tick processed, event) pairs.
fn run_to(m: &mut MatchState, t: u32) -> Vec<(u32, Event)> {
    let mut all = Vec::new();
    while m.public.tick < t && m.public.result.is_none() {
        let at = m.public.tick;
        all.extend(idle(m).into_iter().map(|e| (at, e)));
    }
    all
}

/// Like `run_to`, but enemies are cleared before every tick, so nobody dies.
fn run_safe(m: &mut MatchState, t: u32, inputs: Inputs) -> Vec<(u32, Event)> {
    let mut all = Vec::new();
    while m.public.tick < t && m.public.result.is_none() {
        for s in m.public.sides.iter_mut() {
            s.enemies = [Enemy::default(); ENEMY_CAP];
            s.enemy_len = 0;
        }
        let at = m.public.tick;
        all.extend(tick(m, inputs).into_iter().map(|e| (at, e)));
    }
    all
}

fn input(side: usize, i: SideInput) -> Inputs {
    let mut inputs = Inputs::default();
    inputs.sides[side] = i;
    inputs
}

fn rig(slot: u8) -> SideInput {
    SideInput {
        rig: Some(slot),
        ..SideInput::default()
    }
}

fn peek(slot: u8) -> SideInput {
    SideInput {
        peek: Some(slot),
        ..SideInput::default()
    }
}

/// Both players at the first tick of Fight 1 (tick PLANT_TICKS).
fn fight(layout: u8) -> MatchState {
    let mut m = new_match(layout);
    run_to(&mut m, PLANT_TICKS);
    for s in &m.public.sides {
        assert_eq!((s.stage, s.phase, s.phase_ticks), (0, Phase::Fight, 0));
    }
    m
}

/// Towers that can't fall (so a test's fight never ends on its own).
fn sturdy(m: &mut MatchState) {
    for s in m.public.sides.iter_mut() {
        for t in s.towers.iter_mut().filter(|t| **t > 0) {
            *t = u16::MAX;
        }
    }
}

fn cohort(id: u32, count: u32, x: i16, y: i16, last_row: u8) -> Cohort {
    Cohort {
        id,
        count,
        x,
        y,
        age: 100,
        last_row,
    }
}

fn enemy(id: u32, count: u32, x: i16, y: i16) -> Enemy {
    Enemy {
        id,
        count,
        x,
        y,
        tower: 0,
    }
}

fn place(m: &mut MatchState, side: usize, c: Cohort) {
    let s = &mut m.public.sides[side];
    s.cohorts[usize::from(s.cohort_len)] = c;
    s.cohort_len += 1;
}

fn place_enemy(m: &mut MatchState, side: usize, e: Enemy) {
    let s = &mut m.public.sides[side];
    s.enemies[usize::from(s.enemy_len)] = e;
    s.enemy_len += 1;
}

fn find(m: &MatchState, side: usize, id: u32) -> Option<Cohort> {
    m.public.sides[side]
        .cohorts()
        .iter()
        .find(|c| c.id == id)
        .copied()
}

/// Puts `side` into `stage` / `phase` at phase tick 0 (layout data loaded, field empty).
fn enter(m: &mut MatchState, side: usize, stage: u8, phase: Phase) {
    let layout = m.public.layout;
    let s = &mut m.public.sides[side];
    s.load_stage(layout, stage);
    s.phase = phase;
}

// --- timeline ----------------------------------------------------------------------------------

#[test]
fn plant_then_fight_and_the_cannon_holds_fire_while_planting() {
    // SPEC §3: Plant 3 s (no fire), then Fight; volleys every FIRE_TICKS from the fight's start.
    let mut m = new_match(0);
    let ev = run_to(&mut m, PLANT_TICKS + 3 * FIRE_TICKS + 1);
    assert!(ev.iter().any(|(t, e)| *t == 0
        && *e
            == Event::Phase {
                side: 0,
                stage: 0,
                phase: Phase::Plant
            }));
    let fight_at: Vec<u32> = ev
        .iter()
        .filter(|(_, e)| {
            matches!(
                e,
                Event::Phase {
                    phase: Phase::Fight,
                    ..
                }
            )
        })
        .map(|(t, _)| *t)
        .collect();
    assert_eq!(fight_at, vec![PLANT_TICKS - 1; 2]);
    let volleys: Vec<u32> = ev
        .iter()
        .filter(|(_, e)| matches!(e, Event::Volley { side: 0, .. }))
        .map(|(t, _)| *t)
        .collect();
    let want: Vec<u32> = (0..4).map(|k| PLANT_TICKS + k * FIRE_TICKS).collect();
    assert_eq!(volleys, want);
    assert!(ev
        .iter()
        .all(|(_, e)| !matches!(e, Event::Volley { count, .. } if *count != VOLLEY_SIZE)));
}

#[test]
fn cannon_chases_the_aim() {
    // SPEC §2: at most CANNON_STEP per tick, stopping on the aim; aims are clamped to the lane.
    let mut m = new_match(0);
    let aim = |x| {
        input(
            0,
            SideInput {
                aim: Some(x),
                ..SideInput::default()
            },
        )
    };
    tick(&mut m, aim(-500));
    assert_eq!(m.public.sides[0].aim, 0);
    assert_eq!(m.public.sides[0].cannon_x, 1_500 - CANNON_STEP as i16);
    idle(&mut m);
    assert_eq!(m.public.sides[0].cannon_x, 300);
    idle(&mut m);
    assert_eq!(m.public.sides[0].cannon_x, 0);
    tick(&mut m, aim(99_999));
    assert_eq!(m.public.sides[0].aim, (LANE_WIDTH - 1) as i16);
    assert_eq!(m.public.sides[1].cannon_x, 1_500);
}

#[test]
fn launch_boost_then_cruise() {
    // SPEC §7: LAUNCH_SPEED for LAUNCH_TICKS ticks, then CRUISE_SPEED.
    let mut m = fight(0);
    idle(&mut m);
    let id = m.public.sides[0].cohorts()[0].id;
    for k in 1..=LAUNCH_TICKS + 3 {
        let y = find(&m, 0, id).unwrap().y;
        idle(&mut m);
        let dy = i32::from(find(&m, 0, id).unwrap().y - y);
        let want = if k <= LAUNCH_TICKS {
            LAUNCH_SPEED
        } else {
            CRUISE_SPEED
        };
        assert_eq!(dy, want, "tick {k} of flight");
    }
}

// --- waves -------------------------------------------------------------------------------------

#[test]
fn wave_schedule_and_fatigue() {
    // SPEC §4: first wave at 10, then gaps 130 / 130 / 80; fatigue 1000‰ to 15 s → 100‰ at 45 s.
    let at: Vec<u32> = (0..2_000).filter(|&t| wave_index(t).is_some()).collect();
    assert_eq!(&at[..7], &[10, 140, 270, 350, 480, 610, 690]);
    assert_eq!(wave_index(10), Some(0));
    assert_eq!(wave_index(350), Some(3));
    assert_eq!(wave_index(690), Some(6));
    assert_eq!(wave_index(9), None);
    assert_eq!(fatigue_pm(0), 1_000);
    assert_eq!(fatigue_pm(300), 1_000);
    assert_eq!(fatigue_pm(600), 550);
    assert_eq!(fatigue_pm(900), 100);
    assert_eq!(fatigue_pm(5_000), 100);
    // big → small → medium, at least 1.
    assert_eq!(wave_size(20, 0, 10, 100), 23);
    assert_eq!(wave_size(20, 1, 140, 100), 17);
    assert_eq!(wave_size(20, 2, 270, 100), 20);
    assert_eq!(wave_size(20, 3, 600, 100), 12); // 23 × 0.55
    assert_eq!(wave_size(20, 0, 10, 50), 11);
    assert_eq!(wave_size(1, 1, 2_000, 100), 1);
}

#[test]
fn towers_release_waves_on_schedule_at_their_x() {
    // SPEC §4: each live tower releases a cohort at its x and TOWER_Y.
    let mut m = fight(0);
    sturdy(&mut m);
    let ev = run_safe(&mut m, PLANT_TICKS + 360, Inputs::default());
    let tower = LAYOUTS[0].stages[0].towers[0];
    let waves: Vec<(u32, u32)> = ev
        .iter()
        .filter_map(|(t, e)| match e {
            Event::Wave {
                side: 0,
                tower: 0,
                x,
                count,
                merged: false,
                ..
            } => {
                assert_eq!(*x, tower.x);
                Some((*t - PLANT_TICKS, *count))
            }
            _ => None,
        })
        .collect();
    let want: Vec<(u32, u32)> = [(10, 0), (140, 1), (270, 2), (350, 3)]
        .iter()
        .map(|&(t, k)| (t, wave_size(tower.wave_base, k, t, 100)))
        .collect();
    assert_eq!(waves, want);
}

#[test]
fn a_destroyed_tower_releases_nothing() {
    // SPEC §4: only live towers release. Fight 2 of layout 0 with tower 0 down.
    let mut m = new_match(0);
    enter(&mut m, 0, 1, Phase::Fight);
    m.public.sides[0].towers = [0, u16::MAX];
    let ev = run_to(&mut m, 20);
    let towers: Vec<u8> = ev
        .iter()
        .filter_map(|(_, e)| match e {
            Event::Wave { side: 0, tower, .. } => Some(*tower),
            _ => None,
        })
        .collect();
    assert_eq!(towers, vec![1]);
}

#[test]
fn tutorial_halves_side_zeros_first_fight_waves() {
    // SPEC §10: tutorial = side 0's Fight 1 waves at 50%; side 1 unchanged.
    let mut m = MatchState::new(
        0,
        MatchOptions {
            tutorial: true,
            ..MatchOptions::default()
        },
    );
    let ev = run_to(&mut m, PLANT_TICKS + 11);
    let base = LAYOUTS[0].stages[0].towers[0].wave_base;
    let count = |side: u8| {
        ev.iter()
            .find_map(|(_, e)| match e {
                Event::Wave { side: s, count, .. } if *s == side => Some(*count),
                _ => None,
            })
            .unwrap()
    };
    assert_eq!(count(0), wave_size(base, 0, 10, TUTORIAL_WAVE_PCT));
    assert_eq!(count(1), wave_size(base, 0, 10, 100));
    assert!(count(0) < count(1));
}

#[test]
fn a_full_lane_merges_waves_into_that_towers_newest_cohort() {
    // SPEC §7: at ENEMY_CAP a wave joins the newest enemy cohort of its tower.
    let mut m = fight(0);
    sturdy(&mut m);
    for i in 0..ENEMY_CAP as u32 {
        place_enemy(&mut m, 0, enemy(500 + i, 1, 100, 9_000));
    }
    m.public.sides[0].enemies[3].tower = 0;
    for e in m.public.sides[0].enemies.iter_mut().skip(4) {
        e.tower = 1;
    }
    let ev = run_to(&mut m, PLANT_TICKS + 11);
    let merged = ev.iter().find_map(|(_, e)| match e {
        Event::Wave {
            side: 0,
            merged: true,
            enemy_id,
            count,
            ..
        } => Some((*enemy_id, *count)),
        _ => None,
    });
    let (id, count) = merged.expect("merged wave");
    assert_eq!(id, 503);
    let e = m.public.sides[0]
        .enemies()
        .iter()
        .find(|e| e.id == 503)
        .unwrap();
    assert_eq!(e.count, 1 + count);
    assert_eq!(usize::from(m.public.sides[0].enemy_len), ENEMY_CAP);
}

// --- movement and homing -----------------------------------------------------------------------

#[test]
fn enemies_walk_down_and_home_in_on_cohorts_ahead() {
    // SPEC §4: steer STEER_STEP toward the nearest cohort below within DETECT_Y, else straight.
    let mut m = new_match(0);
    let side = &mut m.public.sides[0];
    side.cohorts[0] = cohort(1, 5, 1_000, 5_000, 3);
    side.cohort_len = 1;
    side.enemies[0] = enemy(2, 5, 2_000, 8_000);
    side.enemies[1] = enemy(3, 5, 2_000, 9_500); // 4,500 above: too far to see it
    side.enemies[2] = enemy(4, 5, 1_010, 8_000); // closer than a step: lands on it
    side.enemy_len = 3;
    move_enemies(side);
    let e = side.enemies();
    assert_eq!(
        (e[0].x, e[0].y),
        (2_000 - STEER_STEP as i16, 8_000 - CRUISE_SPEED as i16)
    );
    assert_eq!((e[1].x, e[1].y), (2_000, 9_500 - CRUISE_SPEED as i16));
    assert_eq!(e[2].x, 1_000);
}

#[test]
fn cohorts_walk_straight_among_rows_then_home_in() {
    // SPEC §4: straight while among the gate rows; past the last row, toward the nearest enemy
    // ahead within DETECT_Y, else the nearest live tower.
    let m = new_match(0);
    let st = layouts::stage(0, 0);
    let mut side = m.public.sides[0];
    side.cohorts[0] = cohort(1, 5, 1_000, 500, 0); // among the rows
    side.cohorts[1] = cohort(2, 5, 1_000, 5_000, 3); // past the last row, enemy ahead
    side.cohorts[2] = cohort(3, 5, 2_900, 5_000, 3); // past the last row, enemy out of sight
    side.cohort_len = 3;
    side.enemies[0] = enemy(9, 5, 600, 7_000);
    side.enemies[1] = enemy(10, 5, 2_900, 9_500);
    side.enemy_len = 2;
    move_cohorts(&mut side, st, &m.secret, 0, &mut Events::<64>::new());
    let c = side.cohorts();
    assert_eq!(c[0].x, 1_000);
    assert_eq!(c[1].x, 1_000 - STEER_STEP as i16);
    // Enemy 10 is 4,420 ahead (> DETECT_Y): go for the tower at 1,500 instead.
    assert_eq!(c[2].x, 2_900 - STEER_STEP as i16);
}

// --- clash -------------------------------------------------------------------------------------

#[test]
fn crossed_pairs_within_reach_cancel_one_for_one() {
    // SPEC §4: crossed in y (by at most CLASH_BAND) and x within CLASH_REACH → min(a, b) each.
    let mut m = new_match(0);
    let side = &mut m.public.sides[0];
    side.cohorts[0] = cohort(1, 10, 1_000, 5_000, 3);
    side.cohort_len = 1;
    side.enemies[0] = enemy(2, 4, 1_000 + CLASH_REACH as i16, 5_000 - CLASH_BAND as i16);
    side.enemy_len = 1;
    let mut ev = Events::<16>::new();
    clash(side, 0, &mut ev);
    assert_eq!(side.cohorts[0].count, 6);
    assert_eq!(side.enemies[0].count, 0);
    assert_eq!(
        ev.as_slice(),
        &[Event::Clash {
            side: 0,
            x: 1_200,
            y: 4_800,
            killed: 4
        }]
    );
}

#[test]
fn pairs_that_have_not_met_do_not_clash() {
    // SPEC §4: not yet crossed, too far past each other, or out of reach in x.
    for (dx, dy) in [(0, -1), (0, CLASH_BAND + 1), (CLASH_REACH + 1, 0)] {
        let mut m = new_match(0);
        let side = &mut m.public.sides[0];
        side.cohorts[0] = cohort(1, 10, 1_000, 5_000, 3);
        side.cohort_len = 1;
        side.enemies[0] = enemy(2, 4, (1_000 + dx) as i16, (5_000 - dy) as i16);
        side.enemy_len = 1;
        clash(side, 0, &mut Events::<16>::new());
        assert_eq!(
            (side.cohorts[0].count, side.enemies[0].count),
            (10, 4),
            "{dx} {dy}"
        );
    }
}

#[test]
fn front_most_pairs_resolve_first() {
    // SPEC §4: the front-most cohort meets the enemy first.
    let mut m = new_match(0);
    let side = &mut m.public.sides[0];
    side.cohorts[0] = cohort(1, 3, 1_000, 5_100, 3);
    side.cohorts[1] = cohort(2, 3, 1_000, 5_050, 3);
    side.cohort_len = 2;
    side.enemies[0] = enemy(3, 4, 1_000, 5_000);
    side.enemy_len = 1;
    clash(side, 0, &mut Events::<16>::new());
    assert_eq!(
        (
            side.cohorts[0].count,
            side.cohorts[1].count,
            side.enemies[0].count
        ),
        (0, 2, 0)
    );
}

// --- towers, gold, losses ----------------------------------------------------------------------

#[test]
fn tower_hits_deal_damage_and_earn_gold() {
    // SPEC §4/§5: damage = count (kamikaze), gold = damage dealt, overkill earns nothing,
    // TOWER_BONUS for the kill; reach = TOWER_HALF_W + CLASH_REACH.
    let mut m = fight(0);
    m.public.sides[0].towers[0] = 30;
    let reach = (TOWER_HALF_W + CLASH_REACH) as i16;
    place(
        &mut m,
        0,
        cohort(900, 12, 1_500 - reach, (TOWER_Y - 10) as i16, 3),
    );
    place(
        &mut m,
        0,
        cohort(901, 7, 1_500 + reach + 50, (TOWER_Y - 10) as i16, 3),
    );
    let ev = idle(&mut m);
    let s = &m.public.sides[0];
    assert_eq!(s.towers[0], 18);
    assert_eq!(s.gold, 12);
    assert!(find(&m, 0, 900).is_none());
    // Out of reach: it steered 40 closer but still misses this tick, and keeps walking.
    assert!(find(&m, 0, 901).is_some());
    assert!(ev.contains(&Event::TowerHit {
        side: 0,
        tower: 0,
        damage: 12,
        hp: 18,
        gold: 12
    }));
    // Overkill: 50 into 18 HP earns 18 + the bonus, and the fight ends (Transit).
    place(&mut m, 0, cohort(902, 50, 1_500, (TOWER_Y - 10) as i16, 3));
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::TowerDestroyed {
        side: 0,
        tower: 0,
        gold: TOWER_BONUS
    }));
    assert_eq!(m.public.sides[0].gold, 12 + 18 + TOWER_BONUS);
}

#[test]
fn cohorts_that_hit_nothing_are_lost_at_the_base_edge() {
    // SPEC §4: reaching LANE_LENGTH without a hit removes the cohort, no gold.
    let mut m = fight(0);
    place(&mut m, 0, cohort(900, 9, 100, (LANE_LENGTH - 10) as i16, 3));
    m.public.sides[0].towers[0] = 0; // no target to steer to... and no transit either:
    m.public.sides[0].towers[1] = 0;
    let mut side = m.public.sides[0];
    side.phase = Phase::Fight;
    let st = layouts::stage(0, 0);
    move_cohorts(&mut side, st, &m.secret, 0, &mut Events::<16>::new());
    hits(&mut side, st, 0, &mut Events::<16>::new());
    compact(&mut side);
    assert!(side.cohorts().iter().all(|c| c.id != 900));
    assert_eq!(side.gold, 0);
}

// --- crates ------------------------------------------------------------------------------------

#[test]
fn crates_absorb_until_they_break_then_let_through() {
    // SPEC §4: min(count, hp) is spent; at 0 the crate breaks and the rest passes on.
    let mut m = new_match(0);
    enter(&mut m, 0, 1, Phase::Fight);
    sturdy(&mut m);
    let lock = LAYOUTS[0].stages[1].crates[0];
    assert_eq!(m.public.sides[0].crates[0], lock.hp);
    let y = lock.y - 10;
    place(&mut m, 0, cohort(900, 10, lock.x, y, 1));
    let ev = idle(&mut m);
    assert!(find(&m, 0, 900).is_none());
    assert_eq!(m.public.sides[0].crates[0], lock.hp - 10);
    assert!(ev.contains(&Event::CrateHit {
        side: 0,
        crate_ix: 0,
        cohort_id: 900,
        absorbed: 10,
        hp: u32::from(lock.hp - 10)
    }));
    let big = u32::from(lock.hp) + 5;
    place(&mut m, 0, cohort(901, big, lock.x, y, 1));
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::CrateBroken {
        side: 0,
        crate_ix: 0
    }));
    assert_eq!(m.public.sides[0].crates[0], 0);
    assert_eq!(find(&m, 0, 901).unwrap().count, 15);
    // Broken: the next cohort walks through untouched and gets the big gate.
    place(&mut m, 0, cohort(902, 3, lock.x, y, 1));
    let mut ev = idle(&mut m);
    for _ in 0..4 {
        ev.extend(idle(&mut m));
    }
    let v = m.secret.values[1][2];
    assert!(ev.iter().all(|e| !matches!(e, Event::CrateHit { .. })));
    assert_eq!(find(&m, 0, 902).unwrap().count, v.apply(3));
}

// --- gates -------------------------------------------------------------------------------------

#[test]
fn first_pass_reveals_and_every_pass_applies() {
    // SPEC §6: hidden until the first cohort passes, then shown; ×k on every pass.
    let mut m = fight(0);
    let v = m.secret.values[0][0];
    place(&mut m, 0, cohort(900, 3, 700, 1_330, 0));
    place(&mut m, 0, cohort(901, 2, 700 + 290, 1_300, 0));
    assert_eq!(m.public.sides[0].gates[0].revealed, None);
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::Gate {
        side: 0,
        slot: 0,
        cohort_id: 900,
        op: v,
        before: 3,
        after: v.apply(3),
        reveal: true
    }));
    assert_eq!(m.public.sides[0].gates[0].revealed, Some(v));
    assert_eq!(m.public.sides[1].gates[0].revealed, None); // the other copy is untouched
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::Gate {
        side: 0,
        slot: 0,
        cohort_id: 901,
        op: v,
        before: 2,
        after: v.apply(2),
        reveal: false
    }));
}

#[test]
fn a_cohort_in_the_gap_passes_unchanged() {
    // SPEC §6: between gates nothing happens; the row still counts as passed.
    let mut m = fight(0);
    place(&mut m, 0, cohort(900, 3, 1_500, 1_330, 0));
    let ev = idle(&mut m);
    assert!(ev.iter().all(|e| !matches!(e, Event::Gate { .. })));
    let c = find(&m, 0, 900).unwrap();
    assert_eq!((c.count, c.last_row), (3, 1));
}

#[test]
fn a_row_applies_once_per_cohort() {
    // SPEC §6: `last_row` makes every row apply at most once, in order.
    let mut m = fight(0);
    sturdy(&mut m);
    let aim = input(
        0,
        SideInput {
            aim: Some(700),
            ..SideInput::default()
        },
    );
    let ev: Vec<Event> = run_safe(&mut m, PLANT_TICKS + 400, aim)
        .into_iter()
        .map(|(_, e)| e)
        .collect();
    let mut seen = std::collections::HashSet::new();
    let mut gates = 0;
    for e in &ev {
        if let Event::Gate {
            side,
            cohort_id,
            slot,
            ..
        } = e
        {
            let row = LAYOUTS[0].stages[0].gates[usize::from(*slot)].row;
            assert!(seen.insert((*side, *cohort_id, row)), "row passed twice");
            gates += 1;
        }
    }
    assert!(gates > 20);
}

#[test]
fn sliding_gates_move_from_the_fight_start() {
    // SPEC §6: ping-pong, timed from the player's Fight start; parked at x before it.
    let mut m = new_match(0);
    let def = LAYOUTS[0].stages[0].gates[4];
    assert!(def.moving());
    run_to(&mut m, PLANT_TICKS - 1);
    assert_eq!(m.public.sides[0].gates[4].x, def.x);
    run_safe(&mut m, PLANT_TICKS + 37, Inputs::default());
    // Fight ticks 0..=36 are done.
    assert_eq!(m.public.sides[0].gates[4].x, def.x_at(36));
    assert_ne!(def.x_at(36), def.x);
    // A cohort crossing the row is judged against where the gate is that tick.
    let at = def.x_at(37);
    place(&mut m, 0, cohort(900, 2, at, 3_390, 2));
    let ev = idle(&mut m);
    assert!(ev.iter().any(|e| matches!(
        e,
        Event::Gate {
            slot: 4,
            cohort_id: 900,
            ..
        }
    )));
}

// --- rig ---------------------------------------------------------------------------------------

#[test]
fn rig_is_planted_on_the_opponents_current_stage() {
    // SPEC §6: during my Plant, once per stage; recorded under my stage with the victim's stage.
    let mut m = new_match(0);
    tick(&mut m, input(0, rig(1)));
    assert!(m.public.sides[0].rig_used && !m.public.sides[1].rig_used);
    assert_eq!(m.secret.history[0].rigs[0], Some(Rig { stage: 0, slot: 1 }));
    assert_eq!(m.secret.true_op(1, 0, 1), RIG_OP);
    assert_eq!(m.secret.true_op(0, 0, 1), m.secret.values[0][1]);
    assert_eq!(m.private_view(0).rig, Some(Rig { stage: 0, slot: 1 }));
    // Once per stage.
    tick(&mut m, input(0, rig(2)));
    assert_eq!(m.secret.history[0].rigs[0], Some(Rig { stage: 0, slot: 1 }));
}

#[test]
fn rig_refusals_do_not_use_it_up() {
    // SPEC §6: refused outside my Plant, on a missing or revealed gate, on a finished opponent,
    // or when that opponent stage already holds a rig.
    let fresh = new_match(0);
    let refused = |m: &mut MatchState, slot: u8| {
        tick(m, input(0, rig(slot)));
        assert!(!m.public.sides[0].rig_used);
        assert_eq!(
            m.secret.history[usize::from(m.public.sides[0].stage)].rigs[0],
            None
        );
    };
    // Missing slot (stage 0 of layout 0 has 5 gates).
    refused(&mut fresh.clone(), 5);
    refused(&mut fresh.clone(), 200);
    // Revealed.
    let mut m = fresh;
    m.public.sides[1].gates[1].revealed = Some(GateOp::Mul(2));
    refused(&mut m, 1);
    // Opponent done / dead.
    let mut m = fresh;
    m.public.sides[1].phase = Phase::Done;
    refused(&mut m, 1);
    let mut m = fresh;
    m.public.sides[1].dead = true;
    m.public.sides[0].dead = false;
    apply_input(&mut m, 0, &rig(1));
    assert!(!m.public.sides[0].rig_used);
    // Not in my Plant.
    let mut m = fight(0);
    refused(&mut m, 1);
    // That opponent stage already holds a rig (mine, from an earlier stage).
    let mut m = fresh;
    m.secret.history[0].rigs[0] = Some(Rig { stage: 1, slot: 0 });
    enter(&mut m, 0, 1, Phase::Plant);
    enter(&mut m, 1, 1, Phase::Fight);
    refused(&mut m, 3);
}

#[test]
fn rig_during_the_opponents_transit_lands_on_their_next_stage() {
    // SPEC §6: "or the one they enter next, if they are in Transit".
    let mut m = new_match(0);
    enter(&mut m, 1, 1, Phase::Transit);
    tick(&mut m, input(0, rig(2)));
    assert_eq!(m.secret.history[0].rigs[0], Some(Rig { stage: 1, slot: 2 }));
    assert_eq!(m.secret.rigged_by(1, 1, 2), Some(0));
}

#[test]
fn a_rigged_gate_springs_gotcha_and_halves_for_the_rest_of_the_stage() {
    // SPEC §6: same `?` face; the first pass flashes GOTCHA, then ÷2 on every pass.
    let mut m = new_match(0);
    tick(&mut m, input(0, rig(0)));
    run_to(&mut m, PLANT_TICKS);
    place(&mut m, 1, cohort(900, 9, 700, 1_330, 0));
    place(&mut m, 1, cohort(901, 5, 700, 1_300, 0));
    place(&mut m, 0, cohort(902, 9, 700, 1_330, 0));
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::Gotcha {
        side: 1,
        slot: 0,
        rigged_by: 0
    }));
    assert_eq!(
        ev.iter()
            .filter(|e| matches!(e, Event::Gotcha { .. }))
            .count(),
        1
    );
    assert_eq!(m.public.sides[1].gates[0].revealed, Some(RIG_OP));
    assert_eq!(find(&m, 1, 900).unwrap().count, 4);
    // The rigger's own copy is untouched.
    let v = m.secret.values[0][0];
    assert_eq!(m.public.sides[0].gates[0].revealed, Some(v));
    let ev = idle(&mut m);
    assert_eq!(find(&m, 1, 901).unwrap().count, 2);
    assert!(ev.iter().all(|e| !matches!(e, Event::Gotcha { .. })));
}

#[test]
fn an_unused_rig_is_lost_when_the_plant_ends() {
    // SPEC §6: the next stage brings a fresh rig; nothing carries over.
    let mut m = new_match(0);
    run_to(&mut m, PLANT_TICKS);
    m.public.sides[0].towers[0] = 1;
    place(&mut m, 0, cohort(900, 5, 1_500, (TOWER_Y - 10) as i16, 3));
    idle(&mut m);
    assert_eq!(m.public.sides[0].phase, Phase::Transit);
    assert!(!m.public.sides[0].rig_used);
    assert!(m.secret.history.iter().all(|l| l.rigs[0].is_none()));
}

// --- peek --------------------------------------------------------------------------------------

#[test]
fn peek_shows_my_true_value_once_per_stage() {
    // SPEC §6: during my Fight/Raid, one own unrevealed gate; refused in Plant.
    let mut m = new_match(0);
    tick(&mut m, input(0, peek(2)));
    assert!(!m.public.sides[0].peek_used);
    run_to(&mut m, PLANT_TICKS);
    tick(&mut m, input(0, peek(2)));
    let want = Peek {
        slot: 2,
        op: m.secret.values[0][2],
    };
    assert_eq!(m.private_view(0).peek, Some(want));
    assert!(m.public.sides[0].peek_used);
    assert_eq!(m.private_view(1).peek, None);
    tick(&mut m, input(0, peek(3)));
    assert_eq!(m.private_view(0).peek, Some(want));
}

#[test]
fn peek_refusals_and_rigged_gates() {
    // SPEC §6: refused (and kept) on a revealed or missing gate; a rigged gate peeks as ÷2.
    let mut m = fight(0);
    m.public.sides[0].gates[1].revealed = Some(GateOp::Mul(3));
    tick(&mut m, input(0, peek(1)));
    tick(&mut m, input(0, peek(7)));
    assert!(!m.public.sides[0].peek_used);
    m.secret.history[0].rigs[1] = Some(Rig { stage: 0, slot: 3 });
    tick(&mut m, input(0, peek(3)));
    assert_eq!(
        m.private_view(0).peek,
        Some(Peek {
            slot: 3,
            op: RIG_OP
        })
    );
}

// --- transit, raid, done -----------------------------------------------------------------------

#[test]
fn clearing_a_fight_wipes_the_field_and_moves_on() {
    // SPEC §3: all towers down → Transit (2 s, field wiped, next stage's gates face-down) →
    // Plant (3 s) → Fight 2.
    let mut m = fight(0);
    sturdy(&mut m);
    run_safe(&mut m, PLANT_TICKS + 150, Inputs::default());
    place_enemy(&mut m, 0, enemy(8_000, 5, 2_000, 9_000));
    assert!(m.public.sides[0].cohort_len > 0);
    m.public.sides[0].towers[0] = 1;
    place(&mut m, 0, cohort(9_000, 5, 1_500, (TOWER_Y - 10) as i16, 3));
    let t0 = m.public.tick;
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::Phase {
        side: 0,
        stage: 1,
        phase: Phase::Transit
    }));
    let s = &m.public.sides[0];
    let st = &LAYOUTS[0].stages[1];
    assert_eq!((s.stage, s.phase, s.phase_ticks), (1, Phase::Transit, 0));
    assert!(s.cohorts().is_empty() && s.enemies().is_empty());
    assert_eq!(s.towers, [st.towers[0].hp, st.towers[1].hp]);
    assert_eq!(s.crates[0], st.crates[0].hp);
    assert!(s.gates.iter().all(|g| g.revealed.is_none()));
    assert_eq!(s.gates[2].x, st.gates[2].x);
    // The other copy is not affected.
    assert_eq!(m.public.sides[1].stage, 0);
    let ev = run_safe(
        &mut m,
        t0 + 1 + TRANSIT_TICKS + PLANT_TICKS,
        Inputs::default(),
    );
    let phases: Vec<(u32, Phase)> = ev
        .iter()
        .filter_map(|(t, e)| match e {
            Event::Phase { side: 0, phase, .. } => Some((*t - t0, *phase)),
            _ => None,
        })
        .collect();
    assert_eq!(
        phases,
        vec![
            (TRANSIT_TICKS, Phase::Plant),
            (TRANSIT_TICKS + PLANT_TICKS, Phase::Fight)
        ]
    );
    // No fire in Transit or Plant.
    assert!(ev
        .iter()
        .filter(|(t, _)| *t < t0 + TRANSIT_TICKS + PLANT_TICKS)
        .all(|(_, e)| !matches!(e, Event::Volley { side: 0, .. })));
}

#[test]
fn raid_fires_for_raid_ticks_loots_and_then_is_done() {
    // SPEC §3/§5: fire RAID_TICKS, LOOT_PER_UNIT per dude reaching the vault, Done when the
    // lane is empty.
    let mut m = new_match(0);
    enter(&mut m, 0, RAID_STAGE, Phase::Raid);
    place(&mut m, 0, cohort(9_000, 7, 1_500, (VAULT_Y - 10) as i16, 3));
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::Loot {
        side: 0,
        cohort_id: 9_000,
        units: 7,
        gold: 7 * LOOT_PER_UNIT
    }));
    assert_eq!(m.public.sides[0].gold, 7 * LOOT_PER_UNIT);
    let ev = run_safe(&mut m, 600, Inputs::default());
    let volleys = ev
        .iter()
        .filter(|(_, e)| matches!(e, Event::Volley { side: 0, .. }))
        .count() as u32
        + 1;
    assert_eq!(volleys, RAID_TICKS / FIRE_TICKS);
    let done = ev
        .iter()
        .find(|(_, e)| {
            *e == Event::Phase {
                side: 0,
                stage: RAID_STAGE,
                phase: Phase::Done,
            }
        })
        .map(|(t, _)| *t)
        .expect("done");
    let last_loot = ev
        .iter()
        .filter(|(_, e)| matches!(e, Event::Loot { side: 0, .. }))
        .map(|(t, _)| *t)
        .max()
        .unwrap_or(0);
    assert!(done >= RAID_TICKS - 1 && done >= last_loot);
    assert!(m.public.sides[0].cohorts().is_empty());
    assert!(m.public.sides[0].gold > 7 * LOOT_PER_UNIT);
    // A done player's cannon still moves, nothing else happens.
    let gold = m.public.sides[0].gold;
    tick(
        &mut m,
        input(
            0,
            SideInput {
                aim: Some(0),
                ..SideInput::default()
            },
        ),
    );
    assert_eq!(m.public.sides[0].gold, gold);
    assert_eq!(m.public.sides[0].phase, Phase::Done);
}

// --- death and the end -------------------------------------------------------------------------

#[test]
fn an_enemy_at_the_cannon_line_kills_and_ends_the_match() {
    // SPEC §4/§8: death is instant; the survivor wins the stake.
    let mut m = MatchState::new(
        0,
        MatchOptions {
            stake: 1_000,
            ..MatchOptions::default()
        },
    );
    run_to(&mut m, PLANT_TICKS + 1);
    place_enemy(&mut m, 1, enemy(9_000, 3, 100, CRUISE_SPEED as i16));
    let ev = idle(&mut m);
    assert!(ev.contains(&Event::Death { side: 1 }));
    assert!(m.public.sides[1].dead && !m.public.sides[0].dead);
    let r = m.public.result.unwrap();
    assert_eq!((r.winner, r.ko, r.moved, r.fee), (Some(0), true, 1_000, 50));
    assert_eq!(ev.last(), Some(&Event::End { result: r }));
    // Frozen once ended.
    let frozen = m;
    idle(&mut m);
    assert_eq!(m, frozen);
}

#[test]
fn a_volley_at_the_line_can_still_stop_it() {
    // SPEC §4: the clash runs before the death check.
    let mut m = fight(0);
    place(
        &mut m,
        0,
        Cohort {
            age: 0,
            ..cohort(9_000, 1, 1_500, 0, 0)
        },
    );
    place_enemy(&mut m, 0, enemy(9_001, 1, 1_500, 60));
    idle(&mut m);
    assert!(!m.public.sides[0].dead && m.public.result.is_none());
}

#[test]
fn both_dying_on_the_same_tick_is_a_draw() {
    // SPEC §4.
    let mut m = fight(0);
    place_enemy(&mut m, 0, enemy(9_000, 3, 100, 10));
    place_enemy(&mut m, 1, enemy(9_001, 3, 100, 10));
    idle(&mut m);
    let r = m.public.result.unwrap();
    assert_eq!((r.winner, r.ko, r.moved), (None, true, 0));
}

#[test]
fn both_done_ends_with_the_gold_ratio() {
    // SPEC §3/§8: both done → the pot splits by gold.
    let mut m = MatchState::new(
        0,
        MatchOptions {
            stake: 1_000_000,
            ..MatchOptions::default()
        },
    );
    for (s, gold) in m.public.sides.iter_mut().zip([900, 600]) {
        s.phase = Phase::Done;
        s.gold = gold;
    }
    let ev = idle(&mut m);
    let r = m.public.result.unwrap();
    assert_eq!(
        (r.winner, r.ko, r.moved, r.fee),
        (Some(0), false, 200_000, 10_000)
    );
    assert!(ev.contains(&Event::End { result: r }));
    assert_eq!(m.public.tick, 1);
}

#[test]
fn the_time_cap_ends_the_match_with_gold_so_far() {
    // SPEC §3: at MATCH_TICKS whatever was earned counts.
    let mut m = fight(0);
    sturdy(&mut m);
    while m.public.result.is_none() {
        for s in m.public.sides.iter_mut() {
            s.enemies = [Enemy::default(); ENEMY_CAP];
            s.enemy_len = 0;
        }
        idle(&mut m);
    }
    assert_eq!(m.public.tick, MATCH_TICKS);
    let [a, b] = &m.public.sides;
    assert!(a.gold > 0 && !a.dead && !b.dead);
    assert_eq!(
        m.public.result,
        Some(payout(0, [false, false], [a.gold, b.gold]))
    );
}

#[test]
fn apply_input_between_ticks_equals_passing_it_to_step() {
    // The program applies player instructions between crank ticks.
    let mut a = new_match(3);
    let mut b = a;
    let i = SideInput {
        aim: Some(400),
        rig: Some(1),
        peek: None,
    };
    tick(&mut a, input(1, i));
    apply_input(&mut b, 1, &i);
    idle(&mut b);
    assert_eq!(a.digest(), b.digest());
}
