//! One tick of the match (SPEC v4 + SPEC_V5). For tick `t = public.tick`:
//!
//! 1. inputs: aim and trigger (always), Scout (my Fight/Rush), Champion
//!    (my Fight; also on letting go of the trigger with a full meter)      SPEC §2, §6, V5 §4
//! 2. per lane (side 0, then side 1), each at its own stage and phase:    SPEC §3
//!    - the cannon steps toward its aim                                   SPEC §2
//!    - moving gates slide (timed from the Fight start; the Rush keeps
//!      the Fight's clock, as does the timing gate)                       SPEC §6, V5 §3
//!    - Fight/Rush only: cohorts move (launch boost; speed pads renew
//!      it), slide around obstacles, hit crates, cross gate rows, drop
//!      into pipes, and home in past the last row; enemy cohorts (giants
//!      slower) walk straight down, sliding around obstacles; divider
//!      walls keep both in their column while they stand; clash (never
//!      through a wall); tower hits, gold, Rush loot, losses at the base
//!      edge; death; all towers down (the breach, its tick recorded) →
//!      Transit (Fight 1) or the Rush in place (Fight 2); waves; a volley
//!      while the trigger is held (it charges the Champion meter) or a
//!      called Champion                                                   SPEC §4–§7, V5 §2–§5, §12, §13
//!    - the phase timer: Plant → Fight, Transit → Plant, Rush over →
//!      Done (whatever is left on the lane is cleared, uncounted)         SPEC §3, V5 §2
//! 3. FIRST for a fight first cleared this tick                           V5 §6
//! 4. `tick + 1`; a death, both players done or the time cap ends it      SPEC §3, §8

use crate::constants::{
    CANNON_STEP, CHAMP_COUNT, CHAMP_TICKS, CLASH_BAND, CLASH_REACH, COHORT_CAP, CRUISE_SPEED,
    DETECT_Y, ENEMY_CAP, FATIGUE_END, FATIGUE_MIN_PM, FATIGUE_START, FINAL_STAGE, FIRE_TICKS,
    FIRST_BONUS, FIRST_WAVE_TICKS, GIANT_COUNT, GIANT_SPEED, HALL_X, LANE_LENGTH, LANE_WIDTH,
    LAUNCH_SPEED, LAUNCH_TICKS, LOOT_PER_UNIT, MATCH_TICKS, PLANT_TICKS, RUSH_TICKS, STAGES,
    STEER_STEP, TOWERS_MAX, TOWER_BONUS, TOWER_HALF_W, TOWER_Y, TRANSIT_TICKS, TUTORIAL_WAVE_PCT,
    VAULT_Y, VOLLEY_SIZE, WAVE_GAPS, WAVE_PCT,
};
use crate::events::{Event, EventSink};
use crate::layouts::{self, covers, timing_value, Slot, StageDef};
use crate::payout::payout;
use crate::state::{
    Inputs, MatchState, Peek, PublicGate, PublicSide, PublicState, SecretState, SideInput,
};
use crate::types::{Cohort, Enemy, GateOp, Phase};

/// Advance the match by one tick. A no-op once the match has ended.
pub fn step(m: &mut MatchState, inputs: &Inputs, ev: &mut impl EventSink) {
    if m.public.result.is_some() {
        return;
    }
    let t = m.public.tick;
    if t == 0 {
        // SPEC §3: the match opens with both players in the Plant of Fight 1.
        for (s, side) in (0u8..).zip(m.public.sides.iter()) {
            ev.push(Event::Phase {
                side: s,
                stage: side.stage,
                phase: side.phase,
            });
        }
    }
    for (s, input) in (0u8..).zip(inputs.sides.iter()) {
        apply_side(m, s, input);
    }
    for s in 0..2u8 {
        lane_tick(m, s, t, ev);
    }
    award_first(&mut m.public, t, ev);
    let next = t.saturating_add(1);
    m.public.tick = next;
    let [a, b] = &m.public.sides;
    // SPEC §3: a death ends the match at once; otherwise both done, or the time cap.
    if a.dead || b.dead || (a.finished() && b.finished()) || next >= MATCH_TICKS {
        finish(m, ev);
    }
}

// --- 1. inputs ---------------------------------------------------------------------------------

/// Applies one side's input between ticks, exactly as if it were passed to the next `step`
/// (on-chain, player instructions call this after catching the sim up). Ignored once ended.
pub fn apply_input(m: &mut MatchState, side: u8, input: &SideInput) {
    if m.public.result.is_none() {
        apply_side(m, side, input);
    }
}

fn apply_side(m: &mut MatchState, s: u8, input: &SideInput) {
    if let (Some(aim), Some(side)) = (input.aim, m.public.sides.get_mut(usize::from(s))) {
        // SPEC §2: the aim is any lane x; the cannon chases it.
        side.aim = aim.clamp(0, LANE_WIDTH.saturating_sub(1)) as i16;
    }
    if let Some(slot) = input.peek {
        try_peek(m, s, slot);
    }
    if let Some(on) = input.fire {
        let was = m.public.side(s).is_some_and(|me| me.firing);
        if let Some(me) = m.public.sides.get_mut(usize::from(s)) {
            me.firing = on;
        }
        // SPEC_V5 §4: letting go of the trigger releases a charged Champion.
        if was && !on {
            try_champion(m, s);
        }
    }
    if input.champion {
        try_champion(m, s);
    }
}

/// SPEC_V5 §4: during my Fight with a full meter, the next volley is a Champion. The meter
/// empties at once and refills. Refused (nothing spent) otherwise.
fn try_champion(m: &mut MatchState, s: u8) {
    let Some(me) = m.public.sides.get_mut(usize::from(s)) else {
        return;
    };
    if me.phase != Phase::Fight || me.dead || me.champ_pending {
        return;
    }
    if u32::from(me.champ_meter) < CHAMP_TICKS {
        return;
    }
    me.champ_meter = 0;
    me.champ_pending = true;
}

/// SPEC §6 Peek (SPEC_V5 §4 Scout): during my Fight or Raid, once per stage, one unrevealed gate
/// of my current stage. The result is its true value. Refused, and not used up, on a revealed or
/// missing gate.
fn try_peek(m: &mut MatchState, s: u8, slot: u8) {
    let MatchState { public, secret } = m;
    let layout = public.layout;
    let Some(me) = public.sides.get_mut(usize::from(s)) else {
        return;
    };
    let open = me.gate(slot).is_some_and(|g| g.revealed.is_none());
    // A hidden gate of my stage (the timing gate is public: nothing to scout).
    let exists = layouts::stage(layout, me.stage)
        .gates
        .get(usize::from(slot))
        .is_some_and(|d| d.slot != Slot::Timing);
    if !me.phase.active() || me.peek_used || me.dead || !open || !exists {
        return;
    }
    let op = secret.true_op(me.stage, slot);
    let Some(peek) = secret
        .history
        .get_mut(usize::from(me.stage))
        .and_then(|log| log.peeks.get_mut(usize::from(s)))
    else {
        return;
    };
    *peek = Some(Peek { slot, op });
    me.peek_used = true;
}

// --- 2. one lane -------------------------------------------------------------------------------

fn lane_tick(m: &mut MatchState, s: u8, tick: u32, ev: &mut impl EventSink) {
    let MatchState { public, secret } = m;
    let PublicState {
        sides,
        next_cohort_id,
        layout,
        options,
        ..
    } = public;
    let layout = *layout;
    let Some(side) = sides.get_mut(usize::from(s)) else {
        return;
    };
    if side.dead {
        return;
    }
    move_cannon(side);
    if side.phase == Phase::Done {
        return;
    }
    let st = layouts::stage(layout, side.stage);
    let t = u32::from(side.phase_ticks);
    let active = side.phase.active();
    // SPEC §6: moving gates are timed from the Fight start (the Rush keeps counting the Fight's
    // ticks, so they slide on smoothly); before it they wait at x.
    let gate_t = if active { t } else { 0 };
    for (g, def) in side.gates.iter_mut().zip(st.gates) {
        g.x = def.x_at(gate_t);
    }
    if active {
        move_cohorts(side, st, secret, gate_t, s, ev);
        move_enemies(side, st);
        clash(side, st, s, ev);
        hits(side, st, s, ev);
        compact(side);
        if side.enemies().iter().any(|e| e.y <= 0) {
            // SPEC §4: an enemy reached the cannon line.
            side.dead = true;
            ev.push(Event::Death { side: s });
            return;
        }
        if side.phase == Phase::Fight && side.towers.iter().all(|&hp| hp == 0) {
            // SPEC_V5 §6: the breach tick of this fight, for FIRST (ticks of a Fight are ≥
            // PLANT_TICKS, so 0 stays "not yet").
            if let Some(b) = side.breach_tick.get_mut(usize::from(side.stage)) {
                *b = u16::try_from(tick).unwrap_or(u16::MAX);
            }
            if side.stage < FINAL_STAGE {
                start_transit(side, layout, s, ev);
                return;
            }
            start_rush(side, s, ev);
        }
        if side.phase == Phase::Fight {
            let pct = if options.tutorial && s == 0 && side.stage == 0 {
                TUTORIAL_WAVE_PCT
            } else {
                100
            };
            release_waves(side, st, t, pct, next_cohort_id, s, ev);
        }
        // SPEC_V5 §2: the cannon fires on the volley beat while the trigger is held; a called
        // Champion goes out on the very next tick, held or not.
        let open = side.phase == Phase::Fight || u32::from(side.rush_ticks) < RUSH_TICKS;
        let beat = side.firing && t.checked_rem(FIRE_TICKS) == Some(0);
        if open && (beat || side.champ_pending) {
            fire(side, next_cohort_id, s, ev);
        }
    }
    advance(side, s, ev);
}

/// SPEC §2: the cannon moves toward the aim by at most CANNON_STEP per tick (and stops on it).
fn move_cannon(side: &mut PublicSide) {
    side.cannon_x = toward(side.cannon_x, side.aim, CANNON_STEP);
}

/// `x` moved toward `target` by at most `step`, kept on the lane.
fn toward(x: i16, target: i16, step: i32) -> i16 {
    let gap = i32::from(target).saturating_sub(i32::from(x));
    let stride = gap.clamp(step.saturating_neg(), step);
    i32::from(x)
        .saturating_add(stride)
        .clamp(0, LANE_WIDTH.saturating_sub(1)) as i16
}

// --- cohorts: movement, crates, gates, homing --------------------------------------------------

fn move_cohorts(
    side: &mut PublicSide,
    st: &StageDef,
    secret: &SecretState,
    gate_t: u32,
    s: u8,
    ev: &mut impl EventSink,
) {
    let PublicSide {
        stage,
        phase,
        cohorts,
        cohort_len,
        gates,
        crates,
        towers,
        enemies,
        enemy_len,
        ..
    } = side;
    let stage = *stage;
    let rush = *phase == Phase::Rush;
    let enemies = enemies.get(..usize::from(*enemy_len)).unwrap_or(&[]);
    let band = st.obstacle_band();
    for c in cohorts.iter_mut().take(usize::from(*cohort_len)) {
        if c.count == 0 {
            continue;
        }
        // SPEC §7: 3× cruise speed for the first LAUNCH_TICKS ticks (a speed pad or a pipe
        // starts the count again, SPEC_V5 §13).
        let speed = if u32::from(c.age) < LAUNCH_TICKS {
            LAUNCH_SPEED
        } else {
            CRUISE_SPEED
        };
        let prev_y = i32::from(c.y);
        // SPEC_V5 §13: an obstacle in the way → no y this tick, a slide instead.
        let (x, y) = travel(st, band, i32::from(c.x), prev_y, speed);
        c.y = y.min(i32::from(i16::MAX)) as i16;
        c.age = c.age.saturating_add(1);
        // SPEC_V5 §12 (b): entering a wall's span inside its thickness pushes it out.
        c.x = st.wall_push(x, y) as i16;
        // SPEC_V5 §13: a speed pad under the cohort renews its launch boost.
        if st.on_pad(i32::from(c.x), y) {
            c.age = 0;
        }

        // SPEC §4: a crate absorbs what crosses its row inside its span (edges count, as for
        // gates), until it breaks.
        for (ci, (hp, def)) in (0u8..).zip(crates.iter_mut().zip(st.crates)) {
            let cy = i32::from(def.y);
            let inside = covers(i32::from(c.x), i32::from(def.x), def.width);
            if *hp == 0 || c.count == 0 || prev_y >= cy || y < cy || !inside {
                continue;
            }
            let absorbed = c.count.min(u32::from(*hp));
            *hp = u16::try_from(u32::from(*hp).saturating_sub(absorbed)).unwrap_or(0);
            c.count = c.count.saturating_sub(absorbed);
            ev.push(Event::CrateHit {
                side: s,
                crate_ix: ci,
                cohort_id: c.id,
                absorbed,
                hp: u32::from(*hp),
            });
            if *hp == 0 {
                ev.push(Event::CrateBroken {
                    side: s,
                    crate_ix: ci,
                });
            }
        }

        // SPEC §6: rows apply in order, once per cohort (`last_row` remembers).
        while let Some(&row_y) = st.rows.get(usize::from(c.last_row)) {
            if c.count == 0 || y < i32::from(row_y) {
                break;
            }
            let row = c.last_row;
            c.last_row = c.last_row.saturating_add(1);
            if let Some(slot) = gate_at(st, gates, row, c.x) {
                if let Some(gate) = gates.get_mut(usize::from(slot)) {
                    let timing = st
                        .gates
                        .get(usize::from(slot))
                        .is_some_and(|d| d.slot == Slot::Timing);
                    let op = if timing {
                        // SPEC_V5 §3: the timing gate's value on the crossing tick (public).
                        GateOp::Mul(timing_value(gate_t))
                    } else {
                        secret.true_op(stage, slot)
                    };
                    pass_gate(s, slot, c, gate, op, !timing, ev);
                }
            }
        }

        // SPEC_V5 §13: a pipe's entrance → out at its exit with a fresh launch boost, past
        // every row up to there. Nothing else happens to it this tick.
        if let Some((pipe_ix, p)) = st.pipe_at(i32::from(c.x), y).filter(|_| c.count > 0) {
            c.x = p.out_x;
            c.y = p.out_y;
            c.age = 0;
            c.last_row = c.last_row.max(st.rows_through(i32::from(p.out_y)));
            ev.push(Event::Pipe {
                side: s,
                cohort_id: c.id,
                pipe_ix,
            });
            continue;
        }

        // SPEC §4: past the last row, home in on the nearest enemy ahead, else the nearest tower
        // (in the Rush: the town hall's centre). SPEC_V5 §13: not on a tick it slid round an
        // obstacle (the slide is its move), and never into an obstacle.
        let slid = y == prev_y;
        if usize::from(c.last_row) >= st.rows.len() && c.count > 0 && !slid {
            if let Some(tx) = cohort_target(c, enemies, towers, st, rush) {
                let to = steer(st, c.x, tx, y);
                if !near(band, y, y) || st.blocked(i32::from(to), y).is_none() {
                    c.x = to;
                }
            }
        }
    }
}

/// The move from `y` to `to` comes within `band` (`StageDef::obstacle_band`).
fn near(band: (i32, i32), y: i32, to: i32) -> bool {
    y.max(to) >= band.0 && y.min(to) <= band.1
}

/// SPEC_V5 §13 `StageDef::advance`, skipping the per-obstacle tests when the move stays clear of
/// every obstacle's y band (the same result, cheaper on-chain).
fn travel(st: &StageDef, band: (i32, i32), x: i32, y: i32, dy: i32) -> (i32, i32) {
    if near(band, y, y.saturating_add(dy)) {
        st.advance(x, y, dy)
    } else {
        (x, y.saturating_add(dy))
    }
}

/// SPEC §4 homing by at most STEER_STEP toward `target`, kept inside the column (SPEC_V5 §12
/// (a)) while a wall stands at `y`.
fn steer(st: &StageDef, x: i16, target: i16, y: i32) -> i16 {
    let to = toward(x, target, STEER_STEP);
    st.wall_clamp(i32::from(x), i32::from(to), y) as i16
}

/// The gate of `row` a cohort at `x` goes through right now, or `None` in a gap (SPEC §6: edges
/// count; if two gates cover `x`, the nearest centre wins, the lower slot on ties).
pub fn gate_at(st: &StageDef, gates: &[PublicGate], row: u8, x: i16) -> Option<u8> {
    st.gate_at(row, i32::from(x), |slot, def| {
        gates.get(slot).map_or(i32::from(def.x), |g| i32::from(g.x))
    })
}

/// SPEC §6: the first cohort through reveals a hidden gate; every cohort through gets `op`. The
/// timing gate is always face-up (it never reveals; its op is its value on the crossing tick).
fn pass_gate(
    s: u8,
    slot: u8,
    c: &mut Cohort,
    gate: &mut PublicGate,
    op: GateOp,
    hidden: bool,
    ev: &mut impl EventSink,
) {
    let reveal = hidden && gate.revealed.is_none();
    if reveal {
        gate.revealed = Some(op);
    }
    let before = c.count;
    c.count = op.apply(before);
    ev.push(Event::Gate {
        side: s,
        slot,
        cohort_id: c.id,
        op,
        before,
        after: c.count,
        reveal,
    });
}

fn dist2(ax: i16, ay: i16, bx: i16, by: i16) -> i64 {
    let dx = i64::from(ax).saturating_sub(i64::from(bx));
    let dy = i64::from(ay).saturating_sub(i64::from(by));
    dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
}

/// SPEC §4 homing for my cohort: the nearest enemy ahead within DETECT_Y, else the nearest live
/// tower, or in the Rush the town hall's centre (HALL_X). Ties go to the lower index.
fn cohort_target(
    c: &Cohort,
    enemies: &[Enemy],
    towers: &[u16; TOWERS_MAX],
    st: &StageDef,
    rush: bool,
) -> Option<i16> {
    let mut best: Option<(i64, i16)> = None;
    for e in enemies {
        let ahead = i32::from(e.y).saturating_sub(i32::from(c.y));
        if e.count == 0 || ahead <= 0 || ahead > DETECT_Y {
            continue;
        }
        let d = dist2(c.x, c.y, e.x, e.y);
        if best.is_none_or(|(bd, _)| d < bd) {
            best = Some((d, e.x));
        }
    }
    if let Some((_, x)) = best {
        return Some(x);
    }
    if rush {
        return Some(HALL_X as i16);
    }
    let mut tower: Option<(u32, i16)> = None;
    for (&hp, def) in towers.iter().zip(st.towers) {
        let d = i32::from(def.x).abs_diff(i32::from(c.x));
        if hp > 0 && tower.is_none_or(|(bd, _)| d < bd) {
            tower = Some((d, def.x));
        }
    }
    tower.map(|(_, x)| x)
}

// --- enemies -----------------------------------------------------------------------------------

/// SPEC_V5 §13 (rules v8): an enemy cohort walks straight down at cruise speed (a giant at
/// GIANT_SPEED, SPEC_V5 §5); it does not home in on my cohorts, it only fights what it meets.
/// Obstacles deflect it by the same slide as mine (SPEC_V5 §13); it is pushed out of a wall's
/// thickness as it enters the wall's span (SPEC_V5 §12 (b)). Pads and pipes don't touch it.
fn move_enemies(side: &mut PublicSide, st: &StageDef) {
    let PublicSide {
        enemies, enemy_len, ..
    } = side;
    let band = st.obstacle_band();
    for e in enemies.iter_mut().take(usize::from(*enemy_len)) {
        if e.count == 0 {
            continue;
        }
        let speed = if e.giant { GIANT_SPEED } else { CRUISE_SPEED };
        let (x, y) = travel(
            st,
            band,
            i32::from(e.x),
            i32::from(e.y),
            speed.saturating_neg(),
        );
        e.y = y as i16;
        e.x = st.wall_push(x, y) as i16;
    }
}

// --- clash -------------------------------------------------------------------------------------

/// SPEC §4: a cohort of mine and an enemy cohort meet once they have crossed in y (mine at or
/// above theirs, by at most CLASH_BAND) with x at most CLASH_REACH apart, and no wall standing
/// between them at the clash point's y (SPEC_V5 §12 (c)); they cancel 1:1.
/// Front-most pairs first: both lists are stored oldest (front-most) first.
fn clash(side: &mut PublicSide, st: &StageDef, s: u8, ev: &mut impl EventSink) {
    let PublicSide {
        cohorts,
        cohort_len,
        enemies,
        enemy_len,
        ..
    } = side;
    let foes = enemies
        .get_mut(..usize::from(*enemy_len))
        .unwrap_or(&mut []);
    if foes.is_empty() {
        return;
    }
    for a in cohorts.iter_mut().take(usize::from(*cohort_len)) {
        if a.count == 0 {
            continue;
        }
        for b in foes.iter_mut() {
            if b.count == 0 {
                continue;
            }
            let crossed = i32::from(a.y).saturating_sub(i32::from(b.y));
            if !(0..=CLASH_BAND).contains(&crossed)
                || i32::from(a.x).abs_diff(i32::from(b.x)) > CLASH_REACH as u32
                || st.wall_between(i32::from(a.x), i32::from(b.x), i32::from(mid(a.y, b.y)))
            {
                continue;
            }
            let killed = a.count.min(b.count);
            a.count = a.count.saturating_sub(killed);
            b.count = b.count.saturating_sub(killed);
            ev.push(Event::Clash {
                side: s,
                x: mid(a.x, b.x),
                y: mid(a.y, b.y),
                killed,
            });
            if a.count == 0 {
                break;
            }
        }
    }
}

fn mid(a: i16, b: i16) -> i16 {
    (i32::from(a).saturating_add(i32::from(b)) / 2) as i16
}

// --- hits, loot, losses ------------------------------------------------------------------------

/// SPEC §4/§5: a cohort reaching TOWER_Y within TOWER_HALF_W + CLASH_REACH of a live tower
/// deals its count as damage (gold = damage actually dealt, + TOWER_BONUS for the kill) and is
/// removed. In the Rush, a cohort reaching VAULT_Y anywhere across the lane (the town hall spans
/// the base) loots LOOT_PER_UNIT per dude. A cohort
/// reaching the base edge without hitting anything is lost.
fn hits(side: &mut PublicSide, st: &StageDef, s: u8, ev: &mut impl EventSink) {
    let PublicSide {
        cohorts,
        cohort_len,
        towers,
        gold,
        phase,
        ..
    } = side;
    let rush = *phase == Phase::Rush;
    for c in cohorts.iter_mut().take(usize::from(*cohort_len)) {
        let y = i32::from(c.y);
        if c.count == 0 {
            continue;
        }
        if rush && y >= VAULT_Y {
            let loot = c.count.saturating_mul(LOOT_PER_UNIT);
            *gold = gold.saturating_add(loot);
            ev.push(Event::Loot {
                side: s,
                cohort_id: c.id,
                units: c.count,
                gold: loot,
            });
            c.count = 0;
            continue;
        }
        if !rush && y >= TOWER_Y {
            if let Some(i) = tower_hit(c.x, towers, st) {
                if let (Some(hp), Ok(tower)) = (towers.get_mut(i), u8::try_from(i)) {
                    let damage = c.count.min(u32::from(*hp));
                    *hp = u16::try_from(u32::from(*hp).saturating_sub(damage)).unwrap_or(0);
                    *gold = gold.saturating_add(damage);
                    ev.push(Event::TowerHit {
                        side: s,
                        tower,
                        damage,
                        hp: u32::from(*hp),
                        gold: damage,
                    });
                    if *hp == 0 {
                        *gold = gold.saturating_add(TOWER_BONUS);
                        ev.push(Event::TowerDestroyed {
                            side: s,
                            tower,
                            gold: TOWER_BONUS,
                        });
                    }
                    c.count = 0;
                    continue;
                }
            }
        }
        if y >= LANE_LENGTH {
            c.count = 0;
        }
    }
}

/// The nearest live tower within TOWER_HALF_W + CLASH_REACH of `x` (lower index on ties).
fn tower_hit(x: i16, towers: &[u16; TOWERS_MAX], st: &StageDef) -> Option<usize> {
    let reach = TOWER_HALF_W.saturating_add(CLASH_REACH) as u32;
    let mut best: Option<(u32, usize)> = None;
    for (i, (&hp, def)) in towers.iter().zip(st.towers).enumerate() {
        let d = i32::from(def.x).abs_diff(i32::from(x));
        if hp > 0 && d <= reach && best.is_none_or(|(bd, _)| d < bd) {
            best = Some((d, i));
        }
    }
    best.map(|(_, i)| i)
}

/// Drop dead cohorts and enemies, keep the order (oldest first), zero the free slots.
fn compact(side: &mut PublicSide) {
    side.cohort_len = compact_list(&mut side.cohorts, side.cohort_len, |c| c.count);
    side.enemy_len = compact_list(&mut side.enemies, side.enemy_len, |e| e.count);
}

fn compact_list<T: Copy + Default>(list: &mut [T], len: u8, count: impl Fn(&T) -> u32) -> u8 {
    let mut kept = 0usize;
    for i in 0..usize::from(len) {
        let Some(item) = list.get(i).copied() else {
            break;
        };
        if count(&item) == 0 {
            continue;
        }
        if let Some(slot) = list.get_mut(kept) {
            *slot = item;
        }
        kept = kept.saturating_add(1);
    }
    for slot in list.iter_mut().skip(kept) {
        *slot = T::default();
    }
    u8::try_from(kept).unwrap_or(0)
}

// --- waves -------------------------------------------------------------------------------------

const WAVE_PERIOD: u32 = WAVE_GAPS[0] + WAVE_GAPS[1] + WAVE_GAPS[2];

/// SPEC §4: the wave number released `t` ticks into a fight, if any: the first at
/// FIRST_WAVE_TICKS, then on the WAVE_GAPS cycle.
pub fn wave_index(t: u32) -> Option<u32> {
    let since = t.checked_sub(FIRST_WAVE_TICKS)?;
    let cycles = since.checked_div(WAVE_PERIOD)?;
    let rest = since.checked_rem(WAVE_PERIOD)?;
    let mut at = 0u32;
    for (i, gap) in (0u32..).zip(WAVE_GAPS) {
        if rest == at {
            return Some(cycles.saturating_mul(3).saturating_add(i));
        }
        at = at.saturating_add(gap);
    }
    None
}

/// SPEC §4 fatigue in per mille, `t` ticks into the fight.
pub fn fatigue_pm(t: u32) -> u32 {
    if t <= FATIGUE_START {
        1000
    } else if t >= FATIGUE_END {
        FATIGUE_MIN_PM
    } else {
        let fall = 1000u32.saturating_sub(FATIGUE_MIN_PM);
        let done = t.saturating_sub(FATIGUE_START);
        let span = FATIGUE_END.saturating_sub(FATIGUE_START);
        1000u32.saturating_sub(fall.saturating_mul(done).checked_div(span).unwrap_or(0))
    }
}

/// SPEC §4: `wave_base × cycle% × fatigue‰ × pct%`, at least 1.
pub fn wave_size(wave_base: u16, k: u32, t: u32, pct: u32) -> u32 {
    let cycle = WAVE_PCT
        .get(k.checked_rem(3).unwrap_or(0) as usize)
        .copied()
        .unwrap_or(100);
    let n = u64::from(wave_base)
        .saturating_mul(u64::from(cycle))
        .saturating_mul(u64::from(fatigue_pm(t)))
        .saturating_mul(u64::from(pct))
        / 10_000_000;
    u32::try_from(n).unwrap_or(u32::MAX).max(1)
}

fn release_waves(
    side: &mut PublicSide,
    st: &StageDef,
    t: u32,
    pct: u32,
    ids: &mut u32,
    s: u8,
    ev: &mut impl EventSink,
) {
    let Some(k) = wave_index(t) else {
        return;
    };
    let towers = side.towers;
    // SPEC_V5 §5: in the final stage each small wave brings a giant.
    let giants = side.stage == FINAL_STAGE && k.checked_rem(3) == Some(1);
    for (tower, (&hp, def)) in (0u8..).zip(towers.iter().zip(st.towers)) {
        if hp == 0 {
            continue;
        }
        let count = wave_size(def.wave_base, k, t, pct);
        spawn_enemy(side, tower, def.x, count, false, ids, s, ev);
        if giants {
            spawn_enemy(side, tower, def.x, GIANT_COUNT, true, ids, s, ev);
        }
    }
}

/// One enemy cohort from `tower` at `x`. At ENEMY_CAP it joins the newest enemy cohort of that
/// tower (else the newest of any tower) instead (SPEC §7).
#[allow(clippy::too_many_arguments)]
fn spawn_enemy(
    side: &mut PublicSide,
    tower: u8,
    x: i16,
    count: u32,
    giant: bool,
    ids: &mut u32,
    s: u8,
    ev: &mut impl EventSink,
) {
    let len = usize::from(side.enemy_len);
    if len < ENEMY_CAP {
        if let Some(slot) = side.enemies.get_mut(len) {
            let id = *ids;
            *ids = id.saturating_add(1);
            *slot = Enemy {
                id,
                count,
                x,
                y: TOWER_Y as i16,
                tower,
                giant,
            };
            side.enemy_len = side.enemy_len.saturating_add(1);
            ev.push(Event::Wave {
                side: s,
                tower,
                enemy_id: id,
                x,
                count,
                merged: false,
            });
        }
        return;
    }
    let live = side.enemies.get_mut(..len).unwrap_or(&mut []);
    let pick = live
        .iter()
        .rposition(|e| e.tower == tower)
        .or(len.checked_sub(1));
    if let Some(e) = pick.and_then(|i| live.get_mut(i)) {
        e.count = e.count.saturating_add(count);
        ev.push(Event::Wave {
            side: s,
            tower,
            enemy_id: e.id,
            x: e.x,
            count,
            merged: true,
        });
    }
}

// --- fire --------------------------------------------------------------------------------------

/// SPEC §7: a volley of VOLLEY_SIZE at the cannon's x, or a called Champion of CHAMP_COUNT
/// (SPEC_V5 §4). At COHORT_CAP live cohorts it is skipped (a Champion waits for the next one).
fn fire(side: &mut PublicSide, ids: &mut u32, s: u8, ev: &mut impl EventSink) {
    let len = usize::from(side.cohort_len);
    if len >= COHORT_CAP {
        return;
    }
    let champion = side.champ_pending;
    let count = if champion { CHAMP_COUNT } else { VOLLEY_SIZE };
    let Some(slot) = side.cohorts.get_mut(len) else {
        return;
    };
    let id = *ids;
    *ids = id.saturating_add(1);
    *slot = Cohort {
        id,
        count,
        x: side.cannon_x,
        y: 0,
        age: 0,
        last_row: 0,
        champion,
    };
    side.champ_pending = false;
    side.cohort_len = side.cohort_len.saturating_add(1);
    // SPEC_V5 §4: every ordinary volley in a Fight charges the Champion meter.
    if !champion && side.phase == Phase::Fight {
        let full = u8::try_from(CHAMP_TICKS).unwrap_or(u8::MAX);
        side.champ_meter = side
            .champ_meter
            .saturating_add(u8::try_from(FIRE_TICKS).unwrap_or(u8::MAX))
            .min(full);
    }
    ev.push(Event::Volley {
        side: s,
        cohort_id: id,
        x: side.cannon_x,
        count,
        champion,
    });
}

// --- timeline ----------------------------------------------------------------------------------

/// SPEC §3: every tower down → Transit. The field is wiped and the next stage is loaded (its
/// gates face-down).
fn start_transit(side: &mut PublicSide, layout: u8, s: u8, ev: &mut impl EventSink) {
    let next = side.stage.saturating_add(1).min(FINAL_STAGE);
    side.load_stage(layout, next);
    side.phase = Phase::Transit;
    ev.push(Event::Phase {
        side: s,
        stage: next,
        phase: Phase::Transit,
    });
}

/// SPEC_V5 §2: the final stage's last tower fell (the breach) → the Rush starts where the
/// fight left off: no wipe (cohorts in flight keep going, leftover enemies keep walking and can
/// still kill), no new waves, the cannon fires RUSH_TICKS more. `phase_ticks` keeps counting,
/// so the gates slide on without a jump and the volley rhythm is unbroken.
fn start_rush(side: &mut PublicSide, s: u8, ev: &mut impl EventSink) {
    side.phase = Phase::Rush;
    side.rush_ticks = 0;
    ev.push(Event::Phase {
        side: s,
        stage: side.stage,
        phase: Phase::Rush,
    });
}

/// SPEC §3: the phase timer. Plant → Fight; Transit → Plant; the Rush ends (Done) after
/// RUSH_TICKS: dudes still on the lane are not counted (SPEC_V5 §2), and the lane is cleared.
fn advance(side: &mut PublicSide, s: u8, ev: &mut impl EventSink) {
    side.phase_ticks = side.phase_ticks.saturating_add(1);
    if side.phase == Phase::Rush {
        side.rush_ticks = side.rush_ticks.saturating_add(1);
    }
    let pt = u32::from(side.phase_ticks);
    let next = match side.phase {
        Phase::Plant if pt >= PLANT_TICKS => Phase::Fight,
        Phase::Transit if pt >= TRANSIT_TICKS => Phase::Plant,
        Phase::Rush if u32::from(side.rush_ticks) >= RUSH_TICKS => {
            let lost = side
                .cohorts()
                .iter()
                .fold(0u32, |n, c| n.saturating_add(c.count));
            side.cohorts = [Cohort::default(); COHORT_CAP];
            side.cohort_len = 0;
            side.enemies = [Enemy::default(); ENEMY_CAP];
            side.enemy_len = 0;
            side.champ_pending = false;
            ev.push(Event::RushEnd { side: s, lost });
            Phase::Done
        }
        _ => return,
    };
    side.phase = next;
    side.phase_ticks = 0;
    ev.push(Event::Phase {
        side: s,
        stage: side.stage,
        phase: next,
    });
}

/// SPEC_V5 §6: FIRST goes to whoever cleared a fight on the lower match tick. A breach can't be
/// beaten later, so it is settled on the tick a fight is first cleared: one side then scores
/// FIRST_BONUS; both on the same tick is a tie (nobody).
fn award_first(p: &mut PublicState, tick: u32, ev: &mut impl EventSink) {
    let now = u16::try_from(tick).unwrap_or(u16::MAX);
    for stage in 0..STAGES {
        let [a, b] = p
            .sides
            .each_ref()
            .map(|s| s.breach_tick.get(stage).copied().unwrap_or(0));
        // The first clear of this fight happened on this tick, by exactly one side.
        let first = match (a == now, b == now) {
            (true, false) if b == 0 => 0u8,
            (false, true) if a == 0 => 1u8,
            _ => continue,
        };
        if let Some(side) = p.sides.get_mut(usize::from(first)) {
            side.gold = side.gold.saturating_add(FIRST_BONUS);
            ev.push(Event::First {
                side: first,
                stage: stage as u8,
                gold: FIRST_BONUS,
            });
        }
    }
}

/// SPEC §8: the result from deaths and gold.
fn finish(m: &mut MatchState, ev: &mut impl EventSink) {
    let [a, b] = &m.public.sides;
    let result = payout(m.public.options.stake, [a.dead, b.dead], [a.gold, b.gold]);
    m.public.result = Some(result);
    ev.push(Event::End { result });
}

#[cfg(test)]
mod tests;
