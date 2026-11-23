import type { MatchEvent, MatchView, PrivateView, Side } from './types';

export type MatchListener = (view: MatchView, priv: PrivateView, events: MatchEvent[]) => void;

/**
 * The only thing the web app talks to during a match. Three implementations, same interface:
 * - MockSource:    a hands-off bot-vs-bot match on the real rules (screens, backgrounds)
 * - OfflineSource: real rules via WASM + the local bot
 * - LiveSource:    the Private Ephemeral Rollup feed
 * Swapping between them is a one-line change in the app.
 */
export interface MatchSource {
  /** Which side the viewer plays (draw this side at the bottom). */
  readonly mySide: Side;
  /** Called once per tick (20 Hz) with the new state and that tick's events. Returns unsubscribe. */
  subscribe(listener: MatchListener): () => void;
  start(): void;
  stop(): void;
  /** Target cannon x, 0..LANE_WIDTH. Call freely on drag; sources throttle as needed. */
  setAim(x: number): void;
  /** Call the Champion (SPEC_V5 §4): my next volley is a Champion. Only in my Fight with a full
   *  meter (`LaneView.champMeter >= CHAMP_TICKS`) and none pending; refused calls are ignored. */
  champion(): void;
  /** Whether `champion()` would be accepted now. Sources that take no input say false. */
  canChampion(): boolean;
  /** Scout one of my own face-down gates (slot) in my current stage, during fight/rush, once per
   *  stage (not the timing gate). */
  peek(slot: number): void;
}
