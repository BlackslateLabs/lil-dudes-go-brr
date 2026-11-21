//! One or more tests per rule (SPEC v2.1 section in each name's comment).

use super::*;
use crate::deal::RIG_OP;
use crate::events::Events;
use crate::state::{in_plant, MatchOptions, SideInput};
use crate::types::GateOp;
use crate::{HP_MAX, PLANT_STARTS, PLANT_TICKS};

const M2: GateOp = GateOp::Mul(2);

fn new_match() -> MatchState {
    MatchState::new(1, MatchOptions::default())
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

fn input(side: usize, i: SideInput) -> Inputs {
    let mut inputs = Inputs::default();
    inputs.sides[side] = i;
    inputs
}

fn aims(a0: i32, a1: i32) -> Inputs {
    Inputs {
        sides: [
            SideInput {
                aim: Some(a0),
                ..SideInput::default()
            },
            SideInput {
                aim: Some(a1),
                ..SideInput::default()
            },
        ],
    }
}

fn col_x(col: i32) -> i32 {
    col * COL_WIDTH + COL_WIDTH / 2
}

/// Put a known layout on both grids (keeps the public gold flags and hints consistent).
fn set_deal(m: &mut MatchState, ops: [GateOp; CELLS], gold_cell: u8) {
    m.secret.deal.ops = ops;
    m.secret.deal.gold_cell = gold_cell;
    for hints in m.secret.deal.hints.iter_mut() {
        for (c, (hint, &op)) in hints.iter_mut().zip(ops.iter()).enumerate() {
            *hint = if c == usize::from(gold_cell) {
                Hint::Gold
            } else if op.is_good() {
                Hint::Good
            } else {
                Hint::Bad
            };
        }
    }
    let gates = face_down(&m.secret.deal);
    for side in m.public.sides.iter_mut() {
        side.gates = gates;
    }
    if m.public.status() == Status::Playing {
        show_hints(m);
    }
}

fn place(m: &mut MatchState, side: usize, c: Cohort) {
    let s = &mut m.public.sides[side];
    let n = usize::from(s.cohort_len);
    s.cohorts[n] = c;
    s.cohort_len += 1;
}

fn cohort(id: u32, count: u32, x: i32, y: i32) -> Cohort {
    Cohort {
        id,
        count,
        x: x as i16,
        y: y as i16,
        age: 50,
        last_row: 3,
    }
}

fn find(m: &MatchState, side: usize, id: u32) -> Option<Cohort> {
    m.public.sides[side]
        .cohorts()
        .iter()
        .copied()
        .find(|c| c.id == id)
}

// --- timeline (SPEC §3) ------------------------------------------------------------------------

#[test]
fn timeline_plants_redeals_surge_and_timer() {
    // SPEC §3: plants at 0:00, 0:40, 1:20; Surge at 1:45; the timer at 2:00.
    let mut m = new_match();
    let ev = run_to(&mut m, MATCH_TICKS);
    let at = |want: Event| {
        ev.iter()
            .filter(|(_, e)| *e == want)
            .map(|&(t, _)| t)
            .collect::<Vec<_>>()
    };
    assert_eq!(at(Event::Plant { phase: 0 }), vec![0]);
    // Entering tick 800 / 1600 happens at the end of the step for tick 799 / 1599.
    assert_eq!(at(Event::Redeal { phase: 1 }), vec![799]);
    assert_eq!(at(Event::Plant { phase: 1 }), vec![799]);
    assert_eq!(at(Event::Redeal { phase: 2 }), vec![1599]);
    assert_eq!(at(Event::Surge), vec![SURGE_TICK - 1]);
    let ends: Vec<_> = ev
        .iter()
        .filter(|(_, e)| matches!(e, Event::End { .. }))
        .collect();
    assert_eq!(ends.len(), 1);
    assert_eq!(ends[0].0, MATCH_TICKS - 1);
    assert_eq!(m.public.tick, MATCH_TICKS);
    assert_eq!(m.public.status(), Status::Ended);
    // Both cannons idle at the centre: mirrored deal, head-on clashes, nobody scores → draw.
    let r = m.public.result.unwrap();
    assert_eq!((r.winner, r.ko, r.moved), (None, false, 0));
    assert_eq!(m.public.sides[0].hp, m.public.sides[1].hp);
}

#[test]
fn status_follows_the_plant_windows() {
    // SPEC §3: the first 3 s of each phase are a plant window.
    let mut m = new_match();
    for t in 0..MATCH_TICKS {
        let phase = phase_at(t);
        let want = if t < PLANT_STARTS[usize::from(phase)] + PLANT_TICKS {
            Status::Plant
        } else {
            Status::Playing
        };
        assert_eq!(m.public.status(), want, "tick {t}");
        assert_eq!(m.public.phase(), phase);
        assert_eq!(m.public.surge(), t >= SURGE_TICK);
        idle(&mut m);
    }
}

#[test]
fn ended_match_is_frozen() {
    let mut m = new_match();
    run_to(&mut m, MATCH_TICKS);
    let before = m;
    assert!(idle(&mut m).is_empty());
    assert_eq!(m, before);
}

// --- fire (SPEC §3, §6) ------------------------------------------------------------------------

fn volley_ticks(ev: &[(u32, Event)], side: u8) -> Vec<u32> {
    ev.iter()
        .filter(|(_, e)| matches!(e, Event::Volley { side: s, .. } if *s == side))
        .map(|&(t, _)| t)
        .collect()
}

#[test]
fn plant_windows_hold_fire_and_play_fires_every_8_ticks() {
    // SPEC §3/§6: no fire in plant windows; a volley every FIRE_TICKS from the first play tick.
    let mut m = new_match();
    let ev = run_to(&mut m, SURGE_TICK);
    let v = volley_ticks(&ev, 0);
    assert_eq!(v, volley_ticks(&ev, 1));
    assert_eq!(v[0], PLANT_TICKS);
    assert!(v.iter().all(|&t| !in_plant(t)));
    for w in v.windows(2) {
        let gap = w[1] - w[0];
        assert!(
            gap == FIRE_TICKS || in_plant(w[1] - 1),
            "gap {gap} at {}",
            w[1]
        );
    }
    assert!(v.contains(&(PLANT_STARTS[1] + PLANT_TICKS)));
    assert!(v.contains(&(PLANT_STARTS[2] + PLANT_TICKS)));
    // 740 play ticks per phase in phases 1–2 → 93 volleys each; 440 ticks before Surge → 55.
    assert_eq!(v.len(), 93 + 93 + 55);
}

#[test]
fn surge_doubles_the_fire_rate() {
    // SPEC §3: from 1:45 a volley every FIRE_TICKS_SURGE ticks.
    let mut m = new_match();
    run_to(&mut m, SURGE_TICK);
    let mut ev = Vec::new();
    while m.public.result.is_none() {
        let at = m.public.tick;
        ev.extend(idle(&mut m).into_iter().map(|e| (at, e)));
    }
    let v = volley_ticks(&ev, 0);
    assert_eq!(v[0], SURGE_TICK);
    assert!(v.windows(2).all(|w| w[1] - w[0] == FIRE_TICKS_SURGE));
    assert_eq!(
        v.len() as u32,
        (MATCH_TICKS - SURGE_TICK) / FIRE_TICKS_SURGE
    );
}

#[test]
fn volley_is_one_cohort_of_four_at_the_cannon() {
    // SPEC §2/§6: one cohort of VOLLEY_SIZE at the sim's x, never the raw aim.
    let mut m = new_match();
    run_to(&mut m, PLANT_TICKS);
    let ev = tick(&mut m, aims(0, 2999));
    let volleys: Vec<_> = ev
        .iter()
        .filter_map(|e| match e {
            Event::Volley { side, x, count, .. } => Some((*side, *x, *count)),
            _ => None,
        })
        .collect();
    // The cannons started at 1500 and moved one CANNON_STEP this tick.
    assert_eq!(
        volleys,
        vec![
            (0, 1500 - CANNON_STEP as i16, 4),
            (1, 1500 + CANNON_STEP as i16, 4)
        ]
    );
    let c = m.public.sides[0].cohorts()[0];
    assert_eq!((c.count, c.y, c.age, c.last_row), (VOLLEY_SIZE, 0, 0, 0));
}

#[test]
fn cohort_cap_skips_volleys() {
    // SPEC §6: at most COHORT_CAP live cohorts per side.
    let mut m = new_match();
    run_to(&mut m, PLANT_TICKS + 1);
    let n0 = m.public.sides[0].cohort_len;
    for i in n0 as usize..COHORT_CAP {
        place(&mut m, 0, cohort(1000 + i as u32, 1, 100, 0));
    }
    run_to(&mut m, PLANT_TICKS + FIRE_TICKS + 1);
    assert_eq!(usize::from(m.public.sides[0].cohort_len), COHORT_CAP);
    assert_eq!(m.public.sides[1].cohort_len, 2);
}

// --- cannon (SPEC §2) --------------------------------------------------------------------------

#[test]
fn cannon_steps_toward_the_aim_and_stops_on_it() {
    // SPEC §2: at most CANNON_STEP per tick, crossing the lane in ~5 ticks.
    let mut m = new_match();
    let mut xs = Vec::new();
    for _ in 0..4 {
        tick(&mut m, aims(0, 2999));
        xs.push((m.public.sides[0].cannon_x, m.public.sides[1].cannon_x));
    }
    assert_eq!(xs, vec![(900, 2100), (300, 2700), (0, 2999), (0, 2999)]);
    tick(&mut m, aims(250, 2999));
    assert_eq!(m.public.sides[0].cannon_x, 250);
}

#[test]
fn aim_is_clamped_to_the_lane() {
    let mut m = new_match();
    tick(&mut m, aims(-5000, 99_999));
    assert_eq!(m.public.sides[0].aim, 0);
    assert_eq!(m.public.sides[1].aim, (LANE_WIDTH - 1) as i16);
    // No input keeps the aim.
    idle(&mut m);
    assert_eq!(m.public.sides[1].aim, (LANE_WIDTH - 1) as i16);
}

// --- movement (SPEC §6) ------------------------------------------------------------------------

#[test]
fn launch_boost_then_cruise() {
    // SPEC §6: 3× cruise for LAUNCH_TICKS ticks, then cruise.
    let mut m = new_match();
    run_to(&mut m, PLANT_TICKS + 1);
    let id = m.public.sides[0].cohorts()[0].id;
    let mut ys = Vec::new();
    for _ in 0..8 {
        ys.push(find(&m, 0, id).unwrap().y);
        idle(&mut m);
    }
    // Fired at y = 0, then 6 boosted ticks of 300, then cruise at 100.
    assert_eq!(ys, vec![0, 300, 600, 900, 1200, 1500, 1800, 1900]);
}

// --- gates (SPEC §2, §4) -----------------------------------------------------------------------

#[test]
fn gate_spans_and_gaps() {
    // SPEC §2: gates are GATE_WIDTH (75%) of their column; the rest is a gap.
    assert_eq!(gate_at(0, 1500), Some(1));
    assert_eq!(gate_at(0, 125), Some(0));
    assert_eq!(gate_at(0, 875), Some(0));
    assert_eq!(gate_at(0, 124), None);
    assert_eq!(gate_at(0, 876), None);
    assert_eq!(gate_at(0, 1000), None);
    assert_eq!(gate_at(1, 2000), None);
    assert_eq!(gate_at(0, 2999), None);
    assert_eq!(gate_at(2, 2500), Some(8));
    assert_eq!(gate_at(1, 1125), Some(4));
    assert_eq!(gate_at(0, -50), None);
}

/// Side 0 fires one cohort at `x` (side 1 aims far away so nothing clashes); returns the
/// Gate events of that cohort.
fn one_cohort_through(m: &mut MatchState, x: i32) -> Vec<Event> {
    let away = if x < 1500 { 2999 } else { 0 };
    for _ in 0..PLANT_TICKS {
        tick(m, aims(x, away));
    }
    let mut ev = tick(m, aims(x, away));
    for _ in 0..40 {
        ev.extend(idle(m));
    }
    let id = 1; // the first cohort of the match
    ev.into_iter()
        .filter(|e| matches!(e, Event::Gate { cohort_id, side: 0, .. } if *cohort_id == id))
        .collect()
}

#[test]
fn each_row_applies_once_per_cohort() {
    // SPEC §4: three rows, each applied once (4 → 8 → 16 → 32 through three ×2).
    let mut m = new_match();
    set_deal(&mut m, [M2; CELLS], 0);
    let ev = one_cohort_through(&mut m, col_x(1));
    let got: Vec<_> = ev
        .iter()
        .map(|e| match e {
            Event::Gate {
                cell,
                before,
                after,
                ..
            } => (*cell, *before, *after),
            _ => unreachable!(),
        })
        .collect();
    assert_eq!(got, vec![(1, 4, 8), (4, 8, 16), (7, 16, 32)]);
}

#[test]
fn a_cohort_in_a_gap_passes_unchanged() {
    // SPEC §6: none if it's in a gap.
    let mut m = new_match();
    set_deal(&mut m, [M2; CELLS], 0);
    assert!(one_cohort_through(&mut m, COL_WIDTH).is_empty());
}

#[test]
fn ops_follow_the_spec_and_reveal_on_first_pass() {
    // SPEC §4: +6, −6, ÷2 in column 1: 4 → 10 → 4 → 2; the first cohort reveals for both.
    let mut m = new_match();
    let mut ops = [M2; CELLS];
    ops[1] = GateOp::Add(6);
    ops[4] = GateOp::Sub(6);
    ops[7] = GateOp::Div(2);
    set_deal(&mut m, ops, 0);
    let mut ev = Vec::new();
    for _ in 0..PLANT_TICKS + 30 {
        ev.extend(tick(&mut m, aims(col_x(1), col_x(0))));
    }
    let reveals: Vec<_> = ev
        .iter()
        .filter_map(|e| match e {
            Event::Reveal {
                side: 0,
                cell,
                op,
                gold,
            } => Some((*cell, *op, *gold)),
            _ => None,
        })
        .collect();
    assert_eq!(
        reveals,
        vec![
            (1, GateOp::Add(6), false),
            (4, GateOp::Sub(6), false),
            (7, GateOp::Div(2), false)
        ]
    );
    let first: Vec<_> = ev
        .iter()
        .filter_map(|e| match e {
            Event::Gate {
                side: 0,
                cohort_id: 1,
                after,
                ..
            } => Some(*after),
            _ => None,
        })
        .collect();
    assert_eq!(first, vec![10, 4, 2]);
    let g = m.public.sides[0].gates;
    assert_eq!(g[1].revealed, Some(GateOp::Add(6)));
    assert_eq!(g[7].revealed, Some(GateOp::Div(2)));
    assert_eq!(g[2].revealed, None);
    // Later cohorts get the same ops without new Reveal events.
    let reveals_now = ev
        .iter()
        .filter(|e| matches!(e, Event::Reveal { side: 0, .. }))
        .count();
    let later = run_to(&mut m, PLANT_TICKS + 120);
    assert!(later.iter().all(|(_, e)| !matches!(
        e,
        Event::Reveal {
            side: 0,
            cell: 1 | 4 | 7,
            ..
        }
    )));
    assert_eq!(reveals_now, 3);
}

#[test]
fn a_cohort_reduced_to_zero_dies_at_the_gate() {
    // SPEC §4: −n → max(0, c − n).
    let mut m = new_match();
    let mut ops = [M2; CELLS];
    ops[1] = GateOp::Sub(6);
    set_deal(&mut m, ops, 0);
    let ev = one_cohort_through(&mut m, col_x(1));
    assert_eq!(ev.len(), 1);
    assert!(find(&m, 0, 1).is_none());
}

#[test]
fn redeal_replaces_every_gate_face_down() {
    // SPEC §3/§4: revealed gates stay revealed until the next deal.
    let mut m = new_match();
    run_to(&mut m, PLANT_STARTS[1] - 1);
    assert!(m.public.sides[0].gates.iter().any(|g| g.revealed.is_some()));
    idle(&mut m);
    assert_eq!(m.secret.deal, Deal::new(1, 1));
    for s in &m.public.sides {
        assert!(s.gates.iter().all(|g| g.revealed.is_none()));
        assert_eq!(s.gates, face_down(&m.secret.deal));
    }
}

#[test]
fn gates_are_inactive_during_plant_windows() {
    // SPEC §3 (M1 rule): cohorts in flight during a plant pass the face-down deal unchanged.
    let mut m = new_match();
    let ev = run_to(&mut m, PLANT_STARTS[1] + PLANT_TICKS);
    assert!(ev.iter().any(|&(t, e)| t >= PLANT_STARTS[1] - 30
        && t < PLANT_STARTS[1]
        && matches!(e, Event::Gate { .. })));
    for &(t, e) in &ev {
        if in_plant(t) {
            assert!(
                !matches!(e, Event::Gate { .. } | Event::Reveal { .. }),
                "tick {t}: {e:?}"
            );
        }
    }
}

// --- hints (SPEC §4) ---------------------------------------------------------------------------

#[test]
fn hints_hidden_in_plant_and_shown_at_play_start() {
    // SPEC §3/§4: no hints during a plant window (gold always shows gold); hints at play start.
    let mut m = new_match();
    for t in 0..PLANT_STARTS[1] + PLANT_TICKS + 1 {
        let deal = m.secret.deal;
        for (s, side) in m.public.sides.iter().enumerate() {
            for (c, g) in side.gates.iter().enumerate() {
                let gold = c == usize::from(deal.gold_cell);
                let want = if gold {
                    Hint::Gold
                } else if in_plant(t) {
                    Hint::None
                } else {
                    deal.hints[s][c]
                };
                assert_eq!(g.hint, want, "tick {t} side {s} cell {c}");
                assert_eq!(g.gold, gold);
            }
        }
        idle(&mut m);
    }
}

// --- rig (SPEC §5) -----------------------------------------------------------------------------

fn rig(side: usize, cell: u8) -> Inputs {
    input(
        side,
        SideInput {
            rig: Some(cell),
            ..SideInput::default()
        },
    )
}

fn peek(side: usize, cell: u8) -> Inputs {
    input(
        side,
        SideInput {
            peek: Some(cell),
            ..SideInput::default()
        },
    )
}

#[test]
fn rig_only_in_plant_once_per_phase_never_gold() {
    // SPEC §5: one rig per phase, plant window only, any opponent cell except gold.
    let mut m = new_match();
    set_deal(&mut m, [M2; CELLS], 4);
    tick(&mut m, rig(0, 4)); // gold: ignored
    tick(&mut m, rig(0, 9)); // out of range: ignored
    tick(&mut m, rig(0, 200));
    assert!(!m.public.sides[0].rig_used);
    assert_eq!(m.private_view(0).rig, None);
    tick(&mut m, rig(0, 1));
    tick(&mut m, rig(0, 2)); // second rig: ignored
    assert!(m.public.sides[0].rig_used);
    assert_eq!(m.private_view(0).rig, Some(1));
    assert_eq!(m.private_view(1).rig, None);
    assert_eq!(m.secret.rigged_by(1, 1), Some(0));
    // During play: ignored.
    run_to(&mut m, PLANT_TICKS);
    tick(&mut m, rig(1, 3));
    assert!(!m.public.sides[1].rig_used);
    // Re-deal resets rigs.
    run_to(&mut m, PLANT_STARTS[1]);
    assert!(!m.public.sides[0].rig_used);
    assert_eq!(m.private_view(0).rig, None);
    tick(&mut m, rig(1, 0));
    assert_eq!(m.private_view(1).rig, Some(0));
}

#[test]
fn rigged_gate_shows_fake_blue_then_gotcha_halves() {
    // SPEC §4/§5: a rigged gate shows a fake blue; the first cohort through flashes GOTCHA and
    // the trap (÷2) fires, and stays the gate's value for the phase.
    let mut m = new_match();
    let mut ops = [M2; CELLS];
    ops[1] = GateOp::Sub(6); // a red gate, rigged into a "blue" trap
    set_deal(&mut m, ops, 8);
    tick(&mut m, rig(1, 1)); // side 1 rigs side 0's cell 1
    run_to(&mut m, PLANT_TICKS - 1);
    assert_eq!(m.public.sides[0].gates[1].hint, Hint::None);
    let mut ev = Vec::new();
    for _ in 0..40 {
        ev.extend(tick(&mut m, aims(col_x(1), col_x(0))));
    }
    assert_eq!(m.public.sides[0].gates[1].hint, Hint::Good);
    assert_eq!(m.public.sides[1].gates[1].hint, Hint::Bad);
    let first = ev
        .iter()
        .position(|e| matches!(e, Event::Gotcha { .. }))
        .unwrap();
    assert_eq!(
        ev[first],
        Event::Gotcha {
            side: 0,
            cell: 1,
            rigged_by: 1
        }
    );
    assert_eq!(
        ev[first + 1],
        Event::Reveal {
            side: 0,
            cell: 1,
            op: RIG_OP,
            gold: false
        }
    );
    assert!(matches!(
        ev[first + 2],
        Event::Gate {
            cell: 1,
            before: 4,
            after: 2,
            ..
        }
    ));
    assert_eq!(
        ev.iter()
            .filter(|e| matches!(e, Event::Gotcha { .. }))
            .count(),
        1
    );
    assert_eq!(m.public.sides[0].gates[1].revealed, Some(RIG_OP));
}

// --- peek (SPEC §5) ----------------------------------------------------------------------------

#[test]
fn peek_only_in_play_once_per_phase_on_my_unrevealed_cell() {
    // SPEC §5: privately see the true value of one unrevealed cell on your own side.
    let mut m = new_match();
    let mut ops = [M2; CELLS];
    ops[5] = GateOp::Add(10);
    set_deal(&mut m, ops, 8);
    tick(&mut m, peek(0, 5)); // plant: ignored
    assert!(!m.public.sides[0].peek_used);
    run_to(&mut m, PLANT_TICKS);
    tick(&mut m, peek(0, 9)); // out of range: ignored
    assert!(!m.public.sides[0].peek_used);
    tick(&mut m, peek(0, 5));
    let pv = m.private_view(0).peek.unwrap();
    assert_eq!((pv.cell, pv.op, pv.gold), (5, GateOp::Add(10), false));
    assert_eq!(m.private_view(1).peek, None);
    tick(&mut m, peek(0, 8)); // second peek: ignored
    assert_eq!(m.private_view(0).peek.unwrap().cell, 5);
    // Gold peeks show the real value; re-deal resets the peek.
    run_to(&mut m, PLANT_STARTS[1]);
    assert_eq!(m.private_view(0).peek, None);
    assert!(!m.public.sides[0].peek_used);
}

#[test]
fn peek_exposes_a_rig_and_refuses_revealed_cells() {
    // SPEC §5: a peek shows the true value now, so it also exposes a rig.
    let mut m = new_match();
    set_deal(&mut m, [M2; CELLS], 8);
    tick(&mut m, rig(1, 4));
    run_to(&mut m, PLANT_TICKS);
    // Side 0's first cohort at column 1 reveals cell 1 within ~6 ticks.
    for _ in 0..10 {
        tick(&mut m, aims(col_x(1), col_x(0)));
    }
    assert!(m.public.sides[0].gates[1].revealed.is_some());
    tick(&mut m, peek(0, 1)); // revealed: ignored
    assert!(!m.public.sides[0].peek_used);
    tick(&mut m, peek(0, 4));
    assert_eq!(m.private_view(0).peek.unwrap().op, RIG_OP);
}

// --- clash (SPEC §6) ---------------------------------------------------------------------------

/// A mid-play tick with no volley on it, and no other cohorts.
fn quiet_mid_match() -> MatchState {
    let mut m = new_match();
    m.public.tick = 101;
    m
}

#[test]
fn clash_subtracts_counts() {
    // SPEC §6: 120 blue vs 80 red leaves 40 blue.
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 120, 1500, 5950));
    place(&mut m, 1, cohort(2, 80, 1500, 5950));
    let ev = idle(&mut m);
    assert_eq!(find(&m, 0, 1).unwrap().count, 40);
    assert!(find(&m, 1, 2).is_none());
    assert!(ev.contains(&Event::Clash {
        x: 1500,
        y: 6000,
        killed: [80, 80]
    }));
}

#[test]
fn equal_cohorts_wipe_each_other_out() {
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 30, 1500, 5950));
    place(&mut m, 1, cohort(2, 30, 1500, 5950));
    idle(&mut m);
    assert_eq!(m.public.sides[0].cohort_len, 0);
    assert_eq!(m.public.sides[1].cohort_len, 0);
}

#[test]
fn streams_a_column_apart_pass_each_other() {
    // SPEC §6 (M1 rule): they meet only within CLASH_REACH in x.
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 10, 500, 5950));
    place(&mut m, 1, cohort(2, 10, 1500, 5950));
    place(&mut m, 0, cohort(3, 10, 1000, 5000));
    place(&mut m, 1, cohort(4, 10, 1501, 6900));
    idle(&mut m);
    assert_eq!(find(&m, 0, 1).unwrap().count, 10);
    assert_eq!(find(&m, 1, 2).unwrap().count, 10);
    assert_eq!(find(&m, 0, 3).unwrap().count, 10);
    assert_eq!(find(&m, 1, 4).unwrap().count, 10);
    // Exactly CLASH_REACH apart do meet.
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 10, 1000, 5950));
    place(&mut m, 1, cohort(2, 4, 1500, 5950));
    idle(&mut m);
    assert_eq!(find(&m, 0, 1).unwrap().count, 6);
}

#[test]
fn a_big_cohort_grinds_through_several() {
    // Front-most pairs first; the survivor carries on into the next.
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 50, 1500, 6500));
    place(&mut m, 1, cohort(2, 10, 1500, 5600));
    place(&mut m, 1, cohort(3, 15, 1500, 5500));
    place(&mut m, 1, cohort(4, 20, 1500, 1000)); // not met yet
    idle(&mut m);
    assert_eq!(find(&m, 0, 1).unwrap().count, 25);
    assert_eq!(find(&m, 1, 4).unwrap().count, 20);
    assert_eq!(m.public.sides[1].cohort_len, 1);
}

#[test]
fn clashes_happen_wherever_cohorts_meet() {
    // A fresh volley can block an enemy cohort right at its own cannon (defending).
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 4, 1500, 300));
    place(&mut m, 1, cohort(2, 10, 1500, 11_650));
    idle(&mut m);
    assert!(find(&m, 0, 1).is_none());
    assert_eq!(find(&m, 1, 2).unwrap().count, 6);
    assert_eq!(m.public.sides[0].hp, HP_MAX);
}

// --- hits, KO, timer, payout (SPEC §6, §7) ----------------------------------------------------

#[test]
fn a_cohort_at_the_enemy_cannon_deals_its_count() {
    // SPEC §6: damage equal to its count, then removed.
    let mut m = quiet_mid_match();
    place(&mut m, 0, cohort(1, 50, 2500, 11_950));
    let ev = idle(&mut m);
    assert_eq!(m.public.sides[1].hp, HP_MAX - 50);
    assert!(find(&m, 0, 1).is_none());
    assert!(ev.contains(&Event::Hit {
        side: 1,
        damage: 50,
        hp: HP_MAX - 50
    }));
}

#[test]
fn ko_ends_the_match_instantly() {
    // SPEC §7: KO (HP 0) ends the match instantly; the full level moves.
    let mut m = quiet_mid_match();
    m.public.options.stake = 1_000_000;
    m.public.sides[1].hp = 30;
    place(&mut m, 0, cohort(1, 50, 2500, 11_950));
    let ev = idle(&mut m);
    let r = m.public.result.unwrap();
    assert_eq!(
        (r.winner, r.ko, r.moved, r.fee),
        (Some(0), true, 1_000_000, 50_000)
    );
    assert_eq!(m.public.sides[1].hp, 0);
    assert_eq!(m.public.tick, 102);
    assert_eq!(ev.last(), Some(&Event::End { result: r }));
    assert!(!ev.iter().any(|e| matches!(e, Event::Volley { .. })));
}

#[test]
fn double_ko_on_one_tick_is_a_draw() {
    let mut m = quiet_mid_match();
    m.public.sides[0].hp = 10;
    m.public.sides[1].hp = 10;
    place(&mut m, 0, cohort(1, 50, 500, 11_950));
    place(&mut m, 1, cohort(2, 50, 2500, 11_950));
    idle(&mut m);
    let r = m.public.result.unwrap();
    assert_eq!((r.winner, r.ko, r.moved), (None, true, 0));
}

#[test]
fn timer_win_pays_by_margin_and_equal_hp_draws() {
    // SPEC §7: 60% vs 40% of HP at the timer moves 60% of S.
    let mut m = new_match();
    m.public.options.stake = 10_000_000;
    m.public.tick = MATCH_TICKS - 1;
    m.public.sides[0].hp = 1320;
    m.public.sides[1].hp = 880;
    idle(&mut m);
    let r = m.public.result.unwrap();
    assert_eq!(
        (r.winner, r.ko, r.moved, r.fee),
        (Some(0), false, 6_000_000, 300_000)
    );

    let mut m = new_match();
    m.public.options.stake = 10_000_000;
    m.public.tick = MATCH_TICKS - 1;
    m.public.sides[0].hp = 1320;
    m.public.sides[1].hp = 1320;
    idle(&mut m);
    assert_eq!(m.public.result.unwrap().winner, None);
}
