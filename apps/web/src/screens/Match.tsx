import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { LANE_WIDTH, MATCH_TICKS, OfflineSource, PLANT_TICKS, STAGES, TICKS_PER_SEC } from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { modelsReady } from '../arena/models/assets';
import { setBattleDuck } from '../feel/sound';
import { useHud } from '../hud';
import { ChampionMeter } from '../match/ChampionMeter';
import { EndSequence, GradText } from '../match/EndSequence';
import { RaceBar } from '../match/RaceBar';
import { Tutorial } from '../match/Tutorial';
import type { MatchFeed } from '../match/feed';
import { useFeed } from '../match/useFeed';
import { isBreach, useMatchHud } from '../match/useMatchHud';
import { clearSeed, peekSeed } from '../match/nextSeed';
import { liveMatchSource, useLive } from '../live/session';
import { LiveBadge } from './LiveBadge';
import { PeekSheet } from './PeekConsole';
import { SoundControls } from './Settings';
import { isTutorialMatch, useApp } from '../store';
import '../match/hud.css';

/** Finger travel (fraction of screen width) that sweeps the cannon across the whole lane. */
const DRAG_SPAN = 0.7;
const STAGE_LABELS = Array.from({ length: STAGES }, (_, i) => `Fight ${i + 1}`);
/** "Done! Waiting…" waits until the TIME! stamp has had its moment. */
const TIME_STAMP_MS = 2200;

/** Wait for `n` animation frames (lets the arena mount and compile before the clock starts). */
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });

/** Match screen (SPEC v5 §8): your lane full size, the opponent as a track on the race bar. */
export function Match() {
  const [ready, setReady] = useState(false);
  const feed = useFeed(
    () => {
      // A live match (Quick Match, room, rematch): the Private Ephemeral Rollup feed.
      const live = liveMatchSource();
      if (live) return live;
      // The seed (it picks the layout) was chosen for the VS screen; `?seed=123` pins it (testing).
      // `?autoplay=1` lets the bot drive your side too (demos, screenshots).
      const params = new URLSearchParams(window.location.search);
      const seed = peekSeed();
      const selfBot = params.get('autoplay') === '1';
      // `?speed=4` plays the match faster (testing, screenshots). Clamped to 1–16.
      const speedRaw = Number(params.get('speed'));
      const speed = Number.isFinite(speedRaw) && speedRaw >= 1 ? Math.min(16, speedRaw) : 1;
      // A bot is always labelled "Bot"; in your first bot match its Fight 1 waves are gentler (SPEC v5 §8).
      const base = { myName: 'You', opponentName: 'Bot', selfBot, speed, tutorial: !selfBot && isTutorialMatch() };
      return new OfflineSource({ ...base, seed });
    },
    // Don't start the clock until the models are in and the arena has drawn (no first-frame stall).
    () =>
      modelsReady()
        .then(() => frames(2))
        .finally(() => setReady(true)),
  );
  useMatchHud(feed);

  // Rules v6: a finger on the lane holds the trigger (the cannon fires) and drags the aim;
  // lifting the last finger lets go (and launches a charged Champion).
  const drag = useRef<{ x: number; id: number } | null>(null);
  const fingers = useRef(new Set<number>());
  const hold = (on: boolean) => {
    feed.setFiring(on);
    useHud.getState().set({ holding: on });
  };
  const onDown = (e: PointerEvent) => {
    // A tap in Scout mode picks a gate; it doesn't pull the trigger.
    if (useHud.getState().peeking) return;
    fingers.current.add(e.pointerId);
    drag.current = { x: e.clientX, id: e.pointerId };
    hold(true);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || drag.current.id !== e.pointerId) return;
    const dxPx = e.clientX - drag.current.x;
    drag.current.x = e.clientX;
    const width = e.currentTarget.getBoundingClientRect().width;
    feed.nudgeAim((dxPx / (width * DRAG_SPAN)) * LANE_WIDTH);
  };
  const onUp = (e: PointerEvent) => {
    if (!fingers.current.delete(e.pointerId)) return;
    if (drag.current?.id === e.pointerId) {
      feed.flushAim();
      drag.current = null;
    }
    if (fingers.current.size === 0) hold(false);
  };
  // The next match (a rematch) gets a fresh seed once this one is gone.
  useEffect(() => clearSeed, []);
  // Losing the page (app switch, lock) lets go.
  useEffect(() => {
    const letGo = () => {
      fingers.current.clear();
      drag.current = null;
      hold(false);
    };
    const onVis = () => document.hidden && letGo();
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed]);

  return (
    <div
      className="screen match"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
    >
      <Arena feed={feed} interactive />
      <TopBar />
      <LiveBadge />
      <RaceBar />
      <Tutorial feed={feed} />
      <Prompts />
      <Banner />
      <EndSequence />
      <ThumbControls feed={feed} />
      <CogMenu />
      {!ready && (
        <div className="match-loading">
          <span>Loading…</span>
        </div>
      )}
    </div>
  );
}

function StagePips({ stage, phase }: { stage: number; phase: string }) {
  return (
    <span className="pips" title={STAGE_LABELS[stage]}>
      {STAGE_LABELS.map((_, i) => (
        <i key={i} className={i < stage || phase === 'done' ? 'done' : i === stage ? 'on' : ''} />
      ))}
    </span>
  );
}

/** Top bar: your score big on the left, a slim timer pill, the stake (the cog sits over the right end). */
function TopBar() {
  const name = useHud((s) => s.names[0]);
  const gold = useHud((s) => s.gold[0]);
  const stage = useHud((s) => s.stage[0]);
  const phase = useHud((s) => s.phase[0]);
  const tick = useHud((s) => s.tick);
  const status = useHud((s) => s.status);
  const stake = useHud((s) => s.stake);
  const left = Math.max(0, Math.ceil((MATCH_TICKS - tick) / TICKS_PER_SEC));
  return (
    <div className="hud topbar">
      <div className="tb-me">
        <GradText text={gold} className="tb-score" />
        <span className="tb-who">
          <b>{name}</b>
          <StagePips stage={stage} phase={phase} />
        </span>
      </div>
      <div className={`tb-timer ${status !== 'ended' && left <= 10 ? 'low' : ''}`}>{status === 'ended' ? '0:00' : formatTime(left)}</div>
      <div className="tb-right">
        <span className="tb-stake">{stake > 0 ? `${stake / 1e9} SOL` : 'FREE'}</span>
      </div>
    </div>
  );
}

/** One-line prompts just above your cannon (TECH §5). The breach has its own end sequence. */
function Prompts() {
  const phase = useHud((s) => s.phase);
  const myPhaseTick = useHud((s) => s.myPhaseTick);
  const peeking = useHud((s) => s.peeking);
  const holding = useHud((s) => s.holding);
  const names = useHud((s) => s.names);
  const stage = useHud((s) => s.stage[0]);
  const timeAt = useHud((s) => s.timeAt);
  const ended = useHud((s) => s.ended);
  useHud((s) => s.tick);
  let text: string | null = null;
  if (ended) {
    text = null;
  } else if (peeking) {
    text = 'Scout: tap one of your ? gates';
  } else if (phase[0] === 'plant') {
    const secs = Math.max(1, Math.ceil((PLANT_TICKS - myPhaseTick) / TICKS_PER_SEC));
    text = `${STAGE_LABELS[stage]}: fire in ${secs}…`;
  } else if (phase[0] === 'fight' && !holding) {
    text = 'Hold to fire!';
  } else if (phase[0] === 'transit') {
    text = 'Stage cleared!';
  } else if (phase[0] === 'done' && (timeAt === null || performance.now() - timeAt > TIME_STAMP_MS)) {
    text = phase[1] === 'done' || phase[1] === 'dead' ? 'Done!' : `Done! Waiting for ${names[1]}…`;
  }
  return text ? (
    <div className="hud prompt">
      <span>{text}</span>
    </div>
  ) : null;
}

/** Short centre banners (FIGHT 2, TOWER DOWN). Quiet once the end sequence starts. */
function Banner() {
  const banner = useHud((s) => s.banner);
  const ended = useHud((s) => s.ended);
  const breachAt = useHud((s) => s.breachAt);
  if (!banner || ended || (breachAt !== null && banner.at >= breachAt)) return null;
  return (
    <div key={banner.at} className={`banner-pop flash ${banner.tone}`}>
      {banner.text}
    </div>
  );
}

/** Bottom-right, by the thumb: Scout (once per stage) and the Champion meter. */
function ThumbControls({ feed }: { feed: MatchFeed }) {
  const peekUsed = useHud((s) => s.peekUsed);
  const peeking = useHud((s) => s.peeking);
  const phase = useHud((s) => s.phase[0]);
  const set = useHud((s) => s.set);
  const canScout = !peekUsed && (phase === 'fight' || isBreach(phase));
  return (
    <div className="hud thumb" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={`round scout ${peeking ? 'on' : ''}`}
        disabled={!canScout && !peeking}
        onClick={() => set({ peeking: !peeking })}
        title="Scout: privately reveal one of your gates (once per stage)"
      >
        👁
      </button>
      <ChampionMeter feed={feed} />
    </div>
  );
}

/**
 * The cog (no pause in PvP, SPEC v5 §8): sound, vibration, and "Leave match (forfeit)" behind an
 * in-page confirm. The match keeps running while the sheet is open.
 */
function CogMenu() {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [peek, setPeek] = useState(false);
  const stake = useHud((s) => s.stake);
  // Live matches only: an offline bot match has no sealed accounts to try.
  const live = useLive((s) => s.source);
  const close = () => {
    setOpen(false);
    setConfirming(false);
  };
  return (
    <>
      <button className="cog" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(true)} title="Menu" aria-label="Menu">
        ⚙
      </button>
      {peek && live && <PeekSheet src={live} onClose={() => setPeek(false)} />}
      {open && (
        <div className="cog-veil" onPointerDown={(e) => e.stopPropagation()} onClick={close}>
          <div className="cog-sheet" role="dialog" aria-label="Match menu" onClick={(e) => e.stopPropagation()}>
            {!confirming ? (
              <>
                <h3>Menu</h3>
                <p className="cog-note">The match keeps going.</p>
                <SoundControls />
                {live && !live.reveal() && (
                  <button
                    className="cog-row cog-peek"
                    onClick={() => {
                      close();
                      setPeek(true);
                    }}
                  >
                    <span>Try to peek at their gates</span>
                    <i>›</i>
                  </button>
                )}
                <button className="cog-leave" onClick={() => setConfirming(true)}>
                  Leave match (forfeit)
                </button>
                <button className="cog-back" onClick={close}>
                  Back to the match
                </button>
              </>
            ) : (
              <>
                <h3>Leave the match?</h3>
                <p className="cog-note">{stake > 0 ? 'You forfeit and lose your stake.' : 'You forfeit this match.'}</p>
                <button
                  className="cog-leave"
                  onClick={() => {
                    // Unmounting the match stops the source (useFeed). A live source will also
                    // need to tell the chain (forfeit) once LiveSource has that call.
                    setBattleDuck(false);
                    useApp.getState().go('home');
                  }}
                >
                  Leave (forfeit)
                </button>
                <button className="cog-back" onClick={() => setConfirming(false)}>
                  Stay
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatTime(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
