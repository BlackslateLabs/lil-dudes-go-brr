// The light half of live play: the store the screens draw, its types, and helpers that need no
// Solana code. Home, the VS screen, the match and the result import this (and live/actions.ts for
// the flows), so the first screen and the offline bot match never wait for @solana/web3.js. The
// flows themselves live in live/session.ts and load on demand.
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { queueStats, STAKE_RESERVE, type GateOp, type LiveSource, type Side } from '@lil-dudes/client';
import { sol } from '../screens/format';
import { SERVER } from './storage';

export type StepState = 'todo' | 'now' | 'ok' | 'fail';
export interface Step {
  key: string;
  label: string;
  state: StepState;
  /** A second line (e.g. "connection lost, retrying"). */
  note?: string;
}

export type ErrorKind = 'server' | 'balance' | 'faucet' | 'room' | 'full' | 'aborted' | 'noshow' | 'chain' | 'stake' | 'tab';
export interface LiveError {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Run the same flow again. */
  retry?: () => void;
  /** The stake that was asked for (balance errors offer a top-up to it). */
  stake?: number;
}

export type LivePhase = 'idle' | 'queue' | 'host' | 'join' | 'starting' | 'playing' | 'ended' | 'error';
export type LiveMode = 'queue' | 'host' | 'join' | 'rematch' | 'rejoin';

/** A gate that flipped during the match (Verify checks each against the seed). */
export interface FlipLog {
  side: Side;
  stage: number;
  slot: number;
  op: GateOp;
}

export interface Opponent {
  name: string;
  address: string;
  bot: boolean;
}

export interface LiveState {
  phase: LivePhase;
  mode: LiveMode | null;
  /** Lamports per player (0 = free). */
  stake: number;
  /** When the current wait started (the waiting screens' clock). */
  since: number;
  /** Lobby steps (queue, room). */
  steps: Step[];
  /** On-chain steps shown on the VS screen. */
  chain: Step[];
  /** 'retrying' while the server or RPC is unreachable (the flow keeps trying). */
  conn: 'ok' | 'retrying';
  /** The room: the host's share card, or what a joiner is about to confirm. */
  room: { code: string; stake: number; host: string } | null;
  /** A joiner looked the room up and must confirm the stake. */
  confirm: boolean;
  /** Quick Match: alone at this stake for ~12 s (suggest nearby stakes and the bot). */
  lonely: boolean;
  /** Free Quick Match alone for ~5 s: offer "Play the Bot instead" (it never joins by itself). */
  botOffer: boolean;
  /** The online bot couldn't be called: the offer becomes the bot on this device. */
  botOffline: boolean;
  /** Queue liquidity while waiting (GET /queue/stats): others at my stake, the nearest stakes
   *  with someone waiting, players online. */
  qstats: { here: number; near: { stake: number; players: number }[]; online: number } | null;
  /** What Home can resume (a reloaded tab): from this device or the server's /me. */
  resume: { kind: 'match' | 'queue' | 'room'; label: string } | null;
  matchId: bigint | null;
  side: Side | null;
  opp: Opponent | null;
  source: LiveSource | null;
  layout: number | null;
  flips: FlipLog[];
  /** Burner balance in lamports (null = not fetched yet / unknown). */
  balance: number | null;
  /** Balance just before the payout landed (the result's count-up starts here). */
  balanceBefore: number | null;
  /** Bumps when the settlement is known (the result screen re-reads `source.reveal()`). */
  settled: number;
  error: LiveError | null;
}

export const IDLE: Omit<LiveState, 'balance'> = {
  phase: 'idle',
  mode: null,
  stake: 0,
  since: 0,
  steps: [],
  chain: [],
  conn: 'ok',
  room: null,
  confirm: false,
  lonely: false,
  botOffer: false,
  botOffline: false,
  qstats: null,
  resume: null,
  matchId: null,
  side: null,
  opp: null,
  source: null,
  layout: null,
  flips: [],
  balanceBefore: null,
  settled: 0,
  error: null,
};

export const useLive = create<LiveState>(() => ({ ...IDLE, balance: null }));

/** Short address: "4oar…aA4Z". */
export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The playing key's address, once the live code has loaded (it registers itself); null before. */
let keySource: () => string | null = () => null;
export function setKeySource(f: () => string | null) {
  keySource = f;
}
export const playingKey = (): string | null => keySource();

// --- faucet limits + cooldown (the cooldown itself is kept by live/session.ts, per game wallet) ---

/** The server faucet's limits (GET /faucet `policy`); these defaults until it answers. */
export interface FaucetPolicy {
  /** The most it fills a burner to (lamports). */
  maxBalance: number;
  /** Once per burner every this long. */
  burnerEveryMs: number;
  /** Top-ups per connection (IP) per window. */
  ipMax: number;
  ipWindowMs: number;
  /** What it adds on top of the stake (rent + fees). */
  reserve: number;
}

export const DEFAULT_POLICY: FaucetPolicy = {
  maxBalance: 300_000_000,
  burnerEveryMs: 10 * 60_000,
  ipMax: 3,
  ipWindowMs: 10 * 60_000,
  reserve: STAKE_RESERVE,
};

/** The faucet's limits and this tab's cooldown (kept apart from the live session, which resets). */
export const useFaucet = create<{ policy: FaucetPolicy; until: number | null }>(() => ({ policy: DEFAULT_POLICY, until: null }));


let policyAsked = false;
/** Reads the faucet's real limits once (GET /faucet); keeps the defaults if it can't. */
export function loadFaucetPolicy() {
  if (policyAsked) return;
  policyAsked = true;
  void fetch(`${SERVER.replace(/\/$/, '')}/faucet`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { policy?: Partial<FaucetPolicy> } | null) => {
      if (j?.policy) useFaucet.setState({ policy: { ...DEFAULT_POLICY, ...j.policy } });
    })
    .catch(() => undefined);
}

/** "7:42" (or "42 s"). */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
};

/** The faucet can fill a burner for this stake (stake + reserve within its cap). */
export const faucetCovers = (stake: number) => {
  const p = useFaucet.getState().policy;
  return stake + p.reserve <= p.maxBalance;
};

/** The limits in one line, for the "i" popover and refused top-ups. */
export function faucetLimits(p: FaucetPolicy = useFaucet.getState().policy): string {
  return `Free devnet SOL is limited: once every ${Math.round(p.burnerEveryMs / 60_000)} min, up to ${sol(p.maxBalance)} SOL.`;
}

/** "7:42" until `until` (ms), ticking each second; null once it has passed (or none). */
export function useCountdown(until: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until && until > now ? clock(until - now) : null;
}

/** "3 online · 1 searching" (the Quick Match sheet and the queue screen). Staked tickets pair at any
 *  amount now, so `here` counts every staked player for a stake, free ones for free. */
export const whoLine = (online: number, here: number, stake: number) => `${online} online · ${here} searching${stake ? '' : ' (free)'}`;

/** Who's around at this stake, refreshed every ~5 s while `on` (GET /queue/stats); null until known. */
export function useWhosAround(stake: number, on: boolean): string | null {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    const player = playingKey() ?? undefined;
    const tick = async () => {
      const st = await queueStats(SERVER, { stake, player }).catch(() => null);
      if (live && st) setLine(whoLine(st.online, st.here ?? 0, stake));
    };
    void tick();
    const t = setInterval(() => void tick(), 5_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [stake, on]);
  return line;
}

/** What a stake needs on the burner: the stake + the reserve (rent, delegation, fees). */
export const needFor = (stake: number) => stake + STAKE_RESERVE;

/** The Match screen's source when a live match is on (null = play offline vs the bot). */
export function liveMatchSource(): LiveSource | null {
  const s = useLive.getState();
  return (s.phase === 'playing' || s.phase === 'ended') && s.source ? s.source : null;
}
