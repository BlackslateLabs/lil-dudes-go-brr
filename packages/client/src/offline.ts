// OfflineSource: the real rules (crates/sim, compiled to WASM in @lil-dudes/sim-wasm) plus the
// Warlord bot on the other side, with no chain. Same behaviour contract as MockSource: 20 Hz
// ticks, subscribe / start / stop / setAim / rig / peek. It is also the fallback demo.
import { constants_json, initSync, layout_version, rules_version, SimMatch } from '@lil-dudes/sim-wasm';
import { wasmBase64 } from '@lil-dudes/sim-wasm/inline';
import * as C from './constants';
import type { MatchListener, MatchSource } from './source';
import type {
  CohortView,
  GateOp,
  GateView,
  Hint,
  MatchEvent,
  MatchResult,
  MatchStatus,
  MatchView,
  PrivateView,
  SideView,
  Side,
} from './types';

/** Must equal LAYOUT_VERSION in crates/sim-wasm/src/lib.rs (the flat layouts are documented there). */
const LAYOUT_VERSION = 1;
const EVENT_STRIDE = 6;

let ready = false;

/** Load the WASM sim (synchronous, ~45 KB, once). The OfflineSource constructor calls it. */
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

/** The Rust constants, straight from the WASM build (the parity test compares them to constants.ts). */
export function simConstants(): Record<string, number | number[]> {
  initSim();
  return JSON.parse(constants_json()) as Record<string, number | number[]>;
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
  /** Match seed (decides every deal). Default: random. Same seed + same inputs = same match. */
  seed?: bigint;
  /** Bot seed (tie-breaks, its rig/peek cells). Default: random, independent of `seed`. */
  botSeed?: bigint;
  /** Guided first match: the bot holds back in phase 1 (SPEC §9). Default false. */
  tutorial?: boolean;
}

const STATUS: readonly MatchStatus[] = ['plant', 'playing', 'ended'];
const HINTS: readonly Hint[] = ['none', 'good', 'bad', 'gold'];
const OPS: readonly GateOp['kind'][] = ['mul', 'add', 'sub', 'div'];

const op = (kind: number, value: number): GateOp => ({ kind: OPS[kind] ?? 'mul', value });
const side = (n: number): Side => (n === 1 ? 1 : 0);
const isCell = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < C.CELLS;

function randomU64(): bigint {
  const w = new Uint32Array(2);
  crypto.getRandomValues(w);
  return (BigInt(w[0]!) << 32n) | BigInt(w[1]!);
}

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

  constructor(opts: OfflineOptions = {}) {
    initSim();
    this.mySide = opts.mySide ?? 0;
    this.seed = opts.seed ?? randomU64();
    this.speed = opts.speed ?? 1;
    this.matchId = `offline-${this.seed.toString(16)}`;
    const me = opts.myName ?? 'You';
    const them = opts.opponentName ?? 'Warlord';
    this.names = this.mySide === 0 ? [me, them] : [them, me];
    const botMask = this.mySide === 0 ? 0b10 : 0b01;
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

  rig(cell: number): void {
    // The sim ignores invalid rigs; out-of-range numbers must not reach the u8 binding.
    if (isCell(cell)) this.sim.set_input(this.mySide, undefined, cell, undefined);
  }

  peek(cell: number): void {
    if (isCell(cell)) this.sim.set_input(this.mySide, undefined, undefined, cell);
  }

  /** Advance one tick now (tests, headless runs). Inputs queued since the last tick apply to it. */
  step(): void {
    if (!this.sim.step()) {
      this.stop();
      return;
    }
    const events = this.decodeEvents();
    this.current = { view: this.decodeView(), priv: this.decodePrivate() };
    const { view, priv } = this.current;
    for (const l of this.listeners) l(view, priv, events);
    if (view.result) this.stop();
  }

  /** Latest state (the same objects the last listener call got). */
  get view(): MatchView {
    return this.current.view;
  }

  /** Digest of the full sim state (public + secret); equal across Rust, WASM and replays. */
  digest(): bigint {
    return this.sim.digest();
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
    const status = STATUS[next()] ?? 'playing';
    const phase = next();
    const surge = next() === 1;
    const stake = next();
    const hasResult = next() === 1;
    const winner = next();
    const ko = next() === 1;
    const moved = next();
    const fee = next();
    const sides = ([0, 1] as const).map((s): SideView => {
      const hp = next();
      const cannonX = next();
      const aimX = next();
      const rigUsed = next() === 1;
      const peekUsed = next() === 1;
      const isBot = next() === 1;
      const gates: GateView[] = [];
      for (let cell = 0; cell < C.CELLS; cell++) {
        const hint = HINTS[next()] ?? 'none';
        const gold = next() === 1;
        const revealed = next() === 1;
        const kind = next();
        const value = next();
        gates.push({ cell, hint: revealed ? 'none' : hint, revealed: revealed ? op(kind, value) : null, gold });
      }
      const n = next();
      const cohorts: CohortView[] = [];
      for (let k = 0; k < n; k++) {
        cohorts.push({ id: next(), count: next(), x: next(), y: next(), age: next() });
      }
      return { name: this.names[s], isBot, hp, cannonX, aimX, cohorts, gates, rigUsed, peekUsed };
    }) as [SideView, SideView];
    const result: MatchResult | null = hasResult
      ? { winner: winner < 0 ? null : side(winner), ko, moved, fee }
      : null;
    return { matchId: this.matchId, tick, status, phase, surge, stake, sides, result };
  }

  private decodePrivate(): PrivateView {
    const [rig = -1, peekCell = -1, kind = 0, value = 0, gold = 0] = this.sim.private_view(this.mySide);
    return {
      myRig: rig < 0 ? null : rig,
      myPeek: peekCell < 0 ? null : { cell: peekCell, op: op(kind, value), gold: gold === 1 },
    };
  }

  private decodeEvents(): MatchEvent[] {
    const v = this.sim.events();
    const out: MatchEvent[] = [];
    for (let i = 0; i + EVENT_STRIDE <= v.length; i += EVENT_STRIDE) {
      const [t, a = 0, b = 0, c = 0, d = 0, e = 0] = v.subarray(i, i + EVENT_STRIDE);
      switch (t) {
        case 0:
          out.push({ type: 'volley', side: side(a), cohortId: b, x: c, count: d });
          break;
        case 1:
          out.push({ type: 'reveal', side: side(a), cell: b, op: op(c, d), gold: e === 1 });
          break;
        case 2:
          out.push({ type: 'gate', side: side(a), cell: b, cohortId: c, before: d, after: e });
          break;
        case 3:
          out.push({ type: 'gotcha', side: side(a), cell: b, riggedBy: side(c) });
          break;
        case 4:
          out.push({ type: 'clash', x: a, y: b, killedA: c, killedB: d });
          break;
        case 5:
          out.push({ type: 'hit', side: side(a), damage: b, hp: c });
          break;
        case 6:
          out.push({ type: 'plant', phase: a });
          break;
        case 7:
          out.push({ type: 'redeal', phase: a });
          break;
        case 8:
          out.push({ type: 'surge' });
          break;
        case 9:
          out.push({ type: 'end', result: { winner: a < 0 ? null : side(a), ko: b === 1, moved: c, fee: d } });
          break;
      }
    }
    return out;
  }
}
