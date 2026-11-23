// MockSource: a scripted, hands-off match for building screens. It is the real rules (WASM)
// with the Warlord bot on BOTH sides, so every MatchView field and every MatchEvent is v5-correct
// and nothing needs input (setAim / champion / peek are ignored). `startTick` fast-forwards.
import { OfflineSource } from './offline';
import type { MatchListener, MatchSource } from './source';
import type { MatchView, PrivateView, Side } from './types';

export interface MockOptions {
  /** Which side the viewer watches. Default 0. */
  mySide?: Side;
  myName?: string;
  opponentName?: string;
  /** Lamports. Default 0 (free). */
  stake?: number;
  /** Playback speed multiplier for testing (2 = twice as fast). Default 1. */
  speed?: number;
  /** Start at this tick (played instantly, no events), e.g. to jump to Fight 2 or the Rush. Default 0. */
  startTick?: number;
  /** Match / bot seeds. Default: fixed, so the mock plays the same match every time. */
  seed?: bigint;
  botSeed?: bigint;
}

export class MockSource implements MatchSource {
  readonly mySide: Side;
  private readonly src: OfflineSource;

  constructor(opts: MockOptions = {}) {
    this.mySide = opts.mySide ?? 0;
    this.src = new OfflineSource({
      mySide: this.mySide,
      myName: opts.myName ?? 'You',
      opponentName: opts.opponentName ?? 'Warlord',
      stake: opts.stake,
      speed: opts.speed,
      seed: opts.seed ?? 20261120n,
      botSeed: opts.botSeed ?? 7n,
      selfBot: true,
    });
    const until = Math.max(0, Math.floor(opts.startTick ?? 0));
    // No listeners yet: the fast-forward emits nothing.
    while (this.src.view.tick < until && !this.src.view.result) this.src.step();
  }

  subscribe(listener: MatchListener): () => void {
    return this.src.subscribe(listener);
  }

  start(): void {
    this.src.start();
  }

  stop(): void {
    this.src.stop();
  }

  /** Ignored: the bot plays this side too. */
  setAim(_x: number): void {}
  setFiring(_on: boolean): void {}
  champion(): void {}
  /** Always false: the bot plays this side. */
  canChampion(): boolean {
    return false;
  }
  peek(_slot: number): void {}

  /** Advance one tick now (tests). */
  step(): void {
    this.src.step();
  }

  get view(): MatchView {
    return this.src.view;
  }

  get priv(): PrivateView {
    return this.src.priv;
  }

  dispose(): void {
    this.src.dispose();
  }
}
