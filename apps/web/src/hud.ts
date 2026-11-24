import { create } from 'zustand';
import type { LanePhase, MatchStatus } from '@lil-dudes/client';

/**
 * One side's race track (the race bar): the towers of each stage and how many are down, the town
 * hall, and the bar's fill. Both sides play the same layout, so both tracks have the same icons.
 */
export interface RaceTrack {
  /** Towers per stage (Fight 1, Fight 2), and how many of them are down. */
  towers: number[];
  down: number[];
  /** The town hall: 0 not reached, 1 in the Rush, 2 done. */
  hall: 0 | 1 | 2;
  /** Overrun. */
  dead: boolean;
  /** 0..1: towers broken, plus damage on the live ones, plus the hall. */
  fill: number;
}

const EMPTY_TRACK: RaceTrack = { towers: [], down: [], hall: 0, dead: false, fill: 0 };

/** Low-rate HUD state (≤ 10 updates/s), so React doesn't re-render every frame. [me, them] pairs. */
export interface HudState {
  tick: number;
  status: MatchStatus;
  stake: number;
  names: [string, string];
  gold: [number, number];
  stage: [number, number];
  /** v4 phases; a v5 source may also say 'rush' for the post-breach Rush. */
  phase: [LanePhase, LanePhase];
  /** Ticks since my current phase started (plant countdown). */
  myPhaseTick: number;
  /** Ticks since my breach (v4 raid / v5 Rush) started (0 before it). */
  raidTicks: number;
  /** The race bar: [me, them]. */
  race: [RaceTrack, RaceTrack];
  /** A short race toast under the bar ("Bot cleared Fight 1!"). */
  toast: { text: string; tone: 'good' | 'bad'; at: number } | null;
  peekUsed: boolean;
  /** Scout mode (v4 "peek"): the next tap on one of your `?` gates reveals it, privately. */
  peeking: boolean;
  /** A finger is down on the lane: the cannon fires (rules v6). */
  holding: boolean;
  /** A short centre banner ("FIGHT 2", "TOWER DOWN"). */
  banner: { text: string; tone: 'good' | 'bad' | 'gold'; at: number } | null;
  /** End sequence: when (performance.now()) my last Fight 2 tower fell (BREACH!). */
  breachAt: number | null;
  /** Rush countdown number on screen: 3, 2, 1 (0 = none yet / over). */
  countdown: number;
  /** When "TIME!" was stamped (the Rush clock ran out, or the 3:00 cap). */
  timeAt: number | null;
  /** My dudes that reached the town hall since the breach (v4 raid loot / v5 Rush count). */
  hallCount: number;
  /** When an enemy reached my cannon line (OVERRUN!). */
  overrunAt: number | null;
  /** An enemy is within the last quarter of my lane. */
  danger: boolean;
  ended: { won: boolean | null; died: 'me' | 'them' | null; at: number } | null;
  set: (patch: Partial<Omit<HudState, 'set'>>) => void;
}

export const HUD_RESET: Omit<HudState, 'set'> = {
  tick: 0,
  status: 'waiting',
  stake: 0,
  names: ['You', 'Opponent'],
  gold: [0, 0],
  stage: [0, 0],
  phase: ['plant', 'plant'],
  myPhaseTick: 0,
  raidTicks: 0,
  race: [EMPTY_TRACK, EMPTY_TRACK],
  toast: null,
  peekUsed: false,
  peeking: false,
  holding: false,
  banner: null,
  breachAt: null,
  countdown: 0,
  timeAt: null,
  hallCount: 0,
  overrunAt: null,
  danger: false,
  ended: null,
};

export const useHud = create<HudState>((set) => ({
  ...HUD_RESET,
  set: (patch) => set(patch),
}));
