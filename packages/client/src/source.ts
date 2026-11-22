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
  /**
   * Rig from my own lane (SPEC v4 §6): `slot` names a gate of MY current stage, and the trap lands
   * on the same slot of the opponent's copy of that stage (both lanes are the same level). Any
   * phase (plant, fight, transit, raid) while I am alive and not done, once per stage of mine.
   * Refused (and not used up) when the opponent is dead or done, already past my stage, on my
   * stage with that gate already revealed in their lane, the slot doesn't exist, or that stage of
   * theirs is already rigged. Refused calls are ignored; ask `canRig` first to grey out gates.
   */
  rig(slot: number): void;
  /**
   * Whether `rig(slot)` would be accepted right now (the sim's own rule, from public state only).
   * Cheap: call it per gate per frame to grey out the ones that can't be rigged. Sources that take
   * no input (MockSource) always say false.
   */
  canRig(slot: number): boolean;
  /** Peek one of my own unrevealed gates (slot) in my current stage, during fight/raid, once per stage. */
  peek(slot: number): void;
}
