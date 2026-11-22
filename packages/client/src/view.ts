// Public lane state → MatchView (types.ts). Shared by OfflineSource (WASM flat view) and the
// codec (on-chain bytes), so both give identical views (test/codec.test.ts).
import * as C from './constants';
import { crateOfGate, fightGold, gateMoving, layoutDef, stageDef } from './layout';
import type { CohortView, GateOp, GateView, LanePhase, LaneView, MatchResult, MatchStatus, MatchView, Side } from './types';

/** An enemy cohort as stored (CohortView without `age`, plus the tower that released it). */
export interface EnemyState {
  id: number;
  count: number;
  x: number;
  y: number;
  tower: number;
}

/** One lane's public fields, as the sim keeps them. */
export interface LaneState {
  stage: number;
  /** Sim phase code: 0 plant, 1 fight, 2 transit, 3 raid (the town hall raid of the final
   *  stage), 4 done. */
  phase: number;
  phaseTicks: number;
  /** Ticks since the town hall raid started (0 before it). */
  raidTicks: number;
  dead: boolean;
  cannonX: number;
  aimX: number;
  gold: number;
  rigUsed: boolean;
  peekUsed: boolean;
  /** TOWERS_MAX tower HP of the current stage (0 = down or no tower). */
  towers: number[];
  /** CRATES_MAX crate HP of the current stage (0 = broken or no crate). */
  crates: number[];
  /** GATES_MAX gates of the current stage: x now, and the revealed op (null = face-down). */
  gates: { x: number; revealed: GateOp | null }[];
  cohorts: CohortView[];
  enemies: EnemyState[];
}

/** The result as stored (before gold / deaths are attached). */
export interface RawResult {
  winner: Side | null;
  ko: boolean;
  moved: number;
  fee: number;
}

const PHASES: readonly LanePhase[] = ['plant', 'fight', 'transit', 'raid', 'done'];
const RAID = 3;
const DONE = 4;

export const sideOf = (n: number): Side => (n === 1 ? 1 : 0);

export function lanePhase(l: Pick<LaneState, 'phase' | 'dead'>): LanePhase {
  return l.dead ? 'dead' : (PHASES[l.phase] ?? 'plant');
}

export function laneView(l: LaneState, layout: number, name: string, isBot: boolean): LaneView {
  const st = stageDef(layout, l.stage);
  const gates = st.gates.map((def, slot): GateView => {
    const g = l.gates[slot];
    const crate = def.big ? crateOfGate(st, slot) : -1;
    return {
      slot,
      x: g?.x ?? def.x,
      y: st.rows[def.row] ?? 0,
      width: def.width,
      big: def.big,
      moving: gateMoving(def),
      revealed: g?.revealed ?? null,
      locked: crate >= 0 && (l.crates[crate] ?? 0) > 0,
    };
  });
  return {
    name,
    isBot,
    stage: l.stage,
    phase: lanePhase(l),
    phaseTick: l.phaseTicks,
    raidTicks: l.raidTicks,
    gold: l.gold,
    // The raid starts with exactly fightGold (every tower of every stage down); only loot after.
    raidGold: l.phase === RAID || l.phase === DONE ? Math.max(0, l.gold - fightGold(layout)) : 0,
    cannonX: l.cannonX,
    aimX: l.aimX,
    cohorts: l.cohorts.map(({ id, count, x, y, age }) => ({ id, count, x, y, age })),
    // Enemies carry no age in the sim (they have no launch boost): 0.
    enemies: l.enemies.map(({ id, count, x, y }) => ({ id, count, x, y, age: 0 })),
    towers: st.towers.map((t, index) => ({ index, x: t.x, y: C.TOWER_Y, hp: l.towers[index] ?? 0, maxHp: t.hp })),
    gates,
    crates: st.crates.map((c, index) => ({ index, x: c.x, y: c.y, width: c.width, hp: l.crates[index] ?? 0, maxHp: c.hp })),
    rigUsed: l.rigUsed,
    peekUsed: l.peekUsed,
  };
}

/** The MatchResult for a stored result: `died` = the one side that died (null if none or both). */
export function resultOf(r: RawResult | null, lanes: readonly [LaneState, LaneState]): MatchResult | null {
  if (!r) return null;
  const [a, b] = lanes;
  return {
    winner: r.winner,
    died: a.dead !== b.dead ? (a.dead ? 0 : 1) : null,
    gold: [a.gold, b.gold],
    moved: r.moved,
    fee: r.fee,
  };
}

export interface ViewInput {
  matchId: string;
  tick: number;
  layout: number;
  stake: number;
  bot: [boolean, boolean];
  names: [string, string];
  lanes: [LaneState, LaneState];
  result: RawResult | null;
  /** Default: 'ended' with a result, else 'playing'. */
  status?: MatchStatus;
}

export function matchView(v: ViewInput): MatchView {
  return {
    matchId: v.matchId,
    tick: v.tick,
    status: v.status ?? (v.result ? 'ended' : 'playing'),
    layout: v.layout,
    layoutName: layoutDef(v.layout).name,
    stake: v.stake,
    sides: [laneView(v.lanes[0], v.layout, v.names[0], v.bot[0]), laneView(v.lanes[1], v.layout, v.names[1], v.bot[1])],
    result: resultOf(v.result, v.lanes),
  };
}
