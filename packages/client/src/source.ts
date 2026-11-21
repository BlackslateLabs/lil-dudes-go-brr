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
  /** Rig one opponent cell (0..8) during a plant window. */
  rig(cell: number): void;
  /** Peek one of my own unrevealed cells (0..8) once per phase. */
  peek(cell: number): void;
}
