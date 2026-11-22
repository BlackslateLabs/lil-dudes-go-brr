import { create } from 'zustand';
import type { MatchStatus } from '@lil-dudes/client';

/** Low-rate HUD state (≤ 10 updates/s), so React doesn't re-render every frame. */
export interface HudState {
  tick: number;
  status: MatchStatus;
  phase: number;
  surge: boolean;
  stake: number;
  names: [string, string];
  /** Dudes on the field, [you, them]. */
  totals: [number, number];
  rigUsed: boolean;
  peekUsed: boolean;
  /** Peek mode: the next tap on one of your `?` gates peeks it. */
  peeking: boolean;
  /** Last GOTCHA: whether it hit you, and when (performance.now()) to restart the animation. */
  gotcha: { onMe: boolean; at: number } | null;
  surgeAt: number | null;
  ended: { ko: boolean; won: boolean | null } | null;
  set: (patch: Partial<Omit<HudState, 'set'>>) => void;
}

export const HUD_RESET: Omit<HudState, 'set'> = {
  tick: 0,
  status: 'plant',
  phase: 0,
  surge: false,
  stake: 0,
  names: ['You', 'Opponent'],
  totals: [0, 0],
  rigUsed: false,
  peekUsed: false,
  peeking: false,
  gotcha: null,
  surgeAt: null,
  ended: null,
};

export const useHud = create<HudState>((set) => ({
  ...HUD_RESET,
  set: (patch) => set(patch),
}));
