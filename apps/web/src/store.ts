import { create } from 'zustand';
import type { MatchResult, Side } from '@lil-dudes/client';
import { sfx } from './feel/sound';

export type Screen = 'home' | 'vs' | 'match' | 'result';
export type StakeTier = 'free' | '0.05' | '0.1' | '0.25';

export const STAKE_TIERS: { id: StakeTier; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: '0.05', label: '0.05' },
  { id: '0.1', label: '0.1' },
  { id: '0.25', label: '0.25' },
];

/** A stake tier in lamports (0 = free). */
export function tierLamports(tier: StakeTier): number {
  return tier === 'free' ? 0 : Math.round(Number(tier) * 1e9);
}

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
  /** The opponent was a bot (from `LaneView.isBot`): the result labels it "Bot", whatever its name. */
  opponentIsBot?: boolean;
}

/**
 * The logo wipe between screens: `in` = panels closing over the old screen (0.8 s), then the screen
 * swaps and `out` = panels opening on the new one (0.35 s).
 */
export type WipeState = 'idle' | 'in' | 'out';
export const WIPE_IN_MS = 800;
export const WIPE_OUT_MS = 350;

interface AppState {
  screen: Screen;
  stake: StakeTier;
  lastMatch: LastMatch | null;
  wipe: WipeState;
  /** Replay the tutorial in the next bot match even though it's done ("How to play"). */
  tutorialAgain: boolean;
  /** Every screen change goes through here: it plays the logo wipe and swaps under it. */
  go: (screen: Screen) => void;
  setStake: (stake: StakeTier) => void;
  setLastMatch: (m: LastMatch) => void;
  setTutorialAgain: (on: boolean) => void;
}

const params = new URLSearchParams(window.location.search);

/** `?screen=match` (or `vs`, `result`) opens straight to that screen, no wipe. Dev and screenshots. */
function initialScreen(): Screen {
  const s = params.get('screen');
  return s === 'vs' || s === 'match' || s === 'result' ? s : 'home';
}

let wipeTimer: ReturnType<typeof setTimeout> | undefined;
let wipeTarget: Screen | null = null;

export const useApp = create<AppState>((set, get) => ({
  screen: initialScreen(),
  stake: 'free',
  lastMatch: params.get('screen') === 'result' ? demoLastMatch(params.get('demo')) : null,
  wipe: 'idle',
  tutorialAgain: false,
  go: (screen) => {
    // A second go() while the panels are closing just changes where we're going.
    if (get().wipe === 'in') {
      wipeTarget = screen;
      return;
    }
    if (screen === get().screen && get().wipe === 'idle') return;
    clearTimeout(wipeTimer);
    wipeTarget = screen;
    set({ wipe: 'in' });
    sfx.wipeIn();
    wipeTimer = setTimeout(() => {
      set({ screen: wipeTarget ?? screen, wipe: 'out' });
      wipeTarget = null;
      sfx.wipeOut();
      wipeTimer = setTimeout(() => set({ wipe: 'idle' }), WIPE_OUT_MS);
    }, WIPE_IN_MS);
  },
  setStake: (stake) => set({ stake }),
  setLastMatch: (lastMatch) => set({ lastMatch }),
  setTutorialAgain: (tutorialAgain) => set({ tutorialAgain }),
}));

// --- per-device flags (localStorage; private windows can throw, so every access is guarded) ------

const TUTORIAL_KEY = 'ldgb.tutorialDone';
const BEST_KEY = 'ldgb.best';

function readLs(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLs(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the flag just doesn't persist */
  }
}

/** Has this device finished (or skipped) the first bot match? Unlocks staked PvP on Home. */
export function tutorialDone(): boolean {
  return readLs(TUTORIAL_KEY) === '1';
}

export function setTutorialDone() {
  writeLs(TUTORIAL_KEY, '1');
}

/**
 * Should the next bot match run the tutorial (bubbles; the source's `tutorial` flag, so the bot
 * can't overrun you in Fight 1)? Never in `?autoplay=1`.
 */
export function isTutorialMatch(): boolean {
  if (params.get('autoplay') === '1') return false;
  return !tutorialDone() || useApp.getState().tutorialAgain;
}

/** Personal best score on this device (0 if none). */
export function bestScore(): number {
  const n = Number(readLs(BEST_KEY));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function setBestScore(score: number) {
  writeLs(BEST_KEY, String(Math.floor(score)));
}

/** Is this a `?demo=…` result (a sample LastMatch, not a played match)? */
export const isDemoResult = params.get('screen') === 'result' && params.get('demo') !== null;

/**
 * `?screen=result&demo=1` (or `demo=lose|free|draw|overrun|fell`): a sample LastMatch so the result
 * ceremony can be seen without playing. The money numbers are worked out by hand from SPEC v5 §7
 * for S = 0.1 SOL; the real screen only ever shows what the MatchResult says.
 */
function demoLastMatch(kind: string | null): LastMatch | null {
  if (kind === null) return null;
  const S = 100_000_000;
  const win: ScoreParts = { damage: 380, towers: 150, first: 50, rush: 20 };
  const lose: ScoreParts = { damage: 270, towers: 100, first: 0, rush: 30 };
  const base = { mySide: 0 as Side, names: ['You', 'Rival'] as [string, string], stake: S, layoutName: 'Twin Bridges' };
  switch (kind) {
    case 'lose':
      return { ...base, breakdown: [lose, win], result: { winner: 1, died: null, gold: [400, 600], moved: 40_000_000, fee: 2_000_000 } };
    case 'free':
      return {
        ...base,
        names: ['You', 'Bot'],
        opponentIsBot: true,
        stake: 0,
        breakdown: [win, lose],
        result: { winner: 0, died: null, gold: [600, 400], moved: 0, fee: 0 },
      };
    case 'draw':
      return { ...base, breakdown: [lose, lose], result: { winner: null, died: null, gold: [400, 400], moved: 0, fee: 0 } };
    case 'overrun':
      return {
        ...base,
        breakdown: [{ damage: 120, towers: 50, first: 0, rush: 0 }, { damage: 210, towers: 50, first: 50, rush: 0 }],
        result: { winner: 1, died: 0, gold: [170, 310], moved: S, fee: 5_000_000 },
      };
    case 'fell':
      return {
        ...base,
        breakdown: [{ damage: 210, towers: 50, first: 50, rush: 0 }, { damage: 120, towers: 50, first: 0, rush: 0 }],
        result: { winner: 0, died: 1, gold: [310, 170], moved: S, fee: 5_000_000 },
      };
    default:
      return { ...base, breakdown: [win, lose], result: { winner: 0, died: null, gold: [600, 400], moved: 40_000_000, fee: 2_000_000 } };
  }
}
