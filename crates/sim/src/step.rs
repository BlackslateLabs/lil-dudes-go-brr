//! One tick of the match (SPEC v2.1). For tick `t = public.tick`:
//!
//! 1. inputs: rig (plant window only), peek (play only), aim (always)    SPEC §2, §5
//! 2. cannons step toward their aim                                       SPEC §2
//! 3. cohorts move (launch boost) and cross gate rows                     SPEC §4, §6
//! 4. clash: opposing cohorts that have met subtract                      SPEC §6
//! 5. hits: cohorts at the enemy cannon deal damage                       SPEC §6
//! 6. KO ends the match at once                                           SPEC §7
//! 7. fire: one volley per side on the cadence (plant windows hold fire)  SPEC §3, §6
//! 8. `tick + 1`; the timer ends the match, otherwise enter the new tick:
//!    re-deal + plant, play start (hints appear), Surge                   SPEC §3, §4

use crate::constants::{
    CANNON_STEP, CELLS, CLASH_REACH, COHORT_CAP, COLS, COL_WIDTH, CRUISE_SPEED, FIRE_TICKS,
    FIRE_TICKS_SURGE, GATE_WIDTH, LANE_LENGTH, LANE_WIDTH, LAUNCH_SPEED, LAUNCH_TICKS, MATCH_TICKS,
    ROW_Y, SURGE_TICK, VOLLEY_SIZE,
};
use crate::deal::Deal;
use crate::events::{Event, EventSink};
use crate::payout::payout;
use crate::state::{
    face_down, other, phase_at, phase_start, play_start, Inputs, MatchState, Peek, PublicGate,
    PublicSide, PublicState, SecretState,
};
use crate::types::{Cohort, Hint, Status};

/// Advance the match by one tick. A no-op once the match has ended.
pub fn step(m: &mut MatchState, inputs: &Inputs, ev: &mut impl EventSink) {
    if m.public.result.is_some() {
        return;
    }
    let t = m.public.tick;
    if t == 0 {
        // SPEC §3: the match opens with plant 1 (the deal was made face-down at creation).
        ev.push(Event::Plant { phase: 0 });
    }
    let status = m.public.status();

    apply_inputs(m, inputs, status);
    move_cannons(&mut m.public);
    move_cohorts(m, status, ev);
    clash(&mut m.public, ev);
    hits(&mut m.public, ev);
    compact(&mut m.public);

    let next = t.saturating_add(1);
    if m.public.sides.iter().any(|s| s.hp == 0) {
        // SPEC §7: KO ends the match instantly.
        m.public.tick = next;
        finish(m, ev);
        return;
    }
    if status == Status::Playing {
        fire(&mut m.public, t, ev);
    }
    m.public.tick = next;
    if next >= MATCH_TICKS {
        // SPEC §7: at the timer, higher HP wins.
        finish(m, ev);
        return;
    }
    enter_tick(m, next, ev);
}

// --- 1. inputs ---------------------------------------------------------------------------------

fn apply_inputs(m: &mut MatchState, inputs: &Inputs, status: Status) {
    for (s, input) in (0u8..).zip(inputs.sides.iter()) {
        if let (Some(aim), Some(side)) = (input.aim, m.public.sides.get_mut(usize::from(s))) {
            // SPEC §2: the aim is any lane x; the cannon chases it.
            side.aim = aim.clamp(0, LANE_WIDTH.saturating_sub(1)) as i16;
        }
        if let (Some(cell), Status::Plant) = (input.rig, status) {
            try_rig(m, s, cell);
        }
        if let (Some(cell), Status::Playing) = (input.peek, status) {
            try_peek(m, s, cell);
        }
    }
}

/// SPEC §5: once per phase, during the plant window, any opponent cell except the gold gate.
/// Invalid requests are ignored and do not use the rig.
fn try_rig(m: &mut MatchState, s: u8, cell: u8) {
    if usize::from(cell) >= CELLS || m.secret.deal.is_gold(cell) {
        return;
    }
    let target_unrevealed = m
        .public
        .side(other(s))
        .and_then(|o| o.gate(cell))
        .is_some_and(|g| g.revealed.is_none());
    let (Some(me), Some(rig)) = (
        m.public.sides.get_mut(usize::from(s)),
        m.secret.rigs.get_mut(usize::from(s)),
    ) else {
        return;
    };
    if me.rig_used || !target_unrevealed {
        return;
    }
    me.rig_used = true;
    *rig = Some(cell);
}

/// SPEC §5: once per phase, during play, one of my own unrevealed cells. The result is the
/// gate's true value now, so it also exposes a rig (rigs are fixed once play starts).
fn try_peek(m: &mut MatchState, s: u8, cell: u8) {
    let op = m.secret.true_op(s, cell);
    let (Some(me), Some(peek)) = (
        m.public.sides.get_mut(usize::from(s)),
        m.secret.peeks.get_mut(usize::from(s)),
    ) else {
        return;
    };
    let Some(gate) = me.gates.get(usize::from(cell)) else {
        return;
    };
    if me.peek_used || gate.revealed.is_some() {
        return;
    }
    me.peek_used = true;
    *peek = Some(Peek {
        cell,
        op,
        gold: gate.gold,
    });
}

// --- 2. cannons --------------------------------------------------------------------------------

/// SPEC §2: the cannon moves toward the aim by at most CANNON_STEP per tick (and stops on it).
fn move_cannons(p: &mut PublicState) {
    for side in p.sides.iter_mut() {
        let gap = i32::from(side.aim).saturating_sub(i32::from(side.cannon_x));
        let stride = gap.clamp(CANNON_STEP.saturating_neg(), CANNON_STEP);
        side.cannon_x = i32::from(side.cannon_x).saturating_add(stride) as i16;
    }
}

// --- 3. movement and gates ---------------------------------------------------------------------

fn move_cohorts(m: &mut MatchState, status: Status, ev: &mut impl EventSink) {
    let MatchState { public, secret } = m;
    for (s, side) in (0u8..).zip(public.sides.iter_mut()) {
        let PublicSide {
            cohorts,
            cohort_len,
            gates,
            ..
        } = side;
        for c in cohorts.iter_mut().take(usize::from(*cohort_len)) {
            if c.count == 0 {
                continue;
            }
            // SPEC §6: 3× cruise speed for the first LAUNCH_TICKS ticks.
            let speed = if u32::from(c.age) < LAUNCH_TICKS {
                LAUNCH_SPEED
            } else {
                CRUISE_SPEED
            };
            c.y = c.y.saturating_add(speed as i16);
            c.age = c.age.saturating_add(1);

            // SPEC §4: rows apply in order, once per cohort (`last_row` remembers).
            while let Some(&row_y) = ROW_Y.get(usize::from(c.last_row)) {
                if i32::from(c.y) < row_y {
                    break;
                }
                let row = c.last_row;
                c.last_row = c.last_row.saturating_add(1);
                if status == Status::Plant {
                    // SPEC §3: during a plant window the board is face-down and inactive, so
                    // cohorts still in flight pass the fresh deal unchanged.
                    continue;
                }
                if let Some(cell) = gate_at(row, c.x) {
                    pass_gate(s, cell, c, gates, secret, ev);
                }
                if c.count == 0 {
                    break;
                }
            }
        }
    }
}

/// SPEC §2/§6: the gate whose span contains `x` in `row`, or `None` in a gap. Each gate is
/// GATE_WIDTH wide, centred in its column.
pub fn gate_at(row: u8, x: i16) -> Option<u8> {
    let x = i32::from(x).clamp(0, LANE_WIDTH.saturating_sub(1));
    let col = x
        .checked_div(COL_WIDTH)
        .unwrap_or(0)
        .min((COLS as i32).saturating_sub(1));
    let centre = col.saturating_mul(COL_WIDTH).saturating_add(COL_WIDTH / 2);
    if x.abs_diff(centre).saturating_mul(2) > GATE_WIDTH as u32 {
        return None;
    }
    let cell = i32::from(row)
        .saturating_mul(COLS as i32)
        .saturating_add(col);
    u8::try_from(cell).ok().filter(|&c| usize::from(c) < CELLS)
}

/// SPEC §4/§5: the first cohort through reveals the gate (and springs a rig: GOTCHA); every
/// cohort through gets the gate's op.
fn pass_gate(
    s: u8,
    cell: u8,
    c: &mut Cohort,
    gates: &mut [PublicGate; CELLS],
    secret: &SecretState,
    ev: &mut impl EventSink,
) {
    let Some(gate) = gates.get_mut(usize::from(cell)) else {
        return;
    };
    let op = secret.true_op(s, cell);
    if gate.revealed.is_none() {
        if let Some(rigged_by) = secret.rigged_by(s, cell) {
            ev.push(Event::Gotcha {
                side: s,
                cell,
                rigged_by,
            });
        }
        gate.revealed = Some(op);
        ev.push(Event::Reveal {
            side: s,
            cell,
            op,
            gold: gate.gold,
        });
    }
    let before = c.count;
    c.count = op.apply(before);
    ev.push(Event::Gate {
        side: s,
        cell,
        cohort_id: c.id,
        before,
        after: c.count,
    });
}

// --- 4. clash ----------------------------------------------------------------------------------

/// SPEC §6: opposing cohorts that meet subtract counts (120 vs 80 leaves 40 vs 0). They meet
/// once they have reached each other along the lane (`y0 + y1 >= LANE_LENGTH`, so nothing can
/// tunnel through) and their x differ by at most CLASH_REACH. This applies wherever they meet;
/// with both cannons firing it is normally the clash zone. Pairs are resolved front-most first
/// on both sides (cohorts are stored oldest = front-most first).
fn clash(p: &mut PublicState, ev: &mut impl EventSink) {
    let [s0, s1] = &mut p.sides;
    let b_side = s1.cohorts_mut();
    for a in s0.cohorts_mut().iter_mut() {
        for b in b_side.iter_mut() {
            if a.count == 0 {
                break;
            }
            if b.count == 0 {
                continue;
            }
            if i32::from(a.y).saturating_add(i32::from(b.y)) < LANE_LENGTH {
                // b is the front-most remaining; everything behind it is further back too.
                break;
            }
            if i32::from(a.x).abs_diff(i32::from(b.x)) > CLASH_REACH as u32 {
                continue;
            }
            let killed = a.count.min(b.count);
            a.count = a.count.saturating_sub(killed);
            b.count = b.count.saturating_sub(killed);
            let x = i32::from(a.x).saturating_add(i32::from(b.x)) / 2;
            let b_y = LANE_LENGTH.saturating_sub(i32::from(b.y));
            let y = i32::from(a.y).saturating_add(b_y) / 2;
            ev.push(Event::Clash {
                x: x as i16,
                y: y.clamp(0, LANE_LENGTH) as i16,
                killed: [killed, killed],
            });
        }
    }
}

// --- 5. hits -----------------------------------------------------------------------------------

/// SPEC §6: a cohort reaching the enemy cannon deals damage equal to its count and is removed.
fn hits(p: &mut PublicState, ev: &mut impl EventSink) {
    let [s0, s1] = &mut p.sides;
    hit_cannon(s0, s1, 1, ev);
    hit_cannon(s1, s0, 0, ev);
}

fn hit_cannon(
    attacker: &mut PublicSide,
    victim: &mut PublicSide,
    victim_side: u8,
    ev: &mut impl EventSink,
) {
    for c in attacker.cohorts_mut().iter_mut() {
        if c.count == 0 || i32::from(c.y) < LANE_LENGTH {
            continue;
        }
        victim.hp = victim.hp.saturating_sub(c.count);
        ev.push(Event::Hit {
            side: victim_side,
            damage: c.count,
            hp: victim.hp,
        });
        c.count = 0;
    }
}

/// Drop dead cohorts, keep the order (oldest first), zero the free slots.
fn compact(p: &mut PublicState) {
    for side in p.sides.iter_mut() {
        let len = usize::from(side.cohort_len);
        let mut kept = 0usize;
        for i in 0..len {
            let Some(c) = side.cohorts.get(i).copied() else {
                break;
            };
            if c.count == 0 {
                continue;
            }
            if let Some(slot) = side.cohorts.get_mut(kept) {
                *slot = c;
            }
            kept = kept.saturating_add(1);
        }
        for slot in side.cohorts.iter_mut().skip(kept) {
            *slot = Cohort::default();
        }
        side.cohort_len = kept as u8;
    }
}

// --- 7. fire -----------------------------------------------------------------------------------

/// SPEC §3/§6: a volley of VOLLEY_SIZE every FIRE_TICKS (FIRE_TICKS_SURGE in Surge), starting
/// on the first tick of play, at the cannon's current x. At COHORT_CAP live cohorts the volley
/// is skipped.
fn fire(p: &mut PublicState, t: u32, ev: &mut impl EventSink) {
    let every = if t >= SURGE_TICK {
        FIRE_TICKS_SURGE
    } else {
        FIRE_TICKS
    };
    let since = t.saturating_sub(play_start(phase_at(t)));
    if since.checked_rem(every) != Some(0) {
        return;
    }
    let PublicState {
        sides,
        next_cohort_id,
        ..
    } = p;
    for (s, side) in (0u8..).zip(sides.iter_mut()) {
        let len = usize::from(side.cohort_len);
        if len >= COHORT_CAP {
            continue;
        }
        let Some(slot) = side.cohorts.get_mut(len) else {
            continue;
        };
        let id = *next_cohort_id;
        *slot = Cohort {
            id,
            count: VOLLEY_SIZE,
            x: side.cannon_x,
            y: 0,
            age: 0,
            last_row: 0,
        };
        side.cohort_len = side.cohort_len.saturating_add(1);
        *next_cohort_id = id.saturating_add(1);
        ev.push(Event::Volley {
            side: s,
            cohort_id: id,
            x: side.cannon_x,
            count: VOLLEY_SIZE,
        });
    }
}

// --- 8. timeline -------------------------------------------------------------------------------

fn enter_tick(m: &mut MatchState, tick: u32, ev: &mut impl EventSink) {
    let phase = phase_at(tick);
    if phase > 0 && tick == phase_start(phase) {
        // SPEC §3: re-deal all 18 gates, new plant, new rig and peek. Unused ones are lost.
        redeal(m, phase);
        ev.push(Event::Redeal { phase });
        ev.push(Event::Plant { phase });
    }
    if tick == play_start(phase) {
        show_hints(m);
    }
    if tick == SURGE_TICK {
        ev.push(Event::Surge);
    }
}

fn redeal(m: &mut MatchState, phase: u8) {
    let deal = Deal::new(m.secret.seed, phase);
    for side in m.public.sides.iter_mut() {
        side.gates = face_down(&deal);
        side.rig_used = false;
        side.peek_used = false;
    }
    m.secret.deal = deal;
    m.secret.rigs = [None; 2];
    m.secret.peeks = [None; 2];
}

/// SPEC §4: when play starts, every gate shows its hint (true colour or grey); gold shows gold;
/// a rigged gate shows a fake blue. Hints are written only now, after rigs are locked, so the
/// public state never shows a hint change that would give a rig away.
fn show_hints(m: &mut MatchState) {
    let MatchState { public, secret } = m;
    for ((s, side), hints) in (0u8..)
        .zip(public.sides.iter_mut())
        .zip(secret.deal.hints.iter())
    {
        for ((cell, gate), &hint) in (0u8..).zip(side.gates.iter_mut()).zip(hints.iter()) {
            gate.hint = if gate.gold {
                Hint::Gold
            } else if secret.rigged_by(s, cell).is_some() {
                Hint::Good
            } else {
                hint
            };
        }
    }
}

fn finish(m: &mut MatchState, ev: &mut impl EventSink) {
    let [a, b] = &m.public.sides;
    let result = payout(m.public.options.stake, [a.hp, b.hp]);
    m.public.result = Some(result);
    ev.push(Event::End { result });
}

#[cfg(test)]
mod tests;
