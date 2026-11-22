// OfflineSource: the real rules (crates/sim, compiled to WASM in @lil-dudes/sim-wasm) plus the
// Warlord bot on the other side, with no chain. Same behaviour contract as LiveSource: 20 Hz
// ticks, subscribe / start / stop / setAim / rig / peek. It is also the fallback demo.
import { constants_json, initSync, layout_version, rules_version, SimMatch } from '@lil-dudes/sim-wasm';
import { wasmBase64 } from '@lil-dudes/sim-wasm/inline';
import * as C from './constants';
import { opFromSigned } from './layout';
import type { MatchListener, MatchSource } from './source';
import { markSprung, payoutOf, revealOf, type GotchaLog, type MatchReveal } from './verify';
import { matchView, sideOf, type LaneState, type RawResult } from './view';
import type { MatchEvent, MatchView, PrivateView, Side } from './types';

/** Must equal LAYOUT_VERSION in crates/sim-wasm/src/lib.rs (the flat layouts are documented there). */
const LAYOUT_VERSION = 3;
const EVENT_STRIDE = 8;
const PHASE_NAMES = ['plant', 'fight', 'transit', 'raid', 'done'] as const;

let ready = false;

/** Load the WASM sim (synchronous, once). The OfflineSource constructor calls it. */
export function initSim(): void {
  if (ready) return;
  const bin = atob(wasmBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  initSync({ module: bytes });
  if (layout_version() !== LAYOUT_VERSION) {
    throw new Error(`@lil-dudes/sim-wasm layout ${layout_version()} != ${LAYOUT_VERSION}: rebuild or update offline.ts`);
  }
  ready = true;
}

/** The Rust constants and level pool, straight from the WASM build (raw JSON: snake_case keys
 *  inside LAYOUTS). The parity test compares them to constants.ts. */
export function simConstants(): Record<string, unknown> {
  initSim();
  return JSON.parse(constants_json()) as Record<string, unknown>;
}

/** crates/sim RULES_VERSION of the bundled build. */
export function simRulesVersion(): number {
  initSim();
  return rules_version();
}

export interface OfflineOptions {
  /** Which side the viewer plays. Default 0. The bot plays the other side. */
  mySide?: Side;
  myName?: string;
  opponentName?: string;
  /** Lamports. Default 0 (free). Only affects the payout numbers in the result. */
  stake?: number;
  /** Playback speed multiplier (2 = twice as fast). Default 1. */
  speed?: number;
  /** Match seed (decides the layout and every gate value). Default: random. Same seed + same inputs = same match. */
  seed?: bigint;
  /** Bot seed (tie-breaks, its rig/peek slots). Default: random, independent of `seed`. */
  botSeed?: bigint;
  /** Guided first match: side 0's Fight 1 waves at TUTORIAL_WAVE_PCT (SPEC §10). Default false. */
  tutorial?: boolean;
  /** The bot also drives `mySide` (inputs are ignored): a hands-off match for the Home-screen
   *  background, demos and tests. Default false. */
  selfBot?: boolean;
}

function randomU64(): bigint {
  const w = new Uint32Array(2);
  crypto.getRandomValues(w);
  return (BigInt(w[0]!) << 32n) | BigInt(w[1]!);
}

/** A gate slot the u8 binding can take (the sim refuses the rest of the invalid ones). */
const isSlot = (slot: number) => Number.isInteger(slot) && slot >= 0 && slot < C.GATES_MAX;

export class OfflineSource implements MatchSource {
  readonly mySide: Side;
  /** The match seed. Offline there is nothing to hide; live matches reveal it at the end (Verify). */
  readonly seed: bigint;
  readonly matchId: string;
  private readonly sim: SimMatch;
  private readonly names: [string, string];
  private readonly speed: number;
  private listeners = new Set<MatchListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: { view: MatchView; priv: PrivateView };
  private lanes: [LaneState, LaneState] | null = null;
  private gotchas: GotchaLog[] = [];

  constructor(opts: OfflineOptions = {}) {
    initSim();
    this.mySide = opts.mySide ?? 0;
    this.seed = opts.seed ?? randomU64();
    this.speed = opts.speed ?? 1;
    this.matchId = `offline-${this.seed.toString(16)}`;
    const me = opts.myName ?? 'You';
    const them = opts.opponentName ?? 'Warlord';
    this.names = this.mySide === 0 ? [me, them] : [them, me];
    const botMask = opts.selfBot ? 0b11 : this.mySide === 0 ? 0b10 : 0b01;
    const stake = BigInt(Math.max(0, Math.floor(opts.stake ?? 0)));
    this.sim = new SimMatch(this.seed, opts.botSeed ?? randomU64(), stake, botMask, opts.tutorial ?? false);
    this.current = { view: this.decodeView(), priv: this.decodePrivate() };
  }

  subscribe(listener: MatchListener): () => void {
    this.listeners.add(listener);
    listener(this.current.view, this.current.priv, []);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer || this.current.view.result) return;
    this.timer = setInterval(() => this.step(), C.TICK_MS / this.speed);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setAim(x: number): void {
    if (!Number.isFinite(x)) return;
    const aim = Math.round(Math.max(0, Math.min(C.LANE_WIDTH - 1, x)));
    this.sim.set_input(this.mySide, aim, undefined, undefined);
  }

  /** Rig from my own lane: gate `slot` of my current stage, trapped in the opponent's copy (see
   *  MatchSource.rig). Passed straight to the sim, which refuses what `canRig` says no to. */
  rig(slot: number): void {
    // Out-of-range numbers must not reach the u8 binding.
    if (isSlot(slot)) this.sim.set_input(this.mySide, undefined, slot, undefined);
  }

  /** The sim's own rig rule for `mySide` right now (`SimMatch.can_rig`). */
  canRig(slot: number): boolean {
    return isSlot(slot) && !this.current.view.result && this.sim.can_rig(this.mySide, slot);
  }

  peek(slot: number): void {
    if (isSlot(slot)) this.sim.set_input(this.mySide, undefined, undefined, slot);
  }

  /** Advance one tick now (tests, headless runs). Inputs queued since the last tick apply to it. */
  step(): void {
    const before = this.lanes!;
    if (!this.sim.step()) {
      this.stop();
      return;
    }
    const view = this.decodeView();
    const events = this.decodeEvents(before, view);
    this.current = { view, priv: this.decodePrivate() };
    for (const e of events) {
      if (e.type === 'gotcha') this.gotchas.push({ stage: e.stage, tick: view.tick - 1, side: e.side, slot: e.slot, riggedBy: e.riggedBy });
    }
    for (const l of this.listeners) l(view, this.current.priv, events);
    if (view.result) this.stop();
  }

  /** Latest state (the same objects the last listener call got). */
  get view(): MatchView {
    return this.current.view;
  }

  /** Latest private view of `mySide`. */
  get priv(): PrivateView {
    return this.current.priv;
  }

  /** Digest of the full sim state (public + secret); equal across Rust, WASM and replays. */
  digest(): bigint {
    return this.sim.digest();
  }

  /** The result screen's data (same shape as LiveSource.reveal()): layout and every stage's
   *  values, every stage's rigs and peeks (with `sprung`), GOTCHAs, gold, deaths, payout and why.
   *  Offline the seed is no secret, so this works mid-match too (result/payout then describe the
   *  current state). No txs. */
  reveal(): MatchReveal {
    const v = this.current.view;
    const base = revealOf(this.seed, this.sim.history());
    const names: [string, string] = [v.sides[0].name, v.sides[1].name];
    const dead: [boolean, boolean] = [v.sides[0].phase === 'dead', v.sides[1].phase === 'dead'];
    return {
      ...base,
      history: markSprung(base.history, this.gotchas),
      matchId: this.matchId,
      names,
      result: v.result,
      gold: [v.sides[0].gold, v.sides[1].gold],
      dead,
      finalTick: v.tick,
      gotchas: [...this.gotchas],
      payout: payoutOf(v.stake, v.result, { names, dead }),
      txs: [],
      settlement: { state: 'offline' },
    };
  }

  /** The public state in the on-chain Match account layout (decode with `decodePublic`). */
  publicBytes(): Uint8Array {
    return this.sim.public_bytes();
  }

  /** Every stage's rigs and peeks so far, in the codec history layout (`decodeHistory`). */
  history(): Uint8Array {
    return this.sim.history();
  }

  /** Stop and free the WASM memory now (otherwise it is freed when garbage-collected). */
  dispose(): void {
    this.stop();
    this.listeners.clear();
    this.sim.free();
  }

  // --- decoding the flat layouts of crates/sim-wasm/src/lib.rs ---------------------------------

  private decodeView(): MatchView {
    const v = this.sim.view();
    let i = 0;
    const next = () => v[i++] ?? 0;
    if (next() !== LAYOUT_VERSION) throw new Error('sim view layout mismatch');
    const tick = next();
    next(); // ended (= has result)
    const layout = next();
    const stake = next();
    const hasResult = next() === 1;
    const winner = next();
    const ko = next() === 1;
    const moved = next();
    const fee = next();
    const bot: [boolean, boolean] = [false, false];
    const lane = (s: Side): LaneState => {
      const stage = next();
      const phase = next();
      const phaseTicks = next();
      const dead = next() === 1;
      const cannonX = next();
      const aimX = next();
      const gold = next();
      const rigUsed = next() === 1;
      const peekUsed = next() === 1;
      bot[s] = next() === 1;
      const raidTicks = next();
      const towers = Array.from({ length: C.TOWERS_MAX }, next);
      const crates = Array.from({ length: C.CRATES_MAX }, next);
      const gates = Array.from({ length: C.GATES_MAX }, () => ({ x: next(), revealed: opFromSigned(next()) }));
      const cohorts = Array.from({ length: next() }, () => ({ id: next(), count: next(), x: next(), y: next(), age: next() }));
      const enemies = Array.from({ length: next() }, () => ({ id: next(), count: next(), x: next(), y: next(), tower: next() }));
      return { stage, phase, phaseTicks, raidTicks, dead, cannonX, aimX, gold, rigUsed, peekUsed, towers, crates, gates, cohorts, enemies };
    };
    const lanes: [LaneState, LaneState] = [lane(0), lane(1)];
    this.lanes = lanes;
    const result: RawResult | null = hasResult ? { winner: winner < 0 ? null : sideOf(winner), ko, moved, fee } : null;
    return matchView({ matchId: this.matchId, tick, layout, stake, bot, names: this.names, lanes, result });
  }

  private decodePrivate(): PrivateView {
    const [stage = 0, rigStage = -1, rigSlot = -1, peekSlot = -1, peekOp = 0] = this.sim.private_view(this.mySide);
    const op = opFromSigned(peekOp);
    return {
      myRig: rigStage < 0 || rigSlot < 0 ? null : { stage: rigStage, slot: rigSlot },
      myPeek: peekSlot < 0 || !op ? null : { stage, slot: peekSlot, op },
    };
  }

  /** `before`: the lanes before this step (reveals and GOTCHAs name the stage they happened in;
   *  a `stage` event later in the same tick moves it on). `view`: after the step (the result). */
  private decodeEvents(before: [LaneState, LaneState], view: MatchView): MatchEvent[] {
    const v = this.sim.events();
    const out: MatchEvent[] = [];
    const stage = [before[0].stage, before[1].stage];
    const broken = new Set<string>();
    for (let i = 0; i + EVENT_STRIDE <= v.length; i += EVENT_STRIDE) {
      const [t, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0] = v.subarray(i, i + EVENT_STRIDE);
      const side = sideOf(a);
      switch (t) {
        case 0:
          out.push({ type: 'volley', side, cohortId: b, x: c, count: d });
          break;
        case 1: {
          const op = opFromSigned(d);
          if (g === 1 && op) out.push({ type: 'reveal', side, stage: stage[side]!, slot: b, op });
          out.push({ type: 'gate', side, slot: b, cohortId: c, before: e, after: f });
          break;
        }
        case 2:
          out.push({ type: 'gotcha', side, stage: stage[side]!, slot: b, riggedBy: sideOf(c) });
          break;
        case 3:
          // A hit that breaks the crate is reported broken here; the sim's separate "broken"
          // event that follows is then dropped (one event per crate hit).
          if (e === 0) broken.add(`${side}:${b}`);
          out.push({ type: 'crate', side, index: b, hp: e, broken: e === 0 });
          break;
        case 4:
          if (!broken.has(`${side}:${b}`)) out.push({ type: 'crate', side, index: b, hp: 0, broken: true });
          break;
        case 5:
          out.push({ type: 'wave', side, tower: b, cohortId: c, count: e });
          break;
        case 6:
          out.push({ type: 'clash', side, x: b, y: c, killed: d });
          break;
        case 7:
          out.push({ type: 'towerHit', side, tower: b, damage: c, hp: d, gold: e });
          break;
        case 8:
          out.push({ type: 'towerDown', side, tower: b, gold: c });
          break;
        case 9:
          out.push({ type: 'loot', side, count: c, gold: d });
          break;
        case 10:
          stage[side] = b;
          out.push({ type: 'stage', side, stage: b, phase: PHASE_NAMES[c] ?? 'plant' });
          break;
        case 11:
          out.push({ type: 'death', side });
          break;
        case 12:
          if (view.result) out.push({ type: 'end', result: view.result });
          break;
      }
    }
    return out;
  }
}
