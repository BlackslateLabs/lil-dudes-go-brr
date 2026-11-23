import { create } from 'zustand';
import type { MatchResult, Side } from '@lil-dudes/client';

export type Screen = 'home' | 'vs' | 'match' | 'result';
export type StakeTier = 'free' | '0.05' | '0.1' | '0.25';

export const STAKE_TIERS: { id: StakeTier; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: '0.05', label: '0.05' },
  { id: '0.1', label: '0.1' },
  { id: '0.25', label: '0.25' },
];

/**
 * One player's score, part by part (SPEC v5 §6), tallied from match events for the result ceremony.
 * `first` and `rush` stay 0 until the v5 rules ship (v4 has the raid loot in `rush`).
 */
export interface ScoreParts {
  damage: number;
  towers: number;
  first: number;
  rush: number;
}

/** What the Result screen shows about the match that just ended. */
export interface LastMatch {
  /** Gold, winner and who died are in the result (sides indexed by Side, not [me, them]). */
  result: MatchResult;
  mySide: Side;
  names: [string, string];
  /** Matched stake in lamports (0 = free). */
  stake: number;
  layoutName: string;
  /** Score parts per side (indexed by Side). */
  breakdown: [ScoreParts, ScoreParts];
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
  return s === 'vs' || s === 'match' || s === 'result' ? s : 'home';
}

export const useApp = create<AppState>((set) => ({
  screen: initialScreen(),
  stake: 'free',
  lastMatch: null,
  go: (screen) => set({ screen }),
  setStake: (stake) => set({ stake }),
  setLastMatch: (lastMatch) => set({ lastMatch }),
}));
