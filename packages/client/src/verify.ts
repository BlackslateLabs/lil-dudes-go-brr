// The full reveal of a finished match (result screen, Verify): every deal rebuilt from the
// published seed with the same Rust code (WASM), plus every phase's rigs and peeks.
import { deals_for } from '@lil-dudes/sim-wasm';
import * as C from './constants';
import { opOf } from './codec';
import { initSim } from './offline';
import type { GateOp, Hint, Side } from './types';

const HINTS: readonly Hint[] = ['none', 'good', 'bad', 'gold'];
const DEAL_LEN = 1 + 4 * C.CELLS;
const NONE = 255;

/** One phase's deal: the true value of each cell (both grids are the same), and the hint each
 *  side's gates showed (before rigs: a rigged gate showed a fake 'good' instead). */
export interface Deal {
  phase: number;
  goldCell: number;
  ops: GateOp[];
  hints: [Hint[], Hint[]];
}

/** What both sides did in one phase. `rigs[s]` = the opponent cell side s rigged. */
export interface PhaseLog {
  phase: number;
  rigs: [number | null, number | null];
  peeks: [{ cell: number; op: GateOp; gold: boolean } | null, { cell: number; op: GateOp; gold: boolean } | null];
}

/** Everything hidden during the match, published at the end. */
export interface MatchReveal {
  seed: bigint;
  deals: Deal[];
  history: PhaseLog[];
}

/** The three deals of a match with this seed (crates/sim `Deal::new`, through WASM). */
export function dealsFor(seed: bigint): Deal[] {
  initSim();
  const v = deals_for(seed);
  const deals: Deal[] = [];
  for (let phase = 0; phase < C.PHASES; phase++) {
    const at = phase * DEAL_LEN;
    const ops: GateOp[] = [];
    for (let c = 0; c < C.CELLS; c++) ops.push(opOf(v[at + 1 + 2 * c]!, v[at + 2 + 2 * c]!));
    const hint = (s: number, c: number) => HINTS[v[at + 1 + 2 * C.CELLS + s * C.CELLS + c]!] ?? 'none';
    const hints: [Hint[], Hint[]] = [[], []];
    for (let c = 0; c < C.CELLS; c++) {
      hints[0].push(hint(0, c));
      hints[1].push(hint(1, c));
    }
    deals.push({ phase, goldCell: v[at]!, ops, hints });
  }
  return deals;
}

/** Decodes the 30-byte history (codec layout: 3 phases × 2 sides × [rig, peek cell, kind, value, gold]). */
export function decodeHistory(bytes: Uint8Array): PhaseLog[] {
  const out: PhaseLog[] = [];
  for (let phase = 0; phase < C.PHASES; phase++) {
    const side = (s: Side) => {
      const at = (phase * 2 + s) * 5;
      const rig = bytes[at] ?? NONE;
      const cell = bytes[at + 1] ?? NONE;
      return {
        rig: rig === NONE ? null : rig,
        peek: cell === NONE ? null : { cell, op: opOf(bytes[at + 2] ?? 0, bytes[at + 3] ?? 0), gold: bytes[at + 4] === 1 },
      };
    };
    const [a, b] = [side(0), side(1)];
    out.push({ phase, rigs: [a.rig, b.rig], peeks: [a.peek, b.peek] });
  }
  return out;
}

export function revealOf(seed: bigint, history: Uint8Array): MatchReveal {
  return { seed, deals: dealsFor(seed), history: decodeHistory(history) };
}
