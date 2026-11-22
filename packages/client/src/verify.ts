// The full reveal of a finished match (result screen, Verify): the layout and every stage's gate
// values rebuilt from the published seed with the same Rust code (WASM), plus every stage's rigs
// and peeks from the published history (rules v3, docs/SPEC.md §6, §11).
import { deals_for } from '@lil-dudes/sim-wasm';
import * as C from './constants';
import { layoutDef, opFromByte, stageDef } from './layout';
import { initSim } from './offline';
import type { GateOp, Side } from './types';

const NONE = 255;
/** Codec history: 3 stages × 2 sides × [rig stage, rig slot, peek slot, peek op]. */
export const HISTORY_LEN = C.STAGES * 2 * 4;

/** The level and every stage's true gate values of a match (identical in both copies; a rig
 *  turns one gate of one copy into ÷2 on top). */
export interface Deals {
  layout: number;
  layoutName: string;
  /** `values[stage][slot]`, one per gate of that stage in the layout. */
  values: GateOp[][];
}

/** A rig: the victim's stage and gate slot. */
export interface RigLog {
  stage: number;
  slot: number;
}

/** A peek: my gate slot and the true value I saw (`div` = it was rigged). */
export interface PeekLog {
  slot: number;
  op: GateOp;
}

/** What both players did during one of their OWN stages (`stage` = the actor's stage; a rig
 *  names the victim's stage, which can differ when the players are at different stages). */
export interface StageLog {
  stage: number;
  /** `rigs[s]` = the gate of the opponent's copy side s rigged during its plant of this stage. */
  rigs: [RigLog | null, RigLog | null];
  /** `peeks[s]` = side s's peek during this stage. */
  peeks: [PeekLog | null, PeekLog | null];
  /** `sprung[s]`: side s's rig was hit (a GOTCHA); false if it never was or there was no rig. */
  sprung: [boolean, boolean];
}

/** A rig that was hit: `side`'s first cohort through gate `slot` of its stage `stage`, rigged by `riggedBy`. */
export interface GotchaLog {
  stage: number;
  tick: number;
  side: Side;
  slot: number;
  riggedBy: Side;
}

/** The layout and every stage's values of a match with this seed (crates/sim `deals_for`, through WASM). */
export function dealsFor(seed: bigint): Deals {
  initSim();
  const v = deals_for(seed);
  const layout = v[0] ?? 0;
  const values: GateOp[][] = [];
  for (let stage = 0; stage < C.STAGES; stage++) {
    values.push(
      stageDef(layout, stage).gates.map((_, slot) => opFromByte(v[1 + stage * C.GATES_MAX + slot] ?? 0) ?? { kind: 'mul', value: 1 }),
    );
  }
  return { layout, layoutName: layoutDef(layout).name, values };
}

/** Decodes the 24-byte history (codec layout: 3 stages × 2 sides × [rig stage (255 none), rig
 *  slot, peek slot (255 none), peek op byte]). */
export function decodeHistory(bytes: Uint8Array): StageLog[] {
  const out: StageLog[] = [];
  for (let stage = 0; stage < C.STAGES; stage++) {
    const side = (s: Side) => {
      const at = (stage * 2 + s) * 4;
      const [rs = NONE, rslot = 0, pslot = NONE, pop = 0] = bytes.subarray(at, at + 4);
      return {
        rig: rs === NONE ? null : { stage: rs, slot: rslot },
        peek: pslot === NONE ? null : { slot: pslot, op: opFromByte(pop) ?? { kind: 'mul', value: 1 } },
      };
    };
    const [a, b] = [side(0), side(1)];
    out.push({ stage, rigs: [a.rig, b.rig], peeks: [a.peek, b.peek], sprung: [false, false] });
  }
  return out;
}

/** Marks `sprung` from the GOTCHAs (in place: the rig by `riggedBy` naming that stage and slot)
 *  and returns the history. */
export function markSprung(history: StageLog[], gotchas: GotchaLog[]): StageLog[] {
  for (const g of gotchas) {
    const h = history.find((x) => {
      const r = x.rigs[g.riggedBy];
      return !!r && r.stage === g.stage && r.slot === g.slot;
    });
    if (h) h.sprung[g.riggedBy] = true;
  }
  return history;
}

/** A transaction of the match, with an explorer link. */
export interface TxRecord {
  /** e.g. create_match, join_match, delegate_match, plant_rig, finish, settle (Magic Action). */
  what: string;
  signature: string;
  layer: 'base' | 'tee';
  /** Explorer link (TEE txs that touch a private account show as redacted there, by design). */
  url: string;
  /** Side that sent it, when known (the TEE validator sends the Magic Action). */
  by?: Side | 'validator' | 'other';
}

/** Where the money is: 'pending' until the vault is paid out on the base layer. */
export interface SettlementInfo {
  state: 'offline' | 'pending' | 'settled';
  /** 'action' = the Magic Action paid; 'fallback' = someone called settle; 'free' = nothing to pay. */
  by?: 'action' | 'fallback' | 'free';
  signature?: string;
}

export const BASE_EXPLORER = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const TEE_EXPLORER = (sig: string, rpc = 'https://devnet-tee.magicblock.app') =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
export const ACCOUNT_EXPLORER = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;
