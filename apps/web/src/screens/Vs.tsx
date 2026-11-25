import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { LAYOUTS } from '@lil-dudes/client';
import { sfx } from '../feel/sound';
import { layoutOfSeed, peekSeed } from '../match/nextSeed';
import { LanePreview } from './LanePreview';
import { useLive } from '../live/store';

// The live VS screen runs the chain steps: it loads with the live code.
const LiveVs = lazy(() => import('./LiveVs').then((m) => ({ default: m.LiveVs })));
import { useApp } from '../store';
import { sol } from './format';
import './flow.css';

/** The real chain steps of a staked match, shown as the loading copy (SPEC v5 §8). */
export const STAKED_STEPS = ['Locking stakes…', 'Rolling the dice (VRF)…', 'Entering the private arena…'];

export interface VsPlayer {
  name: string;
  /** A bot is always labelled Bot (and only ever appears in free play). */
  isBot?: boolean;
  /** Lamports at stake (staked play only). */
  stake?: number;
}

export interface VsProps {
  me: VsPlayer;
  them: VsPlayer;
  /** Staked play: the chain steps, in order. Omit for free play (a short "You vs Bot"). */
  steps?: string[];
  /** The step in progress (`steps.length` = all done). Omit to step through on a timer (demo). */
  step?: number;
  /** The level both players play (LAYOUTS index): its name and a little map under the cards. */
  layout?: number;
  onDone: () => void;
}

/** The VS screen is up for at least this long. */
const MIN_MS = 1000;
const DEMO_STEP_MS = 700;
const VS_AT = 450;
/** Free play: VS lands, then a beat to read the level card, then go. */
const FREE_DONE_AT = 2600;
/** Staked: VS → LIVE → go. */
const LIVE_AT = VS_AT + 650;
const STAKED_DONE_AT = LIVE_AT + 1300;

type Beat = 'steps' | 'cards' | 'vs' | 'live';

/**
 * VS / matchmaking (SPEC v5 §8). Free play: both cards slide in, VS hits, then `onDone`. Staked:
 * the chain steps tick off first (driven by `step`), then cards with stakes → VS → LIVE → `onDone`.
 */
export function Vs({ me, them, steps, step, layout, onDone }: VsProps) {
  const staked = !!steps && steps.length > 0;
  const [demoStep, setDemoStep] = useState(0);
  const current = staked ? (step ?? demoStep) : 0;
  const stepsDone = !staked || current >= steps!.length;
  const [beat, setBeat] = useState<Beat>(staked ? 'steps' : 'cards');
  const t0 = useRef(performance.now());
  const done = useRef(onDone);
  done.current = onDone;

  // Demo stepping when nobody drives `step`.
  useEffect(() => {
    if (!staked || step !== undefined || demoStep >= steps!.length) return;
    const t = setTimeout(() => setDemoStep((s) => s + 1), DEMO_STEP_MS);
    return () => clearTimeout(t);
  }, [staked, step, demoStep, steps]);

  // Cards → VS (→ LIVE) → done, once the steps are through.
  useEffect(() => {
    if (!stepsDone) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    setBeat('cards');
    sfx.whoosh();
    at(VS_AT, () => {
      setBeat('vs');
      sfx.vsHit();
    });
    if (staked) at(LIVE_AT, () => setBeat('live'));
    const end = staked ? STAKED_DONE_AT : FREE_DONE_AT;
    const elapsed = performance.now() - t0.current;
    at(Math.max(end, MIN_MS - elapsed), () => done.current());
    return () => timers.forEach(clearTimeout);
  }, [stepsDone, staked]);

  const showCards = beat !== 'steps';
  return (
    <div className={`screen vs beat-${beat}`}>
      <div className="vs-sky" aria-hidden>
        <i className="half me" />
        <i className="half them" />
      </div>

      {staked && (
        <ol className={`vs-steps ${showCards ? 'gone' : ''}`} aria-live="polite">
          {steps!.map((s, i) => (
            <li key={s} className={i < current ? 'ok' : i === current ? 'now' : ''}>
              <i aria-hidden />
              {s}
            </li>
          ))}
        </ol>
      )}

      {showCards && (
        <div className="vs-cards">
          <VsCard p={me} side="me" />
          <div className={`vs-stamp ${beat === 'cards' ? '' : 'on'}`} aria-label="versus">
            <span className="gnum" data-t="VS">
              VS
            </span>
          </div>
          <VsCard p={them} side="them" />
        </div>
      )}

      {showCards && layout !== undefined && (
        <div className="vs-map">
          <LanePreview layout={layout} className="vs-map-svg" />
          <div className="vs-map-text">
            <span className="vs-map-label">Level</span>
            <b className="vs-map-name">{LAYOUTS[layout]?.name ?? 'Arena'}</b>
            <span className="vs-map-line">Same map. Same gates. First to break the towers wins.</span>
          </div>
        </div>
      )}

      {beat === 'live' && <div className="vs-live">LIVE</div>}
      {!staked && showCards && <p className="vs-note">Free match · no stakes</p>}
    </div>
  );
}

/** Mascot heads (public/brand, drawn by us): our blue knight, the red Bot, a human rival's red knight. */
const HEAD = { me: '/brand/head-you.webp', bot: '/brand/head-bot.webp', rival: '/brand/head-rival.webp' } as const;

function VsCard({ p, side }: { p: VsPlayer; side: 'me' | 'them' }) {
  const head = side === 'me' ? HEAD.me : p.isBot ? HEAD.bot : HEAD.rival;
  const name = p.isBot ? 'Bot' : p.name;
  return (
    <div className={`vs-card ${side}`}>
      <div className={`vs-avatar ${p.isBot ? 'bot' : ''}`} aria-hidden>
        <img src={head} alt="" draggable={false} />
      </div>
      <b className="vs-name" title={name}>
        {name}
      </b>
      {p.stake !== undefined && p.stake > 0 && <span className="vs-stake">{sol(p.stake)} SOL</span>}
    </div>
  );
}

/**
 * The VS screen as the app shows it. Live play isn't wired yet, so every match from Home is a free
 * bot match; `?screen=vs&staked=1` shows the staked version with demo stepping.
 */
export function VsScreen() {
  const go = useApp((s) => s.go);
  const stakeLamports = useApp((s) => s.stake);
  // A live match (Quick Match, room, rematch) on its way: the real chain steps (live/session).
  const live = useLive((s) => s.phase === 'starting' || (s.phase === 'error' && s.chain.length > 0));
  const params = new URLSearchParams(window.location.search);
  const demoStaked = params.get('staked') === '1';
  // The match's seed is picked now, so this screen can show the level it will be played on.
  const [layout] = useState(() => layoutOfSeed(peekSeed()));
  // `?name=` previews a long opponent name (layout testing).
  const rivalName = params.get('name');
  if (live)
    return (
      <Suspense fallback={null}>
        <LiveVs />
      </Suspense>
    );
  if (rivalName) return <Vs me={{ name: 'You' }} them={{ name: rivalName }} layout={layout} onDone={() => go('match')} />;
  if (demoStaked) {
    const stake = stakeLamports;
    return <Vs me={{ name: 'You', stake }} them={{ name: 'Rival', stake }} steps={STAKED_STEPS} layout={layout} onDone={() => go('match')} />;
  }
  return <Vs me={{ name: 'You' }} them={{ name: 'Bot', isBot: true }} layout={layout} onDone={() => go('match')} />;
}
