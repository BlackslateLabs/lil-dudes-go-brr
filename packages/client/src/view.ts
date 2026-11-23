// Public lane state → MatchView (types.ts). Shared by OfflineSource (WASM flat view) and the
// codec (on-chain bytes), so both give identical views (test/codec.test.ts).
import * as C from './constants';
import { crateOfGate, fightGold, gateMoving, layoutDef, stageDef, timingValue } from './layout';
import type { GateOp, GateView, LanePhase, LaneView, MatchResult, MatchStatus, MatchView, Side } from './types';

/** An enemy cohort as stored (CohortView without `age`, plus the tower that released it). */
export interface EnemyState {
  id: number;
  count: number;
  x: number;
  y: number;
  tower: number;
  giant: boolean;
}

/** One of my cohorts as stored. */
export interface CohortRecord {
  id: number;
  count: number;
  x: number;
  y: number;
  age: number;
  champion: boolean;
}

/** One lane's public fields, as the sim keeps them. */
export interface LaneState {
  stage: number;
  /** Sim phase code: 0 plant, 1 fight, 2 transit, 3 rush (after the final breach), 4 done. */
  phase: number;
  phaseTicks: number;
  /** Ticks since the breach of the final fight (0 before it). */
  rushTicks: number;
  dead: boolean;
  cannonX: number;
  aimX: number;
  gold: number;
  peekUsed: boolean;
  champMeter: number;
  champPending: boolean;
  /** Match tick each fight was cleared at (0 = not yet). */
  breachTick: [number, number];
  /** TOWERS_MAX tower HP of the current stage (0 = down or no tower). */
  towers: number[];
  /** CRATES_MAX crate HP of the current stage (0 = broken or no crate). */
  crates: number[];
  /** GATES_MAX gates of the current stage: x now, and the revealed op (null = face-down). */
  gates: { x: number; revealed: GateOp | null }[];
  cohorts: CohortRecord[];
  enemies: EnemyState[];
}

/** The result as stored (before gold / deaths are attached). */
export interface RawResult {
  winner: Side | null;
  ko: boolean;
  moved: number;
  fee: number;
}

const PHASES: readonly LanePhase[] = ['plant', 'fight', 'transit', 'rush', 'done'];
const RUSH = 3;
const DONE = 4;

export const sideOf = (n: number): Side => (n === 1 ? 1 : 0);

export function lanePhase(l: Pick<LaneState, 'phase' | 'dead'>): LanePhase {
  return l.dead ? 'dead' : (PHASES[l.phase] ?? 'plant');
}

/** SPEC_V5 §6: `first[stage]` for `me`: I cleared it, and earlier than the other lane (or they
 *  have not yet). Exactly the sim's award (it is settled on the breach tick). */
export function firstOf(me: Pick<LaneState, 'breachTick'>, other: Pick<LaneState, 'breachTick'>): [boolean, boolean] {
  const f = (k: 0 | 1) => {
    const [a, b] = [me.breachTick[k], other.breachTick[k]];
    return a > 0 && (b === 0 || a < b);
  };
  return [f(0), f(1)];
}

export function laneView(l: LaneState, layout: number, name: string, isBot: boolean, other: LaneState): LaneView {
  const st = stageDef(layout, l.stage);
  const timing = timingValue(l.phase === 1 || l.phase === RUSH ? l.phaseTicks : 0);
  const gates = st.gates.map((def, slot): GateView => {
    const g = l.gates[slot];
    const crate = def.big ? crateOfGate(st, slot) : -1;
    const pub = def.timing || def.hazard || def.turbo;
    const revealed = pub ? null : (g?.revealed ?? null);
    return {
      slot,
      x: g?.x ?? def.x,
      y: st.rows[def.row] ?? 0,
      width: def.width,
      big: def.big,
      timing: def.timing,
      hazard: def.hazard,
      turbo: def.turbo,
      moving: gateMoving(def),
      revealed,
      value: def.timing ? { kind: 'mul', value: timing } : def.hazard ? { kind: 'mul', value: 0 } : def.turbo ? { kind: 'mul', value: 1 } : revealed,
      locked: crate >= 0 && (l.crates[crate] ?? 0) > 0,
    };
  });
  const first = firstOf(l, other);
  const firstGold = (first[0] ? C.FIRST_BONUS : 0) + (first[1] ? C.FIRST_BONUS : 0);
  return {
    name,
    isBot,
    stage: l.stage,
    phase: lanePhase(l),
    phaseTick: l.phaseTicks,
    rushTicks: l.rushTicks,
    gold: l.gold,
    // The Rush starts with exactly fightGold + FIRST (every tower of every stage down); only
    // loot after.
    rushGold: l.phase === RUSH || l.phase === DONE ? Math.max(0, l.gold - fightGold(layout) - firstGold) : 0,
    first,
    breachTick: [l.breachTick[0], l.breachTick[1]],
    champMeter: l.champMeter,
    champPending: l.champPending,
    cannonX: l.cannonX,
    aimX: l.aimX,
    cohorts: l.cohorts.map(({ id, count, x, y, age, champion }) => ({ id, count, x, y, age, champion, giant: false })),
    // Enemies carry no age in the sim (they have no launch boost): 0.
    enemies: l.enemies.map(({ id, count, x, y, giant }) => ({ id, count, x, y, age: 0, champion: false, giant })),
    towers: st.towers.map((t, index) => ({ index, x: t.x, y: C.TOWER_Y, hp: l.towers[index] ?? 0, maxHp: t.hp })),
    gates,
    crates: st.crates.map((c, index) => ({ index, x: c.x, y: c.y, width: c.width, hp: l.crates[index] ?? 0, maxHp: c.hp })),
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
    sides: [
      laneView(v.lanes[0], v.layout, v.names[0], v.bot[0], v.lanes[1]),
      laneView(v.lanes[1], v.layout, v.names[1], v.bot[1], v.lanes[0]),
    ],
    result: resultOf(v.result, v.lanes),
  };
}
