// The full reveal of a finished match (result screen, Verify): every deal rebuilt from the
// published seed with the same Rust code (WASM), plus every phase's rigs and peeks.
import { deals_for } from '@lil-dudes/sim-wasm';
import * as C from './constants';
import { opOf } from './codec';
import { initSim } from './offline';
import type { GateOp, Hint, MatchResult, Side } from './types';

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
  /** `sprung[s]`: side s's rig was hit (a GOTCHA); false if it never was or there was no rig. */
  sprung: [boolean, boolean];
}

/** A rig that was hit: `side`'s stream passed the cell `riggedBy` rigged on `side`'s grid. */
export interface GotchaLog {
  phase: number;
  tick: number;
  side: Side;
  cell: number;
  riggedBy: Side;
}

/** How the match ended and what the money did (SPEC §7), for the result screen. */
export interface PayoutInfo {
  /** 'aborted' = the match never started (everyone refunded). */
  kind: 'ko' | 'timer' | 'draw' | 'aborted';
  free: boolean;
  winner: Side | null;
  /** Matched stake S, lamports (each side escrowed S). */
  stake: number;
  /** Timer win: (winner HP − loser HP) in ‰ of HP_MAX (SPEC §7 `lead_pm`). */
  leadPm: number;
  /** Lamports moved loser → winner before the fee, and the fee (5% of moved). */
  moved: number;
  fee: number;
  /** moved / S in ‰ (1000 for a KO). */
  sharePm: number;
  /** What each side got back from the vault, and its net change vs. its stake. */
  paid: [number, number];
  net: [number, number];
  /** One neutral line, e.g. "Blue won on the timer by 22.0% HP → takes 61.0% of the stake, minus a 5% fee". */
  why: string;
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

/** Everything hidden during the match, published at the end, plus what the result screen shows.
 *  The fields after `history` are filled by `OfflineSource.reveal()` and `LiveSource.reveal()`. */
export interface MatchReveal {
  seed: bigint;
  deals: Deal[];
  history: PhaseLog[];
  matchId?: string;
  names?: [string, string];
  result?: MatchResult | null;
  hp?: [number, number];
  finalTick?: number;
  gotchas?: GotchaLog[];
  payout?: PayoutInfo;
  txs?: TxRecord[];
  settlement?: SettlementInfo;
  /** Explorer link of the Match account on the base layer (live only). */
  matchUrl?: string;
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
    out.push({ phase, rigs: [a.rig, b.rig], peeks: [a.peek, b.peek], sprung: [false, false] });
  }
  return out;
}

export function revealOf(seed: bigint, history: Uint8Array): MatchReveal {
  return { seed, deals: dealsFor(seed), history: decodeHistory(history) };
}

const pct = (pm: number) => `${(pm / 10).toFixed(1)}%`;
const SIDE_NAMES = ['Side A', 'Side B'] as const;

/** SPEC §7 in numbers and one line of words. `names` defaults to "Side A" / "Side B". */
export function payoutOf(stake: number, result: MatchResult | null, hp: [number, number], aborted = false, names?: [string, string]): PayoutInfo {
  const free = stake === 0;
  const n = names ?? [...SIDE_NAMES];
  const base = { free, stake, leadPm: 0, moved: 0, fee: 0, sharePm: 0, paid: [stake, stake] as [number, number], net: [0, 0] as [number, number] };
  if (aborted || !result) {
    return { ...base, kind: 'aborted', winner: null, why: free ? 'The match never started.' : 'The match never started: both stakes refunded.' };
  }
  if (result.winner === null) {
    return { ...base, kind: 'draw', winner: null, why: free ? 'Draw: equal HP.' : 'Draw: equal HP, both stakes refunded.' };
  }
  const w = result.winner;
  const l = w === 0 ? 1 : 0;
  const leadPm = Math.min(1000, Math.floor(((hp[w] - hp[l]) * 1000) / C.HP_MAX));
  const moved = Math.min(result.moved, stake);
  const fee = Math.min(result.fee, moved);
  const sharePm = stake > 0 ? Math.floor((moved * 1000) / stake) : result.ko ? 1000 : 500 + Math.floor(leadPm / 2);
  const paid: [number, number] = [0, 0];
  paid[w] = stake + moved - fee;
  paid[l] = stake - moved;
  const net: [number, number] = [0, 0];
  net[w] = moved - fee;
  net[l] = -moved;
  const how = result.ko ? `${n[w]} won by KO` : `${n[w]} won on the timer by ${pct(leadPm)} HP`;
  const money = free ? ' (free match: no money moved)' : result.ko ? ' → takes the whole stake, minus a 5% fee' : ` → takes ${pct(sharePm)} of the stake, minus a 5% fee`;
  return { free, stake, kind: result.ko ? 'ko' : 'timer', winner: w, leadPm, moved, fee, sharePm, paid, net, why: `${how}${money}.` };
}

/** Marks `history[phase].sprung` from the GOTCHAs (in place) and returns the history. */
export function markSprung(history: PhaseLog[], gotchas: GotchaLog[]): PhaseLog[] {
  for (const g of gotchas) {
    const h = history[g.phase];
    if (h && h.rigs[g.riggedBy] === g.cell) h.sprung[g.riggedBy] = true;
  }
  return history;
}

export const BASE_EXPLORER = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
export const TEE_EXPLORER = (sig: string, rpc = 'https://devnet-tee.magicblock.app') =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpc)}`;
export const ACCOUNT_EXPLORER = (address: string) => `https://explorer.solana.com/address/${address}?cluster=devnet`;
