// MatchEvents for the live feed. The chain stores state, not events, so they are derived by
// diffing consecutive snapshots of the public Match state (each snapshot is one or more ticks
// later than the last). Same event types and meanings as OfflineSource; exact for volley, reveal,
// gotcha, hit, plant, redeal, surge and end; gate and clash are reconstructed (a clash event
// sums a snapshot's clash losses at their average position).
import * as C from '../constants';
import { phaseAt, type CohortState, type PublicState } from '../codec';
import type { GateOp, MatchEvent, Side } from '../types';
import type { MatchHeader } from './chain';

const applyOp = (op: GateOp, c: number) => {
  switch (op.kind) {
    case 'mul':
      return c * op.value;
    case 'add':
      return c + op.value;
    case 'sub':
      return Math.max(0, c - op.value);
    case 'div':
      return op.value === 0 ? 0 : Math.floor(c / op.value);
  }
};

/** crates/sim `gate_at`: the cell whose gate span holds `x` in `row`, or null in a gap. */
export function gateAt(row: number, x: number): number | null {
  const cx = Math.min(Math.max(x, 0), C.LANE_WIDTH - 1);
  const col = Math.min(Math.floor(cx / C.COL_WIDTH), C.COLS - 1);
  const centre = col * C.COL_WIDTH + C.COL_WIDTH / 2;
  if (Math.abs(cx - centre) * 2 > C.GATE_WIDTH) return null;
  return row * C.COLS + col;
}

interface Snap {
  state: PublicState;
  gotcha: MatchHeader['gotcha'];
}

export function diffEvents(prev: Snap | null, next: Snap): MatchEvent[] {
  const out: MatchEvent[] = [];
  const n = next.state;
  if (!prev) return n.result ? [{ type: 'end', result: n.result }] : [];
  const p = prev.state;
  const fromTick = p.tick;
  // Timeline, as the sim emits it: plant 1 on the first tick processed; re-deal + plant when a
  // phase start is reached; Surge at its tick.
  if (fromTick === 0 && n.tick > 0) out.push({ type: 'plant', phase: 0 });
  C.PLANT_STARTS.forEach((start, phase) => {
    if (phase > 0 && fromTick < start && n.tick >= start) {
      out.push({ type: 'redeal', phase });
      out.push({ type: 'plant', phase });
    }
  });
  if (fromTick < C.SURGE_TICK && n.tick >= C.SURGE_TICK) out.push({ type: 'surge' });
  const redealt = phaseAt(fromTick) !== phaseAt(n.tick);
  const losses: [{ x: number; y: number; k: number }[], { x: number; y: number; k: number }[]] = [[], []];
  for (const s of [0, 1] as Side[]) {
    const ps = p.sides[s];
    const ns = n.sides[s];
    // Reveals (a re-deal resets the board, so only within one phase).
    if (!redealt) {
      ns.gates.forEach((g, cell) => {
        if (g.revealed && !ps.gates[cell]!.revealed) out.push({ type: 'reveal', side: s, cell, op: g.revealed, gold: g.gold });
      });
    }
    const before = new Map<number, CohortState>(ps.cohorts.map((c) => [c.id, c]));
    const dt = Math.max(1, n.tick - fromTick);
    // Gates a cohort crossed since the last snapshot (rows it reached by `toRow`), applied in order
    // with each gate's now-revealed op; returns the count after them.
    const throughGates = (c: CohortState, toRow: number, x: number) => {
      let count = c.count;
      for (let row = c.lastRow; row < toRow && count > 0; row++) {
        const cell = gateAt(row, x);
        const op = cell === null ? null : ns.gates[cell]!.revealed;
        if (cell === null || !op) continue;
        const after = applyOp(op, count);
        out.push({ type: 'gate', side: s, cell, cohortId: c.id, before: count, after });
        count = after;
      }
      return count;
    };
    for (const c of ns.cohorts) {
      const was = before.get(c.id);
      if (!was) {
        out.push({ type: 'volley', side: s, cohortId: c.id, x: c.x, count: C.VOLLEY_SIZE });
        continue;
      }
      before.delete(c.id);
      const count = throughGates(was, c.lastRow, c.x);
      if (c.count < count) losses[s].push({ x: c.x, y: c.y, k: count - c.count });
    }
    // Gone since the last snapshot: replay its motion; a gate may have zeroed it, it may have
    // reached the enemy cannon (the HP drop counts it), else it died in a clash.
    for (const c of before.values()) {
      let y = c.y;
      let age = c.age;
      for (let t = 0; t < dt; t++) {
        y += age < C.LAUNCH_TICKS ? C.LAUNCH_SPEED : C.CRUISE_SPEED;
        age++;
      }
      const row = C.ROW_Y.filter((ry) => y >= ry).length;
      const count = throughGates(c, Math.max(row, c.lastRow), c.x);
      if (count > 0 && y < C.LANE_LENGTH) losses[s].push({ x: c.x, y: Math.min(y, C.LANE_LENGTH), k: count });
    }
  }
  // Clash: both sides lose the same number of units; one event at the average contact point.
  const k0 = losses[0].reduce((a, l) => a + l.k, 0);
  const k1 = losses[1].reduce((a, l) => a + l.k, 0);
  if (k0 > 0 && k1 > 0) {
    const all = [...losses[0].map((l) => ({ x: l.x, y: l.y })), ...losses[1].map((l) => ({ x: l.x, y: C.LANE_LENGTH - l.y }))];
    const x = Math.round(all.reduce((a, l) => a + l.x, 0) / all.length);
    const y = Math.round(all.reduce((a, l) => a + l.y, 0) / all.length);
    out.push({ type: 'clash', x, y: Math.min(Math.max(y, 0), C.LANE_LENGTH), killedA: Math.min(k0, k1), killedB: Math.min(k0, k1) });
  }
  // Gotcha: the header records the last sprung rig per grid.
  for (const s of [0, 1] as Side[]) {
    const g = next.gotcha[s];
    const was = prev.gotcha[s];
    if (g && (!was || was.tick !== g.tick || was.cell !== g.cell)) {
      out.push({ type: 'gotcha', side: s, cell: g.cell, riggedBy: g.riggedBy === 1 ? 1 : 0 });
    }
  }
  // Hits: the HP drop per cannon.
  for (const s of [0, 1] as Side[]) {
    const dmg = p.sides[s].hp - n.sides[s].hp;
    if (dmg > 0) out.push({ type: 'hit', side: s, damage: dmg, hp: n.sides[s].hp });
  }
  if (n.result && !p.result) out.push({ type: 'end', result: n.result });
  return out;
}
