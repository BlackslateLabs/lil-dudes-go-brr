// The full reveal of a finished match (result screen, Verify): the layout and every stage's gate
// values rebuilt from the published seed with the same Rust code (WASM), plus every stage's rigs
// and peeks from the published history (rules v3, docs/SPEC.md §6, §11).
import { deals_for } from '@lil-dudes/sim-wasm';
import * as C from './constants';
import { layoutDef, opFromByte, stageDef } from './layout';
import { initSim } from './offline';
import type { GateOp, MatchResult, Side } from './types';

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

// --- payout (SPEC §8) -------------------------------------------------------------------------

/** crates/sim `payout`: who wins and the lamports moved loser → winner, from deaths and gold.
 *  A death moves the whole stake S; both alive splits the pot 2S in the ratio of gold, so the
 *  winner (more gold) gains `floor(S·(gw − gl)/(gw + gl))` (= share_w − S, floored for the
 *  loser); equal gold, both 0 or both dead = draw. Fee = floor(moved · FEE_BPS / 10 000). */
export function resultFor(stake: number, dead: [boolean, boolean], gold: [number, number]): { winner: Side | null; ko: boolean; moved: number; fee: number } {
  const ko = dead[0] || dead[1];
  const draw = { winner: null, ko, moved: 0, fee: 0 };
  let winner: Side;
  let moved: number;
  if (dead[0] && dead[1]) return draw;
  if (dead[0] || dead[1]) {
    winner = dead[0] ? 1 : 0;
    moved = stake;
  } else {
    const [a, b] = gold;
    if (a === b) return draw;
    winner = a > b ? 0 : 1;
    const [gw, gl] = a > b ? [a, b] : [b, a];
    moved = mulDiv(stake, gw - gl, gw + gl);
  }
  return { winner, ko, moved, fee: mulDiv(moved, C.FEE_BPS, 10_000) };
}

/** floor(a · b / d) exactly (BigInt: lamports × gold can pass 2^53). */
const mulDiv = (a: number, b: number, d: number): number => (d === 0 ? 0 : Number((BigInt(a) * BigInt(b)) / BigInt(d)));

/** How the match ended and what the money did, for the result screen. */
export interface PayoutInfo {
  /** 'death' = one player died; 'gold' = both survived, split by gold; 'draw'; 'aborted' = the
   *  match never started (everyone refunded). */
  kind: 'death' | 'gold' | 'draw' | 'aborted';
  free: boolean;
  winner: Side | null;
  /** Who died (null if nobody, or both: then `kind` is 'draw' and `bothDied` is set). */
  died: Side | null;
  bothDied: boolean;
  /** Matched stake S, lamports (each side escrowed S). */
  stake: number;
  gold: [number, number];
  /** Each side's gold share in ‰ of the total (0 when nobody has gold). */
  goldPm: [number, number];
  /** Lamports moved loser → winner before the fee, and the fee (5% of moved). */
  moved: number;
  fee: number;
  /** moved / S in ‰ (1000 for a death). In a free match, what it would have been. */
  sharePm: number;
  /** What each side got back from the vault, and its net change vs. its stake. */
  paid: [number, number];
  net: [number, number];
  /** One neutral line, e.g. "Blue won on gold, 900 to 600 (60.0% of the pot) → takes 20.0% of Red's stake, minus a 5% fee." */
  why: string;
}

const pct = (pm: number) => `${(pm / 10).toFixed(1)}%`;
const SIDE_NAMES = ['Side A', 'Side B'] as const;

export interface PayoutOptions {
  /** The match never started (refunds). */
  aborted?: boolean;
  /** Default "Side A" / "Side B". */
  names?: [string, string];
  /** Who died, if known (tells a double death from an equal-gold draw). */
  dead?: [boolean, boolean];
}

/** SPEC §8 in numbers and one line of words. Money is recomputed with `resultFor` from the
 *  result's deaths and gold (equal to the sim's `moved` / `fee`; the tests check it). */
export function payoutOf(stake: number, result: MatchResultLike | null, opts: PayoutOptions = {}): PayoutInfo {
  const free = stake === 0;
  const n = opts.names ?? [...SIDE_NAMES];
  const gold: [number, number] = result ? [result.gold[0], result.gold[1]] : [0, 0];
  const total = gold[0] + gold[1];
  const goldPm: [number, number] = total > 0 ? [Math.floor((gold[0] * 1000) / total), Math.floor((gold[1] * 1000) / total)] : [0, 0];
  const bothDied = !!opts.dead?.[0] && !!opts.dead[1];
  const base = { free, stake, gold, goldPm, died: null, bothDied, moved: 0, fee: 0, sharePm: 0, paid: [stake, stake] as [number, number], net: [0, 0] as [number, number] };
  const refund = free ? '.' : ', both stakes refunded.';
  if (opts.aborted || !result) {
    return { ...base, kind: 'aborted', winner: null, why: free ? 'The match never started.' : 'The match never started: both stakes refunded.' };
  }
  if (result.winner === null) {
    const why = bothDied
      ? `Both players died on the same tick: draw${refund}`
      : total === 0
        ? `Draw: no gold on either side${refund}`
        : `Draw: equal gold (${gold[0]} each)${refund}`;
    return { ...base, kind: 'draw', winner: null, why };
  }
  const w = result.winner;
  const l: Side = w === 0 ? 1 : 0;
  const dead: [boolean, boolean] = result.died === null ? [false, false] : result.died === 0 ? [true, false] : [false, true];
  const { moved, fee } = resultFor(stake, dead, gold);
  const death = result.died !== null;
  const sharePm = death ? 1000 : stake > 0 ? Math.floor((moved * 1000) / stake) : total > 0 ? Math.floor(((gold[w] - gold[l]) * 1000) / total) : 0;
  const paid: [number, number] = [0, 0];
  paid[w] = stake + moved - fee;
  paid[l] = stake - moved;
  const net: [number, number] = [0, 0];
  net[w] = moved - fee;
  net[l] = -moved;
  const how = death ? `${n[l]} died: ${n[w]} wins` : `${n[w]} won on gold, ${gold[w]} to ${gold[l]} (${pct(goldPm[w])} of the pot)`;
  const money = free
    ? ' (free match: no money moved)'
    : death
      ? ' → takes the whole stake, minus a 5% fee'
      : ` → takes ${pct(sharePm)} of ${n[l]}'s stake, minus a 5% fee`;
  return { ...base, kind: death ? 'death' : 'gold', winner: w, died: result.died, moved, fee, sharePm, paid, net, why: `${how}${money}.` };
}

/** The MatchResult fields payoutOf reads. */
export type MatchResultLike = Pick<MatchResult, 'winner' | 'died' | 'gold'>;

// --- the reveal -------------------------------------------------------------------------------

/** Everything hidden during the match, published at the end, plus what the result screen shows.
 *  The fields after `history` are filled by `OfflineSource.reveal()` and `LiveSource.reveal()`. */
export interface MatchReveal extends Deals {
  seed: bigint;
  /** One entry per stage (the actor's own stage), with `sprung` marked from the GOTCHAs. */
  history: StageLog[];
  matchId?: string;
  names?: [string, string];
  result?: MatchResult | null;
  gold?: [number, number];
  /** Who died (both can, on the same tick). */
  dead?: [boolean, boolean];
  finalTick?: number;
  gotchas?: GotchaLog[];
  payout?: PayoutInfo;
  txs?: TxRecord[];
  settlement?: SettlementInfo;
  /** Explorer link of the Match account on the base layer (live only). */
  matchUrl?: string;
}

/** The seed's layout and values plus the decoded history (`sprung` all false until markSprung). */
export function revealOf(seed: bigint, history: Uint8Array): MatchReveal {
  return { seed, ...dealsFor(seed), history: decodeHistory(history) };
}

/** The value `side`'s gate `slot` of `stage` really had: the dealt value, or ÷2 if the opponent
 *  rigged it (Verify checks every revealed gate against this). */
export function trueOp(r: Pick<MatchReveal, 'values' | 'history'>, side: Side, stage: number, slot: number): GateOp {
  const opp: Side = side === 0 ? 1 : 0;
  const rigged = r.history.some((h) => h.rigs[opp]?.stage === stage && h.rigs[opp]?.slot === slot);
  return rigged ? { kind: 'div', value: 2 } : (r.values[stage]?.[slot] ?? { kind: 'mul', value: 1 });
}
