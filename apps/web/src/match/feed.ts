import {
  CANNON_STEP,
  LANE_WIDTH,
  TICK_MS,
  TICKS_PER_SEC,
  type CohortView,
  type GateView,
  type LaneView,
  type MatchEvent,
  type MatchSource,
  type MatchView,
  type PrivateView,
  type Side,
} from '@lil-dudes/client';

type EventFn = (e: MatchEvent, view: MatchView) => void;
type ViewFn = (view: MatchView, priv: PrivateView) => void;

/**
 * Wraps a MatchSource for rendering: keeps the last two 20 Hz snapshots so the 60 fps renderer can
 * interpolate one tick behind (TECH §5), fans events out to effects/sound/HUD, and predicts your own
 * cannon locally so it moves instantly on drag.
 */
export class MatchFeed {
  prev: MatchView | null = null;
  cur: MatchView | null = null;
  priv: PrivateView = { myPeek: null };
  curAt = 0;
  /** Previous snapshot of MY lane, by id/slot, for interpolation. */
  prevCohorts = new Map<number, CohortView>();
  prevEnemies = new Map<number, CohortView>();
  prevGates = new Map<number, GateView>();
  /** Your aim (sim x) and the locally predicted cannon x. */
  aim = LANE_WIDTH / 2;
  myCannon = LANE_WIDTH / 2;
  /** Whether this player has steered yet (see `start`). */
  private steered = false;

  private eventFns = new Set<EventFn>();
  private viewFns = new Set<ViewFn>();
  private off: (() => void) | null = null;
  private lastAimSent = 0;

  constructor(readonly source: MatchSource) {}

  get mySide(): Side {
    return this.source.mySide;
  }

  get theirSide(): Side {
    return (1 - this.source.mySide) as Side;
  }

  /** My lane in the latest snapshot. */
  get me(): LaneView | null {
    return this.cur?.sides[this.mySide] ?? null;
  }

  get them(): LaneView | null {
    return this.cur?.sides[this.theirSide] ?? null;
  }

  start() {
    this.off = this.source.subscribe((view, priv, events) => {
      const first = !this.cur;
      this.prev = this.cur ?? view;
      this.cur = view;
      this.priv = priv;
      this.curAt = performance.now();
      const mine = this.prev.sides[this.mySide];
      // A new stage replaces gates and wipes cohorts: don't interpolate across it.
      const sameStage = mine.stage === view.sides[this.mySide].stage;
      this.prevCohorts.clear();
      this.prevEnemies.clear();
      this.prevGates.clear();
      if (sameStage) {
        for (const c of mine.cohorts) this.prevCohorts.set(c.id, c);
        for (const c of mine.enemies) this.prevEnemies.set(c.id, c);
        for (const g of mine.gates) this.prevGates.set(g.slot, g);
      }
      if (first) this.myCannon = view.sides[this.mySide].cannonX;
      // Until this player steers, follow the source's aim: a bot driving my side (autoplay, the
      // home background) moves the cannon in the source, and the drawn cannon must go with it.
      if (!this.steered) this.aim = view.sides[this.mySide].aimX;
      for (const e of events) for (const fn of this.eventFns) fn(e, view);
      for (const fn of this.viewFns) fn(view, priv);
    });
    this.source.start();
  }

  stop() {
    this.source.stop();
    this.off?.();
    this.off = null;
  }

  onEvent(fn: EventFn): () => void {
    this.eventFns.add(fn);
    return () => this.eventFns.delete(fn);
  }

  onView(fn: ViewFn): () => void {
    this.viewFns.add(fn);
    return () => this.viewFns.delete(fn);
  }

  /** 0..1 from prev to cur (rendering one tick behind, so corrections stay invisible). */
  alpha(now = performance.now()): number {
    return Math.min(1, Math.max(0, (now - this.curAt) / TICK_MS));
  }

  /** Relative drag: move the aim by a sim-x delta. Sends to the source at most ~20/s. */
  nudgeAim(dx: number) {
    this.steered = true;
    this.aim = Math.max(0, Math.min(LANE_WIDTH - 1, this.aim + dx));
    const now = performance.now();
    if (now - this.lastAimSent >= 50) {
      this.lastAimSent = now;
      this.source.setAim(this.aim);
    }
  }

  /** Set an absolute aim and send it now (bots / background matches). */
  setAim(x: number) {
    this.steered = true;
    this.aim = Math.max(0, Math.min(LANE_WIDTH - 1, x));
    this.source.setAim(this.aim);
  }

  /** Flush the latest aim (pointer up), so the last drag position is never lost to throttling. */
  flushAim() {
    this.source.setAim(this.aim);
  }

  /** Advance the local cannon prediction toward the aim at the sim's cannon speed. */
  predict(dt: number) {
    const max = CANNON_STEP * TICKS_PER_SEC * dt;
    const d = this.aim - this.myCannon;
    this.myCannon += Math.abs(d) <= max ? d : Math.sign(d) * max;
  }
}
