import {
  CANNON_STEP,
  LANE_WIDTH,
  TICK_MS,
  TICKS_PER_SEC,
  type CohortView,
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
  priv: PrivateView = { myRig: null, myPeek: null };
  curAt = 0;
  /** Previous snapshot's cohorts by id, per side, for interpolation. */
  prevCohorts: [Map<number, CohortView>, Map<number, CohortView>] = [new Map(), new Map()];
  /** Your aim (sim x) and the locally predicted cannon x. */
  aim = LANE_WIDTH / 2;
  myCannon = LANE_WIDTH / 2;

  private eventFns = new Set<EventFn>();
  private viewFns = new Set<ViewFn>();
  private off: (() => void) | null = null;
  private lastAimSent = 0;

  constructor(readonly source: MatchSource) {}

  get mySide(): Side {
    return this.source.mySide;
  }

  start() {
    this.off = this.source.subscribe((view, priv, events) => {
      const first = !this.cur;
      this.prev = this.cur ?? view;
      this.cur = view;
      this.priv = priv;
      this.curAt = performance.now();
      for (const s of [0, 1] as const) {
        const m = this.prevCohorts[s];
        m.clear();
        for (const c of this.prev.sides[s].cohorts) m.set(c.id, c);
      }
      if (first) {
        this.myCannon = view.sides[this.mySide].cannonX;
        this.aim = view.sides[this.mySide].aimX;
      }
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
    this.aim = Math.max(0, Math.min(LANE_WIDTH - 1, this.aim + dx));
    const now = performance.now();
    if (now - this.lastAimSent >= 50) {
      this.lastAimSent = now;
      this.source.setAim(this.aim);
    }
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
