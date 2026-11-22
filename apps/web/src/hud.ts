import { create } from 'zustand';
import type { LanePhase, MatchStatus } from '@lil-dudes/client';

/** Low-rate HUD state (≤ 10 updates/s), so React doesn't re-render every frame. [me, them] pairs. */
export interface HudState {
  tick: number;
  status: MatchStatus;
  stake: number;
  names: [string, string];
  gold: [number, number];
  stage: [number, number];
  phase: [LanePhase, LanePhase];
  /** Ticks since my current phase started (plant countdown). */
  myPhaseTick: number;
  /** Ticks since my town hall raid started (0 before it). */
  raidTicks: number;
  rigUsed: boolean;
  peekUsed: boolean;
  /** Peek mode: the next tap on one of your `?` gates peeks it. */
  peeking: boolean;
  /** Rig mode: the next tap on one of your gates rigs the opponent's copy of it (SPEC v4 §6). */
  rigging: boolean;
  /** Last GOTCHA: whether it hit me, and when (performance.now()) to restart the animation. */
  gotcha: { onMe: boolean; at: number } | null;
  /** A short centre banner ("STAGE 2", "RAID!", "TOWER DOWN"). */
  banner: { text: string; tone: 'good' | 'bad' | 'gold'; at: number } | null;
  ended: { won: boolean | null; died: 'me' | 'them' | null } | null;
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
  rigUsed: false,
  peekUsed: false,
  peeking: false,
  rigging: false,
  gotcha: null,
  banner: null,
  ended: null,
};

export const useHud = create<HudState>((set) => ({
  ...HUD_RESET,
  set: (patch) => set(patch),
}));
