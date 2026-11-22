import { create } from 'zustand';
import type { MatchResult, Side } from '@lil-dudes/client';

export type Screen = 'home' | 'match' | 'result';
export type StakeTier = 'free' | '0.05' | '0.1' | '0.25';

export const STAKE_TIERS: { id: StakeTier; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: '0.05', label: '0.05' },
  { id: '0.1', label: '0.1' },
  { id: '0.25', label: '0.25' },
];

/** What the Result screen shows about the match that just ended. */
export interface LastMatch {
  result: MatchResult;
  mySide: Side;
  /** Final HP, [you, them]. */
  hp: [number, number];
  names: [string, string];
  /** Matched stake in lamports (0 = free). */
  stake: number;
}

interface AppState {
  screen: Screen;
  stake: StakeTier;
  lastMatch: LastMatch | null;
  go: (screen: Screen) => void;
  setStake: (stake: StakeTier) => void;
  setLastMatch: (m: LastMatch) => void;
}

/** `?screen=match` (or `result`) opens straight to that screen. Dev and screenshot convenience. */
function initialScreen(): Screen {
  const s = new URLSearchParams(window.location.search).get('screen');
  return s === 'match' || s === 'result' ? s : 'home';
}

export const useApp = create<AppState>((set) => ({
  screen: initialScreen(),
  stake: 'free',
  lastMatch: null,
  go: (screen) => set({ screen }),
  setStake: (stake) => set({ stake }),
  setLastMatch: (lastMatch) => set({ lastMatch }),
}));
