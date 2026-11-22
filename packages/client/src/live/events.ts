// MatchEvents for the live feed (rules v3). The chain stores state, not events, so they are
// derived by diffing consecutive snapshots of the public Match state (each snapshot is one or
// more ticks later than the last). Same event types and meanings as OfflineSource.
//
// With consecutive snapshots (one tick apart, what the TEE feed delivers):
// - exact: volley (new cohort ids), wave (new enemy ids), reveal (+ gotcha: v3 gates only
//   multiply, so a gate revealed as ÷ is always the opponent's sprung rig), gate and crate (the
//   cohorts' movement through the stage's crates and gate rows is re-run with the now-revealed
//   values), stage, death, end;
// - summed per snapshot: towerHit (one per tower), loot (one per lane), clash (one per lane: the
//   enemy units lost, at their average position); towerDown when a tower reaches 0 or its stage
//   is left (the last tower falling moves the lane on in the same tick);
// - approximate: a wave that merged into an existing enemy cohort (at ENEMY_CAP) shows as the
//   count increase net of that cohort's clash losses.
// Gaps of several ticks collapse phase changes, and the reveals, gates and crates of a stage the
// lane left inside the gap are not recovered.
import * as C from '../constants';
import { matchResultOf, type PublicState, type SideState } from '../codec';
import { applyOp, gateXAt, stageDef } from '../layout';
import type { LanePhase, MatchEvent, Side } from '../types';

const PHASES: readonly LanePhase[] = ['plant', 'fight', 'transit', 'raid', 'done'];
const FIGHT = 1;
const RAID = 3;
const active = (phase: number) => phase === FIGHT || phase === RAID;
const within = (x: number, centre: number, width: number) => Math.abs(x - centre) * 2 <= Math.abs(width);

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
  for (const s of [0, 1] as Side[]) laneEvents(out, s, p.layout, p.sides[s], n.sides[s], dt);
  if (n.result && !p.result) out.push({ type: 'end', result: matchResultOf(n)! });
  return out;
}

function laneEvents(out: MatchEvent[], side: Side, layout: number, a: SideState, b: SideState, dt: number): void {
  const sameStage = a.stage === b.stage;
  const samePhase = sameStage && a.phase === b.phase;
  const st = stageDef(layout, a.stage);

  // Cohorts through crates and gate rows, re-run tick by tick while the phase holds.
  if (samePhase && active(a.phase) && !a.dead) {
    const crates = [...a.crates];
    const cohorts = a.cohorts.map((c) => ({ ...c }));
    for (let k = 0; k < dt; k++) {
      const t = b.phaseTicks - dt + k;
      for (const c of cohorts) {
        if (c.count === 0) continue;
        const prevY = c.y;
        c.y += c.age < C.LAUNCH_TICKS ? C.LAUNCH_SPEED : C.CRUISE_SPEED;
        c.age = Math.min(255, c.age + 1);
        st.crates.forEach((def, index) => {
          const hp = crates[index] ?? 0;
          if (hp === 0 || c.count === 0 || prevY >= def.y || c.y < def.y || !within(c.x, def.x, def.width)) return;
          const absorbed = Math.min(c.count, hp);
          crates[index] = hp - absorbed;
          c.count -= absorbed;
          out.push({ type: 'crate', side, index, hp: hp - absorbed, broken: hp === absorbed });
        });
        while (c.lastRow < st.rows.length && c.count > 0 && c.y >= st.rows[c.lastRow]!) {
          const row = c.lastRow++;
          const slot = st.gates.findIndex((g) => g.row === row && within(c.x, gateXAt(g, t), g.width));
          const op = slot >= 0 ? b.gates[slot]?.revealed : null;
          if (!op) continue;
          const before = c.count;
          c.count = applyOp(op, before);
          out.push({ type: 'gate', side, slot, cohortId: c.id, before, after: c.count });
        }
      }
    }
  }

  if (sameStage) {
    // Reveals; a gate revealed as ÷ is a sprung rig of the opponent's.
    b.gates.forEach((g, slot) => {
      if (!g.revealed || a.gates[slot]?.revealed || slot >= st.gates.length) return;
      out.push({ type: 'reveal', side, stage: b.stage, slot, op: g.revealed });
      if (g.revealed.kind === 'div') out.push({ type: 'gotcha', side, stage: b.stage, slot, riggedBy: side === 0 ? 1 : 0 });
    });
    // Crate damage outside the re-run (e.g. a phase change inside the gap): one event per crate.
    if (!samePhase) {
      b.crates.forEach((hp, index) => {
        const was = a.crates[index] ?? 0;
        if (hp < was) out.push({ type: 'crate', side, index, hp, broken: hp === 0 });
      });
    }
  }

  // Enemy units lost in clashes (the field is wiped when the stage changes).
  if (sameStage) {
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

  // Towers: summed hits; leaving a fight means every tower still standing fell.
  const fell = !sameStage && a.phase === FIGHT;
  st.towers.forEach((_, tower) => {
    const was = a.towers[tower] ?? 0;
    const hp = fell ? 0 : sameStage ? (b.towers[tower] ?? 0) : was;
    if (hp >= was) return;
    out.push({ type: 'towerHit', side, tower, damage: was - hp, hp, gold: was - hp });
    if (hp === 0) out.push({ type: 'towerDown', side, tower, gold: C.TOWER_BONUS });
  });

  // Loot: in the raid, gold only comes from the vault.
  if (a.stage === C.RAID_STAGE && sameStage && b.gold > a.gold) {
    const gold = b.gold - a.gold;
    out.push({ type: 'loot', side, count: Math.floor(gold / C.LOOT_PER_UNIT), gold });
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
  for (const c of b.cohorts) if (!fired.has(c.id)) out.push({ type: 'volley', side, cohortId: c.id, x: c.x, count: C.VOLLEY_SIZE });

  if (a.stage !== b.stage || a.phase !== b.phase) out.push({ type: 'stage', side, stage: b.stage, phase: PHASES[b.phase] ?? 'plant' });
  if (!a.dead && b.dead) out.push({ type: 'death', side });
}
