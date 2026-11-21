// Decoder for the PUBLIC part of the match state, as stored in the on-chain Match account
// (crates/sim/src/codec.rs documents the layout; a parity test checks this file against the WASM
// build). The secret part never reaches a client during a match.
import * as C from './constants';
import type { CohortView, GateOp, GateView, Hint, MatchResult, MatchStatus, MatchView, Side, SideView } from './types';

/** Must equal crates/sim CODEC_VERSION (byte 0 of the public part). */
export const CODEC_VERSION = 1;
export const HEADER_LEN = 34;
export const GATE_LEN = 2;
export const COHORT_LEN = 12;
const SIDE_GATES = 8;
const SIDE_COHORTS = SIDE_GATES + C.CELLS * GATE_LEN;
export const SIDE_LEN = SIDE_COHORTS + C.COHORT_CAP * COHORT_LEN;
export const PUBLIC_LEN = HEADER_LEN + 2 * SIDE_LEN;

const HINTS: readonly Hint[] = ['none', 'good', 'bad', 'gold'];
const OPS: readonly GateOp['kind'][] = ['mul', 'add', 'sub', 'div'];

/** A cohort as stored (MatchView's CohortView plus the gate rows it has passed). */
export interface CohortState extends CohortView {
  lastRow: number;
}

export interface SideState {
  hp: number;
  cannonX: number;
  aimX: number;
  rigUsed: boolean;
  peekUsed: boolean;
  gates: GateView[];
  cohorts: CohortState[];
}

/** Everything in the public part, decoded. */
export interface PublicState {
  tick: number;
  stake: number;
  bot: [boolean, boolean];
  tutorial: boolean;
  nextCohortId: number;
  result: MatchResult | null;
  sides: [SideState, SideState];
}

export const opOf = (kind: number, value: number): GateOp => ({ kind: OPS[kind & 3] ?? 'mul', value });

/** Decodes the public part starting at `offset` of `data` (e.g. the Match account data). */
export function decodePublic(data: Uint8Array, offset = 0): PublicState {
  if (data.length < offset + PUBLIC_LEN) throw new Error(`public state: need ${PUBLIC_LEN} bytes at ${offset}, have ${data.length - offset}`);
  const dv = new DataView(data.buffer, data.byteOffset + offset, PUBLIC_LEN);
  const version = dv.getUint8(0);
  if (version !== CODEC_VERSION) throw new Error(`public state codec v${version}, expected v${CODEC_VERSION}`);
  const flags = dv.getUint8(1);
  const winner = dv.getUint8(2);
  const result: MatchResult | null =
    flags & 8
      ? {
          winner: winner === 0 ? 0 : winner === 1 ? 1 : null,
          ko: (flags & 16) !== 0,
          moved: Number(dv.getBigUint64(16, true)),
          fee: Number(dv.getBigUint64(24, true)),
        }
      : null;
  const side = (base: number): SideState => {
    const len = Math.min(dv.getUint8(base + 6), C.COHORT_CAP);
    const sflags = dv.getUint8(base + 7);
    const gates: GateView[] = [];
    for (let cell = 0; cell < C.CELLS; cell++) {
      const at = base + SIDE_GATES + cell * GATE_LEN;
      const packed = dv.getUint8(at);
      const revealed = (packed & 8) !== 0;
      gates.push({
        cell,
        // Same convention as OfflineSource: no hint once revealed.
        hint: revealed ? 'none' : (HINTS[packed & 3] ?? 'none'),
        revealed: revealed ? opOf(packed >> 4, dv.getUint8(at + 1)) : null,
        gold: (packed & 4) !== 0,
      });
    }
    const cohorts: CohortState[] = [];
    for (let i = 0; i < len; i++) {
      const at = base + SIDE_COHORTS + i * COHORT_LEN;
      cohorts.push({
        id: dv.getUint16(at, true),
        count: dv.getUint32(at + 2, true),
        x: dv.getInt16(at + 6, true),
        y: dv.getInt16(at + 8, true),
        age: dv.getUint8(at + 10),
        lastRow: dv.getUint8(at + 11),
      });
    }
    return {
      hp: dv.getUint16(base, true),
      cannonX: dv.getInt16(base + 2, true),
      aimX: dv.getInt16(base + 4, true),
      rigUsed: (sflags & 1) !== 0,
      peekUsed: (sflags & 2) !== 0,
      gates,
      cohorts,
    };
  };
  return {
    tick: dv.getUint32(4, true),
    stake: Number(dv.getBigUint64(8, true)),
    bot: [(flags & 1) !== 0, (flags & 2) !== 0],
    tutorial: (flags & 4) !== 0,
    nextCohortId: dv.getUint16(32, true),
    result,
    sides: [side(HEADER_LEN), side(HEADER_LEN + SIDE_LEN)],
  };
}

// --- timeline helpers (mirror crates/sim/src/state.rs) ------------------------------------------

export function phaseAt(tick: number): number {
  let phase = 0;
  C.PLANT_STARTS.forEach((start, p) => {
    if (tick >= start) phase = p;
  });
  return phase;
}

export const playStart = (phase: number): number => (C.PLANT_STARTS[phase] ?? C.MATCH_TICKS) + C.PLANT_TICKS;
export const inPlant = (tick: number): boolean => tick < playStart(phaseAt(tick));

export function statusOf(p: Pick<PublicState, 'tick' | 'result'>): MatchStatus {
  if (p.result) return 'ended';
  return inPlant(p.tick) ? 'plant' : 'playing';
}

/** The MatchView for a decoded public state (names and id come from the Match account header). */
export function toMatchView(p: PublicState, matchId: string, names: [string, string], status?: MatchStatus): MatchView {
  const sides = p.sides.map(
    (s, i): SideView => ({
      name: names[i] ?? '',
      isBot: p.bot[i] ?? false,
      hp: s.hp,
      cannonX: s.cannonX,
      aimX: s.aimX,
      cohorts: s.cohorts.map(({ id, count, x, y, age }) => ({ id, count, x, y, age })),
      gates: s.gates,
      rigUsed: s.rigUsed,
      peekUsed: s.peekUsed,
    }),
  ) as [SideView, SideView];
  return {
    matchId,
    tick: p.tick,
    status: status ?? statusOf(p),
    phase: phaseAt(p.tick),
    surge: p.tick >= C.SURGE_TICK,
    stake: p.stake,
    sides,
    result: p.result,
  };
}

export const sideOf = (n: number): Side => (n === 1 ? 1 : 0);
