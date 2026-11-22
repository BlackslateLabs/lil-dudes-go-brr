// Decoder for the PUBLIC part of the match state, as stored in the on-chain Match account
// (crates/sim/src/codec.rs documents the layout, codec v3 / rules v4; a parity test checks this
// file against the WASM build). The secret part never reaches a client during a match.
import * as C from './constants';
import { opFromByte } from './layout';
import { matchView, resultOf, sideOf, type LaneState, type RawResult } from './view';
import type { CohortView, MatchResult, MatchStatus, MatchView } from './types';

/** Must equal crates/sim CODEC_VERSION (byte 0 of the public part). */
export const CODEC_VERSION = 3;
export const HEADER_LEN = 34;
export const GATE_LEN = 3;
export const UNIT_LEN = 12;
const SIDE_TOWERS = 14;
const SIDE_CRATES = SIDE_TOWERS + C.TOWERS_MAX * 2;
const SIDE_GATES = SIDE_CRATES + C.CRATES_MAX * 2;
const SIDE_COHORTS = SIDE_GATES + C.GATES_MAX * GATE_LEN;
const SIDE_ENEMIES = SIDE_COHORTS + C.COHORT_CAP * UNIT_LEN;
/** u16 raid ticks (codec v3), after the enemies. */
const SIDE_RAID = SIDE_ENEMIES + C.ENEMY_CAP * UNIT_LEN;
/** 720 bytes per side. */
export const SIDE_LEN = SIDE_RAID + 2;
/** 1,474 bytes. */
export const PUBLIC_LEN = HEADER_LEN + 2 * SIDE_LEN;
/** Offset of a side's aim inside its record (the program writes it directly). */
export const SIDE_AIM = 4;

const F_BOT0 = 1;
const F_BOT1 = 2;
const F_TUTORIAL = 4;
const F_RESULT = 8;
const F_KO = 16;
const F_PHASE = 7;
const F_DEAD = 8;
const F_RIG = 16;
const F_PEEK = 32;

/** A cohort as stored (MatchView's CohortView plus the gate rows it has passed). */
export interface CohortState extends CohortView {
  lastRow: number;
}

/** One lane as stored (see view.ts LaneState), with each cohort's `lastRow`. */
export interface SideState extends LaneState {
  cohorts: CohortState[];
}

/** Everything in the public part, decoded. */
export interface PublicState {
  tick: number;
  layout: number;
  stake: number;
  bot: [boolean, boolean];
  tutorial: boolean;
  nextCohortId: number;
  result: RawResult | null;
  sides: [SideState, SideState];
}

/** Decodes the public part starting at `offset` of `data` (e.g. the Match account data). */
export function decodePublic(data: Uint8Array, offset = 0): PublicState {
  if (data.length < offset + PUBLIC_LEN) throw new Error(`public state: need ${PUBLIC_LEN} bytes at ${offset}, have ${data.length - offset}`);
  const dv = new DataView(data.buffer, data.byteOffset + offset, PUBLIC_LEN);
  const u8 = (at: number) => dv.getUint8(at);
  const version = u8(0);
  if (version !== CODEC_VERSION) throw new Error(`public state codec v${version}, expected v${CODEC_VERSION}`);
  const flags = u8(1);
  const winner = u8(2);
  const result: RawResult | null =
    flags & F_RESULT
      ? {
          winner: winner < 2 ? sideOf(winner) : null,
          ko: (flags & F_KO) !== 0,
          moved: Number(dv.getBigUint64(16, true)),
          fee: Number(dv.getBigUint64(24, true)),
        }
      : null;
  const side = (base: number): SideState => {
    const sflags = u8(base + 1);
    const cohortLen = Math.min(u8(base + 12), C.COHORT_CAP);
    const enemyLen = Math.min(u8(base + 13), C.ENEMY_CAP);
    const u16 = (at: number) => dv.getUint16(base + at, true);
    const i16 = (at: number) => dv.getInt16(base + at, true);
    const unit = (start: number, i: number) => base + start + i * UNIT_LEN;
    return {
      stage: u8(base),
      phase: sflags & F_PHASE,
      phaseTicks: u16(6),
      raidTicks: u16(SIDE_RAID),
      dead: (sflags & F_DEAD) !== 0,
      cannonX: i16(2),
      aimX: i16(SIDE_AIM),
      gold: dv.getUint32(base + 8, true),
      rigUsed: (sflags & F_RIG) !== 0,
      peekUsed: (sflags & F_PEEK) !== 0,
      towers: Array.from({ length: C.TOWERS_MAX }, (_, i) => u16(SIDE_TOWERS + 2 * i)),
      crates: Array.from({ length: C.CRATES_MAX }, (_, i) => u16(SIDE_CRATES + 2 * i)),
      gates: Array.from({ length: C.GATES_MAX }, (_, i) => {
        const at = SIDE_GATES + i * GATE_LEN;
        return { x: i16(at), revealed: opFromByte(u8(base + at + 2)) };
      }),
      cohorts: Array.from({ length: cohortLen }, (_, i) => {
        const at = unit(SIDE_COHORTS, i);
        return {
          id: dv.getUint16(at, true),
          count: dv.getUint32(at + 2, true),
          x: dv.getInt16(at + 6, true),
          y: dv.getInt16(at + 8, true),
          age: u8(at + 10),
          lastRow: u8(at + 11),
        };
      }),
      enemies: Array.from({ length: enemyLen }, (_, i) => {
        const at = unit(SIDE_ENEMIES, i);
        return {
          id: dv.getUint16(at, true),
          count: dv.getUint32(at + 2, true),
          x: dv.getInt16(at + 6, true),
          y: dv.getInt16(at + 8, true),
          tower: u8(at + 10),
        };
      }),
    };
  };
  return {
    tick: dv.getUint32(4, true),
    layout: u8(3),
    stake: Number(dv.getBigUint64(8, true)),
    bot: [(flags & F_BOT0) !== 0, (flags & F_BOT1) !== 0],
    tutorial: (flags & F_TUTORIAL) !== 0,
    nextCohortId: dv.getUint16(32, true),
    result,
    sides: [side(HEADER_LEN), side(HEADER_LEN + SIDE_LEN)],
  };
}

/** The MatchResult of a decoded state (with gold and who died), or null while playing. */
export const matchResultOf = (p: PublicState): MatchResult | null => resultOf(p.result, p.sides);

/** The MatchView for a decoded public state (names and id come from the Match account header).
 *  `status` defaults to 'ended' with a result, else 'playing' (LiveSource passes 'waiting'). */
export function toMatchView(p: PublicState, matchId: string, names: [string, string], status?: MatchStatus): MatchView {
  return matchView({ matchId, tick: p.tick, layout: p.layout, stake: p.stake, bot: p.bot, names, lanes: p.sides, result: p.result, status });
}
