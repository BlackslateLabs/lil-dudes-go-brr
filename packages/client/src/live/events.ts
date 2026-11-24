// MatchEvents for the live feed (rules v5). The chain stores state, not events, so they are
// derived by diffing consecutive snapshots of the public Match state (each snapshot is one or
// more ticks later than the last). Same event types and meanings as OfflineSource.
//
// With consecutive snapshots (one tick apart, what the TEE feed delivers):
// - exact: volley (new cohort ids, with the Champion flag), wave (new enemy ids), reveal, gate
//   and crate (the cohorts' movement through the stage's crates and gate rows is re-run with the
//   now-revealed values and the timing gate's clock, gate edges + GATE_GRACE, nearest centre),
//   first (from the breach ticks of both lanes), stage, death, end;
// - summed per snapshot: towerHit (one per tower), loot (one per lane: gold not explained by
//   towers or FIRST, in the Rush), clash (one per lane: the enemy units lost, at their average
//   position); towerDown when a tower reaches 0 or its stage is left (Fight 1's last tower moves
//   the lane to Transit in the same tick; Fight 2's starts the Rush in place, same stage).
// - v5 flow: Fight 2 → Rush keeps the stage, the field and the phase clock, so cohorts are
//   re-run straight through the switch. Rush → Done clears the lane: that tick's rushEnd counts
//   my units that are gone and did not loot (it can include that tick's clash losses).
// - rules v8: the re-run follows the real movement (obstacle slides, wall pushes, speed pads,
//   pipes with their `pipe` event, homing past the last row on the enemies and towers of the
//   earlier snapshot; rules v9 `homing`: close enemies, the late turn), so one-tick snapshots
//   stay exact;
// - missing: a volley fired on a lane's last Rush tick (the lane is cleared in that same tick);
// - approximate: a wave that merged into an existing enemy cohort (at ENEMY_CAP) shows as the
//   count increase net of that cohort's clash losses.
// Gaps of several ticks collapse phase changes, and the reveals, gates and crates of a stage the
// lane left inside the gap are not recovered.
import * as C from '../constants';
import { matchResultOf, type PublicState, type SideState } from '../codec';
import { advance, applyOp, covers, gateAt, gateXAt, homing, obstacleAt, onPad, pipeAt, rowsThrough, stageDef, steerX, timingValue, wallPush } from '../layout';
import { firstOf } from '../view';
import type { GateOp, LanePhase, MatchEvent, Side } from '../types';

const PHASES: readonly LanePhase[] = ['plant', 'fight', 'transit', 'rush', 'done'];
const FIGHT = 1;
const RUSH = 3;
const DONE = 4;
const active = (phase: number) => phase === FIGHT || phase === RUSH;

/** The events that happened between two snapshots of the public state (`prev` null = first one). */
export function diffEvents(prev: PublicState | null, next: PublicState): MatchEvent[] {
  const out: MatchEvent[] = [];
  const n = next;
  if (!prev) {
    const r = matchResultOf(n);
    return r ? [{ type: 'end', result: r }] : [];
  }
  const p = prev;
  const dt = Math.max(1, n.tick - p.tick);
  // The sim announces both lanes' first Plant on the first tick it processes.
  if (p.tick === 0 && n.tick > 0) {
    for (const s of [0, 1] as Side[]) out.push({ type: 'stage', side: s, stage: p.sides[s].stage, phase: PHASES[p.sides[s].phase] ?? 'plant' });
  }
  for (const s of [0, 1] as Side[]) {
    const other: Side = s === 0 ? 1 : 0;
    // FIRST: a fight newly marked first for this lane (settled on the breach tick).
    const was = firstOf(p.sides[s], p.sides[other]);
    const now = firstOf(n.sides[s], n.sides[other]);
    const firsts = ([0, 1] as const).filter((k) => now[k] && !was[k]);
    laneEvents(out, s, p.layout, p.sides[s], n.sides[s], dt, firsts);
  }
  if (n.result && !p.result) out.push({ type: 'end', result: matchResultOf(n)! });
  return out;
}

function laneEvents(out: MatchEvent[], side: Side, layout: number, a: SideState, b: SideState, dt: number, firsts: readonly (0 | 1)[]): void {
  const sameStage = a.stage === b.stage;
  const st = stageDef(layout, a.stage);
  // Rush → Done: the lane is cleared (leftover dudes uncounted, enemies leave).
  const rushEnded = sameStage && a.phase === RUSH && b.phase === DONE;

  // Cohorts through crates and gate rows, re-run tick by tick while the lane stays active in this
  // stage (Fight → Rush keeps the field and the clock; the clock of a tick is the phase ticks
  // before it, so count from `a`).
  const cohorts = a.cohorts.map((c) => ({ ...c }));
  const rerun = sameStage && active(a.phase) && !a.dead;
  if (rerun) {
    const crates = [...a.crates];
    for (let k = 0; k < dt; k++) {
      const t = a.phaseTicks + k;
      for (const c of cohorts) {
        if (c.count === 0) continue;
        // Rules v8 movement (crates/sim step.rs move_cohorts): obstacle slides, wall pushes, pads.
        const prevY = c.y;
        const [nx, ny] = advance(st, c.x, prevY, c.age < C.LAUNCH_TICKS ? C.LAUNCH_SPEED : C.CRUISE_SPEED);
        c.y = ny;
        c.age = Math.min(255, c.age + 1);
        c.x = wallPush(st, nx, ny);
        if (onPad(st, c.x, c.y)) c.age = 0;
        st.crates.forEach((def, index) => {
          const hp = crates[index] ?? 0;
          if (hp === 0 || c.count === 0 || prevY >= def.y || c.y < def.y || !covers(c.x, def.x, def.width)) return;
          const absorbed = Math.min(c.count, hp);
          crates[index] = hp - absorbed;
          c.count -= absorbed;
          out.push({ type: 'crate', side, index, hp: hp - absorbed, broken: hp === absorbed });
        });
        while (c.lastRow < st.rows.length && c.count > 0 && c.y >= st.rows[c.lastRow]!) {
          const row = c.lastRow++;
          const slot = gateAt(st, row, c.x, (_, g) => gateXAt(g, t));
          const def = slot >= 0 ? st.gates[slot] : undefined;
          const op: GateOp | null | undefined = def?.timing ? { kind: 'mul', value: timingValue(t) } : slot >= 0 ? b.gates[slot]?.revealed : null;
          if (!op) continue;
          const before = c.count;
          c.count = applyOp(op, before);
          out.push({ type: 'gate', side, slot, cohortId: c.id, op, before, after: c.count });
        }
        // Pipes: out at the exit with a fresh boost, past the rows up to there.
        const pipeIx = c.count > 0 ? pipeAt(st, c.x, c.y) : -1;
        const pipe = st.pipes[pipeIx];
        if (pipe) {
          [c.x, c.y, c.age] = [pipe.outX, pipe.outY, 0];
          c.lastRow = Math.max(c.lastRow, rowsThrough(st, pipe.outY));
          out.push({ type: 'pipe', side, cohortId: c.id, pipeIx });
          continue;
        }
        // Homing past the last row (rules v9: a close enemy, else the late turn toward the tower;
        // not on a tick it slid, never into an obstacle). The enemies and towers are those of `a`
        // (exact for one-tick snapshots).
        if (c.lastRow >= st.rows.length && c.count > 0 && c.y !== prevY) {
          const aim = homing(st, c.x, c.y, a.enemies, a.towers, a.phase === RUSH);
          if (aim) {
            const to = steerX(st, c.x, aim[0], aim[1], c.y);
            if (obstacleAt(st, to, c.y) < 0) c.x = to;
          }
        }
      }
    }
  }

  if (sameStage) {
    // Reveals (hidden gates only; the timing gate never flips).
    b.gates.forEach((g, slot) => {
      if (!g.revealed || a.gates[slot]?.revealed || slot >= st.gates.length || st.gates[slot]?.timing) return;
      out.push({ type: 'reveal', side, stage: b.stage, slot, op: g.revealed });
    });
    // Crate damage outside the re-run: one event per crate.
    if (!rerun) {
      b.crates.forEach((hp, index) => {
        const was = a.crates[index] ?? 0;
        if (hp < was) out.push({ type: 'crate', side, index, hp, broken: hp === 0 });
      });
    }
  }

  // Towers: summed hits; leaving a fight for the next stage means every tower still standing fell.
  const fell = !sameStage && a.phase === FIGHT;
  let towerGold = 0;
  st.towers.forEach((_, tower) => {
    const was = a.towers[tower] ?? 0;
    const hp = fell ? 0 : sameStage ? (b.towers[tower] ?? 0) : was;
    if (hp >= was) return;
    out.push({ type: 'towerHit', side, tower, damage: was - hp, hp, gold: was - hp });
    towerGold += was - hp;
    if (hp === 0) {
      out.push({ type: 'towerDown', side, tower, gold: C.TOWER_BONUS });
      towerGold += C.TOWER_BONUS;
    }
  });

  // FIRST (decided from both lanes' breach ticks in diffEvents).
  for (const stage of firsts) out.push({ type: 'first', side, stage, gold: C.FIRST_BONUS });
  const firstGold = firsts.length * C.FIRST_BONUS;

  // Loot: in the Rush, gold the towers and FIRST don't explain came from the hall.
  const rushing = sameStage && (b.phase === RUSH || b.phase === DONE);
  const lootGold = rushing ? b.gold - a.gold - towerGold - firstGold : 0;
  const looted = Math.max(0, Math.floor(lootGold / C.LOOT_PER_UNIT));
  if (lootGold > 0) out.push({ type: 'loot', side, count: looted, gold: lootGold });

  // Enemy units lost in clashes (the field is wiped when the stage changes).
  if (rushEnded) {
    // The Rush's last tick: my units that are gone and didn't loot were still on the lane.
    const left = cohorts.reduce((n, c) => n + c.count, 0) - b.cohorts.reduce((n, c) => n + c.count, 0);
    out.push({ type: 'rushEnd', side, lost: Math.max(0, left - looted) });
  } else if (sameStage) {
    const now = new Map(b.enemies.map((e) => [e.id, e]));
    let killed = 0;
    let sx = 0;
    let sy = 0;
    let at = 0;
    for (const e of a.enemies) {
      const later = now.get(e.id);
      const lost = later ? Math.max(0, e.count - later.count) : e.count;
      if (lost === 0) continue;
      killed += lost;
      sx += later?.x ?? e.x;
      sy += later?.y ?? Math.max(0, e.y - C.CRUISE_SPEED);
      at++;
    }
    if (killed > 0) out.push({ type: 'clash', side, x: Math.round(sx / at), y: Math.round(sy / at), killed });
  }

  // Waves: new enemy ids; a merged wave shows as a count increase.
  const had = new Map(a.enemies.map((e) => [e.id, e]));
  for (const e of b.enemies) {
    const was = had.get(e.id);
    if (!was) out.push({ type: 'wave', side, tower: e.tower, cohortId: e.id, count: e.count });
    else if (sameStage && e.count > was.count) out.push({ type: 'wave', side, tower: e.tower, cohortId: e.id, count: e.count - was.count });
  }

  // Volleys: new cohort ids.
  const fired = new Set(a.cohorts.map((c) => c.id));
  for (const c of b.cohorts) {
    if (!fired.has(c.id)) out.push({ type: 'volley', side, cohortId: c.id, x: c.x, count: c.champion ? C.CHAMP_COUNT : C.VOLLEY_SIZE, champion: c.champion });
  }

  if (a.stage !== b.stage || a.phase !== b.phase) out.push({ type: 'stage', side, stage: b.stage, phase: PHASES[b.phase] ?? 'plant' });
  if (!a.dead && b.dead) out.push({ type: 'death', side });
}
