import type { MatchEvent, MatchView, PrivateView, Side } from './types';

export type MatchListener = (view: MatchView, priv: PrivateView, events: MatchEvent[]) => void;

/**
 * The only thing the web app talks to during a match. Three implementations, same interface:
 * - MockSource:    scripted fake, no rules engine (now)
 * - OfflineSource: real rules via WASM + local bot (end of M1)
 * - LiveSource:    the chain feed + WASM prediction (M3)
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
  /**
   * Rig one gate (slot) of the opponent's copy, in the stage they are in now (or enter next, if in
   * transit). Only during my plant, once per stage of mine. Refused calls are ignored (SPEC v3 §6).
   */
  rig(slot: number): void;
  /** Peek one of my own unrevealed gates (slot) in my current stage, during fight/raid, once per stage. */
  peek(slot: number): void;
}
